import "server-only";
import { randomUUID } from "node:crypto";

// Quién ha hecho algo en cada tablero hace poco (los círculos con iniciales de la cabecera) y quién tiene abierta cada
// tarea. Vive en memoria del proceso: basta con una sola instancia. Se alimenta de:
//  - los logs (cualquier acción),
//  - los canales en vivo abiertos (api/projects/[id]/events): tener el tablero a la vista cuenta como actividad mientras
//    el canal esté abierto (la pestaña oculta lo cierra) y, al cerrarse, la persona sigue 5 minutos entre los activos;
//  - la tarea abierta, anunciada una vez con el id del canal (api/tasks/[id]/viewers?stream=…): dura lo que el canal o
//    hasta que se cierra el diálogo;
//  - y, sin canal en vivo, los sondeos de respaldo de siempre (api/projects/[id]/presence y api/tasks/[id]/viewers).
// Los canales reciben el evento `presence` cuando cambia algo (subscribePresence).

const PRESENCE_WINDOW_MS = 5 * 60 * 1000;

type Entry = { name: string; at: number };
type Person = { id: string; name: string };
const state = (globalThis as unknown as { __pzPresence?: Map<string, Map<string, Entry>> }).__pzPresence ??= new Map();

// --- Canales en vivo -------------------------------------------------------------------------------------------------

interface LiveStream {
  projectId: string;
  userId: string;
  name: string;
  openedAt: number;
  /** Tareas que tiene abiertas el diálogo de esa pestaña. */
  tasks: Set<string>;
}
const liveStreams = (globalThis as unknown as { __pzPresenceStreams?: Map<string, LiveStream> }).__pzPresenceStreams ??= new Map();

type PresenceListener = () => void;
const presenceListeners = (globalThis as unknown as { __pzPresenceListeners?: Map<string, Set<PresenceListener>> }).__pzPresenceListeners ??= new Map();
const pendingNotify = new Map<string, ReturnType<typeof setTimeout>>();

/** Avisa (agrupado: 200 ms) a los canales del proyecto de que la presencia ha cambiado. */
function notifyPresence(projectId: string): void {
  if (!presenceListeners.has(projectId) || pendingNotify.has(projectId)) return;
  const timer = setTimeout(() => {
    pendingNotify.delete(projectId);
    for (const l of presenceListeners.get(projectId) ?? []) {
      try {
        l();
      } catch {
        // Un canal roto no afecta al resto.
      }
    }
  }, 200);
  timer.unref?.();
  pendingNotify.set(projectId, timer);
}

/** El canal recibe una llamada cada vez que cambia la presencia del proyecto (luego pide `presenceSnapshot`). */
export function subscribePresence(projectId: string, listener: PresenceListener): () => void {
  let set = presenceListeners.get(projectId);
  if (!set) presenceListeners.set(projectId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) presenceListeners.delete(projectId);
  };
}

/** Anota un canal en vivo abierto (la persona tiene el tablero a la vista). Devuelve su id, que solo conoce esa pestaña. */
export function openPresenceStream(projectId: string, userId: string, name: string, now = Date.now()): string {
  const id = randomUUID();
  const fresh = !isPresent(projectId, userId, now);
  liveStreams.set(id, { projectId, userId, name, openedAt: now, tasks: new Set() });
  if (fresh) notifyPresence(projectId);
  return id;
}

/**
 * El canal se ha cerrado: deja de contar como tablero a la vista (la persona sigue 5 minutos entre los activos) y se
 * quitan las tareas que tenía abiertas. Se puede llamar más de una vez.
 */
export function closePresenceStream(id: string, now = Date.now()): void {
  const s = liveStreams.get(id);
  if (!s) return;
  liveStreams.delete(id);
  notePresence(s.projectId, s.userId, s.name, now);
  notifyPresence(s.projectId);
}

/**
 * La pestaña de ese canal tiene abierta la tarea (del mismo proyecto que el canal). false si el canal no existe o no es
 * de ese usuario y proyecto: entonces se usa el aviso con caducidad (`noteTaskViewer`).
 */
export function holdTaskView(streamId: string, userId: string, taskId: string, projectId: string): boolean {
  const s = liveStreams.get(streamId);
  if (!s || s.userId !== userId || s.projectId !== projectId) return false;
  if (!s.tasks.has(taskId)) {
    s.tasks.add(taskId);
    notifyPresence(projectId);
  }
  return true;
}

