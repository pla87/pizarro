import "server-only";
import { db } from "./db";
import { fingerprintOps, type UndoOp } from "./undo";

// Antes de deshacer (o rehacer) se mira si otra persona cambió después lo que la entrada va a tocar: su historial
// (TaskEvent) en esas tareas desde que se creó la entrada y, si la entrada quita una tarea entera (deshacer su
// creación o rehacer su borrado), lo que otros le añadieron (comentarios, adjuntos, enlaces), que se iría con ella.
// No se aplica nada: quien llama pide confirmación y, si la persona acepta, aplica la entrada (ver actions/undo.ts).

/** Códigos del historial que son de las filas hijas, no de los campos de la tarjeta. */
const CHILD_CODES = ["comment", "subtask"];

export interface UndoConflicts {
  /** Quiénes (nombre en el momento del cambio), por orden de aparición. Vacío con `generic`. */
  names: string[];
  /** En cuántas de las tareas afectadas hubo cambios ajenos. */
  tasks: number;
  /** Cuántas tareas toca la entrada (para decir «esta tarea» o «N de estas tareas»). */
  affected: number;
  /** Lo que otros añadieron a tareas que la entrada va a quitar (se borraría con ellas). */
  added: { comments: number; attachments: number; links: number };
  /** La huella de la entrada cambió pero el historial no dice quién (cambios que no dejan historial). */
  generic: boolean;
}

/**
 * Cambios de otras personas, posteriores a la entrada, en lo que esta va a tocar; null si no hay ninguno.
 * `fingerprint`: la huella guardada en la entrada (las de rehacer y las que deja un rehacer), que también delata
 * cambios que no pasan por el historial (p. ej. reordenar).
 */
export async function findUndoConflicts(
  entry: { ops: unknown; createdAt: Date; fingerprint: string | null },
  userId: string,
  projectId: string,
): Promise<UndoConflicts | null> {
  const ops = entry.ops as UndoOp[];
  const fieldTasks = new Set<string>();
  const removedTasks = new Set<string>();
  const subtaskTasks = new Set<string>();
  const subtaskIds: string[] = [];
  for (const op of ops) {
    if (op.t === "task.set") fieldTasks.add(op.id);
    else if (op.t === "task.remove") removedTasks.add(op.id);
    else if (op.t === "subtask.set" || op.t === "subtask.remove") subtaskIds.push(op.id);
    else if (op.t === "subtask.restore") subtaskTasks.add(op.row.taskId);
  }
  if (subtaskIds.length) {
    for (const s of await db.subtask.findMany({ where: { id: { in: subtaskIds } }, select: { taskId: true } })) subtaskTasks.add(s.taskId);
  }
  const all = [...new Set([...fieldTasks, ...removedTasks, ...subtaskTasks])];
  const since = entry.createdAt;
  const [events, comments, attachments, links] = all.length
    ? await Promise.all([
        db.taskEvent.findMany({
          where: { taskId: { in: all }, projectId, createdAt: { gt: since }, AND: [{ userId: { not: null } }, { userId: { not: userId } }] },
          orderBy: { createdAt: "asc" },
          select: { taskId: true, userName: true, code: true },
        }),
        removedTasks.size
          ? db.taskComment.findMany({ where: { taskId: { in: [...removedTasks] }, createdAt: { gt: since }, deletedAt: null, AND: [{ authorId: { not: null } }, { authorId: { not: userId } }] }, select: { taskId: true, author: { select: { name: true } } } })
          : [],
        removedTasks.size
          ? db.taskAttachment.findMany({ where: { taskId: { in: [...removedTasks] }, createdAt: { gt: since }, AND: [{ createdById: { not: null } }, { createdById: { not: userId } }] }, select: { taskId: true, createdBy: { select: { name: true } } } })
          : [],
        removedTasks.size
          ? db.taskLink.findMany({ where: { taskId: { in: [...removedTasks] }, createdAt: { gt: since }, AND: [{ createdById: { not: null } }, { createdById: { not: userId } }] }, select: { taskId: true, createdBy: { select: { name: true } } } })
          : [],
      ])
    : [[], [], [], []];
  const names: string[] = [];
  const hit = new Set<string>();
  const note = (taskId: string, name: string | null | undefined) => {
    hit.add(taskId);
    if (name && !names.includes(name)) names.push(name);
  };
  for (const e of events) {
    // Lo que cuenta en cada tarea: quitarla entera, cualquier cambio; devolver sus campos, los de la tarjeta; sus subtareas, las subtareas.
    const relevant = removedTasks.has(e.taskId) || (fieldTasks.has(e.taskId) && !CHILD_CODES.includes(e.code)) || (subtaskTasks.has(e.taskId) && e.code === "subtask");
    if (relevant) note(e.taskId, e.userName);
  }
  for (const c of comments) note(c.taskId, c.author?.name);
  for (const a of attachments) note(a.taskId, a.createdBy?.name);
  for (const l of links) note(l.taskId, l.createdBy?.name);
  const added = { comments: comments.length, attachments: attachments.length, links: links.length };
  const affected = all.length;
  if (hit.size) return { names, tasks: hit.size, affected, added, generic: false };
  if (entry.fingerprint && (await fingerprintOps(projectId, ops)) !== entry.fingerprint) {
    return { names: [], tasks: 0, affected, added, generic: true };
  }
  return null;
}
