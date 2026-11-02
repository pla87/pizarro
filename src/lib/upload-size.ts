// Tamaño máximo de un adjunto. El tope real es por proyecto (`Project.fileMaxMb`, 1–100 MB); la variable
// opcional MAX_UPLOAD_MB lo limita además para todo el servidor. Se lee al atender cada subida (no al compilar).
// Sin dependencias: lo usan la ruta de subida, las páginas, la validación y next.config.ts.

/** Límites del ajuste «tamaño máximo de un adjunto» del proyecto (MB) y valor por defecto. */
export const FILE_MAX_MIN_MB = 1;
export const FILE_MAX_MAX_MB = 100;
export const FILE_MAX_DEFAULT_MB = 20;

/** Margen del envoltorio multipart (cabeceras y separadores) sobre el tamaño del archivo. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Tope del servidor entero en MB: MAX_UPLOAD_MB si es un número positivo; si falta o no es válido, null (sin tope propio). */
export function serverUploadCapMb(raw: string | undefined = process.env.MAX_UPLOAD_MB): number | null {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

/** Megas que admite un adjunto del proyecto: el menor entre su ajuste y el tope opcional del servidor. */
export function effectiveFileMaxMb(projectMb: number, raw: string | undefined = process.env.MAX_UPLOAD_MB): number {
  const cap = serverUploadCapMb(raw);
  return cap === null ? projectMb : Math.min(projectMb, cap);
}

/**
 * Tope del cuerpo que el proxy de Next guarda en memoria (`proxyClientMaxBodySize`, ver next.config.ts): 2 MB, el doble
 * de lo que admiten las acciones (1 MB). Las subidas de archivos no pasan por el proxy (src/proxy.ts las saca del
 * matcher), así que este tope no limita los adjuntos: su máximo (por proyecto, y MAX_UPLOAD_MB si existe) lo aplica la
 * ruta de subida al leer el cuerpo, sin recompilar.
 */
export const PROXY_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
