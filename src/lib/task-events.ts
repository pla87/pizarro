import "server-only";
import type { ActionContext, TaskEventInput } from "./action-context";
import { db } from "./db";
import { encodeLabel, decodeLabel, renderLabel } from "./undo-label";
import type { T } from "../i18n/core";

// Historial de cambios de cada tarea (tabla TaskEvent). A diferencia de los logs (7 días por defecto),
// se conserva un año. Lo escribe runAction junto al registro de actividad: o bien los eventos que la
// acción fija con recordTaskEvent, o bien, si no hay, la propia etiqueta de describeAction.

export const TASK_EVENT_RETENTION_DAYS = 365;
/** Máximo de eventos que se devuelven al abrir el historial. */
export const TASK_HISTORY_LIMIT = 200;

/** Acciones con etiqueta que no merecen una línea de historial. */
const IGNORED = new Set(["tasks.reorderSubtask", "undo.undoLast", "undo.redoLast"]);

const CODES: Record<string, string> = {
  "tasks.createTask": "create",
  "tasks.archiveTask": "archive",
  "tasks.restoreTask": "restore",
  "tasks.addComment": "comment",
  "tasks.deleteComment": "comment",
  "tasks.addSubtask": "subtask",
  "tasks.updateSubtask": "subtask",
  "tasks.deleteSubtask": "subtask",
  "tasks.makeEvergreen": "move",
};

/** Eventos de la acción: los explícitos o, si no los hay, uno con la etiqueta de describeAction. */
export function eventsOf(name: string, ctx: Pick<ActionContext, "events" | "label" | "taskId">): TaskEventInput[] {
  if (ctx.events) return ctx.events;
  if (IGNORED.has(name) || !ctx.label || !ctx.taskId) return [];
  return [{ taskId: ctx.taskId, code: CODES[name] ?? "other", label: ctx.label }];
}

/** Guarda los eventos de una acción ya hecha. Nunca lanza: el historial no debe romper la acción. */
export async function saveTaskEvents(name: string, ctx: ActionContext, projectId: string, user: { id: string; name: string } | null): Promise<void> {
  try {
    const events = eventsOf(name, ctx);
    if (!events.length) return;
    // Solo tareas que siguen existiendo (borrar una tarea borra su historial).
    const alive = new Set((await db.task.findMany({ where: { id: { in: [...new Set(events.map((e) => e.taskId))] }, projectId }, select: { id: true } })).map((t) => t.id));
    const data = events.filter((e) => alive.has(e.taskId)).slice(0, 100).map((e) => ({
      taskId: e.taskId,
      projectId,
      userId: user?.id ?? null,
      userName: user?.name ?? "?",
      code: e.code,
      label: encodeLabel(e.label),
    }));
    if (data.length) await db.taskEvent.createMany({ data });
  } catch (err) {
    console.error("[task-events] no se pudo guardar el historial", err);
  }
}

export interface TaskHistoryItem {
  id: string;
  /** Texto ya traducido al idioma de quien lo lee. */
  text: string;
  userName: string;
  createdAt: string;
}

/** Últimos cambios de la tarea, el más reciente primero, con el texto en el idioma de `t`. */
export async function loadTaskHistory(taskId: string, t: T): Promise<TaskHistoryItem[]> {
  const rows = await db.taskEvent.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
    take: TASK_HISTORY_LIMIT,
    select: { id: true, label: true, userName: true, createdAt: true },
  });
  return rows.map((r) => {
    const label = decodeLabel(r.label);
    return { id: r.id, text: label ? renderLabel(label, t) : r.label, userName: r.userName, createdAt: r.createdAt.toISOString() };
  });
}

/** Borra el historial de más de un año. */
export async function purgeOldTaskEvents(now: Date = new Date()): Promise<number> {
  const { count } = await db.taskEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - TASK_EVENT_RETENTION_DAYS * 86_400_000) } } });
  return count;
}
