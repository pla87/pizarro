"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertAssignable, assertProjectAccess, assertTaskAccess, visibleProjectsWhere } from "@/lib/access";
import { loadBoardTask } from "@/lib/board";
import { AppError, notFound } from "@/lib/errors";
import { needsRebalance, positionBetween, POSITION_STEP } from "@/lib/positions";
import { requireUser } from "@/lib/session";
import { removeAttachmentFiles } from "@/lib/uploads";
import * as v from "@/lib/validation";
import type { SubtaskInfo, TaskDetail } from "@/lib/types";

async function assertColumnInProject(columnId: string, projectId: string) {
  const ok = await db.column.count({ where: { id: columnId, projectId } });
  if (!ok) throw new AppError("La columna no existe.");
}

async function assertLabelsInProject(labelIds: string[], projectId: string) {
  if (labelIds.length === 0) return;
  const count = await db.label.count({ where: { id: { in: labelIds }, projectId } });
  if (count !== new Set(labelIds).size) throw new AppError("Etiqueta no válida.");
}

async function lastPosition(columnId: string): Promise<number | null> {
  const last = await db.task.findFirst({ where: { columnId }, orderBy: { position: "desc" }, select: { position: true } });
  return last?.position ?? null;
}

/** Renumera una columna cuando las posiciones fraccionarias se agotan (muy raro). */
async function rebalanceColumn(columnId: string) {
  const tasks = await db.task.findMany({ where: { columnId }, orderBy: { position: "asc" }, select: { id: true } });
  await db.$transaction(tasks.map((t, i) => db.task.update({ where: { id: t.id }, data: { position: (i + 1) * POSITION_STEP } })));
}

const createSchema = z.object({
  projectId: v.id,
  columnId: v.id,
  title: v.title,
  type: v.taskType,
  description: v.description.default(""),
  assigneeId: v.id.nullable().default(null),
  color: v.color.default(null),
  linkUrl: v.linkUrl.default(null),
  labelIds: z.array(v.id).max(20).default([]),
});

export async function createTask(input: z.input<typeof createSchema>) {
  return runAction(async () => {
    const user = await requireUser();
    const data = createSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    await assertColumnInProject(data.columnId, data.projectId);
    await assertLabelsInProject(data.labelIds, data.projectId);
    if (data.assigneeId) await assertAssignable(data.projectId, data.assigneeId);
    const position = positionBetween(await lastPosition(data.columnId), null);
    const task = await db.task.create({
      data: {
        projectId: data.projectId,
        columnId: data.columnId,
        title: data.title,
        type: data.type,
        description: data.description,
        assigneeId: data.assigneeId,
        color: data.color,
        linkUrl: data.linkUrl,
        position,
        createdById: user.id,
        labels: { create: [...new Set(data.labelIds)].map((labelId) => ({ labelId })) },
      },
      select: { id: true },
    });
    return loadBoardTask(task.id);
  });
}

const updateSchema = z.object({
  title: v.title.optional(),
  description: v.description.optional(),
  type: v.taskType.optional(),
  color: v.color.optional(),
  linkUrl: v.linkUrl.optional(),
  assigneeId: v.id.nullable().optional(),
  labelIds: z.array(v.id).max(20).optional(),
});

export async function updateTask(taskId: string, patch: z.input<typeof updateSchema>) {
  return runAction(async () => {
    const user = await requireUser();
    const data = updateSchema.parse(patch);
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    if (data.assigneeId) await assertAssignable(projectId, data.assigneeId);
    if (data.labelIds) await assertLabelsInProject(data.labelIds, projectId);
    const { labelIds, ...fields } = data;
    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: taskId }, data: fields });
      if (labelIds) {
        await tx.taskLabel.deleteMany({ where: { taskId } });
        await tx.taskLabel.createMany({ data: [...new Set(labelIds)].map((labelId) => ({ taskId, labelId })) });
      }
    });
    return loadBoardTask(taskId);
  });
}

async function neighbourPositions(columnId: string, prevId: string | null, nextId: string | null) {
  const ids = [prevId, nextId].filter((x): x is string => !!x);
  const rows = ids.length
    ? await db.task.findMany({ where: { id: { in: ids }, columnId }, select: { id: true, position: true } })
    : [];
  const prev = prevId ? rows.find((r) => r.id === prevId)?.position : null;
  const next = nextId ? rows.find((r) => r.id === nextId)?.position : null;
  // undefined = la vecina indicada ya no está en esa columna (otro usuario la movió).
  return { prev, next, stale: prev === undefined || next === undefined };
}

