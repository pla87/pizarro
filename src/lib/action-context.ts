import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// Contexto de la acción en curso, para que el registro de actividad diga qué pasó y en qué proyecto.
interface ActionContext {
  message?: string;
  projectId?: string | null;
  details?: Record<string, unknown>;
}

export const actionContext = new AsyncLocalStorage<ActionContext>();

/** Texto legible de lo que ha hecho la acción («Movió «X» de A a B»), con datos extra opcionales. */
export function describeAction(message: string, details?: Record<string, unknown>): void {
  const store = actionContext.getStore();
  if (!store) return;
  store.message = message;
  if (details) store.details = { ...store.details, ...details };
}

/** Proyecto afectado por la acción (lo anotan las comprobaciones de acceso). */
export function noteProject(projectId: string | null | undefined): void {
  const store = actionContext.getStore();
  if (store && projectId && !store.projectId) store.projectId = projectId;
}
