// Cómo se lee una fila de JobRun (sin dependencias: lo usan jobs.ts, con "server-only", y el diagnóstico de
// scripts/doctor.ts, que corre fuera de Next).

/**
 * Una tarea que termina bien sin hacer nada a propósito guarda en JobRun.lastError el motivo con este prefijo y
 * lastOk = true (sin columna nueva). Un error real que empiece igual no se confunde: va con lastOk = false.
 */
export const SKIP_PREFIX = "skip:";

export interface JobRunInfo {
  name: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  /** Terminó bien sin hacer nada: el motivo (clave de JobSkip); null si hizo su trabajo o falló. */
  skipped: string | null;
}

interface JobRunRow {
  name: string;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastOk: boolean | null;
  lastError: string | null;
}

/** Fila de JobRun tal como se enseña: la omisión aparte (`skipped`) y no como error. */
export function jobRunView(r: JobRunRow): JobRunInfo {
  const skipped = r.lastOk && r.lastError?.startsWith(SKIP_PREFIX) ? r.lastError.slice(SKIP_PREFIX.length) : null;
  return {
    name: r.name,
    lastStartedAt: r.lastStartedAt?.toISOString() ?? null,
    lastFinishedAt: r.lastFinishedAt?.toISOString() ?? null,
    lastOk: r.lastOk,
    lastError: skipped !== null ? null : r.lastError,
    skipped,
  };
}