/** Mueve una tarjeta entre dos vecinas (por id) de la columna destino. */
export async function moveTask(taskId: string, columnId: string, prevId: string | null, nextId: string | null) {
  return runAction(async () => {
    const user = await requireUser();
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    await assertColumnInProject(v.id.parse(columnId), projectId);
    let n = await neighbourPositions(columnId, prevId, nextId);
    if (!n.stale && needsRebalance(n.prev, n.next)) {
      await rebalanceColumn(columnId);
      n = await neighbourPositions(columnId, prevId, nextId);
    }
    const position = n.stale ? positionBetween(await lastPosition(columnId), null) : positionBetween(n.prev, n.next);
    await db.task.update({ where: { id: taskId }, data: { columnId, position } });
    return { position };
  });
}

/** Mueve varias tarjetas al final de una columna, conservando su orden relativo. */
export async function moveTasks(taskIds: string[], columnId: string) {
  return runAction(async () => {
    const user = await requireUser();
    const ids = z.array(v.id).min(1).max(500).parse(taskIds);
    const column = await db.column.findFirst({
      where: { id: v.id.parse(columnId), project: visibleProjectsWhere(user) },
      select: { id: true, projectId: true },
    });
    if (!column) throw notFound();
    const tasks = await db.task.findMany({
      where: { id: { in: ids }, projectId: column.projectId },
      orderBy: [{ column: { position: "asc" } }, { position: "asc" }],
      select: { id: true, columnId: true },
    });
    const toMove = tasks.filter((t) => t.columnId !== column.id);
    let pos = (await lastPosition(column.id)) ?? 0;
    const moved = toMove.map((t) => ({ id: t.id, position: (pos += POSITION_STEP) }));
    await db.$transaction(moved.map((m) => db.task.update({ where: { id: m.id }, data: { columnId: column.id, position: m.position } })));
    return { columnId: column.id, moved };
  });
}

export async function archiveTask(taskId: string) {
  return runAction(async () => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    await db.task.update({ where: { id: taskId }, data: { archivedAt: new Date() } });
  });
}

export async function deleteTask(taskId: string) {
  return runAction(async () => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    const attachments = await db.taskAttachment.findMany({ where: { taskId }, select: { id: true } });
    await db.task.delete({ where: { id: taskId } });
    await removeAttachmentFiles(attachments.map((a) => a.id));
  });
}

export async function getTaskDetail(taskId: string) {
  return runAction(async (): Promise<TaskDetail> => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    const task = await db.task.findUniqueOrThrow({
      where: { id: taskId },
      select: {
        id: true,
        description: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        subtasks: { orderBy: { position: "asc" }, select: { id: true, title: true, done: true, position: true } },
        attachments: { orderBy: { createdAt: "asc" }, select: { id: true, originalName: true, width: true, height: true } },
      },
    });
    return {
      id: task.id,
      description: task.description,
      createdAt: task.createdAt.toISOString(),
      createdByName: task.createdBy?.name ?? null,
      subtasks: task.subtasks,
      attachments: task.attachments,
    };
  });
}

// --- Subtareas ---------------------------------------------------------------

async function assertSubtaskAccess(subtaskId: string) {
  const user = await requireUser();
  const sub = await db.subtask.findFirst({
    where: { id: v.id.parse(subtaskId), task: { project: visibleProjectsWhere(user) } },
    select: { id: true },
  });
  if (!sub) throw notFound();
}

export async function addSubtask(taskId: string, title: string) {
  return runAction(async (): Promise<SubtaskInfo> => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    const last = await db.subtask.findFirst({ where: { taskId }, orderBy: { position: "desc" }, select: { position: true } });
    return db.subtask.create({
      data: { taskId, title: v.title.parse(title), position: positionBetween(last?.position, null) },
      select: { id: true, title: true, done: true, position: true },
    });
  });
}

export async function updateSubtask(subtaskId: string, patch: { title?: string; done?: boolean }) {
  return runAction(async () => {
    await assertSubtaskAccess(subtaskId);
    const data = z.object({ title: v.title.optional(), done: z.boolean().optional() }).parse(patch);
    await db.subtask.update({ where: { id: subtaskId }, data });
  });
}

export async function deleteSubtask(subtaskId: string) {
  return runAction(async () => {
    await assertSubtaskAccess(subtaskId);
    await db.subtask.delete({ where: { id: subtaskId } });
  });
}

// --- Adjuntos ----------------------------------------------------------------

export async function deleteAttachment(attachmentId: string) {
  return runAction(async () => {
    const user = await requireUser();
    const att = await db.taskAttachment.findFirst({
      where: { id: v.id.parse(attachmentId), task: { project: visibleProjectsWhere(user) } },
      select: { id: true },
    });
    if (!att) throw notFound();
    await db.taskAttachment.delete({ where: { id: att.id } });
    await removeAttachmentFiles([att.id]);
  });
}

export async function restoreTask(taskId: string) {
  return runAction(async () => {
    const user = await requireUser();
    const { columnId } = await assertTaskAccess(user, v.id.parse(taskId));
    const position = positionBetween(await lastPosition(columnId), null);
    await db.task.update({ where: { id: taskId }, data: { archivedAt: null, position } });
  });
}
