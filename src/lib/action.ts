import "server-only";
import { z } from "zod";
import { AppError } from "./errors";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Ejecuta una acción y convierte los errores en un resultado serializable. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    if (err instanceof z.ZodError) {
      return { ok: false, error: err.issues[0]?.message ?? "Datos no válidos." };
    }
    // Clave foránea violada: otra persona cambió los datos a la vez.
    if (err && typeof err === "object" && "code" in err && err.code === "P2003") {
      return { ok: false, error: "Los datos han cambiado mientras tanto. Recarga e inténtalo de nuevo." };
    }
    // Los errores de redirect()/notFound() de Next deben propagarse.
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error("[action]", err);
    return { ok: false, error: "Error inesperado. Inténtalo de nuevo." };
  }
}
