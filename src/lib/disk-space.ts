import "server-only";
import { mkdir, statfs } from "node:fs/promises";
import { AppError } from "./errors";

/** Mensaje único cuando no cabe lo que se va a escribir (comprobación previa o ENOSPC durante la escritura). */
export const NO_SPACE_MESSAGE = "No hay espacio suficiente en el disco del servidor para esta operación.";

const MB = 1024 * 1024;
/** Mínimo libre por defecto que debe quedar además de lo estimado (DISK_MIN_FREE_MB lo cambia). */
export const DISK_MIN_FREE_DEFAULT_MB = 1024;
/** Fracción del sistema de ficheros que también debe quedar libre. */
const DISK_MIN_FREE_FRACTION = 0.05;

/** Margen en bytes: el mayor entre el mínimo configurado (1 GB por defecto) y el 5 % del volumen (si se conoce su tamaño). Se lee cada vez. */
export function diskMarginBytes(totalBytes: number | null = null, raw: string | undefined = process.env.DISK_MIN_FREE_MB): number {
  const n = Number(raw);
  const floor = (raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : DISK_MIN_FREE_DEFAULT_MB) * MB;
  return Math.max(floor, totalBytes ? Math.floor(totalBytes * DISK_MIN_FREE_FRACTION) : 0);
}

/** Bytes libres (para un proceso sin privilegios) y totales del volumen de `dir`; null si el sistema no lo informa. */
export async function diskStats(dir: string): Promise<{ free: number; total: number } | null> {
  try {
    await mkdir(dir, { recursive: true });
    const s = await statfs(dir);
    const free = Number(s.bavail) * Number(s.bsize);
    const total = Number(s.blocks) * Number(s.bsize);
    return Number.isFinite(free) && Number.isFinite(total) ? { free, total } : null;
  } catch {
    return null;
  }
}

/** Bytes libres para un proceso sin privilegios en el volumen de `dir`; null si el sistema no lo informa. */
export async function freeDiskBytes(dir: string): Promise<number | null> {
  return (await diskStats(dir))?.free ?? null;
}

/** ¿Es un error de disco lleno del sistema operativo? */
export const isNoSpaceError = (err: unknown): boolean => (err as { code?: string } | null)?.code === "ENOSPC";

/**
 * Falla (507) si en el volumen de `dir` no caben `needed` bytes más el margen. Si el sistema de ficheros no informa
 * del espacio libre no se bloquea nada: es una salvaguarda, no una garantía. `free` y `total` permiten inyectar los datos en las pruebas
 * (sin `total` en una prueba solo cuenta el mínimo configurado).
 */
export async function assertDiskRoom(
  dir: string,
  needed: number,
  free?: (dir: string) => Promise<number | null>,
  total?: (dir: string) => Promise<number | null>,
): Promise<void> {
  let available: number | null;
  let size: number | null = null;
  if (free) {
    available = await free(dir);
    if (total) size = await total(dir);
  } else {
    const s = await diskStats(dir);
    available = s?.free ?? null;
    size = s?.total ?? null;
  }
  if (available === null) return;
  if (available < needed + diskMarginBytes(size)) throw new AppError(NO_SPACE_MESSAGE, 507, "disk_full");
}