/** La pestaña de ese canal ha cerrado la tarea. */
export function releaseTaskView(streamId: string, userId: string, taskId: string): void {
  const s = liveStreams.get(streamId);
  if (!s || s.userId !== userId || !s.tasks.delete(taskId)) return;
  notifyPresence(s.projectId);
}

/**
 * Estado completo del proyecto para su evento `presence`: activos (incluida la propia persona) y, por tarea del proyecto,
 * quién la tiene abierta (cada pestaña quita a su usuario). Solo lo reciben canales del proyecto (acceso comprobado).
 */
export function presenceSnapshot(projectId: string, now = Date.now()): { users: Person[]; viewers: Record<string, Person[]> } {
  const users = activeUsers(projectId, now).map(({ id, name }) => ({ id, name }));
  const byTask = new Map<string, Map<string, string>>();
  const add = (taskId: string, id: string, name: string) => {
    let m = byTask.get(taskId);
    if (!m) byTask.set(taskId, (m = new Map()));
    m.set(id, name);
  };
  for (const s of liveStreams.values()) if (s.projectId === projectId) for (const taskId of s.tasks) add(taskId, s.userId, s.name);
  for (const [taskId, v] of viewers) {
    if (v.projectId !== projectId) continue;
    for (const [id, e] of v.users) if (now - e.at <= VIEWER_WINDOW_MS) add(taskId, id, e.name);
  }
  const out: Record<string, Person[]> = {};
  for (const taskId of [...byTask.keys()].sort()) {
    out[taskId] = [...byTask.get(taskId)!].map(([id, name]) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id));
  }
  return { users, viewers: out };
}

// --- Actividad en el tablero -----------------------------------------------------------------------------------------

function isPresent(projectId: string, userId: string, now: number): boolean {
  const e = state.get(projectId)?.get(userId);
  if (e && now - e.at <= PRESENCE_WINDOW_MS) return true;
  for (const s of liveStreams.values()) if (s.projectId === projectId && s.userId === userId) return true;
  return false;
}

/** Anota actividad de un usuario en un proyecto. */
export function notePresence(projectId: string, userId: string, name: string, at = Date.now()): void {
  const fresh = !isPresent(projectId, userId, at);
  let users = state.get(projectId);
  if (!users) state.set(projectId, (users = new Map()));
  users.set(userId, { name, at });
  // Solo se avisa si aparece alguien: el orden se pone al día en la siguiente comprobación periódica del canal.
  if (fresh) notifyPresence(projectId);
}

/**
 * Usuarios con actividad en el proyecto en los últimos 5 minutos o con el tablero abierto ahora (canal en vivo), el más
 * reciente primero.
 */
