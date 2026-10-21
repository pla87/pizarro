import "server-only";

// Quién ha hecho algo en cada tablero hace poco (los círculos con iniciales de la cabecera).
// Vive en memoria del proceso: basta con una sola instancia y se alimenta de los logs.

const PRESENCE_WINDOW_MS = 5 * 60 * 1000;

type Entry = { name: string; at: number };
const state = (globalThis as unknown as { __pzPresence?: Map<string, Map<string, Entry>> }).__pzPresence ??= new Map();

/** Anota actividad de un usuario en un proyecto. */
export function notePresence(projectId: string, userId: string, name: string, at = Date.now()): void {
  let users = state.get(projectId);
  if (!users) state.set(projectId, (users = new Map()));
  users.set(userId, { name, at });
}

/** Usuarios con actividad en el proyecto en los últimos 5 minutos, el más reciente primero. */
export function activeUsers(projectId: string, now = Date.now()): { id: string; name: string; at: number }[] {
  const users = state.get(projectId);
  if (!users) return [];
  const out: { id: string; name: string; at: number }[] = [];
  for (const [id, e] of users) {
    if (now - e.at > PRESENCE_WINDOW_MS) users.delete(id);
    else out.push({ id, name: e.name, at: e.at });
  }
  if (users.size === 0) state.delete(projectId);
  return out.sort((a, b) => b.at - a.at);
}

// Quién tiene abierta cada tarea (lo anota el propio diálogo cada pocos segundos).
const VIEWER_WINDOW_MS = 45_000;
const viewers = (globalThis as unknown as { __pzViewers?: Map<string, Map<string, Entry>> }).__pzViewers ??= new Map();

/** Anota que el usuario tiene la tarea abierta y devuelve quién más la tiene. */
export function noteTaskViewer(taskId: string, userId: string, name: string, now = Date.now()): { id: string; name: string }[] {
  let users = viewers.get(taskId);
  if (!users) viewers.set(taskId, (users = new Map()));
  users.set(userId, { name, at: now });
  const others: { id: string; name: string }[] = [];
  for (const [id, e] of users) {
    if (now - e.at > VIEWER_WINDOW_MS) users.delete(id);
    else if (id !== userId) others.push({ id, name: e.name });
  }
  return others;
}

/** El usuario ha cerrado la tarea. */
export function leaveTask(taskId: string, userId: string): void {
  viewers.get(taskId)?.delete(userId);
}
