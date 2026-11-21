import "server-only";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { LOCK_INSTANCE } from "./advisory-locks";
import { db } from "./db";
import {
  INSTANCE_APP_NAME_PREFIX, INSTANCE_CHECK_MS, INSTANCE_CONFLICT_GRACE_MS, INSTANCE_NOTICE_KEY, instanceLockProcess, instanceLockStatus, nextLockStatus, otherInstanceNotice, parseStoredNotice, poolerInUrl,
  type InstanceLockStatus, type LockAttempt,
} from "./instance-lock-core";
import { logEvent } from "./log";
import { connectPgClient } from "./pg-connect";
import { onShutdown } from "./shutdown";

// ¿Hay otra copia de Pizarro usando esta misma base de datos? (otro servicio de Railway, un despliegue viejo que sigue en
// marcha, un `npm start` de prueba apuntando a la base de producción…). Dos copias a la vez se pisan: el bot de Telegram
// por sondeo pierde mensajes (Telegram solo entrega cada uno a una), las tareas de fondo y las copias se reparten entre
// las dos, cada una tiene sus propios archivos subidos y sus avisos en vivo no llegan a quien está en la otra.
//
// Cada proceso del servidor intenta coger el bloqueo consultivo LOCK_INSTANCE en una conexión propia y lo mantiene toda su
// vida (PostgreSQL lo suelta al cerrarse la conexión, también si el proceso muere). Si otra copia lo tiene, se reintenta
// cada INSTANCE_CHECK_MS y solo se avisa si dura más de INSTANCE_CONFLICT_GRACE_MS: en un despliegue de Railway la versión
// nueva y la anterior conviven unos segundos. No impide arrancar ni hacer nada: solo avisa (log, registro de actividad y
// Administración). La copia que avisa lo deja en AppState (INSTANCE_NOTICE_KEY) para que la otra también lo muestre.
//
// PgBouncer en modo transacción: cada consulta puede ir por una conexión distinta del servidor, así que un bloqueo de
// sesión no es fiable (puede quedarse cogido en una conexión del pooler tras parar la copia que lo tenía, o «tenerlo» otra
// sesión). Se reconoce por `pgbouncer=true` en DATABASE_URL, porque la sesión que lo tiene no es de ninguna copia de
// Pizarro o porque nuestra conexión deja de ser la que lo tiene: entonces no se comprueba nada y no hay avisos falsos.

/** Comprueba y mantiene el bloqueo de esta copia. Sin temporizadores: quien lo usa llama a tick() (lo prueba tests/db). */
export class InstanceLockMonitor {
  status: InstanceLockStatus = { status: "starting" };
  private client: pg.Client | null = null;
  private pid: number | null = null;

  constructor(
    private readonly opts: {
      url: string;
      appName: string;
      graceMs?: number;
      now?: () => number;
      /** Cada cambio de estado (para el log y el registro). */
      onChange?: (prev: InstanceLockStatus, next: InstanceLockStatus) => void;
      /** Mientras dura el aviso, en cada comprobación (para que la otra copia también lo vea). */
      onConflict?: (status: Extract<InstanceLockStatus, { status: "conflict" }>) => Promise<void>;
    },
  ) {}

  async tick(): Promise<InstanceLockStatus> {
    if (this.status.status === "pooler") return this.status;
    const attempt = await this.check();
    const prev = this.status;
    const next = nextLockStatus(prev, attempt, this.now(), this.opts.appName, this.opts.graceMs ?? INSTANCE_CONFLICT_GRACE_MS);
    this.status = next;
    if (next.status === "pooler") await this.closeClient();
    if (prev.status !== next.status) this.opts.onChange?.(prev, next);
    if (next.status === "conflict") await this.opts.onConflict?.(next).catch((err) => console.error("[instance] no se pudo guardar el aviso", err));
    return next;
  }

