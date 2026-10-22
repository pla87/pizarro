// Cuotas de almacenamiento de adjuntos. Funciones puras (el uso se calcula en la ruta de subida).

const MB = 1024 * 1024;

function envMb(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Cuota por proyecto en bytes (UPLOAD_QUOTA_MB_PER_PROJECT, 2048 MB por defecto). 0 o inválido → por defecto. */
export function projectQuotaBytes(): number {
  return (envMb("UPLOAD_QUOTA_MB_PER_PROJECT") ?? 2048) * MB;
}

/** Cuota total del servidor en bytes (UPLOAD_QUOTA_MB_TOTAL), o null si no hay límite. */
export function totalQuotaBytes(): number | null {
  const mb = envMb("UPLOAD_QUOTA_MB_TOTAL");
  return mb === null ? null : mb * MB;
}

export interface QuotaExceeded {
  scope: "project" | "total";
  usedMb: number;
  limitMb: number;
}

/** ¿Caben `add` bytes más? Devuelve null si sí; si no, qué cuota se supera y el uso actual en MB. */
export function checkQuota(
  used: { project: number; total: number },
  add: number,
  limits: { project: number; total: number | null } = { project: projectQuotaBytes(), total: totalQuotaBytes() },
): QuotaExceeded | null {
  const toMb = (b: number) => Math.round((b / MB) * 10) / 10;
  if (used.project + add > limits.project) return { scope: "project", usedMb: toMb(used.project), limitMb: toMb(limits.project) };
  if (limits.total !== null && used.total + add > limits.total) return { scope: "total", usedMb: toMb(used.total), limitMb: toMb(limits.total) };
  return null;
}
