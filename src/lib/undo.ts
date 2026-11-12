import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { actionContext } from "./action-context";
import { forgetAttachments } from "./attachment-cache";
import { isUniqueColumnRole } from "./constants";
import { excerpt } from "./mentions";
import { commentNoticesWhere } from "./notify";
import { db } from "./db";
import { assertTaskCapacity } from "./caps";
import { blockProblem, lockBlocking } from "./blocking";
import { lockTaskRows, lockTaskRowsForDelete, resolvePositionTies } from "./task-positions";
import { removeAttachmentFiles, removeReleaseAttachmentFiles } from "./uploads";

// Deshacer: cada acción deshacible deja sus operaciones inversas (addUndo) y runAction las guarda
// como una entrada del usuario en ese proyecto. Se conservan las 10 últimas; deshacer aplica la
// más reciente en orden inverso. Los ficheros de adjuntos borrados se conservan mientras su
// entrada exista, para poder devolverlos.
//
// Rehacer: al deshacer una entrada se captura el estado actual de todo lo que sus operaciones van
// a tocar (mirrorOps) y se guarda como entrada REDO; rehacerla hace lo mismo a la inversa y deja
// otra entrada UNDO, así que se puede alternar. Cualquier acción nueva del usuario en el proyecto
// vacía su pila de rehacer. Cada pila guarda 10 entradas por usuario y proyecto.

const UNDO_LIMIT = 10;
export const UNDO_MAX_AGE_DAYS = 7;

/** Campos de una tarea que se pueden restaurar (fechas en ISO). */
export interface TaskData {
  title?: string;
  description?: string;
  kindId?: string;
  color?: string | null;
  linkUrl?: string | null;
  position?: number;
  columnId?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  deliverableId?: string | null;
  archivedAt?: string | null;
  archivedFromColumnId?: string | null;
  evergreen?: boolean;
  evergreenEvery?: number;
  recurrence?: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  recurrenceDay?: number | null;
  contentUpdatedAt?: string | null;
  contentUpdatedById?: string | null;
  /** Campos opcionales (lib/task-fields.ts): decimales como texto, fecha en ISO. */
  cost?: string | null;
  costPaid?: boolean;
  estimatedHours?: string | null;
  actualHours?: string | null;
  priority?: "BAJA" | "MEDIA" | "ALTA" | "URGENTE" | null;
  client?: string | null;
  startDate?: string | null;
  /** Recurrencia: de qué tarea salió y la columna de rutinas de la que cuelga. */
  recurrenceFromId?: string | null;
  routineColumnId?: string | null;
  /** Tarea (del mismo proyecto) que bloquea a esta. */
  blockedById?: string | null;
}
export type TaskField = keyof TaskData;

type SubtaskRow = { id: string; taskId: string; title: string; done: boolean; position: number };
/** `authorName`: autor de un comentario importado de otra herramienta (sin usuario en Pizarro). */
type CommentRow = { id: string; taskId: string; authorId: string | null; authorName?: string | null; body: string; createdAt: string; editedAt: string | null; parentId?: string | null; deletedAt?: string | null };
type AttachmentRow = {
  id: string; taskId: string; originalName: string; mimeType: string; isImage: boolean;
  width: number | null; height: number | null; size: number; createdById: string | null; createdAt: string;
};
type LinkRow = { id: string; taskId: string; kind: string; title: string; url: string; externalId: string | null; createdById: string | null; shareStatus?: string | null; shareFailed?: number; createdAt: string };
type ColumnRow = { id: string; projectId: string; name: string; position: number; role: string; isDone: boolean; waitingDays?: number | null; routineTargetColumnId?: string | null; wipLimit?: number | null };

/** Todo lo necesario para recrear una tarea borrada con sus hijos. */
export interface TaskSnapshot {
  task: TaskData & { id: string; projectId: string; title: string; columnId: string; kindId: string; position: number; createdById: string | null; createdAt: string };
  labelIds: string[];
  subtasks: SubtaskRow[];
  comments: CommentRow[];
  attachments: AttachmentRow[];
  links: LinkRow[];
  releaseTaskIds: string[];
}

export type UndoOp =
  | { t: "task.set"; id: string; data: TaskData; labelIds?: string[] }
  | { t: "task.remove"; id: string }
  | { t: "task.restore"; snap: TaskSnapshot }
  | { t: "subtask.set"; id: string; data: { title?: string; done?: boolean; position?: number } }
  | { t: "subtask.remove"; id: string }
  | { t: "subtask.restore"; row: SubtaskRow }
  | { t: "comment.remove"; id: string }
  | { t: "comment.restore"; row: CommentRow }
  /** Borrado «blando» (el comentario tenía respuestas): vuelve el texto y desaparece la marca de borrado. */
  | { t: "comment.undelete"; id: string; body: string }
  | { t: "comment.softdelete"; id: string }
  /** Edición de un comentario: vuelve el texto y la marca de editado que tenía. */
  | { t: "comment.set"; id: string; body: string; editedAt: string | null }
  | { t: "attachment.remove"; id: string }
  | { t: "attachment.restore"; row: AttachmentRow }
  | { t: "link.remove"; id: string }
  | { t: "link.restore"; row: LinkRow }
  | { t: "column.set"; id: string; data: { name?: string; position?: number; role?: string; isDone?: boolean; waitingDays?: number | null; routineTargetColumnId?: string | null; wipLimit?: number | null } }
  | { t: "column.remove"; id: string }
  | { t: "column.restore"; row: ColumnRow }
  | { t: "release.remove"; id: string };

/** Anota operaciones inversas de la acción en curso (se guardan solo si la acción termina bien). */
export function addUndo(...ops: UndoOp[]): void {
  const store = actionContext.getStore();
  if (store) (store.undo ??= []).push(...ops);
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const date = (s: string | null | undefined) => (s ? new Date(s) : null);

const TASK_SELECT = {
  title: true, description: true, kindId: true, color: true, linkUrl: true, position: true, columnId: true, assigneeId: true,
  dueDate: true, deliverableId: true, archivedAt: true, archivedFromColumnId: true, evergreen: true, evergreenEvery: true, recurrence: true, recurrenceDay: true, contentUpdatedAt: true, contentUpdatedById: true,
  cost: true, costPaid: true, estimatedHours: true, actualHours: true, priority: true, client: true, startDate: true, recurrenceFromId: true, routineColumnId: true, blockedById: true,
} as const;
type TaskRowFull = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

function toTaskData(row: TaskRowFull, fields: readonly TaskField[]): TaskData {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = row[f];
    // Los decimales (Prisma.Decimal) viajan como texto «12.50».
    out[f] = v instanceof Date ? v.toISOString() : v !== null && typeof v === "object" && "toFixed" in v ? (v as { toFixed(n: number): string }).toFixed(2) : v;
  }
  return out as TaskData;
}

/** Estado actual de esos campos de varias tareas, para restaurarlos al deshacer. */
export async function captureTasks(ids: string[], fields: readonly TaskField[], withLabels = false): Promise<UndoOp[]> {
  if (!ids.length) return [];
  // Solo los campos pedidos: un «Mover a…» de 300 tarjetas no trae sus descripciones (hasta 20 KB cada una).
  const only = Object.fromEntries(fields.filter((f) => f in TASK_SELECT).map((f) => [f, true])) as Partial<Record<TaskField, true>>;
  const rows = await db.task.findMany({
    where: { id: { in: ids } },
    select: { id: true, ...only, ...(withLabels ? { labels: { select: { labelId: true } } } : {}) },
  });
  return rows.map((r) => taskSetOp(r as unknown as TaskRowFull & { id: string }, fields, withLabels ? (r as unknown as { labels: { labelId: string }[] }).labels : undefined));
}

/** Campos que necesita taskSetOp: quien ya ha leído la tarea los incluye en su consulta y se ahorra captureTasks. */
export const TASK_UNDO_SELECT = TASK_SELECT;

/** Lo mismo que captureTasks para una fila ya leída (con TASK_UNDO_SELECT y, si se pasan, sus etiquetas). */
export function taskSetOp(row: TaskRowFull & { id: string }, fields: readonly TaskField[], labels?: { labelId: string }[]): UndoOp {
  return {
    t: "task.set" as const,
    id: row.id,
    data: toTaskData(row, fields),
    ...(labels ? { labelIds: labels.map((l) => l.labelId) } : {}),
  };
}

/** Instantánea completa de tareas que se van a borrar. */
export async function snapshotTasks(ids: string[]): Promise<UndoOp[]> {
  if (!ids.length) return [];
  const rows = await db.task.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, projectId: true, createdById: true, createdAt: true, ...TASK_SELECT,
      labels: { select: { labelId: true } },
      subtasks: true,
      comments: true,
      attachments: true,
      links: true,
      releases: { select: { id: true } },
    },
  });
  return rows.map((r) => ({
    t: "task.restore" as const,
    snap: {
      task: {
        ...toTaskData(r, Object.keys(TASK_SELECT) as TaskField[]),
        id: r.id, projectId: r.projectId, title: r.title, columnId: r.columnId, kindId: r.kindId, position: r.position,
        createdById: r.createdById, createdAt: r.createdAt.toISOString(),
      },
      labelIds: r.labels.map((l) => l.labelId),
      subtasks: r.subtasks.map((s) => ({ id: s.id, taskId: s.taskId, title: s.title, done: s.done, position: s.position })),
      comments: r.comments.map((c) => ({ id: c.id, taskId: c.taskId, authorId: c.authorId, authorName: c.authorName, body: c.body, createdAt: c.createdAt.toISOString(), editedAt: iso(c.editedAt), parentId: c.parentId, deletedAt: iso(c.deletedAt) })),
      attachments: r.attachments.map((a) => ({
        id: a.id, taskId: a.taskId, originalName: a.originalName, mimeType: a.mimeType, isImage: a.isImage,
        width: a.width, height: a.height, size: a.size, createdById: a.createdById, createdAt: a.createdAt.toISOString(),
      })),
      links: r.links.map((l) => ({ id: l.id, taskId: l.taskId, kind: l.kind, title: l.title, url: l.url, externalId: l.externalId, createdById: l.createdById, shareStatus: l.shareStatus, shareFailed: l.shareFailed, createdAt: l.createdAt.toISOString() })),
      releaseTaskIds: r.releases.map((x) => x.id),
    },
  }));
}

