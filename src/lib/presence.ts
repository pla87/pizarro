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
  /**
   * Tareas que tiene abiertas el diálogo de esa pestaña, con el id de cada montaje del diálogo que la anunció (cerrar y
   * reabrir deprisa la misma tarea, o StrictMode, monta dos veces: el cierre del primero no quita la del segundo).
   */
  tasks: Map<string, Set<string>>;
}
const liveStreams = (globalThis as unknown as { __pzPresenceStreams?: Map<string, LiveStream> }).__pzPresenceStreams ??= new Map();
// Los canales de cada proyecto (ids de `liveStreams`): el estado de un proyecto no recorre los canales de los demás.
const streamsByProject = (globalThis as unknown as { __pzPresenceByProject?: Map<string, Set<string>> }).__pzPresenceByProject ??= new Map();

// Canales abiertos por (proyecto, persona): `isPresent` se consulta en cada acción registrada y no recorre ninguno.
const liveCount = (globalThis as unknown as { __pzPresenceLiveCount?: Map<string, number> }).__pzPresenceLiveCount ??= new Map();
const liveKey = (projectId: string, userId: string) => `${projectId}\u0000${userId}`;

function addLiveStream(id: string, s: LiveStream): void {
  liveStreams.set(id, s);
  let set = streamsByProject.get(s.projectId);
  if (!set) streamsByProject.set(s.projectId, (set = new Set()));
  set.add(id);
  const key = liveKey(s.projectId, s.userId);
  liveCount.set(key, (liveCount.get(key) ?? 0) + 1);
}

function deleteLiveStream(id: string): LiveStream | undefined {
  const s = liveStreams.get(id);
  if (!s) return undefined;
  liveStreams.delete(id);
  const set = streamsByProject.get(s.projectId);
  set?.delete(id);
  if (set?.size === 0) streamsByProject.delete(s.projectId);
  const key = liveKey(s.projectId, s.userId);
  const n = (liveCount.get(key) ?? 1) - 1;
  if (n > 0) liveCount.set(key, n);
  else liveCount.delete(key);
  return s;
}

function* projectStreams(projectId: string): Generator<LiveStream> {
  for (const id of streamsByProject.get(projectId) ?? []) {
    const s = liveStreams.get(id);
    if (s) yield s;
  }
}

/** Recibe el estado de la presencia del proyecto (el JSON del evento `presence`), calculado una vez para todos sus canales. */
type PresenceListener = (json: string) => void;
interface ProjectListeners {
  listeners: Set<PresenceListener>;
  /** Comprobación periódica (una por proyecto, no por canal): quien deja de contar como activo sin que pase nada. */
  check: ReturnType<typeof setInterval>;
}
const presenceListeners = (globalThis as unknown as { __pzPresenceListeners2?: Map<string, ProjectListeners> }).__pzPresenceListeners2 ??= new Map();
const pendingNotify = new Map<string, ReturnType<typeof setTimeout>>();
/** Cada cuánto se vuelve a calcular el estado de un proyecto con canales abiertos aunque no haya avisos. */
const PRESENCE_CHECK_MS = 25_000;

function broadcast(projectId: string): void {
  const entry = presenceListeners.get(projectId);
  if (!entry) return;
  const json = presenceJson(projectId);
  for (const l of entry.listeners) {
    try {
      l(json);
    } catch {
      // Un canal roto no afecta al resto.
    }
  }
}

/** Avisa (agrupado: 200 ms) a los canales del proyecto de que la presencia ha cambiado. */
function notifyPresence(projectId: string): void {
  if (!presenceListeners.has(projectId) || pendingNotify.has(projectId)) return;
  const timer = setTimeout(() => {
    pendingNotify.delete(projectId);
    broadcast(projectId);
  }, 200);
  timer.unref?.();
  pendingNotify.set(projectId, timer);
}

/**
 * El canal recibe el estado de la presencia del proyecto cada vez que cambia y en la comprobación periódica (cada 25 s,
 * por si alguien ha dejado de contar como activo); el canal descarta el que ya envió.
 */
export function subscribePresence(projectId: string, listener: PresenceListener): () => void {
  let entry = presenceListeners.get(projectId);
  if (!entry) {
    const check = setInterval(() => broadcast(projectId), PRESENCE_CHECK_MS);
    check.unref?.();
    presenceListeners.set(projectId, (entry = { listeners: new Set(), check }));
  }
  const e = entry;
  e.listeners.add(listener);
  return () => {
    e.listeners.delete(listener);
    if (e.listeners.size === 0 && presenceListeners.get(projectId) === e) {
      clearInterval(e.check);
      presenceListeners.delete(projectId);
    }
  };
}

