import "server-only";
import { z } from "zod";
import { actionContext, type ActionContext } from "./action-context";
import { AppError, zodIssueMessage } from "./errors";
import { logEvent } from "./log";
import { READ_ACTIONS } from "./log-query";
import { publishChange } from "./realtime";
import { LIVE_PATCH_MAX } from "@/components/board/livePatch";
import { saveTaskEvents } from "./task-events";
import { discardUndo, saveUndo, type UndoOp } from "./undo";
import { encodeLabel, type Label } from "./undo-label";
import { requestContext } from "./request-context";
import { getCurrentUser, getPendingUser } from "./session";
import { toLocale, translate } from "@/i18n/core";

/**
 * Acciones revisadas cuyo resultado basta para actualizar la pestaña que las lanza (ver `cid`). Los comentarios: el
 * detalle abierto aplica su resultado y el recuento de la tarjeta; sin cid, su propio aviso volvía a pedirlos. Las
 * subtareas: el detalle aplica su resultado y deriva de su lista el contador de la tarjeta (la lista consolidada de la
 * columna lo suma o lo resta); sin cid, cada casilla marcada pedía el tablero entero. Quitar un enlace de Google: el
 * detalle quita la fila y resta uno al contador de la tarjeta. Borrar un adjunto no: el detalle no lleva a la tarjeta los
 * contadores de adjuntos que devuelve (llegan con el refresco).
 */
const ECHO_SAFE_ACTIONS = new Set([
  "tasks.updateTask", "tasks.changeTaskKind", "tasks.moveTask", "tasks.moveTasks", "tasks.archiveTask", "tasks.archiveTasks",
  "tasks.deleteTask", "tasks.deleteTasks", "tasks.duplicateTask", "tasks.makeEvergreen",
  "tasks.addComment", "tasks.editComment", "tasks.deleteComment",
  "tasks.addSubtask", "tasks.addSubtasks", "tasks.updateSubtask", "tasks.reorderSubtask", "tasks.deleteSubtask",
  "tasks.deleteTaskLink",
]);

/**
 * Acciones que solo cambian datos personales de quien las lanza (nada que se vea en el tablero de los demás): se
 * registran como las demás, pero no se avisa a las otras pestañas del proyecto (cada aviso las haría recargar). También
 * las que no cambian nada del tablero aunque se registren: abrir el enlace de «Compartir fuera» (shareOut.getLink) solo
 * descifra la dirección para el diálogo.
 */
const UNPUBLISHED_ACTIONS: ReadonlySet<string> = new Set(["tasks.setTaskFollowing", "shareOut.getLink"]);

/** `cid`: id del cambio publicado a las demás pestañas (solo en acciones que cambian datos de un proyecto). */
/** `code`: el de un AppError que lo lleve, para que la pantalla distinga un fallo concreto (p. ej. `edit_conflict`). */
type ActionResult<T = undefined> = { ok: true; data: T; cid?: string } | { ok: false; error: string; code?: string };

/** Nombre y argumentos de la acción, para el registro de actividad. */
interface ActionMeta {
  name: string;
  args?: ArrayLike<unknown>;
}

