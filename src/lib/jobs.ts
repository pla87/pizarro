import "server-only";
import { db } from "./db";
import { connectPgClient } from "./pg-connect";

// Tareas de fondo: un solo proceso a la vez (bloqueo consultivo de Postgres) y la última ejecución de cada
// una guardada en la tabla JobRun, para que los reinicios y los despliegues solapados no las repitan.

// Las claves de los bloqueos están todas en advisory-locks.ts (para que no se repitan).

type LockResult<T> = { ran: true; value: T } | { ran: false };

/**
 * Ejecuta `fn` solo si este proceso consigue el bloqueo `key` (pg_try_advisory_lock) en una conexión propia,
 * abierta mientras dura `fn`; si otro proceso lo tiene, devuelve { ran: false } sin esperar. Si el proceso
 * muere, Postgres suelta el bloqueo al cerrarse la conexión. Los errores de `fn` se propagan.
 */
export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>, opts: { url?: string; connectTimeoutMs?: number } = {}): Promise<LockResult<T>> {
  // Con tope para conectar y keepalive (pg-connect.ts): si la base no contesta, la pasada falla y la siguiente lo
  // vuelve a intentar, en vez de quedarse esperando para siempre. `opts`: solo para pruebas.
  const client = await connectPgClient(opts.url ?? process.env.DATABASE_URL ?? "", { label: "jobs", connectTimeoutMs: opts.connectTimeoutMs });
  try {
    const { rows } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [key]);
    if (!rows[0]?.ok) return { ran: false };
    try {
      return { ran: true, value: await fn() };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]).catch(() => {});
    }
  } finally {
    await client.end().catch(() => {});
  }
}

export interface JobDef {
  /** Nombre fijo (clave de JobRun). */
  name: string;
  run: () => Promise<unknown>;
  /** Si se indica, no se repite hasta que pase este tiempo desde el último arranque (guardado en JobRun). */
  everyMs?: number;
}

type JobOutcome = "ok" | "error" | "skipped";

const MAX_ERROR_CHARS = 500;

/** Ejecuta una tarea y anota en JobRun cuándo empezó y cómo terminó; nunca lanza. */
export async function runJob(job: JobDef, now: Date = new Date()): Promise<JobOutcome> {
  try {
    if (job.everyMs) {
      const last = await db.jobRun.findUnique({ where: { name: job.name }, select: { lastStartedAt: true } });
      if (last?.lastStartedAt && now.getTime() - last.lastStartedAt.getTime() < job.everyMs) return "skipped";
    }
    await db.jobRun.upsert({ where: { name: job.name }, create: { name: job.name, lastStartedAt: now }, update: { lastStartedAt: now } });
  } catch (err) {
    console.error(`[jobs] ${job.name}: no se pudo anotar el inicio`, err);
    return "error";
  }
  let error: string | null = null;
  try {
    await job.run();
  } catch (err) {
    console.error(`[jobs] ${job.name}`, err);
    error = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_CHARS) || "Error";
  }
  try {
    await db.jobRun.update({ where: { name: job.name }, data: { lastFinishedAt: new Date(), lastOk: error === null, lastError: error } });
  } catch (err) {
    console.error(`[jobs] ${job.name}: no se pudo anotar el final`, err);
  }
  return error === null ? "ok" : "error";
}

export interface JobRunInfo {
  name: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
}

/** Estado de todas las tareas (Administración → Copias de seguridad). */
export async function listJobRuns(): Promise<JobRunInfo[]> {
  const rows = await db.jobRun.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({
    name: r.name,
    lastStartedAt: r.lastStartedAt?.toISOString() ?? null,
    lastFinishedAt: r.lastFinishedAt?.toISOString() ?? null,
    lastOk: r.lastOk,
    lastError: r.lastError,
  }));
}