/** Anota un canal en vivo abierto (la persona tiene el tablero a la vista). Devuelve su id, que solo conoce esa pestaña. */
export function openPresenceStream(projectId: string, userId: string, name: string, now = Date.now()): string {
  const id = randomUUID();
  const fresh = !isPresent(projectId, userId, now);
  addLiveStream(id, { projectId, userId, name, openedAt: now, tasks: new Map() });
  if (fresh) notifyPresence(projectId);
  return id;
}

/**
 * El canal se ha cerrado: deja de contar como tablero a la vista (la persona sigue 5 minutos entre los activos) y se
 * quitan las tareas que tenía abiertas. Se puede llamar más de una vez.
 */
export function closePresenceStream(id: string, now = Date.now()): void {
  const s = deleteLiveStream(id);
  if (!s) return;
  notePresence(s.projectId, s.userId, s.name, now);
  notifyPresence(s.projectId);
}

/**
 * Cierres de tarea que llegaron antes que su anuncio (abrir y cerrar muy deprisa: el DELETE puede adelantar al GET, o el
 * GET falló). Clave `canal:tarea:montaje`; el anuncio de ese mismo montaje que llega poco después no la retiene (si no,
 * quedaría abierta mientras dure el canal). El de otro montaje (reabrir la tarea) no lo consume.
 */
const earlyReleases = (globalThis as unknown as { __pzEarlyReleases?: Map<string, number> }).__pzEarlyReleases ??= new Map();
const EARLY_RELEASE_MS = 10_000;

function sweepEarlyReleases(now: number): void {
  for (const [k, at] of earlyReleases) if (now - at > EARLY_RELEASE_MS) earlyReleases.delete(k);
}

/**
 * El montaje `openId` del diálogo de la pestaña de ese canal tiene abierta la tarea (del mismo proyecto que el canal).
 * false si el canal no existe o no es de ese usuario y proyecto: entonces se usa el aviso con caducidad
 * (`noteTaskViewer`). Si ese montaje ya la cerró hace un momento (el cierre llegó antes que este anuncio), gana el
 * cierre: devuelve true sin retenerla. Solo avisa a los canales si la tarea no estaba ya abierta en esa pestaña.
 */
export function holdTaskView(streamId: string, userId: string, taskId: string, projectId: string, openId: string, now = Date.now()): boolean {
  const s = liveStreams.get(streamId);
  if (!s || s.userId !== userId || s.projectId !== projectId) return false;
  const key = `${streamId}:${taskId}:${openId}`;
  const released = earlyReleases.get(key);
  if (released !== undefined) {
    earlyReleases.delete(key);
    if (now - released <= EARLY_RELEASE_MS) return true;
  }
  const opens = s.tasks.get(taskId);
  if (opens) opens.add(openId);
  else {
    s.tasks.set(taskId, new Set([openId]));
    notifyPresence(projectId);
  }
  return true;
}

/**
 * El montaje `openId` del diálogo de la pestaña de ese canal ha cerrado la tarea. Si aún no la había anunciado, se
 * apunta para que su anuncio no la retenga. Solo avisa cuando la cierra el último montaje que la tenía abierta.
 */
export function releaseTaskView(streamId: string, userId: string, taskId: string, openId: string, now = Date.now()): void {
  const s = liveStreams.get(streamId);
  if (!s || s.userId !== userId) return;
  const opens = s.tasks.get(taskId);
  if (!opens?.delete(openId)) {
    if (earlyReleases.size > 1000) sweepEarlyReleases(now);
    earlyReleases.set(`${streamId}:${taskId}:${openId}`, now);
    return;
  }
  if (opens.size > 0) return;
  s.tasks.delete(taskId);
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
  for (const s of projectStreams(projectId)) for (const taskId of s.tasks.keys()) add(taskId, s.userId, s.name);
  for (const taskId of viewersByProject.get(projectId) ?? []) {
    const v = viewers.get(taskId);
    if (!v) continue;
    for (const [id, e] of v.users) if (now - e.at <= VIEWER_WINDOW_MS) add(taskId, id, e.name);
  }
  const out: Record<string, Person[]> = {};
  for (const taskId of [...byTask.keys()].sort()) {
    out[taskId] = [...byTask.get(taskId)!].map(([id, name]) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id));
  }
  return { users, viewers: out };
}

