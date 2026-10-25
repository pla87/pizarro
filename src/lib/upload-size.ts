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
 * Tope fijo del cuerpo de la petición en el proxy de Next (`proxyClientMaxBodySize`): el mayor archivo posible
 * (FILE_MAX_MAX_MB) más el envoltorio multipart, con margen. No depende de ninguna variable de entorno, así que
 * no hace falta recompilar al cambiar los límites: el límite real se comprueba en la ruta de subida.
 */
export const PROXY_BODY_LIMIT_BYTES = FILE_MAX_MAX_MB * 1024 * 1024 + 1024 * 1024;
