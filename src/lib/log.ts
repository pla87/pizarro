import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { actionContext } from "./action-context";
import { db } from "./db";
import { cleanText, clipText, isConnectionError } from "./log-clean";
import { notePresence } from "./presence";
import { maskSecretPaths } from "./secret-path";

// Registro de actividad (Administración → Logs). Los eventos se acumulan en memoria y se
// escriben en lote cada pocos segundos: registrar nunca añade una consulta a la petición.

type LogLevel = "info" | "warn" | "error";

interface LogEvent {
  level?: LogLevel;
  /** auth, page, action, api, notify, system… */
  category: string;
  /** Nombre del evento, p. ej. «tasks.createTask». */
  action: string;
  message?: string;
  userId?: string | null;
  userName?: string | null;
  projectId?: string | null;
  path?: string | null;
  durationMs?: number | null;
  ip?: string | null;
  details?: unknown;
}

const FLUSH_MS = 3000;
const MAX_QUEUE = 200;
const PURGE_EVERY_MS = 60 * 60 * 1000;

export function logRetentionDays(): number {
  const days = Number(process.env.LOG_RETENTION_DAYS ?? 7);
  return Number.isFinite(days) && days >= 1 ? Math.min(days, 90) : 7;
}

// En globalThis para sobrevivir a la recarga de módulos en desarrollo.
const state = (globalThis as unknown as { __pzLog?: { queue: Prisma.AppLogCreateManyInput[]; timer: ReturnType<typeof setTimeout> | null; lastPurge: number } })
  .__pzLog ??= { queue: [], timer: null, lastPurge: 0 };

const SECRET_KEY = /pass(word)?|token|secret|authorization|cookie|phone/i;

/**
 * Copia apta para guardar: sin secretos, con textos y listas recortados, y textos y claves sin lo que PostgreSQL no admite
 * en jsonb (NUL, medio emoji): un solo detalle así hacía fallar el lote entero, una y otra vez.
 */
function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.length > 500 ? `${clipText(value, 500)}… (${value.length} caracteres)` : cleanText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof File !== "undefined" && value instanceof File) return { file: value.name, type: value.type, size: value.size };
  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return sanitize(Object.fromEntries([...value.entries()].map(([k, v]) => [k, SECRET_KEY.test(k) ? "[oculto]" : v])), depth);
  }
  if (depth >= 4) return "[…]";
  if (Array.isArray(value)) {
    const items = value.slice(0, 30).map((v) => sanitize(v, depth + 1));
    return value.length > 30 ? [...items, `… y ${value.length - 30} más`] : items;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [rawKey, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      const k = clipText(rawKey, 200);
      out[k] = SECRET_KEY.test(k) ? "[oculto]" : sanitize(v, depth + 1);
    }
    return out;
  }
  return cleanText(String(value));
}

/** Texto opcional limpio y recortado (null si no hay). */
const optText = (s: string | null | undefined, max: number) => (s ? clipText(s, max) : null);

export function logEvent(e: LogEvent): void {
  try {
    const store = actionContext.getStore();
    // Última red de seguridad: ninguna ruta con credencial en la URL (calendario, /reset/, /confirm/) llega al registro.
    // Todo texto se limpia (NUL, medio emoji) y se recorta sin partir emojis: PostgreSQL rechazaría la fila (y su lote).
    // El projectId puede venir de los argumentos del cliente (ver lib/action.ts), así que también.
    const message = clipText(maskSecretPaths(e.message ?? ""), 1000);
    const projectId = optText(e.projectId ?? store?.projectId, 100);
    state.queue.push({
      createdAt: new Date(),
      level: e.level ?? "info",
      category: clipText(e.category, 60),
      action: clipText(e.action, 120),
      message,
      userId: optText(e.userId, 100),
      userName: optText(e.userName, 200),
      // Sin proyecto explícito, el de la acción en curso (si lo hay): lo usan los logs para ocultar los privados ajenos.
      projectId,
      privateProjectId: store?.projectIsPrivate && (e.projectId ?? store.projectId) === store.projectId ? optText(store.projectId, 100) : null,
      path: e.path ? clipText(maskSecretPaths(e.path), 500) : null,
      durationMs: e.durationMs == null ? null : Math.round(e.durationMs),
      ip: optText(e.ip, 100),
      details: e.details === undefined ? undefined : (sanitize(e.details) as Prisma.InputJsonValue),
    });
    // Presencia en el tablero: cualquier acción. Las visitas de página no (el tablero se refresca solo): abrir el tablero o
    // una tarea lo anotan sus propios sondeos (rutas de presence y viewers).
    // Solo acciones correctas: una fallida (p. ej. sin acceso) podría traer un projectId ajeno del cliente.
    if (projectId && e.userId && e.category !== "page" && (e.level ?? "info") === "info") notePresence(projectId, e.userId, e.userName ?? "?");
    if (e.level === "error") console.error(`[${e.category}] ${e.action}: ${message.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")}`);
    if (state.queue.length >= MAX_QUEUE) void flushLogs();
    else state.timer ??= setTimeout(() => void flushLogs(), FLUSH_MS);
  } catch (err) {
    console.error("[log] no se pudo registrar el evento", err);
  }
}

/** Escribe los eventos pendientes y, como mucho una vez por hora, borra los antiguos. */
export async function flushLogs(): Promise<void> {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  const batch = state.queue.splice(0);
  // Lo que se devuelve a la cola si se corta la conexión: nunca lo ya guardado (un fallo al purgar no duplica filas).
  let pending = batch;
  try {
    if (batch.length) {
      // Se anota el proyecto cuando es privado (sigue ocultando el detalle aunque el proyecto se borre).
      const ids = [...new Set(batch.map((e) => e.projectId).filter((id): id is string => !!id))];
      const privates = ids.length
        ? new Set((await db.project.findMany({ where: { id: { in: ids }, isPrivate: true }, select: { id: true } })).map((p) => p.id))
        : new Set<string>();
      const rows = batch.map((e) => ({ ...e, privateProjectId: e.privateProjectId ?? (e.projectId && privates.has(e.projectId) ? e.projectId : null) }));
      try {
        await db.appLog.createMany({ data: rows });
      } catch (err) {
        if (isConnectionError(err)) throw err;
        // La base rechaza alguna fila por su contenido: se guardan una a una y se descartan solo las que no admite. Antes
        // el lote entero volvía a la cola y fallaba para siempre (ningún log más se guardaba).
        for (let i = 0; i < rows.length; i++) {
          try {
            await db.appLog.create({ data: rows[i]! });
          } catch (rowErr) {
            if (isConnectionError(rowErr)) {
              pending = batch.slice(i);
              throw rowErr;
            }
            console.error(`[log] evento descartado (la base de datos no admite su contenido): ${rows[i]!.category} ${rows[i]!.action}`, rowErr);
          }
        }
      }
      pending = [];
    }
    if (Date.now() - state.lastPurge > PURGE_EVERY_MS) {
      state.lastPurge = Date.now();
      await db.appLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - logRetentionDays() * 86_400_000) } } });
    }
  } catch (err) {
    console.error("[log] no se pudieron guardar los eventos", err);
    // Se devuelven a la cola para el siguiente intento (con tope, por si la BD sigue caída).
    state.queue.unshift(...pending.slice(-MAX_QUEUE * 5));
    if (state.queue.length > MAX_QUEUE * 10) state.queue.splice(0, state.queue.length - MAX_QUEUE * 10);
  }
}