/** El estado del proyecto ya en JSON (lo que envía el evento `presence`). */
export function presenceJson(projectId: string, now = Date.now()): string {
  return JSON.stringify(presenceSnapshot(projectId, now));
}

// --- Actividad en el tablero -----------------------------------------------------------------------------------------

function isPresent(projectId: string, userId: string, now: number): boolean {
  const e = state.get(projectId)?.get(userId);
  if (e && now - e.at <= PRESENCE_WINDOW_MS) return true;
  return liveCount.has(liveKey(projectId, userId));
}

/** Barrido de la actividad caducada de todos los proyectos: los que nadie mira no pasan por `activeUsers`. */
const STATE_SWEEP_MS = 60_000;
let lastStateSweep = 0;
function sweepState(now: number): void {
  lastStateSweep = now;
  for (const [pid, users] of state) {
    for (const [id, e] of users) if (now - e.at > PRESENCE_WINDOW_MS) users.delete(id);
    if (users.size === 0) state.delete(pid);
  }
}

/** ¿Queda actividad anotada en memoria para el proyecto? (pruebas del barrido) */
export function hasPresenceEntry(projectId: string): boolean {
  return state.has(projectId);
}

/** Anota actividad de un usuario en un proyecto. */
export function notePresence(projectId: string, userId: string, name: string, at = Date.now()): void {
  // Como mucho una vez por minuto: barato aunque haya muchos proyectos.
  if (at - lastStateSweep > STATE_SWEEP_MS) sweepState(at);
  const fresh = !isPresent(projectId, userId, at);
  let users = state.get(projectId);
  if (!users) state.set(projectId, (users = new Map()));
  users.set(userId, { name, at });
  // Solo se avisa si aparece alguien: el orden se pone al día en la siguiente comprobación periódica del proyecto.
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
  for (const s of projectStreams(projectId)) {
    const prev = merged.get(s.userId);
    // Con el canal abierto cuenta desde que se abrió o desde su última acción: un orden estable entre comprobaciones.
    if (!prev || prev.at < s.openedAt) merged.set(s.userId, { name: s.name, at: s.openedAt });
  }
  return [...merged].map(([id, e]) => ({ id, name: e.name, at: e.at })).sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

// --- Tarea abierta sin canal en vivo (sondeo de respaldo cada pocos segundos) ----------------------------------------

// El sondeo de respaldo avisa cada 60 s: cada aviso vale 150 s (dos avisos y medio, por si uno se retrasa o se pierde).
const VIEWER_WINDOW_MS = 150_000;
type TaskViewers = { projectId: string; users: Map<string, Entry> };
const viewers = (globalThis as unknown as { __pzViewers?: Map<string, TaskViewers> }).__pzViewers ??= new Map();
// Las tareas de `viewers` de cada proyecto (el estado de un proyecto no recorre las de los demás).
const viewersByProject = (globalThis as unknown as { __pzViewersByProject?: Map<string, Set<string>> }).__pzViewersByProject ??= new Map();

function setViewers(taskId: string, v: TaskViewers): void {
  deleteViewers(taskId);
  viewers.set(taskId, v);
  let set = viewersByProject.get(v.projectId);
  if (!set) viewersByProject.set(v.projectId, (set = new Set()));
  set.add(taskId);
}

function deleteViewers(taskId: string): void {
  const v = viewers.get(taskId);
  if (!v) return;
  viewers.delete(taskId);
  const set = viewersByProject.get(v.projectId);
  set?.delete(taskId);
  if (set?.size === 0) viewersByProject.delete(v.projectId);
}

/** Quién más tiene abierta la tarea ahora (por cualquier camino), sin el propio usuario. */
export function taskViewersExcept(taskId: string, projectId: string, userId: string, now = Date.now()): Person[] {
  const out = new Map<string, string>();
  for (const s of projectStreams(projectId)) if (s.userId !== userId && s.tasks.has(taskId)) out.set(s.userId, s.name);
  const v = viewers.get(taskId);
  if (v) for (const [id, e] of v.users) if (id !== userId && now - e.at <= VIEWER_WINDOW_MS) out.set(id, e.name);
  return [...out].map(([id, name]) => ({ id, name }));
}

/** Anota (150 s) que el usuario tiene la tarea abierta y devuelve quién más la tiene. */
export function noteTaskViewer(taskId: string, projectId: string, userId: string, name: string, now = Date.now()): Person[] {
  if (viewers.size > 200) sweepViewers(now);
  let v = viewers.get(taskId);
  if (!v || v.projectId !== projectId) setViewers(taskId, (v = { projectId, users: new Map() }));
  const prev = v.users.get(userId);
  v.users.set(userId, { name, at: now });
  if (!prev || now - prev.at > VIEWER_WINDOW_MS) notifyPresence(projectId);
  for (const [id, e] of v.users) if (now - e.at > VIEWER_WINDOW_MS) v.users.delete(id);
  return taskViewersExcept(taskId, projectId, userId, now);
}

/**
 * Quién tiene abierta cada tarea del proyecto ahora mismo (sin `exceptUserId`), para los círculos de las tarjetas del
 * tablero (sondeo de respaldo). Solo recorre lo de ese proyecto.
 */
export function openTaskViewers(projectId: string, exceptUserId: string, now = Date.now()): Map<string, Person[]> {
  const out = new Map<string, Map<string, string>>();
  const add = (taskId: string, id: string, name: string) => {
    if (id === exceptUserId) return;
    let m = out.get(taskId);
    if (!m) out.set(taskId, (m = new Map()));
    m.set(id, name);
  };
  for (const taskId of [...(viewersByProject.get(projectId) ?? [])]) {
    const v = viewers.get(taskId);
    if (!v) continue;
    for (const [id, e] of v.users) {
      if (now - e.at > VIEWER_WINDOW_MS) v.users.delete(id);
      else add(taskId, id, e.name);
    }
    if (v.users.size === 0) deleteViewers(taskId);
  }
  for (const s of projectStreams(projectId)) for (const taskId of s.tasks.keys()) add(taskId, s.userId, s.name);
  return new Map([...out].map(([taskId, m]) => [taskId, [...m].map(([id, name]) => ({ id, name }))]));
}

/** El usuario ha cerrado la tarea (aviso sin canal). Solo avisa a los canales si estaba anotado. */
export function leaveTask(taskId: string, userId: string): void {
  const v = viewers.get(taskId);
  if (!v?.users.delete(userId)) return;
  if (v.users.size === 0) deleteViewers(taskId);
  notifyPresence(v.projectId);
}

// Las tareas que nadie vuelve a pingear no se limpiaban solas: barrido ocasional del mapa entero.
function sweepViewers(now: number): void {
  for (const [taskId, v] of viewers) {
    for (const [id, e] of v.users) if (now - e.at > VIEWER_WINDOW_MS) v.users.delete(id);
    if (v.users.size === 0) deleteViewers(taskId);
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
  for (const [id, s] of [...liveStreams]) {
    if (s.userId !== userId || (projectId && s.projectId !== projectId)) continue;
    deleteLiveStream(id);
    notifyPresence(s.projectId);
  }
  if (!projectId) {
    for (const [taskId, v] of viewers) {
      if (v.users.delete(userId)) notifyPresence(v.projectId);
      if (v.users.size === 0) deleteViewers(taskId);
    }
  }
}

/**
 * La persona ha cerrado sesión: deja de contar entre los activos (no 5 minutos más) y de tener tareas abiertas por el
 * aviso con caducidad, salvo en los proyectos donde le quede un canal abierto (otro dispositivo con el tablero a la vista).
 */
export function leavePresence(userId: string): void {
  for (const [pid, users] of state) {
    if (!users.has(userId) || liveCount.has(liveKey(pid, userId))) continue;
    users.delete(userId);
    if (users.size === 0) state.delete(pid);
    notifyPresence(pid);
  }
  for (const [taskId, v] of viewers) {
    if (liveCount.has(liveKey(v.projectId, userId)) || !v.users.delete(userId)) continue;
    if (v.users.size === 0) deleteViewers(taskId);
    notifyPresence(v.projectId);
  }
}

/** Vacía la presencia de un proyecto (cambia su visibilidad o se borra); reaparece quien siga actuando. */
export function dropProjectPresence(projectId: string): void {
  state.delete(projectId);
  for (const id of [...(streamsByProject.get(projectId) ?? [])]) deleteLiveStream(id);
  for (const taskId of [...(viewersByProject.get(projectId) ?? [])]) deleteViewers(taskId);
  notifyPresence(projectId);
}