  /** Suelta el bloqueo y cierra la conexión (al apagar). */
  async stop(): Promise<void> {
    if (this.client && this.status.status === "held") await this.client.query("SELECT pg_advisory_unlock($1)", [LOCK_INSTANCE]).catch(() => {});
    await this.closeClient();
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private async check(): Promise<LockAttempt> {
    try {
      const client = await this.connection();
      if (this.status.status === "held") {
        // Sigue siendo nuestro: misma sesión (con un pooler en modo transacción cambiaría) y con el bloqueo.
        const { rows } = await client.query<{ pid: number; mine: boolean }>(
          "SELECT pg_backend_pid() AS pid, EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid = pg_backend_pid() AND classid = 0 AND objid = $1 AND objsubid = 1) AS mine",
          [LOCK_INSTANCE],
        );
        return rows[0]?.mine && rows[0].pid === this.pid ? { kind: "acquired" } : { kind: "lost" };
      }
      const { rows } = await client.query<{ ok: boolean; pid: number }>("SELECT pg_try_advisory_lock($1) AS ok, pg_backend_pid() AS pid", [LOCK_INSTANCE]);
      if (rows[0]?.ok) {
        this.pid = rows[0].pid;
        return { kind: "acquired" };
      }
      const holder = await client.query<{ app: string | null; since: Date | null }>(
        "SELECT a.application_name AS app, a.backend_start AS since FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND l.granted AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND l.classid = 0 AND l.objid = $1 AND l.objsubid = 1 LIMIT 1",
        [LOCK_INSTANCE],
      );
      const h = holder.rows[0];
      return { kind: "busy", holder: h ? { appName: h.app, since: h.since ? new Date(h.since).toISOString() : null } : null };
    } catch (err) {
      // Conexión perdida: PostgreSQL ya soltó el bloqueo; en la siguiente comprobación se abre otra y se vuelve a pedir.
      await this.closeClient();
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  private async connection(): Promise<pg.Client> {
    if (this.client) return this.client;
    const client = await connectPgClient(this.opts.url, { label: "instance", applicationName: this.opts.appName });
    // Como en jobs.ts: si esta máquina desaparece sin cerrar la conexión, PostgreSQL lo nota en ~1,5 min y suelta el
    // bloqueo (con el keepalive del sistema, unas 2 h, la copia nueva avisaría de una copia que ya no existe).
    await client.query("SET tcp_keepalives_idle = 60; SET tcp_keepalives_interval = 10; SET tcp_keepalives_count = 3").catch(() => {});
    this.client = client;
    this.pid = null;
    return client;
  }

  private async closeClient(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.pid = null;
    await c?.end().catch(() => {});
  }
}

// --- Proceso del servidor ------------------------------------------------------------------------


const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

function logChange(prev: InstanceLockStatus, next: InstanceLockStatus): void {
  if (next.status === "conflict") {
    const message = `Hay otra copia de Pizarro usando esta misma base de datos desde hace más de ${minutes(INSTANCE_CONFLICT_GRACE_MS)} minutos. Dos copias a la vez se pisan (Telegram por sondeo, tareas de fondo, copias de seguridad, archivos subidos). Para la que sobra: un servicio o un despliegue antiguo de Railway, otro servidor o un npm start de prueba con esta DATABASE_URL.`;
    console.warn(`[instance] AVISO: ${message}`);
    logEvent({ level: "warn", category: "system", action: "system.otherInstance", message, details: { holderSince: next.holderSince } });
  } else if (prev.status === "conflict" && next.status === "held") {
    console.log("[instance] La otra copia de Pizarro ya no usa esta base de datos.");
    logEvent({ category: "system", action: "system.otherInstanceGone", message: "La otra copia de Pizarro ya no usa esta base de datos." });
    void db.appState.deleteMany({ where: { key: INSTANCE_NOTICE_KEY } }).catch(() => {});
  } else if (next.status === "pooler") {
    console.log("[instance] La conexión con PostgreSQL pasa por un pooler en modo transacción (PgBouncer): no se puede comprobar si otra copia de Pizarro usa esta base.");
  } else if (next.status === "waiting" && prev.status !== "conflict") {
    console.log(`[instance] Otra copia de Pizarro usa esta base de datos (lo normal unos segundos durante un despliegue); si sigue pasados ${minutes(INSTANCE_CONFLICT_GRACE_MS)} minutos, se avisará.`);
  }
}

async function saveNotice(status: Extract<InstanceLockStatus, { status: "conflict" }>): Promise<void> {
  const value = JSON.stringify({ at: new Date().toISOString(), since: new Date(status.since).toISOString() });
  await db.appState.upsert({ where: { key: INSTANCE_NOTICE_KEY }, create: { key: INSTANCE_NOTICE_KEY, value }, update: { value } });
}

/** Arranca la comprobación (instrumentation.ts). Una sola vez por proceso; se para con el apagado ordenado. */
export function startInstanceLock(env: Record<string, string | undefined> = process.env): void {
  const proc = instanceLockProcess();
  if (proc.started) return;
  proc.started = true;
  const url = env.DATABASE_URL ?? "";
  if (!url) return;
  if (poolerInUrl(url)) {
    proc.current = { status: "pooler" };
    logChange({ status: "starting" }, proc.current);
    return;
  }
  const monitor = new InstanceLockMonitor({ url, appName: `${INSTANCE_APP_NAME_PREFIX}${randomBytes(6).toString("hex")}`, onChange: logChange, onConflict: saveNotice });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const loop = async () => {
    await monitor.tick().catch((err) => console.error("[instance]", err));
    proc.current = monitor.status;
    if (!stopped && monitor.status.status !== "pooler") (timer = setTimeout(loop, INSTANCE_CHECK_MS)).unref();
  };
  void loop();
  onShutdown("instanceLock", async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await monitor.stop();
  });
}

/** Aviso para Administración, o null: lo que ve este proceso o lo que dejó guardado la otra copia hace poco. */
export async function getOtherInstanceNotice(now: number = Date.now()): Promise<{ since: string } | null> {
  const local = instanceLockStatus();
  if (local.status === "conflict" || local.status === "pooler") return otherInstanceNotice(local, null, now);
  const row = await db.appState.findUnique({ where: { key: INSTANCE_NOTICE_KEY }, select: { value: true } }).catch(() => null);
  return otherInstanceNotice(local, parseStoredNotice(row?.value), now);
}
