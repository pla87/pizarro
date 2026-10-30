import "server-only";
import { z } from "zod";
import { actionContext, type ActionContext } from "./action-context";
import { AppError } from "./errors";
import { logEvent } from "./log";
import { READ_ACTIONS } from "./log-query";
import { publishChange } from "./realtime";
import { saveTaskEvents } from "./task-events";
import { discardUndo, saveUndo, type UndoOp } from "./undo";
import { encodeLabel } from "./undo-label";
import { requestContext } from "./request-context";
import { getCurrentUser, getPendingUser } from "./session";
import { toLocale, translate } from "@/i18n/core";

/** Acciones revisadas cuyo resultado basta para actualizar la pestaña que las lanza (ver `cid`). */
const ECHO_SAFE_ACTIONS = new Set([
  "tasks.updateTask", "tasks.moveTask", "tasks.moveTasks", "tasks.archiveTask", "tasks.archiveTasks",
  "tasks.deleteTask", "tasks.deleteTasks", "tasks.duplicateTask", "tasks.makeEvergreen",
]);

/** `cid`: id del cambio publicado a las demás pestañas (solo en acciones que cambian datos de un proyecto). */
type ActionResult<T = undefined> = { ok: true; data: T; cid?: string } | { ok: false; error: string };

/** Nombre y argumentos de la acción, para el registro de actividad. */
interface ActionMeta {
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
  const ctx: ActionContext = {};
  try {
    result = { ok: true, data: await actionContext.run(ctx, fn) };
    const tracked = !!meta && !!ctx.projectId && !READ_ACTIONS.includes(meta.name);
    const willUndo = !!ctx.undo?.length && !!ctx.projectId;
    const user = tracked || willUndo ? await getCurrentUser().catch(() => null) : null;
    // Aviso a las demás pestañas del proyecto (las consultas no cambian nada): ya está confirmada la transacción
    // principal y publishChange no depende del historial ni del deshacer, así que sale antes de guardarlos.
    const cid = tracked ? publishChange({ projectId: ctx.projectId!, userId: user?.id ?? null, action: meta!.name }) : undefined;
    // Solo las acciones cuyo resultado ya trae todo lo que cambian devuelven el id; en las demás (o si la acción tocó
    // más de lo que devuelve) la pestaña que la lanzó también se refresca con su propio aviso.
    if (cid && !ctx.refreshOwnTab && ECHO_SAFE_ACTIONS.has(meta!.name)) result.cid = cid;
    // Al guardar una entrada de deshacer se vacía la pila de rehacer: no depende del historial, va a la vez.
    let redoError: unknown = null;
    const redoCleared = willUndo && user
      ? discardUndo({ userId: user.id, projectId: ctx.projectId!, kind: "REDO" }).then(() => undefined, (err) => { redoError = err; })
      : Promise.resolve();
    // El historial se guarda antes que la entrada de deshacer: así ésta recuerda sus ids y deshacer los borra.
    const [eventIds] = await Promise.all([tracked ? saveTaskEvents(meta!.name, ctx, ctx.projectId!, user) : Promise.resolve([] as string[]), redoCleared]);
    if (willUndo) {
      const id = await recordUndo(user, meta?.name ?? "acción", ctx.projectId!, ctx.label ? encodeLabel(ctx.label) : ctx.message, ctx.undo!, ctx.taskId ?? null, eventIds, redoError);
      if (id && ctx.undoRef) ctx.undoRef.id = id;
    }
  } catch (err) {
    // Los errores de redirect()/notFound() de Next deben propagarse.
    if (err && typeof err === "object" && "digest" in err && !(err instanceof AppError)) throw err;
    if (err instanceof AppError) {
      level = "warn";
      result = { ok: false, error: err.message };
    } else if (err instanceof z.ZodError) {
      level = "warn";
      result = { ok: false, error: err.issues[0]?.message ?? "Datos no válidos." };
    } else if (err && typeof err === "object" && "code" in err && (err.code === "P2003" || err.code === "P2002" || err.code === "P2025")) {
      // Clave foránea o única violada, o fila desaparecida: otra persona cambió los datos a la vez.
      level = "warn";
      result = { ok: false, error: "Los datos han cambiado mientras tanto. Recarga e inténtalo de nuevo." };
    } else {
      level = "error";
      console.error("[action]", err);
      result = { ok: false, error: "Error inesperado. Inténtalo de nuevo." };
      if (meta) {
        await logAction(meta, ctx, start, level, result.error, { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
        return { ok: false, error: await translateError(result.error) };
      }
    }
  }
  // Con éxito, el texto que haya dejado la acción («Movió «X» de A a B»); si falla, el error.
  if (meta) await logAction(meta, ctx, start, level, result.ok ? (ctx.message ?? "OK") : result.error);
  // El registro queda en español; al usuario, el error en su idioma.
  if (!result.ok) result = { ok: false, error: await translateError(result.error) };
  return result;
}

/** Guarda lo necesario para deshacer la acción; si falla, la acción ya está hecha y solo se registra. */
async function recordUndo(
  user: { id: string } | null, name: string, projectId: string, message: string | undefined, ops: UndoOp[], taskId: string | null, eventIds: string[], redoError: unknown,
): Promise<string | null> {
  try {
    if (redoError) throw redoError;
    if (user) return await saveUndo(user.id, projectId, message ?? name, ops, taskId, "UNDO", false, null, { eventIds });
  } catch (err) {
    console.error("[undo] no se pudo guardar", err);
  }
  return null;
}

async function translateError(message: string): Promise<string> {
  try {
    const user = (await getCurrentUser()) ?? (await getPendingUser());
    return translate(toLocale(user?.locale), message);
  } catch {
    return message;
  }
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
