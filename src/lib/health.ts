import { constants } from "node:fs";
import { access, mkdir, statfs } from "node:fs/promises";

// Comprobaciones de /api/health: base de datos, carpeta de subidas escribible y espacio libre en su disco.
// La respuesta solo lleva un motivo corto: nunca rutas, mensajes de error ni secretos.

const MB = 1024 * 1024;
export const DEFAULT_MIN_FREE_MB = 200;

/** Espacio libre mínimo en el disco de subidas (HEALTH_MIN_FREE_MB; 0 desactiva la comprobación). */
export function minFreeBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = env.HEALTH_MIN_FREE_MB;
  const mb = raw === undefined || raw.trim() === "" ? DEFAULT_MIN_FREE_MB : Number(raw);
  return Number.isFinite(mb) && mb >= 0 ? Math.round(mb * MB) : DEFAULT_MIN_FREE_MB * MB;
}

export interface UploadsCheck {
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

export type HealthReason = "database" | "uploads_not_writable" | "low_disk_space";
export type HealthResult = { ok: true } | { ok: false; reason: HealthReason };

/** Veredicto a partir de las comprobaciones (en orden de gravedad). */
export function evaluateHealth(input: { dbOk: boolean; uploads: UploadsCheck; minFreeBytes: number }): HealthResult {
  if (!input.dbOk) return { ok: false, reason: "database" };
  if (!input.uploads.writable) return { ok: false, reason: "uploads_not_writable" };
  if (input.minFreeBytes > 0 && input.uploads.freeBytes !== null && input.uploads.freeBytes < input.minFreeBytes) return { ok: false, reason: "low_disk_space" };
  return { ok: true };
}
