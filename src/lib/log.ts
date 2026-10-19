import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { actionContext } from "./action-context";
import { db } from "./db";

// Registro de actividad (Administración → Logs). Los eventos se acumulan en memoria y se
// escriben en lote cada pocos segundos: registrar nunca añade una consulta a la petición.

export type LogLevel = "info" | "warn" | "error";

export interface LogEvent {
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

const SECRET_KEY = /pass(word)?|token|secret|authorization|cookie/i;

/** Copia apta para guardar: sin secretos, con textos y listas recortados. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}… (${value.length} caracteres)` : value;
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
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[k] = SECRET_KEY.test(k) ? "[oculto]" : sanitize(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function logEvent(e: LogEvent): void {
  try {
    state.queue.push({
      createdAt: new Date(),
      level: e.level ?? "info",
      category: e.category,
      action: e.action.slice(0, 120),
      message: (e.message ?? "").slice(0, 1000),
      userId: e.userId ?? null,
      userName: e.userName ?? null,
      // Sin proyecto explícito, el de la acción en curso (si lo hay): lo usan los logs para ocultar los privados ajenos.
      projectId: e.projectId ?? actionContext.getStore()?.projectId ?? null,
      path: e.path?.slice(0, 500) ?? null,
      durationMs: e.durationMs == null ? null : Math.round(e.durationMs),
      ip: e.ip ?? null,
      details: e.details === undefined ? undefined : (sanitize(e.details) as Prisma.InputJsonValue),
    });
    if (e.level === "error") console.error(`[${e.category}] ${e.action}: ${e.message ?? ""}`);
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
  try {
    if (batch.length) {
      // Se anota el dueño de los proyectos privados afectados (sigue sirviendo aunque el proyecto se borre).
      const ids = [...new Set(batch.map((e) => e.projectId).filter((id): id is string => !!id))];
      const owners = ids.length
        ? new Map((await db.project.findMany({ where: { id: { in: ids }, privateOwnerId: { not: null } }, select: { id: true, privateOwnerId: true } })).map((p) => [p.id, p.privateOwnerId]))
        : new Map<string, string | null>();
      await db.appLog.createMany({ data: batch.map((e) => ({ ...e, privateOwnerId: (e.projectId && owners.get(e.projectId)) || null })) });
    }
    if (Date.now() - state.lastPurge > PURGE_EVERY_MS) {
      state.lastPurge = Date.now();
      await db.appLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - logRetentionDays() * 86_400_000) } } });
    }
  } catch (err) {
    console.error("[log] no se pudieron guardar los eventos", err);
  }
}
