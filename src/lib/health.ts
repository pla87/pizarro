import { constants } from "node:fs";
import { access, mkdir, statfs } from "node:fs/promises";

// Comprobaciones de /api/health: base de datos, carpeta de subidas escribible y espacio libre en su disco.
// La respuesta solo lleva un motivo corto: nunca rutas, mensajes de error ni secretos. El disco casi lleno es un aviso
// (`warnings`), no un fallo: con un 503 Railway no desplegaba la versión nueva (railway.json usa /api/health como
// comprobación) y Docker marcaba el contenedor como «unhealthy», justo cuando hacía falta entrar a liberar espacio.

const MB = 1024 * 1024;
export const DEFAULT_MIN_FREE_MB = 200;
/** Cuánto se guarda el resultado de /api/health (la ruta es pública y sin límite de ritmo). */
export const HEALTH_CACHE_MS = 3_000;

/** Espacio libre mínimo en el disco de subidas (HEALTH_MIN_FREE_MB; 0 desactiva la comprobación). */
export function minFreeBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = env.HEALTH_MIN_FREE_MB;
  const mb = raw === undefined || raw.trim() === "" ? DEFAULT_MIN_FREE_MB : Number(raw);
  return Number.isFinite(mb) && mb >= 0 ? Math.round(mb * MB) : DEFAULT_MIN_FREE_MB * MB;
}

interface UploadsCheck {
  writable: boolean;
  /** Bytes libres para el usuario del proceso; null si no se pudo saber (no cuenta como fallo). */
  freeBytes: number | null;
}

/** ¿Se puede escribir en la carpeta y cuánto espacio libre queda? Si no existe, se crea (como al arrancar). */
export async function checkUploads(dir: string): Promise<UploadsCheck> {
  let writable = true;
  try {
    await access(dir, constants.W_OK);
  } catch (err) {
    writable = false;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        await mkdir(dir, { recursive: true });
        await access(dir, constants.W_OK);
        writable = true;
      } catch {
        // Sigue sin poder escribirse.
      }
    }
  }
  let freeBytes: number | null = null;
  try {
    const s = await statfs(dir);
    freeBytes = Number(s.bavail) * Number(s.bsize);
  } catch {
    // statfs no disponible o carpeta inaccesible: ya lo dice «writable».
  }
  return { writable, freeBytes };
}

type HealthReason = "database" | "uploads_not_writable";
type HealthWarning = "low_disk_space";
type HealthResult = { ok: true; warnings?: HealthWarning[] } | { ok: false; reason: HealthReason };

/** ¿Queda menos espacio libre que el mínimo? (con el mínimo a 0, o sin saber el espacio libre, no). */
export function isLowDisk(freeBytes: number | null, min: number): boolean {
  return min > 0 && freeBytes !== null && freeBytes < min;
}

/** Veredicto a partir de las comprobaciones (en orden de gravedad). El disco casi lleno solo avisa. */
export function evaluateHealth(input: { dbOk: boolean; uploads: UploadsCheck; minFreeBytes: number }): HealthResult {
  if (!input.dbOk) return { ok: false, reason: "database" };
  if (!input.uploads.writable) return { ok: false, reason: "uploads_not_writable" };
  if (isLowDisk(input.uploads.freeBytes, input.minFreeBytes)) return { ok: true, warnings: ["low_disk_space"] };
  return { ok: true };
}

/**
 * Disco de las subidas por debajo del mínimo (HEALTH_MIN_FREE_MB), para el aviso de Administración: bytes libres y el
 * mínimo; null si hay espacio (o no se sabe).
 */
export async function lowDiskSpace(dir: string, min: number = minFreeBytes()): Promise<{ freeBytes: number; minBytes: number } | null> {
  if (min <= 0) return null;
  try {
    const s = await statfs(dir);
    const freeBytes = Number(s.bavail) * Number(s.bsize);
    return isLowDisk(freeBytes, min) ? { freeBytes, minBytes: min } : null;
  } catch {
    return null;
  }
}
