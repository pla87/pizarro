/** Tamaño máximo (bytes) de un archivo de importación de proyecto: PROJECT_IMPORT_MAX_MB (500 MB por defecto). Se lee en cada petición. */
export function importMaxBytes(raw: string | undefined = process.env.PROJECT_IMPORT_MAX_MB): number {
  const n = Number(raw);
  return (raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : 500) * 1024 * 1024;
}
