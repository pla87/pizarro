import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { actionContext } from "./action-context";
import { isUniqueColumnRole } from "./constants";
import { db } from "./db";
import { assertTaskCapacity } from "./caps";
import { resolvePositionTies } from "./task-positions";
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

export const UNDO_LIMIT = 10;
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
}
export type TaskField = keyof TaskData;

type SubtaskRow = { id: string; taskId: string; title: string; done: boolean; position: number };
type CommentRow = { id: string; taskId: string; authorId: string | null; body: string; createdAt: string; editedAt: string | null; parentId?: string | null; deletedAt?: string | null };
type AttachmentRow = {
  id: string; taskId: string; originalName: string; mimeType: string; isImage: boolean;
  width: number | null; height: number | null; size: number; createdById: string | null; createdAt: string;
};
type LinkRow = { id: string; taskId: string; kind: string; title: string; url: string; externalId: string | null; createdById: string | null; shareStatus?: string | null; shareFailed?: number; createdAt: string };
type ColumnRow = { id: string; projectId: string; name: string; position: number; role: string; isDone: boolean; waitingDays?: number | null; routineTargetColumnId?: string | null };

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
  | { t: "attachment.remove"; id: string }
  | { t: "attachment.restore"; row: AttachmentRow }
  | { t: "link.remove"; id: string }
  | { t: "link.restore"; row: LinkRow }
  | { t: "column.set"; id: string; data: { name?: string; position?: number; role?: string; isDone?: boolean; waitingDays?: number | null; routineTargetColumnId?: string | null } }
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
  cost: true, costPaid: true, estimatedHours: true, actualHours: true, priority: true, client: true, startDate: true, recurrenceFromId: true, routineColumnId: true,
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
  const rows = await db.task.findMany({
    where: { id: { in: ids } },
    select: { id: true, ...TASK_SELECT, ...(withLabels ? { labels: { select: { labelId: true } } } : {}) },
  });
  return rows.map((r) => taskSetOp(r, fields, withLabels ? (r as unknown as { labels: { labelId: string }[] }).labels : undefined));
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
      comments: r.comments.map((c) => ({ id: c.id, taskId: c.taskId, authorId: c.authorId, body: c.body, createdAt: c.createdAt.toISOString(), editedAt: iso(c.editedAt), parentId: c.parentId, deletedAt: iso(c.deletedAt) })),
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

