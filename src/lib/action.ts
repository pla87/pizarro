import "server-only";
import { z } from "zod";
import { actionContext } from "./action-context";
import { AppError } from "./errors";
import { logEvent } from "./log";
import { requestContext } from "./request-context";
import { getCurrentUser } from "./session";

export { requestContext };

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Nombre y argumentos de la acción, para el registro de actividad. */
export interface ActionMeta {
  name: string;
  args?: ArrayLike<unknown>;
}

/** Ejecuta una acción, la registra en los logs y convierte los errores en un resultado serializable. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>>;
export async function runAction<T>(meta: ActionMeta, fn: () => Promise<T>): Promise<ActionResult<T>>;
export async function runAction<T>(a: ActionMeta | (() => Promise<T>), b?: () => Promise<T>): Promise<ActionResult<T>> {
  const meta = typeof a === "function" ? null : a;
  const fn = typeof a === "function" ? a : b!;
  const start = performance.now();
  let result: ActionResult<T>;
  let level: "info" | "warn" | "error" = "info";
  const ctx: { message?: string; projectId?: string | null; details?: Record<string, unknown> } = {};
  try {
    result = { ok: true, data: await actionContext.run(ctx, fn) };
  } catch (err) {
    // Los errores de redirect()/notFound() de Next deben propagarse.
    if (err && typeof err === "object" && "digest" in err && !(err instanceof AppError)) throw err;
    if (err instanceof AppError) {
      level = "warn";
      result = { ok: false, error: err.message };
    } else if (err instanceof z.ZodError) {
      level = "warn";
      result = { ok: false, error: err.issues[0]?.message ?? "Datos no válidos." };
    } else if (err && typeof err === "object" && "code" in err && err.code === "P2003") {
      // Clave foránea violada: otra persona cambió los datos a la vez.
      level = "warn";
      result = { ok: false, error: "Los datos han cambiado mientras tanto. Recarga e inténtalo de nuevo." };
    } else {
      level = "error";
      console.error("[action]", err);
      result = { ok: false, error: "Error inesperado. Inténtalo de nuevo." };
      if (meta) {
        await logAction(meta, ctx, start, level, result.error, { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
        return result;
      }
    }
  }
  // Con éxito, el texto que haya dejado la acción («Movió «X» de A a B»); si falla, el error.
  if (meta) await logAction(meta, ctx, start, level, result.ok ? (ctx.message ?? "OK") : result.error);
  return result;
}

async function logAction(
  meta: ActionMeta,
  actx: { projectId?: string | null; details?: Record<string, unknown> },
  start: number,
  level: "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
) {
  try {
    const [user, ctx] = await Promise.all([getCurrentUser().catch(() => null), requestContext()]);
    const args = meta.args ? Array.from(meta.args) : [];
    const first = args[0];
    const projectId =
      actx.projectId ??
      (first && typeof first === "object" && "projectId" in first && typeof first.projectId === "string" ? first.projectId : null);
    logEvent({
      level,
      category: "action",
      action: meta.name,
      message,
      userId: user?.id ?? null,
      userName: user?.name ?? null,
      projectId,
      path: ctx.path,
      ip: ctx.ip,
      durationMs: performance.now() - start,
      details: { args, ...actx.details, ...extra },
    });
  } catch {
    // El registro nunca debe romper la acción.
  }
}
