// Tamaño máximo por adjunto (MAX_UPLOAD_MB). Sin dependencias: lo usan tanto la ruta de subida como
// next.config.ts, que fija con él el tope del cuerpo que admite el proxy de Next.

const DEFAULT_MB = 20;

/** Megas por adjunto: MAX_UPLOAD_MB si es un número positivo; si falta o no es válido, 20. */
export function maxUploadMb(raw: string | undefined = process.env.MAX_UPLOAD_MB): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : DEFAULT_MB;
}

/**
 * Tope del cuerpo de la petición en el proxy de Next (`proxyClientMaxBodySize`): el archivo más el
 * envoltorio multipart (cabeceras y separadores, unos cientos de bytes) con margen. Si fuese menor que
 * MAX_UPLOAD_MB, el proxy cortaría el cuerpo y la subida fallaría antes de llegar a la ruta.
 */
export function proxyBodyLimitBytes(mb: number = maxUploadMb()): number {
  return Math.ceil(mb * 1024 * 1024) + 1024 * 1024;
}