/** Borra entradas y los ficheros que solo ellas retenían. */
export async function discardEntries(entries: { id: string; ops: unknown }[]): Promise<void> {
  if (!entries.length) return;
  const candidates = entries.flatMap((e) => retainedAttachmentIds(e.ops as UndoOp[]));
  await db.undoEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } });
  if (!candidates.length) return;
  const alive = new Set((await db.taskAttachment.findMany({ where: { id: { in: candidates } }, select: { id: true } })).map((a) => a.id));
  await removeAttachmentFiles(candidates.filter((id) => !alive.has(id)));
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
  const out: UndoOp[] = [];
  const seen = new Set<string>();
  const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true));
  const inProject = { task: { projectId } };
  for (const op of ops) {
    switch (op.t) {
      case "task.set": {
        if (!once(`task.set:${op.id}:${Object.keys(op.data).join(",")}:${!!op.labelIds}`)) break;
        const taskOk = await db.task.count({ where: { id: op.id, projectId } });
        if (taskOk) out.push(...(await captureTasks([op.id], Object.keys(op.data) as TaskField[], !!op.labelIds)));
        break;
      }
      case "task.remove":
        if (once(`task:${op.id}`) && (await db.task.count({ where: { id: op.id, projectId } }))) out.push(...(await snapshotTasks([op.id])));
        break;
      case "task.restore":
        if (once(`task:${op.snap.task.id}`)) out.push({ t: "task.remove", id: op.snap.task.id });
        break;
      case "subtask.set": {
        if (!once(`subtask.set:${op.id}`)) break;
        const r = await db.subtask.findFirst({ where: { id: op.id, ...inProject } });
        if (r) out.push({ t: "subtask.set", id: op.id, data: Object.fromEntries(Object.keys(op.data).map((k) => [k, r[k as keyof typeof r]])) });
        break;
      }
      case "subtask.remove": {
        const r = once(`subtask:${op.id}`) && (await db.subtask.findFirst({ where: { id: op.id, ...inProject } }));
        if (r) out.push({ t: "subtask.restore", row: { id: r.id, taskId: r.taskId, title: r.title, done: r.done, position: r.position } });
        break;
      }
      case "subtask.restore":
        if (once(`subtask:${op.row.id}`)) out.push({ t: "subtask.remove", id: op.row.id });
        break;
      case "comment.remove": {
        const c = once(`comment:${op.id}`) && (await db.taskComment.findFirst({ where: { id: op.id, ...inProject } }));
        if (c) out.push({ t: "comment.restore", row: { id: c.id, taskId: c.taskId, authorId: c.authorId, body: c.body, createdAt: c.createdAt.toISOString(), editedAt: iso(c.editedAt), parentId: c.parentId, deletedAt: iso(c.deletedAt) } });
        break;
      }
      case "comment.restore":
        if (once(`comment:${op.row.id}`)) out.push({ t: "comment.remove", id: op.row.id });
        break;
      case "comment.undelete":
        if (once(`comment:${op.id}`)) out.push({ t: "comment.softdelete", id: op.id });
        break;
      case "comment.softdelete": {
        const c = once(`comment:${op.id}`) && (await db.taskComment.findFirst({ where: { id: op.id, deletedAt: null, ...inProject }, select: { id: true, body: true } }));
        if (c) out.push({ t: "comment.undelete", id: c.id, body: c.body });
        break;
      }
      case "attachment.remove": {
        const a = once(`attachment:${op.id}`) && (await db.taskAttachment.findFirst({ where: { id: op.id, ...inProject } }));
        if (a) {
          out.push({
            t: "attachment.restore",
            row: { id: a.id, taskId: a.taskId, originalName: a.originalName, mimeType: a.mimeType, isImage: a.isImage, width: a.width, height: a.height, size: a.size, createdById: a.createdById, createdAt: a.createdAt.toISOString() },
          });
        }
        break;
      }
      case "attachment.restore":
        if (once(`attachment:${op.row.id}`)) out.push({ t: "attachment.remove", id: op.row.id });
        break;
      case "link.remove": {
        const l = once(`link:${op.id}`) && (await db.taskLink.findFirst({ where: { id: op.id, ...inProject } }));
        if (l) out.push({ t: "link.restore", row: { id: l.id, taskId: l.taskId, kind: l.kind, title: l.title, url: l.url, externalId: l.externalId, createdById: l.createdById, createdAt: l.createdAt.toISOString() } });
        break;
      }
      case "link.restore":
        if (once(`link:${op.row.id}`)) out.push({ t: "link.remove", id: op.row.id });
        break;
      case "column.set": {
        if (!once(`column.set:${op.id}`)) break;
        const c = await db.column.findFirst({ where: { id: op.id, projectId } });
        if (c) out.push({ t: "column.set", id: op.id, data: Object.fromEntries(Object.keys(op.data).map((k) => [k, c[k as keyof typeof c]])) });
        break;
      }
      case "column.remove": {
        const c = once(`column:${op.id}`) && (await db.column.findFirst({ where: { id: op.id, projectId } }));
        if (c) out.push({ t: "column.restore", row: { id: c.id, projectId: c.projectId, name: c.name, position: c.position, role: c.role, isDone: c.isDone, waitingDays: c.waitingDays, routineTargetColumnId: c.routineTargetColumnId } });
        break;
      }
      case "column.restore":
        if (once(`column:${op.row.id}`)) out.push({ t: "column.remove", id: op.row.id });
        break;
      case "release.remove":
        break;
    }
  }
  return out;
}

/** Una columna de presupuesto exige el campo Coste: si al deshacer vuelve una, se reactiva. */
async function ensureCostField(projectId: string): Promise<void> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { taskFields: true } });
  if (p && !p.taskFields.includes("cost")) await db.project.update({ where: { id: projectId }, data: { taskFields: [...p.taskFields, "cost"] } });
}

