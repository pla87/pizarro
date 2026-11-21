import type { BoardTask } from "@/lib/types";
import { isPendingCopy } from "./groupDrag";
import { sameTask } from "./sameTask";

// Refresco en vivo de tarjetas sueltas: cuando otra persona cambia una o unas pocas tarjetas, el tablero pide solo esas
// (GET /api/projects/[id]/board-tasks?ids=…) en vez de recargarlo entero. Reglas puras (tests/live-patch.test.ts); las
// usan Board.tsx y, para el tope de ids que anuncia el canal, lib/action.ts.

/** Como mucho tantas tarjetas por aviso y por petición: más (un «Mover a…» de cientos) es un lote, y se recarga entero. */
export const LIVE_PATCH_MAX = 50;

/**
 * Espera máxima (al azar, como `foreignRefreshDelay`) antes de pedir las tarjetas cambiadas. Menor que la de la recarga
 * completa: la petición es pequeña y la tarjeta debe verse cambiar casi a la vez en todas las pestañas.
 */
export const PATCH_JITTER_MAX_MS = 500;

/**
 * Acciones que solo cambian las tarjetas que anuncian (crear, editar, mover, archivar, borrar, recuperar, duplicar, y lo
 * que cambia sus contadores: comentarios, subtareas, adjuntos y enlaces). Todas anotan cada tarea que tocan (noteTask /
 * noteTasks, también la siguiente aparición de una repetición y la copia de un duplicado); si además tocan algo más
 * (renumerar la columna, crear o quitar etiquetas), el aviso lleva `full` (needOwnRefresh). Las demás (columnas,
 * etiquetas, tipos, plantillas, permisos, deshacer, importar…) recargan el tablero entero.
 */
const PATCHABLE_ACTIONS: ReadonlySet<string> = new Set([
  "tasks.createTask", "tasks.updateTask", "tasks.moveTask", "tasks.moveTasks", "tasks.makeEvergreen",
  "tasks.archiveTask", "tasks.archiveTasks", "tasks.deleteTask", "tasks.deleteTasks", "tasks.duplicateTask", "tasks.restoreTask",
  "tasks.addComment", "tasks.editComment", "tasks.deleteComment",
  "tasks.addSubtask", "tasks.addSubtasks", "tasks.updateSubtask", "tasks.reorderSubtask", "tasks.deleteSubtask",
  "tasks.deleteAttachment", "attachments.upload", "tasks.createGoogleFile", "tasks.deleteTaskLink",
]);

/** Qué hacer con unos avisos del canal: recargar el tablero entero o pedir solo esas tarjetas. */
type LivePlan = { full: true } | { full: false; ids: string[] };

/**
 * Decide por un lote de avisos (los que llegan seguidos se agrupan). Basta uno que no sea «de tarjeta» (acción fuera de
 * la lista, sin la lista de tareas, con `full`, ilegible) o que entre todos pasen de LIVE_PATCH_MAX para recargarlo todo.
 */
export function liveUpdatePlan(changes: readonly unknown[]): LivePlan {
  const ids = new Set<string>();
  for (const change of changes) {
    if (!change || typeof change !== "object") return { full: true };
    const c = change as { action?: unknown; taskIds?: unknown; full?: unknown };
    if (typeof c.action !== "string" || !PATCHABLE_ACTIONS.has(c.action) || c.full === true) return { full: true };
    if (!Array.isArray(c.taskIds) || !c.taskIds.length || c.taskIds.some((id) => typeof id !== "string" || !id)) return { full: true };
    for (const id of c.taskIds as string[]) ids.add(id);
    if (ids.size > LIVE_PATCH_MAX) return { full: true };
  }
  return { full: false, ids: [...ids] };
}

/**
 * Ids que se piden: los cambiados y las tarjetas que dependen de ellos (bloqueadas por una que se borra pierden el
 * bloqueo en el servidor). Las copias provisionales no existen en el servidor.
 */
export function patchRequestIds(tasks: readonly BoardTask[], ids: Iterable<string>): string[] {
  const out = new Set([...ids].filter((id) => !isPendingCopy(id)));
  if (!out.size) return [];
  for (const t of tasks) if (t.blockedBy && out.has(t.blockedBy.id)) out.add(t.id);
  return [...out];
}

