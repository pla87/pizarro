import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { UndoOp } from "./undo";

// Contexto de la acción en curso, para que el registro de actividad diga qué pasó y en qué proyecto.
interface ActionContext {
  message?: string;
  projectId?: string | null;
  details?: Record<string, unknown>;
  /** Operaciones inversas para deshacer la acción (ver undo.ts). */
  undo?: UndoOp[];
  /** Tarea afectada si es solo una (null si son varias): contexto del deshacer. */
  taskId?: string | null;
}

export const actionContext = new AsyncLocalStorage<ActionContext>();

/** Texto legible de lo que ha hecho la acción («Movió «X» de A a B»), con datos extra opcionales. */
export function describeAction(message: string, details?: Record<string, unknown>): void {
  const store = actionContext.getStore();
  if (!store) return;
  store.message = message;
  if (details) store.details = { ...store.details, ...details };
}

/** Tarea afectada por la acción; si se anotan dos distintas, la acción no es de una sola tarea. */
export function noteTask(taskId: string | null | undefined): void {
  const store = actionContext.getStore();
  if (!store || !taskId) return;
  if (store.taskId === undefined) store.taskId = taskId;
  else if (store.taskId !== taskId) store.taskId = null;
}

/** Proyecto afectado por la acción (lo anotan las comprobaciones de acceso). */
export function noteProject(projectId: string | null | undefined): void {
  const store = actionContext.getStore();
  if (store && projectId && !store.projectId) store.projectId = projectId;
}
