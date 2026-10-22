import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { actionContext } from "./action-context";
import { db } from "./db";
import { removeAttachmentFiles, removeReleaseAttachmentFiles } from "./uploads";

// Deshacer: cada acción deshacible deja sus operaciones inversas (addUndo) y runAction las guarda
// como una entrada del usuario en ese proyecto. Se conservan las 10 últimas; deshacer aplica la
// más reciente en orden inverso. Los ficheros de adjuntos borrados se conservan mientras su
// entrada exista, para poder devolverlos.

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
  contentUpdatedAt?: string | null;
  contentUpdatedById?: string | null;
}
export type TaskField = keyof TaskData;

type SubtaskRow = { id: string; taskId: string; title: string; done: boolean; position: number };
type CommentRow = { id: string; taskId: string; authorId: string | null; body: string; createdAt: string; editedAt: string | null; parentId?: string | null };
type AttachmentRow = {
  id: string; taskId: string; originalName: string; mimeType: string; isImage: boolean;
  width: number | null; height: number | null; size: number; createdById: string | null; createdAt: string;
};
type LinkRow = { id: string; taskId: string; kind: string; title: string; url: string; externalId: string | null; createdById: string | null; createdAt: string };
type ColumnRow = { id: string; projectId: string; name: string; position: number; role: string; isDone: boolean };

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
  | { t: "attachment.remove"; id: string }
  | { t: "attachment.restore"; row: AttachmentRow }
  | { t: "link.remove"; id: string }
  | { t: "link.restore"; row: LinkRow }
  | { t: "column.set"; id: string; data: { name?: string; position?: number; role?: string; isDone?: boolean } }
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
  dueDate: true, deliverableId: true, archivedAt: true, archivedFromColumnId: true, evergreen: true, contentUpdatedAt: true, contentUpdatedById: true,
} as const;
type TaskRowFull = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

function toTaskData(row: TaskRowFull, fields: readonly TaskField[]): TaskData {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = row[f];
    out[f] = v instanceof Date ? v.toISOString() : v;
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
  return rows.map((r) => ({
    t: "task.set" as const,
    id: r.id,
    data: toTaskData(r, fields),
    ...(withLabels ? { labelIds: (r as unknown as { labels: { labelId: string }[] }).labels.map((l) => l.labelId) } : {}),
  }));
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
      comments: r.comments.map((c) => ({ id: c.id, taskId: c.taskId, authorId: c.authorId, body: c.body, createdAt: c.createdAt.toISOString(), editedAt: iso(c.editedAt), parentId: c.parentId })),
      attachments: r.attachments.map((a) => ({
        id: a.id, taskId: a.taskId, originalName: a.originalName, mimeType: a.mimeType, isImage: a.isImage,
        width: a.width, height: a.height, size: a.size, createdById: a.createdById, createdAt: a.createdAt.toISOString(),
      })),
      links: r.links.map((l) => ({ id: l.id, taskId: l.taskId, kind: l.kind, title: l.title, url: l.url, externalId: l.externalId, createdById: l.createdById, createdAt: l.createdAt.toISOString() })),
      releaseTaskIds: r.releases.map((x) => x.id),
    },
  }));
}

