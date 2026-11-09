// Aviso dentro de la página de cada cambio que llega por el canal en vivo del proyecto (ver Board.tsx): el tablero se
// refresca por su cuenta; los componentes que muestran algo que el refresco del tablero no trae (los comentarios del
// detalle abierto) lo escuchan para ponerse al día.

export const REMOTE_CHANGE_EVENT = "pz:remote-change";

export interface RemoteChange {
  /** Acción del servidor («tasks.addComment», «undo.undoLast»…). */
  action: string;
  /** Tarea afectada si fue solo una. */
  taskId: string | null;
  userId: string | null;
}

/** Reenvía a la página el aviso recibido por el canal (datos ya leídos del JSON). */
export function announceRemoteChange(data: unknown): void {
  if (!data || typeof data !== "object" || typeof window === "undefined") return;
  const d = data as Record<string, unknown>;
  const detail: RemoteChange = {
    action: typeof d.action === "string" ? d.action : "",
    taskId: typeof d.taskId === "string" ? d.taskId : null,
    userId: typeof d.userId === "string" ? d.userId : null,
  };
  window.dispatchEvent(new CustomEvent<RemoteChange>(REMOTE_CHANGE_EVENT, { detail }));
}

/** ¿El cambio puede haber tocado los comentarios de esta tarea? (deshacer y rehacer no dicen qué tarea tocan). */
export function touchesComments(change: RemoteChange, taskId: string): boolean {
  if (change.taskId === taskId) return /comment/i.test(change.action);
  return !change.taskId && /^undo\./.test(change.action);
}
