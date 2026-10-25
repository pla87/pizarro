import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { UndoOp } from "./undo";
import { fitsTemplate, renderLabelEs, type Label, type Params } from "./undo-label";

/** Cambio que se anota en el historial de una tarea (ver task-events.ts). */
export interface TaskEventInput {
  taskId: string;
  /** create, update, move, done, archive, restore, subtask, comment, other… */
  code: string;
  label: Label;
}

// Contexto de la acción en curso, para que el registro de actividad diga qué pasó y en qué proyecto.
export interface ActionContext {
  message?: string;
  /** Plantilla traducible de la acción (para el texto del deshacer en el idioma del usuario). */
  label?: Label;
  projectId?: string | null;
  /** El proyecto anotado es privado: los logs lo ocultan aunque se borre antes de escribirse. */
  projectIsPrivate?: boolean;
  details?: Record<string, unknown>;
  /** Operaciones inversas para deshacer la acción (ver undo.ts). */
  undo?: UndoOp[];
  /** Tarea afectada si es solo una (null si son varias): contexto del deshacer. */
  taskId?: string | null;
  /** Historial de tareas: si la acción lo fija, sustituye al que se deduce de la etiqueta; [] = no anotar nada. */
  events?: TaskEventInput[];
  /** Se rellena con el id de la entrada de deshacer que cree runAction (ver trackUndoEntry). */
  undoRef?: { id?: string };
}

export const actionContext = new AsyncLocalStorage<ActionContext>();

/**
 * Texto legible de lo que ha hecho la acción («Movió «X» de A a B»), con datos extra opcionales.
 * Con plantilla traducible: `describeAction("Movió «{task}» a «{col}»", { task, col }, details)`.
 * El registro guarda el texto en español; la etiqueta del deshacer se traduce al leerla.
 * Sin variables, `describeAction(texto, details)` sigue valiendo (texto plano, sin traducir).
 */
export function describeAction(message: string, details?: Record<string, unknown>): void;
export function describeAction(template: string, params: Params, details?: Record<string, unknown>): void;
export function describeAction(message: string, a?: Record<string, unknown> | Params, b?: Record<string, unknown>): void {
  const store = actionContext.getStore();
  if (!store) return;
  const isParams = b !== undefined || (a !== undefined && fitsTemplate(message, a));
  if (isParams) {
    const label: Label = { k: message, p: a as Params };
    store.label = label;
    store.message = renderLabelEs(label);
  } else {
    store.label = undefined;
    store.message = message;
  }
  const details = isParams ? b : (a as Record<string, unknown> | undefined);
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
export function noteProject(projectId: string | null | undefined, isPrivate?: boolean): void {
  const store = actionContext.getStore();
  if (!store || !projectId) return;
  if (!store.projectId) store.projectId = projectId;
  if (isPrivate && store.projectId === projectId) store.projectIsPrivate = true;
}

/** Anota un cambio en el historial de la tarea (con varias llamadas, solo cuentan las explícitas). */
export function recordTaskEvent(taskId: string, code: string, label: Label): void {
  const store = actionContext.getStore();
  if (!store) return;
  (store.events ??= []).push({ taskId, code, label });
}

/** La acción no deja rastro en el historial (p. ej. reordenar sin cambiar de columna). */
export function skipTaskEvents(): void {
  const store = actionContext.getStore();
  if (store) store.events ??= [];
}

/**
 * Referencia que runAction rellenará con el id de la entrada de deshacer de esta acción (se guarda
 * después de ejecutarla). La acción la devuelve en su resultado y el cliente la lee ya rellena.
 */
export function trackUndoEntry(): { id?: string } {
  const ref: { id?: string } = {};
  const store = actionContext.getStore();
  if (store) store.undoRef = ref;
  return ref;
}