/** Guarda una entrada y descarta las que pasen del límite (liberando sus ficheros pendientes). */
export async function saveUndo(userId: string, projectId: string, label: string, ops: UndoOp[], taskId: string | null = null): Promise<void> {
  await db.undoEntry.create({ data: { userId, projectId, taskId, label: label.slice(0, 300), ops: ops as unknown as Prisma.InputJsonValue } });
  const old = await db.undoEntry.findMany({
    where: { userId, projectId },
    orderBy: { createdAt: "desc" },
    skip: UNDO_LIMIT,
    select: { id: true, ops: true },
  });
  if (old.length) await discardEntries(old);
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

function taskUpdateData(d: TaskData): Prisma.TaskUncheckedUpdateInput {
  const out: Prisma.TaskUncheckedUpdateInput = {};
  for (const [k, v] of Object.entries(d)) {
    if (k === "dueDate" || k === "archivedAt" || k === "contentUpdatedAt") (out as Record<string, unknown>)[k] = date(v as string | null);
    else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Aplica las operaciones inversas (de la última a la primera). Lo que ya no existe se salta;
 * devuelve cuántas operaciones no se pudieron aplicar.
 */
export async function applyUndo(projectId: string, ops: UndoOp[]): Promise<number> {
  let skipped = 0;
  const filesToRemove: string[] = [];
  const releaseFiles: string[] = [];
  const columnIds = new Set((await db.column.findMany({ where: { projectId }, select: { id: true } })).map((c) => c.id));
  const firstColumn = async () => (await db.column.findFirst({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true } }))?.id;
  /** Una columna borrada entretanto: la tarea va a la primera. */
  const safeColumn = async (id: string | undefined) => (id && columnIds.has(id) ? id : await firstColumn());

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
          if (data.assigneeId && !(await db.user.count({ where: { id: data.assigneeId } }))) data.assigneeId = null;
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
          const userIds = new Set((await db.user.findMany({ select: { id: true } })).map((u) => u.id));
          const known = (id: string | null | undefined) => (id && userIds.has(id) ? id : null);
          const deliverableId = t.deliverableId && (await db.deliverable.count({ where: { id: t.deliverableId } })) ? t.deliverableId : null;
          const labels = await db.label.findMany({ where: { id: { in: s.labelIds }, projectId }, select: { id: true } });
          await db.$transaction([
            db.task.create({
              data: {
                ...(taskUpdateData({ ...t, columnId, kindId, deliverableId, assigneeId: known(t.assigneeId) }) as Prisma.TaskUncheckedCreateInput),
                id: t.id, projectId, title: t.title, position: t.position, createdById: known(t.createdById), createdAt: new Date(t.createdAt),
              },
            }),
            db.taskLabel.createMany({ data: labels.map((l) => ({ taskId: t.id, labelId: l.id })) }),
            db.subtask.createMany({ data: s.subtasks }),
            db.taskComment.createMany({ data: s.comments.map((c) => ({ ...c, authorId: known(c.authorId), createdAt: new Date(c.createdAt), editedAt: date(c.editedAt) })) }),
            db.taskAttachment.createMany({ data: s.attachments.map((a) => ({ ...a, createdById: known(a.createdById), createdAt: new Date(a.createdAt) })) }),
            db.taskLink.createMany({ data: s.links.map((l) => ({ ...l, kind: l.kind as Prisma.TaskLinkCreateManyInput["kind"], createdById: known(l.createdById), createdAt: new Date(l.createdAt) })) }),
            db.releaseTask.updateMany({ where: { id: { in: s.releaseTaskIds } }, data: { taskId: t.id } }),
          ]);
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
          await db.taskComment.create({ data: { ...r, parentId, authorId: author, createdAt: new Date(r.createdAt), editedAt: date(r.editedAt) } });
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
          const { count } = await db.column.updateMany({ where: { id: op.id, projectId }, data: op.data as Prisma.ColumnUpdateManyMutationInput });
          if (!count) skipped++;
          break;
        }
        case "column.remove": {
          if (await db.task.count({ where: { columnId: op.id, archivedAt: null } })) { skipped++; break; }
          const other = await db.column.findFirst({ where: { projectId, id: { not: op.id } }, orderBy: { position: "asc" }, select: { id: true } });
          if (!other) { skipped++; break; }
          await db.$transaction([
            db.task.updateMany({ where: { columnId: op.id }, data: { columnId: other.id } }),
            db.column.deleteMany({ where: { id: op.id, projectId } }),
          ]);
          columnIds.delete(op.id);
          break;
        }
        case "column.restore": {
          if (await db.column.count({ where: { id: op.row.id } })) { skipped++; break; }
          await db.column.create({ data: { ...op.row, projectId, role: op.row.role as Prisma.ColumnCreateInput["role"] } });
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
  if (filesToRemove.length) await removeAttachmentFiles(filesToRemove);
  if (releaseFiles.length) await removeReleaseAttachmentFiles(releaseFiles);
  return skipped;
}
