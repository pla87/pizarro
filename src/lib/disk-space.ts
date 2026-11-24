import "server-only";
import { mkdir, statfs } from "node:fs/promises";
import { AppError } from "./errors";
import { logEvent } from "./log";
import { logSize } from "./format-size";

/** Mensaje único cuando no cabe lo que se va a escribir (comprobación previa o ENOSPC durante la escritura). */
export const NO_SPACE_MESSAGE = "No hay espacio suficiente en el disco del servidor para esta operación.";

const MB = 1024 * 1024;
/** Margen por defecto: 1 GB como mucho (DISK_MIN_FREE_MB lo fija a mano)... */
const DISK_MIN_FREE_DEFAULT_MB = 1024;
/** ...pero nunca más del 20 % del volumen (en un disco pequeño un GB fijo bloquearía todo)... */
const DISK_MIN_FREE_FRACTION = 0.2;
/** ...ni menos de 100 MB. */
const DISK_MIN_FREE_FLOOR_MB = 100;

/**
 * Margen en bytes que debe quedar libre además de lo estimado. Con DISK_MIN_FREE_MB válido manda tal cual; si no,
 * min(1 GB, 20 % del volumen) con un suelo de 100 MB (sin conocer el tamaño del volumen, 1 GB). Se lee cada vez.
 */
export function diskMarginBytes(totalBytes: number | null = null, raw: string | undefined = process.env.DISK_MIN_FREE_MB): number {
  const n = Number(raw);
  if (raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n >= 0) return n * MB;
  const byVolume = totalBytes ? Math.floor(totalBytes * DISK_MIN_FREE_FRACTION) : Infinity;
  return Math.max(DISK_MIN_FREE_FLOOR_MB * MB, Math.min(DISK_MIN_FREE_DEFAULT_MB * MB, byVolume));
}

/** Margen de la copia de seguridad: aprobado aparte, porque la retención libera después lo que la copia escribe. */
const BACKUP_MIN_FREE_MB = 100;

/**
 * Margen en bytes de la copia de seguridad (local y diaria, antes de volcar la base de datos): 100 MB en vez del común
 * de diskMarginBytes (hasta 1 GB). Con DISK_MIN_FREE_MB válido manda tal cual, como en lo demás.
 */
export function backupMarginBytes(raw: string | undefined = process.env.DISK_MIN_FREE_MB): number {
  const n = Number(raw);
  if (raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n >= 0) return n * MB;
  return BACKUP_MIN_FREE_MB * MB;
}

// Reservas en este proceso: bytes que los trabajos en marcha aún van a escribir y que el disco no refleja todavía.
const reservations: Map<string, { dir: string; bytes: number }> = ((globalThis as unknown as { __pzDiskReserved?: Map<string, { dir: string; bytes: number }> }).__pzDiskReserved ??= new Map());

/** Reserva `bytes` en `dir` para el trabajo `id` (sustituye su reserva anterior). Se libera con `releaseDisk`. */
export function reserveDisk(id: string, dir: string, bytes: number): void {
  reservations.set(id, { dir, bytes: Math.max(0, bytes) });
}

export function releaseDisk(id: string): void {
  reservations.delete(id);
}

/** Bytes reservados por los trabajos en marcha que escriben en `dir` (menos los del trabajo `exceptId`). */
function reservedDiskBytes(dir: string, exceptId?: string): number {
  let sum = 0;
  for (const [id, r] of reservations) if (r.dir === dir && id !== exceptId) sum += r.bytes;
  return sum;
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

/** ¿Es un error de disco lleno del sistema operativo? */
export const isNoSpaceError = (err: unknown): boolean => (err as { code?: string } | null)?.code === "ENOSPC";

/** Mensaje de una subida (adjunto, documento) que no se pudo escribir por falta de espacio en el disco. */
const UPLOAD_NO_SPACE_MESSAGE = "El servidor no tiene espacio para guardar el archivo.";

/**
 * Error al escribir el fichero de una subida: si es ENOSPC lo anota en el registro del sistema (es un problema del
 * servidor que la administración debe ver, no un fallo de quien sube) y devuelve un 507 con un mensaje claro en vez del
 * 500 genérico; cualquier otro error se devuelve tal cual. Quien llama ya ha borrado lo que se llegara a escribir.
 */
export function uploadWriteError(err: unknown, what: { action: string; bytes: number; details?: Record<string, unknown> }): unknown {
  if (!isNoSpaceError(err)) return err;
  logEvent({
    level: "error", category: "system", action: what.action,
    label: { k: "Disco lleno: no se pudo guardar una subida de {size}", p: { size: logSize(what.bytes) } },
    details: { bytes: what.bytes, ...what.details, error: err instanceof Error ? err.message : String(err) },
  });
  return new AppError(UPLOAD_NO_SPACE_MESSAGE, 507, "disk_full");
}

/** Espacio del volumen cuando assertDiskRoom lo da por lleno (va en el error, para el registro). */
export interface DiskRoom {
  /** Bytes libres, ya descontado lo reservado por los demás trabajos. */
  free: number;
  /** Margen exigido (ver diskMarginBytes). */
  margin: number;
}

/**
 * Falla (507) si en el volumen de `dir` no caben `needed` bytes más el margen. Si el sistema de ficheros no informa
 * del espacio libre no se bloquea nada: es una salvaguarda, no una garantía. `free` y `total` permiten inyectar los datos en las pruebas
 * (sin `total` en una prueba solo cuenta el mínimo configurado). Lo reservado por los demás trabajos en marcha de
 * este proceso en `dir` (salvo `selfId`) se descuenta del espacio libre. El error lleva `room` (DiskRoom). `marginFor`: el
 * margen según el tamaño del volumen (por defecto diskMarginBytes; la copia de seguridad usa backupMarginBytes).
 */
export async function assertDiskRoom(
  dir: string,
  needed: number,
  free?: (dir: string) => Promise<number | null>,
  total?: (dir: string) => Promise<number | null>,
  selfId?: string,
  marginFor: (totalBytes: number | null) => number = diskMarginBytes,
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
  const room: DiskRoom = { free: available - reservedDiskBytes(dir, selfId), margin: marginFor(size) };
  if (room.free < needed + room.margin) throw Object.assign(new AppError(NO_SPACE_MESSAGE, 507, "disk_full"), { room });
}