export function activeUsers(projectId: string, now = Date.now()): { id: string; name: string; at: number }[] {
  const merged = new Map<string, { name: string; at: number }>();
  const users = state.get(projectId);
  if (users) {
    for (const [id, e] of users) {
      if (now - e.at > PRESENCE_WINDOW_MS) users.delete(id);
      else merged.set(id, { name: e.name, at: e.at });
    }
    if (users.size === 0) state.delete(projectId);
  }
  for (const s of liveStreams.values()) {
    if (s.projectId !== projectId) continue;
    const prev = merged.get(s.userId);
    // Con el canal abierto cuenta desde que se abrió o desde su última acción: un orden estable entre comprobaciones.
    if (!prev || prev.at < s.openedAt) merged.set(s.userId, { name: s.name, at: s.openedAt });
  }
  return [...merged].map(([id, e]) => ({ id, name: e.name, at: e.at })).sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

// --- Tarea abierta sin canal en vivo (sondeo de respaldo cada pocos segundos) ----------------------------------------

const VIEWER_WINDOW_MS = 45_000;
type TaskViewers = { projectId: string; users: Map<string, Entry> };
const viewers = (globalThis as unknown as { __pzViewers?: Map<string, TaskViewers> }).__pzViewers ??= new Map();

/** Quién más tiene abierta la tarea ahora (por cualquier camino), sin el propio usuario. */
export function taskViewersExcept(taskId: string, projectId: string, userId: string, now = Date.now()): Person[] {
  const out = new Map<string, string>();
  for (const s of liveStreams.values()) if (s.projectId === projectId && s.userId !== userId && s.tasks.has(taskId)) out.set(s.userId, s.name);
  const v = viewers.get(taskId);
  if (v) for (const [id, e] of v.users) if (id !== userId && now - e.at <= VIEWER_WINDOW_MS) out.set(id, e.name);
  return [...out].map(([id, name]) => ({ id, name }));
}

/** Anota (45 s) que el usuario tiene la tarea abierta y devuelve quién más la tiene. */
export function noteTaskViewer(taskId: string, projectId: string, userId: string, name: string, now = Date.now()): Person[] {
  if (viewers.size > 200) sweepViewers(now);
  let v = viewers.get(taskId);
  if (!v || v.projectId !== projectId) viewers.set(taskId, (v = { projectId, users: new Map() }));
  const prev = v.users.get(userId);
  v.users.set(userId, { name, at: now });
  if (!prev || now - prev.at > VIEWER_WINDOW_MS) notifyPresence(projectId);
  for (const [id, e] of v.users) if (now - e.at > VIEWER_WINDOW_MS) v.users.delete(id);
  return taskViewersExcept(taskId, projectId, userId, now);
}

/** Quién tiene abierta cada tarea ahora mismo (sin `exceptUserId`), para los círculos de las tarjetas del tablero. */
export function openTaskViewers(exceptUserId: string, now = Date.now()): Map<string, Person[]> {
  const out = new Map<string, Map<string, string>>();
  const add = (taskId: string, id: string, name: string) => {
    if (id === exceptUserId) return;
    let m = out.get(taskId);
    if (!m) out.set(taskId, (m = new Map()));
    m.set(id, name);
  };
  for (const [taskId, v] of viewers) {
    for (const [id, e] of v.users) {
      if (now - e.at > VIEWER_WINDOW_MS) v.users.delete(id);
      else add(taskId, id, e.name);
    }
    if (v.users.size === 0) viewers.delete(taskId);
  }
  for (const s of liveStreams.values()) for (const taskId of s.tasks) add(taskId, s.userId, s.name);
  return new Map([...out].map(([taskId, m]) => [taskId, [...m].map(([id, name]) => ({ id, name }))]));
}

/** El usuario ha cerrado la tarea (aviso sin canal). */
export function leaveTask(taskId: string, userId: string): void {
  const v = viewers.get(taskId);
  if (!v?.users.delete(userId)) return;
  if (v.users.size === 0) viewers.delete(taskId);
  notifyPresence(v.projectId);
}

// Las tareas que nadie vuelve a pingear no se limpiaban solas: barrido ocasional del mapa entero.
function sweepViewers(now: number): void {
  for (const [taskId, v] of viewers) {
    for (const [id, e] of v.users) if (now - e.at > VIEWER_WINDOW_MS) v.users.delete(id);
    if (v.users.size === 0) viewers.delete(taskId);
  }
}

/** Quita a un usuario de la presencia (pierde acceso): deja de aparecer en cabeceras y diálogos. */
export function dropUserPresence(userId: string, projectId?: string): void {
  for (const [pid, users] of state) {
    if (projectId && pid !== projectId) continue;
    if (users.delete(userId)) notifyPresence(pid);
    if (users.size === 0) state.delete(pid);
  }
  // Sus canales ya se han cortado (revoke.ts); por si quedara alguno, deja de contar.
  for (const [id, s] of liveStreams) {
    if (s.userId !== userId || (projectId && s.projectId !== projectId)) continue;
    liveStreams.delete(id);
    notifyPresence(s.projectId);
  }
  if (!projectId) {
    for (const [taskId, v] of viewers) {
      if (v.users.delete(userId)) notifyPresence(v.projectId);
      if (v.users.size === 0) viewers.delete(taskId);
    }
  }
}

/** Vacía la presencia de un proyecto (cambia su visibilidad o se borra); reaparece quien siga actuando. */
export function dropProjectPresence(projectId: string): void {
  state.delete(projectId);
  for (const [id, s] of liveStreams) if (s.projectId === projectId) liveStreams.delete(id);
  for (const [taskId, v] of viewers) if (v.projectId === projectId) viewers.delete(taskId);
  notifyPresence(projectId);
}