export type UndoKind = "UNDO" | "REDO";

type SubtaskKey = "title" | "done" | "position";
/**
 * Fila borrada en el rato. `byUndo`: alguna entrada de deshacer la anota (la borró una acción suya); si solo la anotan
 * las de rehacer, la quitó su «Deshacer» (deshizo algo suyo, p. ej. haberla creado).
 */
type Deleted<R> = { row: R; byUndo: boolean };

/** Lo que una persona tocó de una tarea según sus entradas de deshacer y rehacer de un rato (ver touchedTask). */
export interface TouchedTask {
  /** Campos de la tarjeta (claves de TaskData) y si cambió sus etiquetas. */
  fields: Set<string>;
  labels: boolean;
  /**
   * Subtareas: campos que cambió, su valor antes del primer cambio del rato (solo de las entradas de deshacer: las de
   * rehacer guardan el valor previo a su «Deshacer», que ya era suyo), creadas (ids) y borradas (fila al borrarla).
   */
  subtaskFields: Map<string, Set<SubtaskKey>>;
  subtaskBefore: Map<string, Partial<Record<SubtaskKey, unknown>>>;
  subtasksCreated: Set<string>;
  subtasksDeleted: Map<string, Deleted<SubtaskRow>>;
  attachmentsCreated: Set<string>;
  attachmentsDeleted: Map<string, Deleted<AttachmentRow>>;
  linksCreated: Set<string>;
  linksDeleted: Map<string, Deleted<LinkRow>>;
  /** Tareas que nacieron en la misma acción que movió esta (la siguiente aparición de una recurrente). */
  spawned: Set<string>;
}

function noteDeleted<R extends { id: string }>(map: Map<string, Deleted<R>>, row: R, kind: UndoKind): void {
  map.set(row.id, { row, byUndo: (map.get(row.id)?.byUndo ?? false) || kind === "UNDO" });
}

/**
 * Qué hizo una persona en la tarea `taskId` según sus entradas (las más antiguas primero). Cada operación es la
 * inversa de lo que hizo: `task.set` lleva los campos que cambió; `subtask.remove`/`attachment.remove`/`link.remove`,
 * lo que creó; `*.restore`, lo que borró. Las de rehacer valen igual: son la inversa de lo que hizo su «Deshacer».
 * Las subtareas y adjuntos sin tarea en la operación se filtran después por pertenencia a la tarea.
 */
export function touchedTask(entries: { kind: UndoKind; ops: unknown }[], taskId: string): TouchedTask {
  const out: TouchedTask = {
    fields: new Set(), labels: false, subtaskFields: new Map(), subtaskBefore: new Map(), subtasksCreated: new Set(), subtasksDeleted: new Map(),
    attachmentsCreated: new Set(), attachmentsDeleted: new Map(), linksCreated: new Set(), linksDeleted: new Map(), spawned: new Set(),
  };
  for (const e of entries) {
    const ops = e.ops as UndoOp[];
    let moved = false;
    const removed: string[] = [];
    for (const op of ops) {
      switch (op.t) {
        case "task.set":
          if (op.id !== taskId) break;
          for (const k of Object.keys(op.data)) out.fields.add(k);
          if (op.labelIds) out.labels = true;
          if (op.data.columnId !== undefined) moved = true;
          break;
        case "task.remove":
          if (op.id !== taskId) removed.push(op.id);
          break;
        case "subtask.set": {
          const keys = out.subtaskFields.get(op.id) ?? new Set<SubtaskKey>();
          const before = out.subtaskBefore.get(op.id) ?? {};
          for (const [k, val] of Object.entries(op.data) as [SubtaskKey, unknown][]) {
            keys.add(k);
            if (e.kind === "UNDO" && !(k in before)) before[k] = val;
          }
          out.subtaskFields.set(op.id, keys);
          out.subtaskBefore.set(op.id, before);
          break;
        }
        case "subtask.remove": out.subtasksCreated.add(op.id); break;
        case "subtask.restore": if (op.row.taskId === taskId) noteDeleted(out.subtasksDeleted, op.row, e.kind); break;
        case "attachment.remove": out.attachmentsCreated.add(op.id); break;
        case "attachment.restore": if (op.row.taskId === taskId) noteDeleted(out.attachmentsDeleted, op.row, e.kind); break;
        case "link.remove": out.linksCreated.add(op.id); break;
        case "link.restore": if (op.row.taskId === taskId) noteDeleted(out.linksDeleted, op.row, e.kind); break;
        default: break;
      }
    }
    // Solo en las de deshacer: una de rehacer con task.remove es una tarea que su «Deshacer» devolvió, no una que naciera.
    if (moved && e.kind === "UNDO") for (const id of removed) out.spawned.add(id);
  }
  return out;
}

/**
 * ¿Pudo recortarse lo que touchedTask ve? Cada pila guarda UNDO_LIMIT entradas por persona y proyecto: si las de un
 * rato la llenan (de deshacer o de rehacer), las más antiguas de ese rato pueden haberse descartado.
 */
export function entriesMayBeTrimmed(entries: { kind: UndoKind }[]): boolean {
  return (["UNDO", "REDO"] as const).some((k) => entries.filter((e) => e.kind === k).length >= UNDO_LIMIT);
}

/**
 * Lo que otras personas hicieron en la tarea en el mismo rato (para no pisarlo en touchEverything): lo que dicen sus
 * entradas de deshacer y rehacer (`touched`), si esas entradas lo cuentan todo (`complete`: ninguna pila llena y ningún
 * cambio sin autor) y si su historial (TaskEvent) registra cambios en la tarjeta (`fields`) o en las subtareas (`subtasks`).
 */
export interface OthersActivity {
  touched: TouchedTask;
  complete: boolean;
  fields: boolean;
  subtasks: boolean;
}

/** Sin actividad de otras personas. */
const NO_OTHERS: OthersActivity = { touched: touchedTask([], ""), complete: true, fields: false, subtasks: false };

/**
 * Cuando las entradas pudieron recortarse (entriesMayBeTrimmed), lo que hizo la persona ya no se sabe entero: se da por
 * tocado lo que la instantánea del detalle permite devolver (campos, etiquetas, las subtareas que había, que vuelven a su
 * estado; las que no había se quitan), MENOS lo que hicieron otras personas en ese rato (`others`): sus campos, sus
 * subtareas nuevas y las que borraron no se tocan. Si no se puede saber qué hicieron (sus pilas también se llenaron o
 * hay cambios sin autor), en esa parte (tarjeta o subtareas) solo vuelve lo que las entradas conservadas atribuyen a esta
 * persona: antes que deshacer de más, se deshace de menos. Adjuntos y enlaces siguen por su autor y fecha.
 */
export function touchEverything(
  out: TouchedTask,
  taskId: string,
  snapSubtasks: { id: string; title: string; done: boolean; position: number }[] | undefined,
  currentSubtaskIds: string[],
  others: OthersActivity = NO_OTHERS,
): void {
  if (!others.fields || others.complete) {
    for (const k of TASK_DATA_KEYS) if (!others.touched.fields.has(k)) out.fields.add(k);
    if (!others.touched.labels) out.labels = true;
  }
  if (!snapSubtasks) return;
  // ¿Se sabe qué subtareas tocaron otras personas? (o no tocaron ninguna)
  if (others.subtasks && !others.complete) return;
  const theirs = others.touched;
  const before = new Set(snapSubtasks.map((s) => s.id));
  for (const id of currentSubtaskIds) if (!before.has(id) && !theirs.subtasksCreated.has(id)) out.subtasksCreated.add(id);
  const now = new Set(currentSubtaskIds);
  for (const s of snapSubtasks) {
    const keys = out.subtaskFields.get(s.id) ?? new Set<SubtaskKey>();
    const changedByOthers = theirs.subtaskFields.get(s.id);
    for (const k of ["title", "done", "position"] as const) if (!changedByOthers?.has(k)) keys.add(k);
    if (keys.size) out.subtaskFields.set(s.id, keys);
    out.subtasksCreated.delete(s.id);
    if (!now.has(s.id) && !out.subtasksDeleted.has(s.id) && !theirs.subtasksDeleted.has(s.id)) out.subtasksDeleted.set(s.id, { row: { ...s, taskId }, byUndo: true });
  }
}

/** Entrada de historial (TaskEvent) tal como se guarda en la entrada de rehacer para poder recrearla. */
export interface SavedEvent {
  taskId: string;
  projectId: string;
  userId: string | null;
  userName: string;
  code: string;
  label: string;
  createdAt: string;
}

