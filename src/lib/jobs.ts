import "server-only";
import pg from "pg";
import { db } from "./db";

// Tareas de fondo: un solo proceso a la vez (bloqueo consultivo de Postgres) y la última ejecución de cada
// una guardada en la tabla JobRun, para que los reinicios y los despliegues solapados no las repitan.

/** Claves de los bloqueos consultivos (números arbitrarios, fijos y distintos entre sí). */
export const LOCK_MAINTENANCE = 741_031_001;
export const LOCK_RELEASE_RESUME = 741_031_002;

export type LockResult<T> = { ran: true; value: T } | { ran: false };

/**
 * Ejecuta `fn` solo si este proceso consigue el bloqueo `key` (pg_try_advisory_lock) en una conexión propia,
 * abierta mientras dura `fn`; si otro proceso lo tiene, devuelve { ran: false } sin esperar. Si el proceso
 * muere, Postgres suelta el bloqueo al cerrarse la conexión. Los errores de `fn` se propagan.
 */
export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<LockResult<T>> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  // Sin este oyente, un corte de la conexión del bloqueo sería un error no capturado del proceso.
  client.on("error", (err) => console.error("[jobs] conexión del bloqueo", err.message));
  await client.connect();
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

export type JobOutcome = "ok" | "error" | "skipped";

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
