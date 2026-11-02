// Cuotas de almacenamiento de adjuntos. Funciones puras (el uso se calcula en la ruta de subida y los ajustes
// guardados en la base de datos los lee quota-settings.ts).

const MB = 1024 * 1024;

/** Cuota por proyecto cuando nadie ha configurado nada: 10 GB. */
export const DEFAULT_PROJECT_QUOTA_MB = 10240;
/** Margen de lo que se puede configurar (MB). */
export const QUOTA_MIN_MB = 1;
export const QUOTA_MAX_MB = 10_000_000;

/** Valor positivo de una variable de entorno en MB; vacío, 0 o inválido → null (como si no estuviera definida). */
export function parseEnvMb(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Ajuste guardado en la aplicación: sin tocar (por defecto), sin límite o un número de MB. */
export type QuotaSetting = { mode: "default" } | { mode: "unlimited" } | { mode: "custom"; mb: number };

export function parseQuotaSetting(raw: string | null | undefined): QuotaSetting {
  if (raw === "unlimited") return { mode: "unlimited" };
  const n = Number(raw);
  return raw != null && raw.trim() !== "" && Number.isInteger(n) && n >= QUOTA_MIN_MB && n <= QUOTA_MAX_MB ? { mode: "custom", mb: n } : { mode: "default" };
}

export function serializeQuotaSetting(s: QuotaSetting): string | null {
  return s.mode === "default" ? null : s.mode === "unlimited" ? "unlimited" : String(s.mb);
}

export type QuotaSource = "project" | "env" | "app" | "default" | "none";

/**
 * Cuota efectiva de un proyecto en MB (null = sin límite). Orden: la del propio proyecto, la variable de entorno
 * UPLOAD_QUOTA_MB_PER_PROJECT, el ajuste de Administración y, si no hay nada, 10 GB.
 */
export function resolveProjectQuota(input: { override?: number | null; env?: string; app: QuotaSetting }): { mb: number | null; source: QuotaSource } {
  if (input.override != null && input.override > 0) return { mb: input.override, source: "project" };
  const env = parseEnvMb(input.env);
  if (env !== null) return { mb: env, source: "env" };
  if (input.app.mode === "custom") return { mb: input.app.mb, source: "app" };
  if (input.app.mode === "unlimited") return { mb: null, source: "app" };
  return { mb: DEFAULT_PROJECT_QUOTA_MB, source: "default" };
}

/** Cuota total del servidor en MB: la variable de entorno manda sobre el ajuste; sin ninguno, sin límite. */
export function resolveTotalQuota(input: { env?: string; app: QuotaSetting }): { mb: number | null; source: QuotaSource } {
  const env = parseEnvMb(input.env);
  if (env !== null) return { mb: env, source: "env" };
  if (input.app.mode === "custom") return { mb: input.app.mb, source: "app" };
  return { mb: null, source: "none" };
}

export interface QuotaExceeded {
  scope: "project" | "total";
  usedMb: number;
  limitMb: number;
}

export interface QuotaBytes {
  /** null = sin límite. */
  project: number | null;
  total: number | null;
}

export const mbToBytes = (mb: number | null): number | null => (mb === null ? null : mb * MB);

/** ¿Caben `add` bytes más? Devuelve null si sí; si no, qué cuota se supera y el uso actual en MB. */
export function checkQuota(used: { project: number; total: number }, add: number, limits: QuotaBytes): QuotaExceeded | null {
  const toMb = (b: number) => Math.round((b / MB) * 10) / 10;
  if (limits.project !== null && used.project + add > limits.project) return { scope: "project", usedMb: toMb(used.project), limitMb: toMb(limits.project) };
  if (limits.total !== null && used.total + add > limits.total) return { scope: "total", usedMb: toMb(used.total), limitMb: toMb(limits.total) };
  return null;
}
