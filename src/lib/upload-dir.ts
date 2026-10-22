import path from "node:path";

/** Carpeta de subidas (el volumen en Railway). Siempre absoluta. */
export function uploadDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR ?? "./uploads");
}

/** Subcarpeta de las copias de seguridad cifradas (dentro del mismo volumen; la limpieza de huérfanos no la toca). */
export function backupsDir(): string {
  return path.join(/*turbopackIgnore: true*/ uploadDir(), "backups");
}