/**
 * Guarda una entrada en la pila `kind` y descarta las que pasen del límite (liberando sus ficheros
 * pendientes). Una acción nueva (UNDO sin `fromRedo`) vacía además la pila de rehacer del usuario.
 * `history`: ids del historial que registró la acción (se borran al deshacer) o copia para recrearlo al rehacer.
 */
export async function saveUndo(
  userId: string, projectId: string, label: string, ops: UndoOp[], taskId: string | null = null,
  kind: UndoKind = "UNDO", clearRedo = kind === "UNDO", fingerprint: string | null = null,
  history: { eventIds?: string[]; events?: SavedEvent[] } = {},
): Promise<string> {
  if (clearRedo) await discardUndo({ userId, projectId, kind: "REDO" });
  const created = await db.undoEntry.create({
    data: {
      userId, projectId, taskId, kind, label: label.slice(0, 300), ops: ops as unknown as Prisma.InputJsonValue, fingerprint,
      eventIds: history.eventIds ?? [],
      ...(history.events?.length ? { events: history.events as unknown as Prisma.InputJsonValue } : {}),
    },
    select: { id: true },
  });
  const old = await db.undoEntry.findMany({
    where: { userId, projectId, kind },
    orderBy: { createdAt: "desc" },
    skip: UNDO_LIMIT,
    select: { id: true, ops: true },
  });
  if (old.length) await discardEntries(old);
  return created.id;
}

/** Ficheros retenidos por las entradas: adjuntos borrados que ya no existen en la base de datos. */
function retainedAttachmentIds(ops: UndoOp[]): string[] {
  const ids: string[] = [];
  for (const op of ops) {
    if (op.t === "attachment.restore") ids.push(op.row.id);
    if (op.t === "task.restore") ids.push(...op.snap.attachments.map((a) => a.id));
  }
  return ids;
}

/**
 * De esos adjuntos, los que otra entrada (deshacer o rehacer, de cualquier persona) aún puede devolver: su fichero
 * debe seguir en el disco. Una sola pasada por UndoEntry: se sacan con jsonb_path_query los ids que retiene cada
 * entrada (las dos formas de `retainedAttachmentIds`) y se cruzan con los pedidos. Antes era un EXISTS con `@>` por
 * cada id, que recorría la tabla entera por adjunto (segundos con miles de entradas, pagados al recortar la pila).
 */