/** Campos que taskUpdateData acepta: las entradas antiguas pueden traer otros (p. ej. externalUrl) y se ignoran. */
const TASK_DATA_KEYS: ReadonlySet<string> = new Set<keyof TaskData>([
  "title", "description", "kindId", "color", "linkUrl", "position", "columnId", "assigneeId", "dueDate", "deliverableId",
  "archivedAt", "archivedFromColumnId", "evergreen", "evergreenEvery", "recurrence", "recurrenceDay", "contentUpdatedAt",
  "contentUpdatedById", "cost", "costPaid", "estimatedHours", "actualHours", "priority", "client", "startDate",
  "recurrenceFromId", "routineColumnId",
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

/**
 * Aplica las operaciones inversas (de la última a la primera). Lo que ya no existe se salta;
 * devuelve cuántas operaciones no se pudieron aplicar. Con `keepFiles` no borra los ficheros de los
 * adjuntos que quita: la entrada contraria (rehacer/deshacer) los retiene y los libera al descartarse.
 */
export async function applyUndo(projectId: string, ops: UndoOp[], opts: { keepFiles?: boolean } = {}): Promise<number> {
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

  for (const op of [...ops].reverse()) {
    try {
      switch (op.t) {
        case "task.set": {
          const exists = await db.task.count({ where: { id: op.id, projectId } });
          if (!exists) { skipped++; break; }
          const data = { ...op.data };
          if (data.columnId) data.columnId = await safeColumn(data.columnId);
          if (data.kindId && !(await db.taskKind.count({ where: { id: data.kindId } }))) delete data.kindId;
          if (data.deliverableId && !(await db.deliverable.count({ where: { id: data.deliverableId } }))) data.deliverableId = null;
          if (data.assigneeId) data.assigneeId = assignable(data.assigneeId);
          if (data.position !== undefined || data.columnId !== undefined) placed.push(op.id);
          await db.$transaction([
            db.task.update({ where: { id: op.id }, data: taskUpdateData(data) }),
            ...(op.labelIds
              ? [
                  db.taskLabel.deleteMany({ where: { taskId: op.id } }),
                  db.taskLabel.createMany({
                    data: (await db.label.findMany({ where: { id: { in: op.labelIds }, projectId }, select: { id: true } })).map((l) => ({ taskId: op.id, labelId: l.id })),
                  }),
                ]
              : []),
          ]);
          break;
        }
        case "task.remove": {
          const atts = await db.taskAttachment.findMany({ where: { taskId: op.id }, select: { id: true } });
          const { count } = await db.task.deleteMany({ where: { id: op.id, projectId } });
          if (!count) skipped++;
          else filesToRemove.push(...atts.map((a) => a.id));
          break;
        }
        case "task.restore": {
          const s = op.snap;
          if (await db.task.count({ where: { id: s.task.id } })) { skipped++; break; }
          const t = s.task;
          const kindOk = await db.taskKind.count({ where: { id: t.kindId } });
          const kindId = kindOk ? t.kindId : (await db.taskKind.findFirst({ where: { OR: [{ projectId: null }, { projectId }] }, orderBy: { position: "asc" }, select: { id: true } }))?.id;
          const columnId = await safeColumn(t.columnId);
          if (!kindId || !columnId) { skipped++; break; }
          // La tarea de la que salió puede haberse borrado (clave foránea): entonces se queda sin origen.
          const recurrenceFromId = t.recurrenceFromId && (await db.task.count({ where: { id: t.recurrenceFromId } })) ? t.recurrenceFromId : null;
          const deliverableId = t.deliverableId && (await db.deliverable.count({ where: { id: t.deliverableId } })) ? t.deliverableId : null;
          const labels = await db.label.findMany({ where: { id: { in: s.labelIds }, projectId }, select: { id: true } });
          await db.$transaction([
            db.task.create({
              data: {
                ...(taskUpdateData({ ...t, columnId, kindId, deliverableId, assigneeId: assignable(t.assigneeId), recurrenceFromId }) as Prisma.TaskUncheckedCreateInput),
                id: t.id, projectId, title: t.title, position: t.position, createdById: known(t.createdById), createdAt: new Date(t.createdAt),
              },
            }),
            db.taskLabel.createMany({ data: labels.map((l) => ({ taskId: t.id, labelId: l.id })) }),
            db.subtask.createMany({ data: s.subtasks }),
            db.taskComment.createMany({ data: s.comments.map((c) => ({ ...c, authorId: known(c.authorId), createdAt: new Date(c.createdAt), editedAt: date(c.editedAt), deletedAt: date(c.deletedAt) })) }),
            db.taskAttachment.createMany({ data: s.attachments.map((a) => ({ ...a, createdById: known(a.createdById), createdAt: new Date(a.createdAt) })) }),
            db.taskLink.createMany({ data: s.links.map((l) => ({ ...l, kind: l.kind as Prisma.TaskLinkCreateManyInput["kind"], createdById: known(l.createdById), createdAt: new Date(l.createdAt) })) }),
            db.releaseTask.updateMany({ where: { id: { in: s.releaseTaskIds } }, data: { taskId: t.id } }),
          ]);
          placed.push(t.id);
          break;
        }
        case "subtask.set": {
          const { count } = await db.subtask.updateMany({ where: { id: op.id, task: { projectId } }, data: op.data });
          if (!count) skipped++;
          break;
        }
        case "subtask.remove": {
          const { count } = await db.subtask.deleteMany({ where: { id: op.id, task: { projectId } } });
          if (!count) skipped++;
          break;
        }
        case "subtask.restore": {
          if (!(await db.task.count({ where: { id: op.row.taskId, projectId } })) || (await db.subtask.count({ where: { id: op.row.id } }))) { skipped++; break; }
          await db.subtask.create({ data: op.row });
          break;
        }
        case "comment.remove": {
          const { count } = await db.taskComment.deleteMany({ where: { id: op.id, task: { projectId } } });
          if (!count) skipped++;
          break;
        }
        case "comment.restore": {
          const r = op.row;
          if (!(await db.task.count({ where: { id: r.taskId, projectId } })) || (await db.taskComment.count({ where: { id: r.id } }))) { skipped++; break; }
          const author = r.authorId && (await db.user.count({ where: { id: r.authorId } })) ? r.authorId : null;
          const parentId = r.parentId && (await db.taskComment.count({ where: { id: r.parentId } })) ? r.parentId : null;
          await db.taskComment.create({ data: { ...r, parentId, authorId: author, createdAt: new Date(r.createdAt), editedAt: date(r.editedAt), deletedAt: date(r.deletedAt) } });
          break;
        }
        case "comment.undelete": {
          const { count } = await db.taskComment.updateMany({ where: { id: op.id, deletedAt: { not: null }, task: { projectId } }, data: { body: op.body, deletedAt: null } });
          if (!count) skipped++;
          break;
        }
        case "comment.softdelete": {
          const { count } = await db.taskComment.updateMany({ where: { id: op.id, deletedAt: null, task: { projectId } }, data: { body: "", deletedAt: new Date() } });
          if (!count) skipped++;
          break;
        }
        case "attachment.remove": {
          const { count } = await db.taskAttachment.deleteMany({ where: { id: op.id, task: { projectId } } });
          if (!count) skipped++;
          else filesToRemove.push(op.id);
          break;
        }
        case "attachment.restore": {
          const r = op.row;
          if (!(await db.task.count({ where: { id: r.taskId, projectId } })) || (await db.taskAttachment.count({ where: { id: r.id } }))) { skipped++; break; }
          const creator = r.createdById && (await db.user.count({ where: { id: r.createdById } })) ? r.createdById : null;
          await db.taskAttachment.create({ data: { ...r, createdById: creator, createdAt: new Date(r.createdAt) } });
          break;
        }
        case "link.remove": {
          const { count } = await db.taskLink.deleteMany({ where: { id: op.id, task: { projectId } } });
          if (!count) skipped++;
          break;
        }
        case "link.restore": {
          const r = op.row;
          if (!(await db.task.count({ where: { id: r.taskId, projectId } })) || (await db.taskLink.count({ where: { id: r.id } }))) { skipped++; break; }
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
          if (!count) skipped++;
          else if (op.data.role === "BUDGET") await ensureCostField(projectId);
          break;
        }
        case "column.remove": {
          if (await db.task.count({ where: { columnId: op.id, archivedAt: null } })) { skipped++; break; }
          const other = await db.column.findFirst({ where: { projectId, id: { not: op.id } }, orderBy: { position: "asc" }, select: { id: true } });
          if (!other) { skipped++; break; }
          placed.push(...(await db.task.findMany({ where: { columnId: op.id }, select: { id: true } })).map((r) => r.id));
          await db.$transaction([
            db.task.updateMany({ where: { columnId: op.id }, data: { columnId: other.id } }),
            db.column.deleteMany({ where: { id: op.id, projectId } }),
          ]);
          columnIds.delete(op.id);
          break;
        }
        case "column.restore": {
          if (await db.column.count({ where: { id: op.row.id } })) { skipped++; break; }
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
          if (!count) skipped++;
          else releaseFiles.push(...atts.map((a) => a.id));
          break;
        }
      }
    } catch (err) {
      console.error("[undo]", op.t, err);
      skipped++;
    }
  }
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
 */
export async function fingerprintOps(projectId: string, ops: UndoOp[]): Promise<string> {
  const taskIds = new Set<string>();
  const columnIds = new Set<string>();
  const releaseIds = new Set<string>();
  const lookups: { model: "subtask" | "taskComment" | "taskAttachment" | "taskLink"; id: string }[] = [];
  for (const op of ops) {
    switch (op.t) {
      case "task.set": case "task.remove": taskIds.add(op.id); break;
      case "task.restore": taskIds.add(op.snap.task.id); break;
      case "subtask.restore": taskIds.add(op.row.taskId); break;
      case "comment.restore": case "attachment.restore": case "link.restore": taskIds.add(op.row.taskId); break;
      case "subtask.set": case "subtask.remove": lookups.push({ model: "subtask", id: op.id }); break;
      case "comment.remove": case "comment.undelete": case "comment.softdelete": lookups.push({ model: "taskComment", id: op.id }); break;
      case "attachment.remove": lookups.push({ model: "taskAttachment", id: op.id }); break;
      case "link.remove": lookups.push({ model: "taskLink", id: op.id }); break;
      case "column.set": case "column.remove": columnIds.add(op.id); break;
      case "column.restore": columnIds.add(op.row.id); break;
      case "release.remove": releaseIds.add(op.id); break;
    }
  }
  // Las filas hijas que ya no existen se anotan como ausentes; las que existen suman su tarea.
  const lines: string[] = [];
  const found = await Promise.all(
    lookups.map((l) => (db[l.model] as unknown as { findUnique: (a: unknown) => Promise<{ taskId: string } | null> }).findUnique({ where: { id: l.id }, select: { taskId: true } })),
  );
  lookups.forEach((l, i) => {
    const row = found[i];
    if (row) taskIds.add(row.taskId); else lines.push(`${l.model}:${l.id}:absent`);
  });
  const tasks = await db.task.findMany({
    where: { id: { in: [...taskIds] }, projectId },
    select: {
      // Contenido, no la hora de escritura: reescribir lo mismo (p. ej. un deshacer propio) no cuenta como cambio.
      id: true, title: true, description: true, kindId: true, color: true, linkUrl: true, position: true, columnId: true, assigneeId: true,
      dueDate: true, deliverableId: true, archivedAt: true, archivedFromColumnId: true, evergreen: true, evergreenEvery: true, recurrence: true, recurrenceDay: true,
      cost: true, costPaid: true, estimatedHours: true, actualHours: true, priority: true, client: true, startDate: true,
      labels: { select: { labelId: true }, orderBy: { labelId: "asc" } },
      subtasks: { select: { id: true, title: true, done: true, position: true }, orderBy: { id: "asc" } },
      comments: { select: { id: true, editedAt: true, deletedAt: true }, orderBy: { id: "asc" } },
      attachments: { select: { id: true }, orderBy: { id: "asc" } },
      links: { select: { id: true, title: true, url: true }, orderBy: { id: "asc" } },
    },
  });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const id of taskIds) lines.push(`task:${id}:${JSON.stringify(byId.get(id) ?? "absent")}`);
  const cols = await db.column.findMany({ where: { id: { in: [...columnIds] }, projectId } });
  const colById = new Map(cols.map((c) => [c.id, c]));
  for (const id of columnIds) lines.push(`column:${id}:${JSON.stringify(colById.get(id) ?? "absent")}`);
  const rels = await db.release.findMany({ where: { id: { in: [...releaseIds] }, projectId }, select: { id: true } });
  const relIds = new Set(rels.map((r) => r.id));
  for (const id of releaseIds) lines.push(`release:${id}:${relIds.has(id) ? "present" : "absent"}`);
  return createHash("sha256").update(lines.sort().join("\n")).digest("hex");
}