/** Consultas que no se anotan en el registro cuando salen bien (los errores sí): abrir una tarea o desplegar una release del histórico. */
const UNLOGGED_READS: ReadonlySet<string> = new Set(["tasks.getTaskDetail", "tasks.getTaskHistory", "tasks.getOlderComments", "tasks.getRecentComments", "releases.getReleaseContent", "changelog.getOlderVersions"]);

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
  // Lo que explica un fallo de validación en el registro (campo y motivo), también cuando los argumentos no se guardan.
  let failure: Record<string, unknown> | undefined;
  try {
    result = { ok: true, data: await actionContext.run(ctx, fn) };
    const tracked = !!meta && !!ctx.projectId && !READ_ACTIONS.includes(meta.name);
    const willUndo = !!ctx.undo?.length && !!ctx.projectId;
    const user = tracked || willUndo ? await getCurrentUser().catch(() => null) : null;
    // Aviso a las demás pestañas del proyecto (las consultas no cambian nada): ya está confirmada la transacción
    // principal y publishChange no depende del historial ni del deshacer, así que sale antes de guardarlos.
    // Con las tarjetas que tocó (si no son demasiadas), las demás pestañas piden solo esas; `full` si tocó algo más.
    const live = ctx.liveTaskIds;
    const cid = tracked && !ctx.noPublish && !UNPUBLISHED_ACTIONS.has(meta!.name)
      ? publishChange({
        projectId: ctx.projectId!, userId: user?.id ?? null, action: meta!.name, taskId: ctx.taskId ?? null,
        ...(live?.size && live.size <= LIVE_PATCH_MAX ? { taskIds: [...live] } : {}),
        ...(ctx.refreshOwnTab ? { full: true } : {}),
      })
      : undefined;
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
      result = err.code ? { ok: false, error: err.message, code: err.code } : { ok: false, error: err.message };
    } else if (err instanceof z.ZodError) {
      level = "warn";
      result = { ok: false, error: zodIssueMessage(err.issues[0]?.message) };
      failure = { issues: err.issues.slice(0, 10).map((i) => ({ path: i.path.map(String).join("."), code: i.code, message: i.message })) };
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
  // Con éxito, el texto que haya dejado la acción («Movió «X» de A a B»); si falla, el error. Abrir una tarea (y lo que
  // carga al abrirla) no deja rastro cuando sale bien: es lo más frecuente y solo llenaba el registro.
  if (meta && !(result.ok && UNLOGGED_READS.has(meta.name))) await logAction(meta, ctx, start, level, result.ok ? (ctx.message ?? "OK") : result.error, failure);
  // El registro queda en español; al usuario, el error en su idioma.
  if (!result.ok) result = { ...result, error: await translateError(result.error) };
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
  actx: { projectId?: string | null; details?: Record<string, unknown>; message?: string; label?: Label },
  start: number,
  level: "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
) {
  try {
    const [user, ctx] = await Promise.all([getCurrentUser().catch(() => null), requestContext()]);
    const rawArgs = meta.args ? Array.from(meta.args) : [];
    const first = rawArgs[0];
    const projectId =
      actx.projectId ??
      (first && typeof first === "object" && "projectId" in first && typeof first.projectId === "string" ? first.projectId : null);
    // Una acción que falla antes de saber su proyecto (validación, sin acceso) no puede marcar el registro como de un
    // proyecto privado, y cualquier administrador lo vería: de los argumentos (títulos, descripciones…) solo se guardan
    // los nombres de los campos. El motivo va en el mensaje y, en los de validación, en `issues`.
    const hidden = level !== "info" && !actx.projectId;
    const args = hidden ? argShape(rawArgs) : rawArgs;
    const details = hidden ? (argShape(actx.details ?? {}) as Record<string, unknown>) : actx.details;
    // log-sin-plantilla: el mensaje de una acción fallida es el texto del error (un texto fijo del diccionario, que la
    // página de Logs ya traduce) o el de describeAction, que trae su plantilla.
    logEvent({
      level,
      category: "action",
      action: meta.name,
      message,
      // La plantilla de describeAction, si el mensaje es el suyo: la página de Logs lo pinta en el idioma de quien lee.
      label: actx.label && message === actx.message ? actx.label : undefined,
      userId: user?.id ?? null,
      userName: user?.name ?? null,
      projectId,
      path: ctx.path,
      ip: ctx.ip,
      durationMs: performance.now() - start,
      details: { args, ...details, ...extra },
    });
  } catch {
    // El registro nunca debe romper la acción.
  }
}

/**
 * Forma de unos argumentos sin sus valores: los objetos conservan los nombres de sus campos y cada valor queda en su tipo
 * («texto», «número»…); las listas, la forma de cada elemento (como mucho 10).
 */
function argShape(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return "texto";
  if (typeof value === "number" || typeof value === "bigint") return "número";
  if (typeof value === "boolean") return "sí/no";
  if (value instanceof Date) return "fecha";
  if (typeof File !== "undefined" && value instanceof File) return "fichero";
  if (typeof FormData !== "undefined" && value instanceof FormData) return argShape(Object.fromEntries(value.entries()), depth);
  if (depth >= 4) return "…";
  if (Array.isArray(value)) {
    const items = value.slice(0, 10).map((v) => argShape(v, depth + 1));
    return value.length > 10 ? [...items, `… y ${value.length - 10} más`] : items;
  }
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([k, v]) => [k, argShape(v, depth + 1)]));
  return typeof value;
}