async function stillRetained(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT r."id" FROM "UndoEntry" u
    CROSS JOIN LATERAL (
      SELECT jsonb_path_query(u."ops", '$[*] ? (@.t == "attachment.restore").row.id') #>> '{}'
      UNION ALL
      SELECT jsonb_path_query(u."ops", '$[*] ? (@.t == "task.restore").snap.attachments[*].id') #>> '{}'
    ) AS r("id")
    JOIN unnest(${ids}::text[]) AS a("id") ON a."id" = r."id"`;
  return new Set(rows.map((r) => r.id));
}

/** Borra entradas y los ficheros que solo ellas retenían (ni un adjunto vivo ni otra entrada los necesitan). */
export async function discardEntries(entries: { id: string; ops: unknown }[]): Promise<void> {
  if (!entries.length) return;
  const candidates = [...new Set(entries.flatMap((e) => retainedAttachmentIds(e.ops as UndoOp[])))];
  await db.undoEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } });
  if (!candidates.length) return;
  const alive = new Set((await db.taskAttachment.findMany({ where: { id: { in: candidates } }, select: { id: true } })).map((a) => a.id));
  const orphans = candidates.filter((id) => !alive.has(id));
  const retained = await stillRetained(orphans);
  await removeAttachmentFiles(orphans.filter((id) => !retained.has(id)));
}

/** Descarta las entradas que cumplan la condición (al borrar un proyecto o un usuario, o por antigüedad). */
export async function discardUndo(where: Prisma.UndoEntryWhereInput): Promise<number> {
  const entries = await db.undoEntry.findMany({ where, select: { id: true, ops: true } });
  await discardEntries(entries);
  return entries.length;
}

/**
 * Estado actual de todo lo que `ops` va a tocar, como operaciones que lo devuelven a ese estado:
 * aplicarlas con applyUndo deshace lo que haga applyUndo(ops). Se llama justo antes de aplicarlas.
 * Lo que no existe ahora no se captura (applyUndo lo saltaría igualmente). Las releases no se
 * pueden recrear, así que `release.remove` no tiene operación de rehacer.
 */
export async function mirrorOps(projectId: string, ops: UndoOp[]): Promise<UndoOp[]> {
  // Cada operación deja su hueco en `out`, en orden. Las de tarea (las que llegan a cientos en una acción masiva) se
  // leen después por lotes y rellenan su hueco: nada cambia en la BD mientras tanto, así que da lo mismo que leerlas
  // una a una, con 2-3 consultas por juego de campos en vez de 2 por tarjeta.
  const out: UndoOp[][] = [];
  const push = (...o: UndoOp[]) => void out.push(o);
  const seen = new Set<string>();
  const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true));
  const inProject = { task: { projectId } };
  const sets = new Map<string, { fields: TaskField[]; withLabels: boolean; slots: { id: string; slot: UndoOp[] }[] }>();
  const removes: { id: string; slot: UndoOp[] }[] = [];
  for (const op of ops) {
    switch (op.t) {
      case "task.set": {
        const fields = Object.keys(op.data).join(",");
        if (!once(`task.set:${op.id}:${fields}:${!!op.labelIds}`)) break;
        const slot: UndoOp[] = [];
        out.push(slot);
        const key = `${fields}:${!!op.labelIds}`;
        const g = sets.get(key) ?? { fields: Object.keys(op.data) as TaskField[], withLabels: !!op.labelIds, slots: [] };
        g.slots.push({ id: op.id, slot });
        sets.set(key, g);
        break;
      }
      case "task.remove":
        if (once(`task:${op.id}`)) {
          const slot: UndoOp[] = [];
          out.push(slot);
          removes.push({ id: op.id, slot });
        }
        break;
      case "task.restore":
        if (once(`task:${op.snap.task.id}`)) push({ t: "task.remove", id: op.snap.task.id });
        break;
      case "subtask.set": {
        if (!once(`subtask.set:${op.id}`)) break;
        const r = await db.subtask.findFirst({ where: { id: op.id, ...inProject } });
        if (r) push({ t: "subtask.set", id: op.id, data: Object.fromEntries(Object.keys(op.data).map((k) => [k, r[k as keyof typeof r]])) });
        break;
      }
      case "subtask.remove": {
        const r = once(`subtask:${op.id}`) && (await db.subtask.findFirst({ where: { id: op.id, ...inProject } }));
        if (r) push({ t: "subtask.restore", row: { id: r.id, taskId: r.taskId, title: r.title, done: r.done, position: r.position } });
        break;
      }
      case "subtask.restore":
        if (once(`subtask:${op.row.id}`)) push({ t: "subtask.remove", id: op.row.id });
        break;
      case "comment.remove": {
        const c = once(`comment:${op.id}`) && (await db.taskComment.findFirst({ where: { id: op.id, ...inProject } }));
        if (c) push({ t: "comment.restore", row: { id: c.id, taskId: c.taskId, authorId: c.authorId, authorName: c.authorName, body: c.body, createdAt: c.createdAt.toISOString(), editedAt: iso(c.editedAt), parentId: c.parentId, deletedAt: iso(c.deletedAt) } });
        break;
      }
      case "comment.restore":
        if (once(`comment:${op.row.id}`)) push({ t: "comment.remove", id: op.row.id });
        break;
      case "comment.undelete":
        if (once(`comment:${op.id}`)) push({ t: "comment.softdelete", id: op.id });
        break;
      case "comment.softdelete": {
        const c = once(`comment:${op.id}`) && (await db.taskComment.findFirst({ where: { id: op.id, deletedAt: null, ...inProject }, select: { id: true, body: true } }));
        if (c) push({ t: "comment.undelete", id: c.id, body: c.body });
        break;
      }
      case "comment.set": {
        const c = once(`comment:${op.id}`) && (await db.taskComment.findFirst({ where: { id: op.id, deletedAt: null, ...inProject }, select: { id: true, body: true, editedAt: true } }));
        if (c) push({ t: "comment.set", id: c.id, body: c.body, editedAt: iso(c.editedAt) });
        break;
      }
      case "attachment.remove": {
        const a = once(`attachment:${op.id}`) && (await db.taskAttachment.findFirst({ where: { id: op.id, ...inProject } }));
        if (a) {
          push({
            t: "attachment.restore",
            row: { id: a.id, taskId: a.taskId, originalName: a.originalName, mimeType: a.mimeType, isImage: a.isImage, width: a.width, height: a.height, size: a.size, createdById: a.createdById, createdAt: a.createdAt.toISOString() },
          });
        }
        break;
      }
      case "attachment.restore":
        if (once(`attachment:${op.row.id}`)) push({ t: "attachment.remove", id: op.row.id });
        break;
      case "link.remove": {
        const l = once(`link:${op.id}`) && (await db.taskLink.findFirst({ where: { id: op.id, ...inProject } }));
        if (l) push({ t: "link.restore", row: { id: l.id, taskId: l.taskId, kind: l.kind, title: l.title, url: l.url, externalId: l.externalId, createdById: l.createdById, createdAt: l.createdAt.toISOString() } });
        break;
      }
      case "link.restore":
        if (once(`link:${op.row.id}`)) push({ t: "link.remove", id: op.row.id });
        break;
      case "column.set": {
        if (!once(`column.set:${op.id}`)) break;
        const c = await db.column.findFirst({ where: { id: op.id, projectId } });
        if (c) push({ t: "column.set", id: op.id, data: Object.fromEntries(Object.keys(op.data).map((k) => [k, c[k as keyof typeof c]])) });
        break;
      }
      case "column.remove": {
        const c = once(`column:${op.id}`) && (await db.column.findFirst({ where: { id: op.id, projectId } }));
        if (c) push({ t: "column.restore", row: { id: c.id, projectId: c.projectId, name: c.name, position: c.position, role: c.role, isDone: c.isDone, waitingDays: c.waitingDays, routineTargetColumnId: c.routineTargetColumnId, wipLimit: c.wipLimit } });
        break;
      }
      case "column.restore":
        if (once(`column:${op.row.id}`)) push({ t: "column.remove", id: op.row.id });
        break;
      case "release.remove":
        break;
    }
  }
  const taskIds = [...new Set([...[...sets.values()].flatMap((g) => g.slots.map((x) => x.id)), ...removes.map((x) => x.id)])];
  if (taskIds.length) {
    const present = new Set((await db.task.findMany({ where: { id: { in: taskIds }, projectId }, select: { id: true } })).map((t) => t.id));
    for (const g of sets.values()) {
      const ids = [...new Set(g.slots.map((x) => x.id).filter((id) => present.has(id)))];
      const byId = new Map((await captureTasks(ids, g.fields, g.withLabels)).map((op) => [(op as TaskSetOp).id, op]));
      for (const x of g.slots) {
        const op = byId.get(x.id);
        if (op) x.slot.push(op);
      }
    }
    const snaps = new Map((await snapshotTasks(removes.map((x) => x.id).filter((id) => present.has(id)))).map((op) => [(op as TaskRestoreOp).snap.task.id, op]));
    for (const x of removes) {
      const op = snaps.get(x.id);
      if (op) x.slot.push(op);
    }
  }
  return out.flat();
}

/** Una columna de presupuesto exige el campo Coste: si al deshacer vuelve una, se reactiva. */
async function ensureCostField(projectId: string): Promise<void> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { taskFields: true } });
  if (p && !p.taskFields.includes("cost")) await db.project.update({ where: { id: projectId }, data: { taskFields: [...p.taskFields, "cost"] } });
}

/**
 * Una tarea fija solo existe en la columna de la release del proyecto. Lo que devuelve una entrada (la marca de una
 * tarea, el rol de una columna, una tarea borrada) puede dejar alguna fuera de ella si entretanto cambió otra cosa:
 * esas pasan a normales (una lectura y, solo si hay alguna, un UPDATE con sus filas bloqueadas en orden de id).
 */
async function clearStrayEvergreen(projectId: string): Promise<void> {
  // Lo normal es que no haya ninguna: una lectura sin candados y, solo si las hay, la transacción.
  const stray = await db.$queryRaw<{ id: string }[]>`
    SELECT t."id" FROM "Task" AS t
    WHERE t."projectId" = ${projectId} AND t."evergreen"
      AND NOT EXISTS (SELECT 1 FROM "Column" AS c WHERE c."id" = t."columnId" AND c."role" = 'NEXT_RELEASE')`;
  if (!stray.length) return;
  const ids = stray.map((r) => r.id);
  await db.$transaction(async (tx) => {
    // Filas en orden de id antes del UPDATE (que las bloquearía en el orden en que las recorre): otra acción en bloque
    // sobre las mismas tareas espera en vez de cruzarse (40P01). Las condiciones se vuelven a comprobar ya bloqueadas.
    await lockTaskRows(tx, ids);
    await tx.$executeRaw`
      UPDATE "Task" AS t SET "evergreen" = false, "evergreenEvery" = 1, "updatedAt" = ${new Date()}
      WHERE t."id" = ANY(${ids}::text[]) AND t."projectId" = ${projectId} AND t."evergreen"
        AND NOT EXISTS (SELECT 1 FROM "Column" AS c WHERE c."id" = t."columnId" AND c."role" = 'NEXT_RELEASE')`;
  });
}

/** Campos que taskUpdateData acepta: las entradas antiguas pueden traer otros (p. ej. externalUrl) y se ignoran. */
const TASK_DATA_KEYS: ReadonlySet<string> = new Set<keyof TaskData>([
  "title", "description", "kindId", "color", "linkUrl", "position", "columnId", "assigneeId", "dueDate", "deliverableId",
  "archivedAt", "archivedFromColumnId", "evergreen", "evergreenEvery", "recurrence", "recurrenceDay", "contentUpdatedAt",
  "contentUpdatedById", "cost", "costPaid", "estimatedHours", "actualHours", "priority", "client", "startDate",
  "recurrenceFromId", "routineColumnId", "blockedById",
]);

export function taskUpdateData(d: TaskData): Prisma.TaskUncheckedUpdateInput {
  const out: Prisma.TaskUncheckedUpdateInput = {};
  for (const [k, v] of Object.entries(d)) {
    if (!TASK_DATA_KEYS.has(k)) continue;
    if (k === "dueDate" || k === "startDate" || k === "archivedAt" || k === "contentUpdatedAt") (out as Record<string, unknown>)[k] = date(v as string | null);
    else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Tareas activas que aplicar `ops` añadiría: las que se vuelven a crear y las archivadas que se desarchivan. */
async function countReturningTasks(projectId: string, ops: UndoOp[]): Promise<number> {
  const restoreIds = new Set<string>();
  const unarchiveIds = new Set<string>();
  for (const op of ops) {
    if (op.t === "task.restore") restoreIds.add(op.snap.task.id);
    else if (op.t === "task.set" && op.data.archivedAt === null) unarchiveIds.add(op.id);
  }
  if (!restoreIds.size && !unarchiveIds.size) return 0;
  const [existing, archived] = await Promise.all([
    restoreIds.size ? db.task.count({ where: { id: { in: [...restoreIds] } } }) : 0,
    unarchiveIds.size ? db.task.count({ where: { id: { in: [...unarchiveIds] }, projectId, archivedAt: { not: null } } }) : 0,
  ]);
  return restoreIds.size - existing + archived;
}

type TaskSetOp = Extract<UndoOp, { t: "task.set" }>;
type TaskRemoveOp = Extract<UndoOp, { t: "task.remove" }>;
type TaskRestoreOp = Extract<UndoOp, { t: "task.restore" }>;

/** Operaciones de tarea que se aplican por lotes cuando van seguidas (deshacer un archivado o un movimiento de 500). */
const BATCHED: ReadonlySet<UndoOp["t"]> = new Set(["task.set", "task.remove", "task.restore"]);
/** Tamaño máximo de un lote (filas por sentencia). */
const BATCH_CHUNK = 500;
/** Lo que commentNoticesWhere necesita de un comentario para encontrar sus avisos. */
const COMMENT_NOTICE_SELECT = { id: true, taskId: true, authorId: true, createdAt: true, body: true } as const satisfies Prisma.TaskCommentSelect;

/** Tipo SQL de cada campo restaurable, para el UPDATE … FROM (VALUES …) de los lotes (los valores viajan como texto). */
const TASK_SQL_TYPE: Record<TaskField, string> = {
  title: "text", description: "text", kindId: "text", color: "text", linkUrl: "text", position: "float8", columnId: "text", assigneeId: "text",
  dueDate: "date", deliverableId: "text", archivedAt: "timestamp", archivedFromColumnId: "text", evergreen: "boolean", evergreenEvery: "int4",
  recurrence: '"Recurrence"', recurrenceDay: "int4", contentUpdatedAt: "timestamp", contentUpdatedById: "text", cost: "numeric", costPaid: "boolean",
  estimatedHours: "numeric", actualHours: "numeric", priority: '"TaskPriority"', client: "text", startDate: "date", recurrenceFromId: "text",
  routineColumnId: "text", blockedById: "text",
};

/**
 * Un valor de TaskData como expresión SQL tipada. Las fechas guardadas en ISO se pasan a UTC igual que hace Prisma
 * (timestamp sin zona en UTC; las de solo día, su fecha en UTC).
 */
function taskValueSql(field: TaskField, value: unknown): Prisma.Sql {
  const text = value === null || value === undefined ? null : String(value);
  const type = TASK_SQL_TYPE[field];
  if (type === "timestamp") return Prisma.sql`((${text}::text)::timestamptz AT TIME ZONE 'UTC')`;
  if (type === "date") return Prisma.sql`(((${text}::text)::timestamptz AT TIME ZONE 'UTC')::date)`;
  return Prisma.sql`(${text}::text)::${Prisma.raw(type)}`;
}

/**
 * Parte una racha de operaciones en lotes aplicables de una vez: sin repetir tarea dentro de un lote (la segunda
 * operación sobre la misma tarea depende de la primera) y como mucho BATCH_CHUNK. Las que `alone` marca se aplican
 * solas, en su sitio: el orden de la racha se respeta siempre.
 */
function batchesOf<T extends UndoOp>(run: T[], idOf: (op: T) => string, alone: (op: T) => boolean): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let ids = new Set<string>();
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
    ids = new Set();
  };
  for (const op of run) {
    if (alone(op)) {
      flush();
      out.push([op]);
      continue;
    }
    if (ids.has(idOf(op)) || cur.length >= BATCH_CHUNK) flush();
    cur.push(op);
    ids.add(idOf(op));
  }
  flush();
  return out;
}

/**
 * Aplica las operaciones inversas (de la última a la primera). Lo que ya no existe se salta;
 * devuelve cuántas operaciones no se pudieron aplicar. Con `keepFiles` no borra los ficheros de los
 * adjuntos que quita: la entrada contraria (rehacer/deshacer) los retiene y los libera al descartarse.
 *
 * Las rachas de operaciones de tarea del mismo tipo (task.set, task.remove, task.restore) se aplican por lotes, con
 * unas pocas consultas en vez de ~5 por tarjeta, y el mismo resultado que una a una (lo comprueba tests/db/undo-batch):
 * mismas comprobaciones (tarea en el proyecto, columna, tipo, entregable, responsable, etiquetas), `updatedAt`,
 * ficheros y caché de adjuntos. Lo que depende del orden dentro de la racha (un bloqueo que vuelve, que se comprueba
 * contra el estado de ese momento por los ciclos, y la tarea de origen de una recurrente, que es única) se aplica solo,
 * en su sitio. Si un lote falla (p. ej. una clave foránea que desapareció entretanto) no deja nada a medias: se repite
 * una a una. `batch: false` fuerza el camino de una en una (pruebas).
 */
export async function applyUndo(projectId: string, ops: UndoOp[], opts: { keepFiles?: boolean; batch?: boolean } = {}): Promise<number> {
  let skipped = 0;
  // Tope de tareas activas: si deshacer/rehacer va a crear (o desarchivar) tareas y no caben, falla entero
  // antes de tocar nada (la entrada se conserva, ver applyLast).
  const returning = await countReturningTasks(projectId, ops);
  if (returning) await assertTaskCapacity(db, projectId, returning);
  const filesToRemove: string[] = [];
  const releaseFiles: string[] = [];
  // Tareas que vuelven a una posición guardada: al terminar se comprueba que no coincidan con otra (ver resolvePositionTies).
  const placed: string[] = [];
  const columnIds = new Set((await db.column.findMany({ where: { projectId }, select: { id: true } })).map((c) => c.id));
  const firstColumn = async () => (await db.column.findFirst({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true } }))?.id;
  /** Una columna borrada entretanto: la tarea va a la primera. */
  const safeColumn = async (id: string | undefined) => (id && columnIds.has(id) ? id : await firstColumn());
  // Quién puede seguir siendo responsable (activo y con acceso al proyecto) y quién existe aún (autor):
  // se leen una vez para toda la entrada, no por tarea.
  const project = await db.project.findUnique({ where: { id: projectId }, select: { isPrivate: true } });
  const existingIds = new Set((await db.user.findMany({ select: { id: true } })).map((u) => u.id));
  const assignableIds = new Set(
    (await db.user.findMany({
      where: { active: true, ...(project?.isPrivate ? { memberships: { some: { projectId } } } : { OR: [{ role: "ADMIN" }, { memberships: { some: { projectId } } }] }) },
      select: { id: true },
    })).map((u) => u.id),
  );
  const known = (id: string | null | undefined) => (id && existingIds.has(id) ? id : null);
  const assignable = (id: string | null | undefined) => (id && assignableIds.has(id) ? id : null);

  /** Una operación suelta; devuelve 1 si no se pudo aplicar. */
  const applyOne = async (op: UndoOp): Promise<number> => {
    let miss = 0;
    try {
      switch (op.t) {
        case "task.set": {
          const exists = await db.task.count({ where: { id: op.id, projectId } });
          if (!exists) { miss++; break; }
          const data = { ...op.data };
          if (data.columnId) data.columnId = await safeColumn(data.columnId);
          if (data.kindId && !(await db.taskKind.count({ where: { id: data.kindId } }))) delete data.kindId;
          if (data.deliverableId && !(await db.deliverable.count({ where: { id: data.deliverableId } }))) data.deliverableId = null;
          if (data.assigneeId) data.assigneeId = assignable(data.assigneeId);
          if (data.position !== undefined || data.columnId !== undefined) placed.push(op.id);
          const labelRows = op.labelIds ? await db.label.findMany({ where: { id: { in: op.labelIds }, projectId }, select: { id: true } }) : null;
          await db.$transaction(async (tx) => {
            // El bloqueo solo vuelve si la tarea que bloqueaba sigue en el proyecto y no cierra un ciclo;
            // comprobación y escritura van juntas bajo el candado de bloqueos del proyecto.
            if (data.blockedById) {
              await lockBlocking(tx, projectId);
              if (await blockProblem(op.id, data.blockedById, projectId, tx)) data.blockedById = null;
            }
            await tx.task.update({ where: { id: op.id }, data: taskUpdateData(data) });
            if (labelRows) {
              await tx.taskLabel.deleteMany({ where: { taskId: op.id } });
              await tx.taskLabel.createMany({ data: labelRows.map((l) => ({ taskId: op.id, labelId: l.id })) });
            }
          });
          break;
        }
        case "task.remove": {
          const atts = await db.taskAttachment.findMany({ where: { taskId: op.id }, select: { id: true } });
          const { count } = await db.task.deleteMany({ where: { id: op.id, projectId } });
          if (!count) miss++;
          else {
            filesToRemove.push(...atts.map((a) => a.id));
            forgetAttachments(atts.map((a) => a.id));
          }
          break;
        }
        case "task.restore": {
          const s = op.snap;
          if (await db.task.count({ where: { id: s.task.id } })) { miss++; break; }
          const t = s.task;
          const kindOk = await db.taskKind.count({ where: { id: t.kindId } });
          const kindId = kindOk ? t.kindId : (await db.taskKind.findFirst({ where: { OR: [{ projectId: null }, { projectId }] }, orderBy: { position: "asc" }, select: { id: true } }))?.id;
          const columnId = await safeColumn(t.columnId);
          if (!kindId || !columnId) { miss++; break; }
          // La tarea de la que salió puede haberse borrado (clave foránea): entonces se queda sin origen. Tampoco lo
          // conserva si entretanto nació otra siguiente aparición de esa tarea (recurrenceFromId es único: el alta
          // fallaría y la tarea se perdería).
          const recurrenceFromId = t.recurrenceFromId
            && (await db.task.count({ where: { id: t.recurrenceFromId } }))
            && !(await db.task.count({ where: { recurrenceFromId: t.recurrenceFromId } }))
            ? t.recurrenceFromId
            : null;
          const deliverableId = t.deliverableId && (await db.deliverable.count({ where: { id: t.deliverableId } })) ? t.deliverableId : null;
          const labels = await db.label.findMany({ where: { id: { in: s.labelIds }, projectId }, select: { id: true } });
          // Se crea sin bloqueo y se enlaza después (la que bloquea puede ser otra tarea que vuelve en esta misma entrada).
          const blockedById = t.blockedById ?? null;
          await db.$transaction(async (tx) => {
            if (blockedById) await lockBlocking(tx, projectId);
            await tx.task.create({
              data: {
                ...(taskUpdateData({ ...t, columnId, kindId, deliverableId, assigneeId: assignable(t.assigneeId), recurrenceFromId, blockedById: null }) as Prisma.TaskUncheckedCreateInput),
                id: t.id, projectId, title: t.title, position: t.position, createdById: known(t.createdById), createdAt: new Date(t.createdAt),
              },
            });
            await tx.taskLabel.createMany({ data: labels.map((l) => ({ taskId: t.id, labelId: l.id })) });
            await tx.subtask.createMany({ data: s.subtasks });
            await tx.taskComment.createMany({ data: s.comments.map((c) => ({ ...c, authorId: known(c.authorId), createdAt: new Date(c.createdAt), editedAt: date(c.editedAt), deletedAt: date(c.deletedAt) })) });
            await tx.taskAttachment.createMany({ data: s.attachments.map((a) => ({ ...a, createdById: known(a.createdById), createdAt: new Date(a.createdAt) })) });
            await tx.taskLink.createMany({ data: s.links.map((l) => ({ ...l, kind: l.kind as Prisma.TaskLinkCreateManyInput["kind"], createdById: known(l.createdById), createdAt: new Date(l.createdAt) })) });
            await tx.releaseTask.updateMany({ where: { id: { in: s.releaseTaskIds } }, data: { taskId: t.id } });
            if (blockedById && !(await blockProblem(t.id, blockedById, projectId, tx))) await tx.task.update({ where: { id: t.id }, data: { blockedById } });
          });
          placed.push(t.id);
          break;
        }
        case "subtask.set": {
          const { count } = await db.subtask.updateMany({ where: { id: op.id, task: { projectId } }, data: op.data });
          if (!count) miss++;
          break;
        }
        case "subtask.remove": {
          const { count } = await db.subtask.deleteMany({ where: { id: op.id, task: { projectId } } });
          if (!count) miss++;
          break;
        }
        case "subtask.restore": {
          if (!(await db.task.count({ where: { id: op.row.taskId, projectId } })) || (await db.subtask.count({ where: { id: op.row.id } }))) { miss++; break; }
          await db.subtask.create({ data: op.row });
          break;
        }
        // Como deleteComment: al quitar o vaciar un comentario se vacía el extracto de los avisos que creó (si no,
        // seguirían mostrando su texto), y al devolverlo vuelven a mostrarlo. Se buscan por commentId (sin clave ajena:
        // sobrevive al borrado) y, los antiguos sin él, por la heurística de commentNoticesWhere (con extracto vacío
        // cuando ya se vaciaron).
        case "comment.remove": {
          const c = await db.taskComment.findFirst({ where: { id: op.id, task: { projectId } }, select: COMMENT_NOTICE_SELECT });
          const { count } = await db.taskComment.deleteMany({ where: { id: op.id, task: { projectId } } });
          if (!count) miss++;
          else if (c) await db.notification.updateMany({ where: commentNoticesWhere(c), data: { excerpt: "" } });
          break;
        }
        case "comment.restore": {
          const r = op.row;
          if (!(await db.task.count({ where: { id: r.taskId, projectId } })) || (await db.taskComment.count({ where: { id: r.id } }))) { miss++; break; }
          const author = r.authorId && (await db.user.count({ where: { id: r.authorId } })) ? r.authorId : null;
          const parentId = r.parentId && (await db.taskComment.count({ where: { id: r.parentId } })) ? r.parentId : null;
          await db.taskComment.create({ data: { ...r, parentId, authorId: author, createdAt: new Date(r.createdAt), editedAt: date(r.editedAt), deletedAt: date(r.deletedAt) } });
          if (!r.deletedAt) await db.notification.updateMany({ where: commentNoticesWhere({ ...r, createdAt: new Date(r.createdAt), body: "" }), data: { excerpt: excerpt(r.body) } });
          break;
        }
        case "comment.undelete": {
          const c = await db.taskComment.findFirst({ where: { id: op.id, deletedAt: { not: null }, task: { projectId } }, select: COMMENT_NOTICE_SELECT });
          const { count } = await db.taskComment.updateMany({ where: { id: op.id, deletedAt: { not: null }, task: { projectId } }, data: { body: op.body, deletedAt: null } });
          if (!count) miss++;
          else if (c) await db.notification.updateMany({ where: commentNoticesWhere({ ...c, body: "" }), data: { excerpt: excerpt(op.body) } });
          break;
        }
        case "comment.softdelete": {
          const c = await db.taskComment.findFirst({ where: { id: op.id, deletedAt: null, task: { projectId } }, select: COMMENT_NOTICE_SELECT });
          const { count } = await db.taskComment.updateMany({ where: { id: op.id, deletedAt: null, task: { projectId } }, data: { body: "", deletedAt: new Date() } });
          if (!count) miss++;
          else if (c) await db.notification.updateMany({ where: commentNoticesWhere(c), data: { excerpt: "" } });
          break;
        }
        case "comment.set": {
          const c = await db.taskComment.findFirst({ where: { id: op.id, deletedAt: null, task: { projectId } }, select: COMMENT_NOTICE_SELECT });
          const { count } = await db.taskComment.updateMany({ where: { id: op.id, deletedAt: null, task: { projectId } }, data: { body: op.body, editedAt: date(op.editedAt) } });
          if (!count) miss++;
          // Los avisos del comentario vuelven a mostrar el texto que queda (si no, al borrarlo seguirían con el deshecho).
          else if (c) await db.notification.updateMany({ where: commentNoticesWhere(c), data: { excerpt: excerpt(op.body) } });
          break;
        }
        case "attachment.remove": {
          const { count } = await db.taskAttachment.deleteMany({ where: { id: op.id, task: { projectId } } });
          if (!count) miss++;
          else {
            filesToRemove.push(op.id);
            forgetAttachments([op.id]);
          }
          break;
        }
        case "attachment.restore": {
          // Deshacer un borrado recrea lo que existía hace nada: no se comprueba la cuota de almacenamiento (igual que
          // task.restore y el «Cancelar» de tasks.ts). Puede dejar el proyecto algo por encima; se libera desde sus ajustes.
          const r = op.row;
          if (!(await db.task.count({ where: { id: r.taskId, projectId } })) || (await db.taskAttachment.count({ where: { id: r.id } }))) { miss++; break; }
          const creator = r.createdById && (await db.user.count({ where: { id: r.createdById } })) ? r.createdById : null;
          await db.taskAttachment.create({ data: { ...r, createdById: creator, createdAt: new Date(r.createdAt) } });
          break;
        }
        case "link.remove": {
          const { count } = await db.taskLink.deleteMany({ where: { id: op.id, task: { projectId } } });
          if (!count) miss++;
          break;
        }
        case "link.restore": {
          const r = op.row;
          if (!(await db.task.count({ where: { id: r.taskId, projectId } })) || (await db.taskLink.count({ where: { id: r.id } }))) { miss++; break; }
          const creator = r.createdById && (await db.user.count({ where: { id: r.createdById } })) ? r.createdById : null;
          await db.taskLink.create({ data: { ...r, kind: r.kind as Prisma.TaskLinkCreateInput["kind"], createdById: creator, createdAt: new Date(r.createdAt) } });
          break;
        }
        case "column.set": {
          // Un rol único (siguiente salto, en producción) solo lo tiene una columna: si otra lo conserva ahora,
          // se le quita antes; la operación de esa columna en la misma entrada le devuelve el suyo.
          const uniqueRole = op.data.role && isUniqueColumnRole(op.data.role) ? (op.data.role as "NEXT_RELEASE" | "IN_PRODUCTION") : null;
          const [, { count }] = await db.$transaction([
            db.column.updateMany({ where: uniqueRole ? { projectId, role: uniqueRole, id: { not: op.id } } : { id: "" }, data: { role: "NONE" } }),
            db.column.updateMany({ where: { id: op.id, projectId }, data: op.data as Prisma.ColumnUpdateManyMutationInput }),
          ]);
          if (!count) miss++;
          else if (op.data.role === "BUDGET") await ensureCostField(projectId);
          break;
        }
        case "column.remove": {
          if (await db.task.count({ where: { columnId: op.id, archivedAt: null } })) { miss++; break; }
          const other = await db.column.findFirst({ where: { projectId, id: { not: op.id } }, orderBy: { position: "asc" }, select: { id: true } });
          if (!other) { miss++; break; }
          placed.push(...(await db.task.findMany({ where: { columnId: op.id }, select: { id: true } })).map((r) => r.id));
          await db.$transaction([
            db.task.updateMany({ where: { columnId: op.id }, data: { columnId: other.id } }),
            db.column.deleteMany({ where: { id: op.id, projectId } }),
          ]);
          columnIds.delete(op.id);
          break;
        }
        case "column.restore": {
          if (await db.column.count({ where: { id: op.row.id } })) { miss++; break; }
          // El destino de rutinas puede haberse borrado entre tanto: entonces la columna vuelve sin él.
          const routineTargetColumnId = op.row.routineTargetColumnId && (await db.column.count({ where: { id: op.row.routineTargetColumnId, projectId } })) ? op.row.routineTargetColumnId : null;
          await db.column.create({ data: { ...op.row, routineTargetColumnId, projectId, role: op.row.role as Prisma.ColumnCreateInput["role"] } });
          if (op.row.role === "BUDGET") await ensureCostField(projectId);
          columnIds.add(op.row.id);
          break;
        }
        case "release.remove": {
          const atts = await db.releaseAttachment.findMany({ where: { releaseId: op.id }, select: { id: true } });
          const { count } = await db.release.deleteMany({ where: { id: op.id, projectId } });
          if (!count) miss++;
          else releaseFiles.push(...atts.map((a) => a.id));
          break;
        }
      }
    } catch (err) {
      console.error("[undo]", op.t, err);
      return 1;
    }
    return miss;
  };
  const oneByOne = async (run: UndoOp[]): Promise<number> => {
    let s = 0;
    for (const op of run) s += await applyOne(op);
    return s;
  };

  /** Lote de task.set de tareas distintas: las comprobaciones de applyOne, leídas de una vez; un UPDATE por juego de campos. */
  const setTasks = async (run: TaskSetOp[]): Promise<number> => {
    let s = 0;
    const kindIds = [...new Set(run.flatMap((op) => (op.data.kindId ? [op.data.kindId] : [])))];
    const deliverableIds = [...new Set(run.flatMap((op) => (op.data.deliverableId ? [op.data.deliverableId] : [])))];
    const labelIds = [...new Set(run.flatMap((op) => op.labelIds ?? []))];
    const [present, kinds, deliverables, labels] = await Promise.all([
      db.task.findMany({ where: { id: { in: run.map((op) => op.id) }, projectId }, select: { id: true } }),
      kindIds.length ? db.taskKind.findMany({ where: { id: { in: kindIds } }, select: { id: true } }) : [],
      deliverableIds.length ? db.deliverable.findMany({ where: { id: { in: deliverableIds } }, select: { id: true } }) : [],
      labelIds.length ? db.label.findMany({ where: { id: { in: labelIds }, projectId }, select: { id: true } }) : [],
    ]);
    const presentIds = new Set(present.map((t) => t.id));
    const kindOk = new Set(kinds.map((k) => k.id));
    const deliverableOk = new Set(deliverables.map((d) => d.id));
    const labelOk = new Set(labels.map((l) => l.id));
    let first: Promise<string | undefined> | null = null;
    // Por juego de campos (los que quedan tras las comprobaciones) y si lleva etiquetas: cada grupo, una sentencia.
    const groups = new Map<string, { keys: TaskField[]; withLabels: boolean; rows: { op: TaskSetOp; data: TaskData; labelIds: string[] }[] }>();
    for (const op of run) {
      if (!presentIds.has(op.id)) { s++; continue; }
      const data = { ...op.data };
      if (data.columnId) data.columnId = columnIds.has(data.columnId) ? data.columnId : await (first ??= firstColumn());
      if (data.kindId && !kindOk.has(data.kindId)) delete data.kindId;
      if (data.deliverableId && !deliverableOk.has(data.deliverableId)) data.deliverableId = null;
      if (data.assigneeId) data.assigneeId = assignable(data.assigneeId);
      if (data.position !== undefined || data.columnId !== undefined) placed.push(op.id);
      const keys = (Object.keys(data) as TaskField[]).filter((k) => TASK_DATA_KEYS.has(k) && data[k] !== undefined).sort();
      const key = `${keys.join(",")}|${op.labelIds ? "L" : ""}`;
      const g = groups.get(key) ?? { keys, withLabels: !!op.labelIds, rows: [] };
      g.rows.push({ op, data, labelIds: (op.labelIds ?? []).filter((id) => labelOk.has(id)) });
      groups.set(key, g);
    }
    const now = new Date();
    for (const g of groups.values()) {
      // Sin campos que escribir (todo filtrado), una a una: es lo que hace task.update con datos vacíos.
      if (!g.keys.length) { s += await oneByOne(g.rows.map((r) => r.op)); continue; }
      try {
        const count = await db.$transaction(async (tx) => {
          const cols = Prisma.raw(g.keys.map((k) => `"${k}"`).join(", "));
          const sets = Prisma.raw(g.keys.map((k) => `"${k}" = v."${k}"`).join(", "));
          const values = Prisma.join(g.rows.map((r) => Prisma.sql`(${r.op.id}::text, ${Prisma.join(g.keys.map((k) => taskValueSql(k, r.data[k])))})`));
          // En orden de id antes del UPDATE … FROM (VALUES …), que las bloquearía en el orden en que recorre la tabla:
          // otra persona moviendo o archivando esas mismas tarjetas en bloque (también en orden de id) espera en vez de
          // cruzarse (40P01). Aquí no se toma ningún otro candado (ni de proyecto ni de columna) antes ni después.
          await lockTaskRows(tx, g.rows.map((r) => r.op.id));
          const n = await tx.$executeRaw`UPDATE "Task" AS t SET ${sets}, "updatedAt" = ${now} FROM (VALUES ${values}) AS v("id", ${cols}) WHERE t."id" = v."id"`;
          if (g.withLabels) {
            await tx.taskLabel.deleteMany({ where: { taskId: { in: g.rows.map((r) => r.op.id) } } });
            await tx.taskLabel.createMany({ data: g.rows.flatMap((r) => r.labelIds.map((labelId) => ({ taskId: r.op.id, labelId }))) });
          }
          return n;
        });
        // Una tarea borrada justo entre la comprobación y el UPDATE: como el P2025 de task.update, cuenta como no aplicada.
        s += g.rows.length - count;
      } catch (err) {
        console.error("[undo] lote task.set: se repite una a una", err);
        s += await oneByOne(g.rows.map((r) => r.op));
      }
    }
    return s;
  };

  /** Lote de task.remove: un DELETE … RETURNING; ficheros y caché, solo de las que de verdad se borran. */
  const removeTasks = async (run: TaskRemoveOp[]): Promise<number> => {
    const ids = run.map((op) => op.id);
    try {
      const atts = await db.taskAttachment.findMany({ where: { taskId: { in: ids } }, select: { id: true, taskId: true } });
      const deleted = new Set(
        await db.$transaction(async (tx) => {
          // Como en setTasks: filas en orden de id antes del DELETE … ANY (que las bloquea en el orden en que las encuentra),
          // y ya con FOR UPDATE, el bloqueo del DELETE (ver lockTaskRowsForDelete).
          await lockTaskRowsForDelete(tx, ids);
          return (await tx.$queryRaw<{ id: string }[]>`DELETE FROM "Task" WHERE "id" = ANY(${ids}::text[]) AND "projectId" = ${projectId} RETURNING "id"`).map((r) => r.id);
        }),
      );
      const gone = atts.filter((a) => deleted.has(a.taskId)).map((a) => a.id);
      filesToRemove.push(...gone);
      forgetAttachments(gone);
      return run.length - deleted.size;
    } catch (err) {
      console.error("[undo] lote task.remove: se repite una a una", err);
      return oneByOne(run);
    }
  };

  /** Lote de task.restore (sin bloqueo ni tarea de origen): las comprobaciones de applyOne, leídas de una vez, y un createMany por tabla. */
  const restoreTasks = async (run: TaskRestoreOp[]): Promise<number> => {
    let s = 0;
    const snaps = run.map((op) => op.snap);
    const deliverableIds = [...new Set(snaps.flatMap((x) => (x.task.deliverableId ? [x.task.deliverableId] : [])))];
    const [existing, kinds, deliverables, labels] = await Promise.all([
      db.task.findMany({ where: { id: { in: snaps.map((x) => x.task.id) } }, select: { id: true } }),
      db.taskKind.findMany({ where: { id: { in: [...new Set(snaps.map((x) => x.task.kindId))] } }, select: { id: true } }),
      deliverableIds.length ? db.deliverable.findMany({ where: { id: { in: deliverableIds } }, select: { id: true } }) : [],
      db.label.findMany({ where: { id: { in: [...new Set(snaps.flatMap((x) => x.labelIds))] }, projectId }, select: { id: true } }),
    ]);
    const exists = new Set(existing.map((t) => t.id));
    const kindOk = new Set(kinds.map((k) => k.id));
    const deliverableOk = new Set(deliverables.map((d) => d.id));
    const labelOk = new Set(labels.map((l) => l.id));
    let fallbackKind: Promise<string | undefined> | null = null;
    let first: Promise<string | undefined> | null = null;
    const rows: { op: TaskRestoreOp; data: Prisma.TaskCreateManyInput }[] = [];
    for (const op of run) {
      const t = op.snap.task;
      if (exists.has(t.id)) { s++; continue; }
      const kindId = kindOk.has(t.kindId)
        ? t.kindId
        : await (fallbackKind ??= db.taskKind.findFirst({ where: { OR: [{ projectId: null }, { projectId }] }, orderBy: { position: "asc" }, select: { id: true } }).then((k) => k?.id));
      const columnId = t.columnId && columnIds.has(t.columnId) ? t.columnId : await (first ??= firstColumn());
      if (!kindId || !columnId) { s++; continue; }
      const deliverableId = t.deliverableId && deliverableOk.has(t.deliverableId) ? t.deliverableId : null;
      rows.push({
        op,
        data: {
          ...(taskUpdateData({ ...t, columnId, kindId, deliverableId, assigneeId: assignable(t.assigneeId), recurrenceFromId: null, blockedById: null }) as Prisma.TaskCreateManyInput),
          id: t.id, projectId, title: t.title, position: t.position, createdById: known(t.createdById), createdAt: new Date(t.createdAt),
        },
      });
    }
    if (!rows.length) return s;
    const ok = rows.map((r) => r.op.snap);
    try {
      await db.$transaction(async (tx) => {
        await tx.task.createMany({ data: rows.map((r) => r.data) });
        await tx.taskLabel.createMany({ data: ok.flatMap((x) => x.labelIds.filter((id) => labelOk.has(id)).map((labelId) => ({ taskId: x.task.id, labelId }))) });
        await tx.subtask.createMany({ data: ok.flatMap((x) => x.subtasks) });
        await tx.taskComment.createMany({ data: ok.flatMap((x) => x.comments.map((c) => ({ ...c, authorId: known(c.authorId), createdAt: new Date(c.createdAt), editedAt: date(c.editedAt), deletedAt: date(c.deletedAt) }))) });
        await tx.taskAttachment.createMany({ data: ok.flatMap((x) => x.attachments.map((a) => ({ ...a, createdById: known(a.createdById), createdAt: new Date(a.createdAt) }))) });
        await tx.taskLink.createMany({ data: ok.flatMap((x) => x.links.map((l) => ({ ...l, kind: l.kind as Prisma.TaskLinkCreateManyInput["kind"], createdById: known(l.createdById), createdAt: new Date(l.createdAt) }))) });
        for (const x of ok) if (x.releaseTaskIds.length) await tx.releaseTask.updateMany({ where: { id: { in: x.releaseTaskIds } }, data: { taskId: x.task.id } });
      });
      placed.push(...ok.map((x) => x.task.id));
    } catch (err) {
      console.error("[undo] lote task.restore: se repite una a una", err);
      s += await oneByOne(rows.map((r) => r.op));
    }
    return s;
  };

  const seq = [...ops].reverse();
  for (let i = 0; i < seq.length; ) {
    const op = seq[i]!;
    let j = i + 1;
    if (opts.batch !== false && BATCHED.has(op.t)) while (j < seq.length && seq[j]!.t === op.t) j++;
    const run = seq.slice(i, j);
    i = j;
    if (run.length < 2) {
      skipped += await applyOne(op);
      continue;
    }
    if (op.t === "task.set") {
      // Un bloqueo que vuelve se comprueba contra el estado de ese momento (ciclos) y la tarea de origen es única: solas.
      for (const b of batchesOf(run as TaskSetOp[], (o) => o.id, (o) => !!o.data.blockedById || "recurrenceFromId" in o.data)) {
        skipped += b.length > 1 ? await setTasks(b) : await applyOne(b[0]!);
      }
    } else if (op.t === "task.remove") {
      for (const b of batchesOf(run as TaskRemoveOp[], (o) => o.id, () => false)) skipped += b.length > 1 ? await removeTasks(b) : await applyOne(b[0]!);
    } else {
      for (const b of batchesOf(run as TaskRestoreOp[], (o) => o.snap.task.id, (o) => !!o.snap.task.blockedById || !!o.snap.task.recurrenceFromId)) {
        skipped += b.length > 1 ? await restoreTasks(b) : await applyOne(b[0]!);
      }
    }
  }
  await clearStrayEvergreen(projectId);
  await resolvePositionTies(placed);
  if (filesToRemove.length && !opts.keepFiles) await removeAttachmentFiles(filesToRemove);
  if (releaseFiles.length) await removeReleaseAttachmentFiles(releaseFiles);
  return skipped;
}

/**
 * Huella del estado actual de todo lo que `ops` va a tocar (tareas con sus etiquetas, subtareas,
 * comentarios, adjuntos y enlaces; columnas; releases; lo que no existe cuenta como «ausente»).
 * Se calcula al crear la entrada contraria y se compara antes de aplicarla: si difiere, otra persona
 * ha cambiado esas filas entretanto (las acciones propias vacían la pila de rehacer). Task.updatedAt
 * no cambia con subtareas, comentarios o etiquetas, por eso se incluyen sus filas en la huella.
 *
 * `stored`: la huella guardada con la que se va a comparar. Las de antes de la versión 2 (sin prefijo) llevaban la
 * descripción entera; para ellas se calcula igual que entonces, así que siguen valiendo tras actualizar la app.
 */
export async function fingerprintOps(projectId: string, ops: UndoOp[], stored?: string | null): Promise<string> {
  return (await fingerprintsOf(projectId, [{ ops, stored }]))[0]!;
}

/** Prefijo de las huellas actuales: la descripción cuenta por su hash (sha256 en SQL), no por su texto. */
const FP_V2 = "v2:";
/** Ids por consulta al leer el estado (una entrada puede tocar 500 tareas y se leen varias a la vez). */
const FP_CHUNK = 1000;

type FpModel = "subtask" | "taskComment" | "taskAttachment" | "taskLink";

/** Lo que cubre la huella de una lista de operaciones (las filas hijas, por su id: su tarea se busca después). */
function fingerprintSubjects(ops: UndoOp[]) {
  const taskIds = new Set<string>();
  const columnIds = new Set<string>();
  const releaseIds = new Set<string>();
  const lookups: { model: FpModel; id: string }[] = [];
  for (const op of ops) {
    switch (op.t) {
      case "task.set": case "task.remove": taskIds.add(op.id); break;
      case "task.restore": taskIds.add(op.snap.task.id); break;
      case "subtask.restore": taskIds.add(op.row.taskId); break;
      case "comment.restore": case "attachment.restore": case "link.restore": taskIds.add(op.row.taskId); break;
      case "subtask.set": case "subtask.remove": lookups.push({ model: "subtask", id: op.id }); break;
      case "comment.remove": case "comment.undelete": case "comment.softdelete": case "comment.set": lookups.push({ model: "taskComment", id: op.id }); break;
      case "attachment.remove": lookups.push({ model: "taskAttachment", id: op.id }); break;
      case "link.remove": lookups.push({ model: "taskLink", id: op.id }); break;
      case "column.set": case "column.remove": columnIds.add(op.id); break;
      case "column.restore": columnIds.add(op.row.id); break;
      case "release.remove": releaseIds.add(op.id); break;
    }
  }
  return { taskIds, columnIds, releaseIds, lookups };
}

/** Lo que se lee de cada tarea, menos la descripción (va aparte, por su hash). Contenido, no la hora de escritura. */
const FP_TASK_SELECT = {
  id: true, title: true, kindId: true, color: true, linkUrl: true, position: true, columnId: true, assigneeId: true,
  dueDate: true, deliverableId: true, archivedAt: true, archivedFromColumnId: true, evergreen: true, evergreenEvery: true, recurrence: true, recurrenceDay: true,
  cost: true, costPaid: true, estimatedHours: true, actualHours: true, priority: true, client: true, startDate: true,
  labels: { select: { labelId: true }, orderBy: { labelId: "asc" } },
  subtasks: { select: { id: true, title: true, done: true, position: true }, orderBy: { id: "asc" } },
  comments: { select: { id: true, editedAt: true, deletedAt: true }, orderBy: { id: "asc" } },
  attachments: { select: { id: true }, orderBy: { id: "asc" } },
  links: { select: { id: true, title: true, url: true }, orderBy: { id: "asc" } },
} as const satisfies Prisma.TaskSelect;

/** El de las huellas antiguas (sin prefijo), tal cual: con la descripción entera y en este orden (cambia el JSON). */
const FP_LEGACY_TASK_SELECT = {
  id: true, title: true, description: true, kindId: true, color: true, linkUrl: true, position: true, columnId: true, assigneeId: true,
  dueDate: true, deliverableId: true, archivedAt: true, archivedFromColumnId: true, evergreen: true, evergreenEvery: true, recurrence: true, recurrenceDay: true,
  cost: true, costPaid: true, estimatedHours: true, actualHours: true, priority: true, client: true, startDate: true,
  labels: FP_TASK_SELECT.labels, subtasks: FP_TASK_SELECT.subtasks, comments: FP_TASK_SELECT.comments, attachments: FP_TASK_SELECT.attachments, links: FP_TASK_SELECT.links,
} as const satisfies Prisma.TaskSelect;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += FP_CHUNK) out.push(items.slice(i, i + FP_CHUNK));
  return out;
}

/**
 * Las huellas de varias entradas con una sola lectura del estado: cada fila (tarea, columna, release, fila hija) se
 * lee una vez aunque la cubran varias entradas, por lotes (`id IN (…)`) y una consulta detrás de otra, sin saturar el
 * pool. Cada huella sale igual que si se calculara sola (fingerprintOps). La descripción entra por su sha256,
 * calculado en PostgreSQL: un cambio en ella cambia la huella igual que antes, sin traer 20 KB por tarjeta.
 */
export async function fingerprintsOf(projectId: string, items: { ops: UndoOp[]; stored?: string | null }[]): Promise<string[]> {
  const subjects = items.map((it) => ({ ...fingerprintSubjects(it.ops), legacy: !!it.stored && !it.stored.startsWith(FP_V2) }));
  // Filas hijas: su tarea entra en la huella; las que ya no existen se anotan como ausentes.
  const byModel = new Map<FpModel, Set<string>>();
  for (const s of subjects) for (const l of s.lookups) (byModel.get(l.model) ?? byModel.set(l.model, new Set()).get(l.model)!).add(l.id);
  const owner = new Map<string, string>();
  for (const [model, ids] of byModel) {
    for (const part of chunks([...ids])) {
      const rows = await (db[model] as unknown as { findMany: (a: unknown) => Promise<{ id: string; taskId: string }[]> }).findMany({
        where: { id: { in: part } }, select: { id: true, taskId: true },
      });
      for (const r of rows) owner.set(`${model}:${r.id}`, r.taskId);
    }
  }
  const lines = subjects.map((s) => {
    const out: string[] = [];
    for (const l of s.lookups) {
      const taskId = owner.get(`${l.model}:${l.id}`);
      if (taskId) s.taskIds.add(taskId); else out.push(`${l.model}:${l.id}:absent`);
    }
    return out;
  });

  const current = new Set<string>();
  const legacy = new Set<string>();
  for (const s of subjects) for (const id of s.taskIds) (s.legacy ? legacy : current).add(id);
  const tasks = new Map<string, string>();
  for (const part of chunks([...current])) {
    const rows = await db.task.findMany({ where: { id: { in: part }, projectId }, select: FP_TASK_SELECT });
    const hashes = await db.$queryRaw<{ id: string; d: string }[]>`
      SELECT "id", encode(sha256(convert_to("description", 'UTF8')), 'hex') AS "d" FROM "Task" WHERE "id" = ANY(${part}::text[]) AND "projectId" = ${projectId}`;
    const hashById = new Map(hashes.map((h) => [h.id, h.d]));
    for (const r of rows) tasks.set(r.id, JSON.stringify({ ...r, description: hashById.get(r.id) ?? null }));
  }
  const legacyTasks = new Map<string, string>();
  for (const part of chunks([...legacy])) {
    for (const r of await db.task.findMany({ where: { id: { in: part }, projectId }, select: FP_LEGACY_TASK_SELECT })) legacyTasks.set(r.id, JSON.stringify(r));
  }
  const columnIds = [...new Set(subjects.flatMap((s) => [...s.columnIds]))];
  const cols = new Map<string, string>();
  for (const part of chunks(columnIds)) for (const c of await db.column.findMany({ where: { id: { in: part }, projectId } })) cols.set(c.id, JSON.stringify(c));
  const releaseIds = [...new Set(subjects.flatMap((s) => [...s.releaseIds]))];
  const rels = new Set<string>();
  for (const part of chunks(releaseIds)) for (const r of await db.release.findMany({ where: { id: { in: part }, projectId }, select: { id: true } })) rels.add(r.id);

  return subjects.map((s, i) => {
    const out = lines[i]!;
    const taskLines = s.legacy ? legacyTasks : tasks;
    for (const id of s.taskIds) out.push(`task:${id}:${taskLines.get(id) ?? '"absent"'}`);
    for (const id of s.columnIds) out.push(`column:${id}:${cols.get(id) ?? '"absent"'}`);
    for (const id of s.releaseIds) out.push(`release:${id}:${rels.has(id) ? "present" : "absent"}`);
    const hash = createHash("sha256").update(out.sort().join("\n")).digest("hex");
    return s.legacy ? hash : `${FP_V2}${hash}`;
  });
}
