import "server-only";
import { mkdir, statfs } from "node:fs/promises";
import { AppError } from "./errors";

/** Margen que debe quedar libre además de lo estimado (los temporales, el registro, la base de datos…). */
export const DISK_MARGIN_BYTES = 64 * 1024 * 1024;

/** Bytes libres para un proceso sin privilegios en el volumen de `dir`; null si el sistema no lo informa. */
export async function freeDiskBytes(dir: string): Promise<number | null> {
  try {
    await mkdir(dir, { recursive: true });
    const s = await statfs(dir);
    const free = Number(s.bavail) * Number(s.bsize);
    return Number.isFinite(free) ? free : null;
  } catch {
    return null;
  }
}

/**
 * Falla (507) si en el volumen de `dir` no caben `needed` bytes más el margen. Si el sistema de ficheros no informa
 * del espacio libre no se bloquea nada: es una salvaguarda, no una garantía. `free` permite inyectar el dato en las pruebas.
 */
export async function assertDiskRoom(dir: string, needed: number, free: (dir: string) => Promise<number | null> = freeDiskBytes): Promise<void> {
  const available = await free(dir);
  if (available === null) return;
  if (available < needed + DISK_MARGIN_BYTES) throw new AppError("No hay espacio libre suficiente en el disco del servidor para esta operación.", 507, "disk_full");
}