/**
 * Aplica al tablero las tarjetas recibidas para `requested`: cambia las que están, añade las nuevas y quita las pedidas
 * que no han llegado (borradas, archivadas o llevadas a otro proyecto). Las que no cambian conservan su objeto (no se
 * vuelven a dibujar), y si no cambia nada se devuelve la misma lista. Devuelve null si algo no cuadra y hay que recargar
 * entero: una tarjeta en una columna que el tablero no tiene (columna nueva) o dos tarjetas de una columna con la misma
 * posición (la columna se ha renumerado y el tablero tiene posiciones viejas).
 */
export function applyTaskPatch(
  prev: readonly BoardTask[],
  requested: readonly string[],
  received: readonly BoardTask[],
  columnIds: ReadonlySet<string>,
): { tasks: BoardTask[]; removed: string[] } | null {
  const asked = new Set(requested);
  const got = new Map<string, BoardTask>();
  for (const t of received) if (asked.has(t.id)) got.set(t.id, t);
  for (const t of got.values()) if (!columnIds.has(t.columnId)) return null;
  const removed: string[] = [];
  let changed = false;
  const seen = new Set<string>();
  const next: BoardTask[] = [];
  for (const t of prev) {
    if (!asked.has(t.id)) {
      next.push(t);
      continue;
    }
    seen.add(t.id);
    const fresh = got.get(t.id);
    if (!fresh) {
      removed.push(t.id);
      changed = true;
    } else if (sameTask(t, fresh)) next.push(t);
    else {
      next.push(fresh);
      changed = true;
    }
  }
  for (const t of got.values()) {
    if (seen.has(t.id)) continue;
    next.push(t);
    changed = true;
  }
  if (!changed) return { tasks: prev as BoardTask[], removed };
  // Posiciones únicas por columna (task-positions.ts): un empate entre una tarjeta recibida y otra del tablero quiere
  // decir que la de este tablero tiene una posición ya renumerada.
  if (positionClash(next, new Set([...got.values()].map((t) => t.columnId)))) return null;
  return { tasks: next, removed };
}

/** Dos tarjetas (no provisionales) de una de las columnas `touched` con la misma posición. */
function positionClash(tasks: readonly BoardTask[], touched: ReadonlySet<string>): boolean {
  const positions = new Map<string, Set<number>>();
  for (const t of tasks) {
    if (!touched.has(t.columnId) || isPendingCopy(t.id)) continue;
    let set = positions.get(t.columnId);
    if (!set) positions.set(t.columnId, (set = new Set()));
    if (set.has(t.position)) return true;
    set.add(t.position);
  }
  return false;
}

/**
 * Tarjetas de una recarga completa con las que se aplicaron por parche después de pedirla (`patched`: la versión del
 * parche, o null si el parche la quitó). La del parche es igual o más nueva: se pidió después que la recarga y por un
 * aviso de un cambio ya guardado; si después hubo otro, su propio aviso la vuelve a pedir. Así la recarga se aplica (sus
 * columnas, etiquetas y demás tarjetas) en vez de tirarla entera y pedir otra, que con el equipo activo se repetía en
 * cadena. Devuelve null si no casan (una tarjeta del parche en una columna que la recarga ya no trae, o con la posición
 * de otra porque la recarga trae la columna renumerada): entonces hay que pedir otra recarga.
 */
export function withPatchedTasks(
  server: readonly BoardTask[],
  patched: ReadonlyMap<string, BoardTask | null>,
  columnIds: ReadonlySet<string>,
): BoardTask[] | null {
  if (!patched.size) return server as BoardTask[];
  const next: BoardTask[] = [];
  const seen = new Set<string>();
  for (const t of server) {
    seen.add(t.id);
    if (!patched.has(t.id)) next.push(t);
    else {
      const p = patched.get(t.id);
      if (p) next.push(p);
    }
  }
  const touched = new Set<string>();
  for (const [id, p] of patched) {
    if (!p) continue;
    if (!columnIds.has(p.columnId)) return null;
    touched.add(p.columnId);
    if (!seen.has(id)) next.push(p);
  }
  return positionClash(next, touched) ? null : next;
}

/** Ruta de las tarjetas sueltas de un proyecto. */
export function liveTasksUrl(projectId: string, ids: readonly string[]): string {
  return `/api/projects/${encodeURIComponent(projectId)}/board-tasks?ids=${ids.map(encodeURIComponent).join(",")}`;
}
