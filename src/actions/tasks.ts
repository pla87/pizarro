"use server";

import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertAssignable, assertProjectAccess, assertTaskAccess, visibleProjectsWhere } from "@/lib/access";
import { boardTaskSelect, loadBoardTask, toBoardTask } from "@/lib/board";
import { MAX_BULK_TASKS } from "@/lib/bulk";
import { describeAction, noteProject } from "@/lib/action-context";
import { addUndo, captureTasks, snapshotTasks, type TaskField } from "@/lib/undo";
import { AppError, notFound } from "@/lib/errors";
import { needsRebalance, positionBetween, POSITION_STEP } from "@/lib/positions";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";
import { isoToDate } from "@/lib/dates";
import { createDriveFile, type GoogleFileKind } from "@/lib/google";
import { extractMentionIds } from "@/lib/mentions";
import { notifyMentions } from "@/lib/notify";
import type { ArchivedTask, CommentInfo, SubtaskInfo, TaskDetail, TaskLinkInfo } from "@/lib/types";

async function assertColumnInProject(columnId: string, projectId: string) {
  const ok = await db.column.count({ where: { id: columnId, projectId } });
  if (!ok) throw new AppError("La columna no existe.");
}

async function assertDeliverableInProject(deliverableId: string | null | undefined, projectId: string) {
  if (!deliverableId) return;
  const ok = await db.deliverable.count({ where: { id: deliverableId, projectId } });
  if (!ok) throw new AppError("El entregable no existe.");
}

/** Los tipos deben ser generales (no ocultos en el proyecto) o del propio proyecto. */
async function assertKindsInProject(kindIds: (string | undefined)[], projectId: string) {
  const ids = [...new Set(kindIds.filter((id): id is string => !!id))];
  if (!ids.length) return;
  const count = await db.taskKind.count({
    where: { id: { in: ids }, OR: [{ projectId: null, hiddenIn: { none: { projectId } } }, { projectId }] },
  });
  if (count !== ids.length) throw new AppError("El tipo de tarea no existe.");
}

async function assertLabelsInProject(labelIds: string[], projectId: string) {
  if (labelIds.length === 0) return;
  const count = await db.label.count({ where: { id: { in: labelIds }, projectId } });
  if (count !== new Set(labelIds).size) throw new AppError("Etiqueta no válida.");
}

/** Título y columna actuales de una tarea, para los textos del registro de actividad. */
async function taskLabel(taskId: string): Promise<{ title: string; column: string }> {
  const t = await db.task.findUnique({ where: { id: taskId }, select: { title: true, column: { select: { name: true } } } });
  return { title: t?.title ?? "(tarea)", column: t?.column.name ?? "?" };
}

async function columnName(columnId: string): Promise<string> {
  return (await db.column.findUnique({ where: { id: columnId }, select: { name: true } }))?.name ?? "?";
}

const CHANGE_LABELS: Record<string, string> = {
  title: "título", description: "descripción", kindId: "tipo", color: "color", linkUrl: "enlace",
  assigneeId: "responsable", labelIds: "etiquetas", dueDate: "fecha límite", deliverableId: "entregable", evergreen: "fija en la release",
};

/** «tipo, responsable y fecha límite» a partir de los campos cambiados. */
function describeChanges(data: Record<string, unknown>): string {
  const names = Object.keys(data).filter((k) => data[k] !== undefined).map((k) => CHANGE_LABELS[k] ?? k);
  if (names.length <= 1) return names[0] ?? "sin cambios";
  return `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
}

/** Campos que cambian al archivar o recuperar una tarea. */
const ARCHIVE_FIELDS: TaskField[] = ["archivedAt", "archivedFromColumnId", "columnId", "position", "evergreen"];

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
  kindId: v.id,
  description: v.description.default(""),
  assigneeId: v.id.nullable().default(null),
  color: v.color.default(null),
  linkUrl: v.linkUrl.default(null),
  labelIds: z.array(v.id).max(20).default([]),
  dueDate: v.dayIso.default(null),
  deliverableId: v.id.nullable().default(null),
  evergreen: z.boolean().default(false),
  subtasks: z.array(v.title).max(50).default([]),
});

export async function createTask(input: z.input<typeof createSchema>) {
  return runAction({ name: "tasks.createTask", args: [input] }, async () => {
    const user = await requireUser();
    const data = createSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    await assertColumnInProject(data.columnId, data.projectId);
    await assertLabelsInProject(data.labelIds, data.projectId);
    if (data.assigneeId) await assertAssignable(data.projectId, data.assigneeId);
    await assertDeliverableInProject(data.deliverableId, data.projectId);
    await assertKindsInProject([data.kindId], data.projectId);
    // Solo se admite evergreen en la columna de la release.
    const evergreen = data.evergreen && (await db.column.count({ where: { id: data.columnId, role: "NEXT_RELEASE" } })) > 0;
    const position = positionBetween(await lastPosition(data.columnId), null);
    const task = await db.task.create({
      data: {
        projectId: data.projectId,
        columnId: data.columnId,
        title: data.title,
        kindId: data.kindId,
        description: data.description,
        assigneeId: data.assigneeId,
        color: data.color,
        linkUrl: data.linkUrl,
        dueDate: data.dueDate ? isoToDate(data.dueDate) : null,
        deliverableId: data.deliverableId,
        evergreen,
        position,
        createdById: user.id,
        labels: { create: [...new Set(data.labelIds)].map((labelId) => ({ labelId })) },
        // Subtareas iniciales en el orden recibido (misma transacción que la tarea).
        subtasks: { create: data.subtasks.map((title, i) => ({ title, position: (i + 1) * POSITION_STEP })) },
      },
      select: { id: true },
    });
    addUndo({ t: "task.remove", id: task.id });
    describeAction(
      `Creó la tarea «${data.title}» en «${await columnName(data.columnId)}»${data.subtasks.length ? ` con ${data.subtasks.length} subtareas` : ""}`,
      { taskId: task.id },
    );
    await notifyMentions({ actorId: user.id, taskId: task.id, projectId: data.projectId, recipientIds: extractMentionIds(data.description), text: data.description });
    return loadBoardTask(task.id);
  });
}

const createManySchema = z.object({
  projectId: v.id,
  columnId: v.id,
  tasks: z.array(z.object({ title: v.title, kindId: v.id })).min(1, "No hay tareas que crear.").max(MAX_BULK_TASKS, `Máximo ${MAX_BULK_TASKS} tareas de una vez.`),
  assigneeId: v.id.nullable().default(null),
  labelIds: z.array(v.id).max(20).default([]),
  dueDate: v.dayIso.default(null),
  deliverableId: v.id.nullable().default(null),
});

/** Crea varias tareas a la vez (una por línea pegada), al final de la columna y en el orden recibido. */
export async function createTasks(input: z.input<typeof createManySchema>) {
  return runAction({ name: "tasks.createTasks", args: [input] }, async () => {
    const user = await requireUser();
    const data = createManySchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    await assertColumnInProject(data.columnId, data.projectId);
    await assertLabelsInProject(data.labelIds, data.projectId);
    if (data.assigneeId) await assertAssignable(data.projectId, data.assigneeId);
    await assertDeliverableInProject(data.deliverableId, data.projectId);
    await assertKindsInProject(data.tasks.map((t) => t.kindId), data.projectId);
    const labelIds = [...new Set(data.labelIds)];
    const dueDate = data.dueDate ? isoToDate(data.dueDate) : null;
    const ids = await db.$transaction(async (tx) => {
      let position = (await tx.task.findFirst({ where: { columnId: data.columnId }, orderBy: { position: "desc" }, select: { position: true } }))?.position ?? null;
      const created = await tx.task.createManyAndReturn({
        data: data.tasks.map((t) => {
          position = positionBetween(position, null);
          return {
            projectId: data.projectId,
            columnId: data.columnId,
            title: t.title,
            kindId: t.kindId,
            assigneeId: data.assigneeId,
            dueDate,
            deliverableId: data.deliverableId,
            position,
            createdById: user.id,
          };
        }),
        select: { id: true },
      });
      if (labelIds.length) {
        await tx.taskLabel.createMany({ data: created.flatMap((t) => labelIds.map((labelId) => ({ taskId: t.id, labelId }))) });
      }
      return created.map((t) => t.id);
    });
    addUndo(...ids.map((id) => ({ t: "task.remove" as const, id })));
    describeAction(`Creó ${ids.length === 1 ? "1 tarea" : `${ids.length} tareas`} en «${await columnName(data.columnId)}»: ${data.tasks.map((t) => `«${t.title}»`).join(", ").slice(0, 600)}`, { taskIds: ids });
    const rows = await db.task.findMany({ where: { id: { in: ids } }, orderBy: { position: "asc" }, select: boardTaskSelect });
    return rows.map(toBoardTask);
  });
}

const updateSchema = z.object({
  title: v.title.optional(),
  description: v.description.optional(),
  kindId: v.id.optional(),
  color: v.color.optional(),
  linkUrl: v.linkUrl.optional(),
  assigneeId: v.id.nullable().optional(),
  labelIds: z.array(v.id).max(20).optional(),
  dueDate: v.dayIso.optional(),
  deliverableId: v.id.nullable().optional(),
  evergreen: z.boolean().optional(),
});

/**
 * `since`: cuándo se cargó el título/descripción que se está editando. Si otra persona los ha
 * cambiado después, no se pisa su texto: se avisa para recargar.
 */
export async function updateTask(taskId: string, patch: z.input<typeof updateSchema>, since?: string | null) {
  return runAction({ name: "tasks.updateTask", args: [taskId, patch, since] }, async () => {
    const user = await requireUser();
    const data = updateSchema.parse(patch);
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    const editsText = data.title !== undefined || data.description !== undefined;
    if (editsText && since !== undefined) {
      const current = await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { contentUpdatedAt: true, contentUpdatedById: true } });
      const base = since ? new Date(since).getTime() : 0;
      if (current.contentUpdatedAt && current.contentUpdatedById !== user.id && current.contentUpdatedAt.getTime() > base) {
        const who = current.contentUpdatedById ? (await db.user.findUnique({ where: { id: current.contentUpdatedById }, select: { name: true } }))?.name : null;
        throw new AppError(`${who ?? "Otra persona"} ha cambiado el texto de esta tarea mientras la editabas. Se ha recargado con sus cambios: vuelve a aplicar los tuyos.`, 409);
      }
    }
    if (data.assigneeId) await assertAssignable(projectId, data.assigneeId);
    if (data.labelIds) await assertLabelsInProject(data.labelIds, projectId);
    await assertDeliverableInProject(data.deliverableId, projectId);
    await assertKindsInProject([data.kindId], projectId);
    // Evergreen solo tiene sentido en la columna de la release.
    if (data.evergreen) {
      const ok = await db.task.count({ where: { id: taskId, column: { role: "NEXT_RELEASE" } } });
      if (!ok) throw new AppError("Solo las tareas de la columna de la release pueden ser fijas.");
    }
    const { labelIds, dueDate, ...rest } = data;
    const fields = {
      ...rest,
      ...(dueDate !== undefined ? { dueDate: dueDate ? isoToDate(dueDate) : null } : {}),
      ...(editsText ? { contentUpdatedAt: new Date(), contentUpdatedById: user.id } : {}),
    };
    const changed = Object.keys(fields).filter((k) => k !== "labelIds") as TaskField[];
    addUndo(...(await captureTasks([taskId], changed, labelIds !== undefined)));
    const before = await taskLabel(taskId);
    const newMentions = await db.$transaction(async (tx) => {
      // Menciones nuevas en la descripción (las que ya estaban no vuelven a avisar).
      // Se lee la versión anterior con bloqueo de fila para que dos ediciones simultáneas no avisen dos veces.
      let added: string[] = [];
      if (data.description !== undefined) {
        const [before] = await tx.$queryRaw<{ description: string }[]>`SELECT "description" FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`;
        const old = new Set(extractMentionIds(before?.description ?? ""));
        added = extractMentionIds(data.description).filter((id) => !old.has(id));
      }
      await tx.task.update({ where: { id: taskId }, data: fields });
      if (labelIds) {
        await tx.taskLabel.deleteMany({ where: { taskId } });
        await tx.taskLabel.createMany({ data: [...new Set(labelIds)].map((labelId) => ({ taskId, labelId })) });
      }
      return added;
    });
    describeAction(`Modificó «${data.title ?? before.title}»: ${describeChanges(data)}`, { taskId });
    if (newMentions.length) {
      await notifyMentions({ actorId: user.id, taskId, projectId, recipientIds: newMentions, text: data.description ?? "" });
    }
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
  return runAction({ name: "tasks.moveTask", args: [taskId, columnId, prevId, nextId] }, async () => {
    const user = await requireUser();
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    await assertColumnInProject(v.id.parse(columnId), projectId);
    let n = await neighbourPositions(columnId, prevId, nextId);
    if (!n.stale && needsRebalance(n.prev, n.next)) {
      await rebalanceColumn(columnId);
      n = await neighbourPositions(columnId, prevId, nextId);
    }
    const position = n.stale ? positionBetween(await lastPosition(columnId), null) : positionBetween(n.prev, n.next);
    const before = await taskLabel(taskId);
    addUndo(...(await captureTasks([taskId], ["columnId", "position", "evergreen"])));
    await db.task.update({ where: { id: taskId }, data: { columnId, position, evergreen: false } });
    const to = await columnName(columnId);
    describeAction(before.column === to ? `Reordenó «${before.title}» en «${to}»` : `Movió «${before.title}» de «${before.column}» a «${to}»`, { taskId });
    return { position };
  });
}

/** Mueve varias tarjetas al final de una columna, conservando su orden relativo. */
export async function moveTasks(taskIds: string[], columnId: string) {
  return runAction({ name: "tasks.moveTasks", args: [taskIds, columnId] }, async () => {
    const user = await requireUser();
    const ids = z.array(v.id).min(1).max(500).parse(taskIds);
    const column = await db.column.findFirst({
      where: { id: v.id.parse(columnId), project: visibleProjectsWhere(user) },
      select: { id: true, projectId: true },
    });
    if (!column) throw notFound();
    noteProject(column.projectId);
    const tasks = await db.task.findMany({
      where: { id: { in: ids }, projectId: column.projectId },
      orderBy: [{ column: { position: "asc" } }, { position: "asc" }],
      select: { id: true, columnId: true },
    });
    const toMove = tasks.filter((t) => t.columnId !== column.id);
    let pos = (await lastPosition(column.id)) ?? 0;
    const moved = toMove.map((t) => ({ id: t.id, position: (pos += POSITION_STEP) }));
    addUndo(...(await captureTasks(moved.map((m) => m.id), ["columnId", "position", "evergreen"])));
    await db.$transaction(moved.map((m) => db.task.update({ where: { id: m.id }, data: { columnId: column.id, position: m.position, evergreen: false } })));
    describeAction(`Movió ${moved.length === 1 ? "1 tarea" : `${moved.length} tareas`} a «${await columnName(column.id)}»`, { taskIds: moved.map((m) => m.id) });
    return { columnId: column.id, moved };
  });
}

/** Convierte una tarea en fija (evergreen): la lleva al final de la columna de la release del proyecto. */
export async function makeEvergreen(taskId: string) {
  return runAction({ name: "tasks.makeEvergreen", args: [taskId] }, async () => {
    const user = await requireUser();
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    addUndo(...(await captureTasks([taskId], ["columnId", "position", "evergreen"])));
    const result = await db.$transaction(async (tx) => {
      const column = await tx.column.findFirst({ where: { projectId, role: "NEXT_RELEASE" }, select: { id: true } });
      if (!column) throw new AppError("El proyecto no tiene columna de release.");
      const last = await tx.task.findFirst({ where: { columnId: column.id }, orderBy: { position: "desc" }, select: { position: true } });
      const position = positionBetween(last?.position ?? null, null);
      const task = await tx.task.update({
        where: { id: taskId },
        data: { columnId: column.id, position, evergreen: true },
        select: { title: true },
      });
      return { columnId: column.id, position, title: task.title };
    });
    describeAction(`Marcó «${result.title}» como fija en la release`, { taskId, columnId: result.columnId });
    return { columnId: result.columnId, position: result.position };
  });
}

export async function archiveTask(taskId: string) {
  return runAction({ name: "tasks.archiveTask", args: [taskId] }, async () => {
    const user = await requireUser();
    const { columnId } = await assertTaskAccess(user, v.id.parse(taskId));
    describeAction(`Archivó «${(await taskLabel(taskId)).title}»`, { taskId });
    addUndo(...(await captureTasks([taskId], ARCHIVE_FIELDS)));
    await db.task.update({ where: { id: taskId }, data: { archivedAt: new Date(), archivedFromColumnId: columnId, evergreen: false } });
  });
}

/** Archiva varias tareas (selección múltiple), recordando la columna de la que salen. */
export async function archiveTasks(taskIds: string[]) {
  return runAction({ name: "tasks.archiveTasks", args: [taskIds] }, async () => {
    const user = await requireUser();
    const ids = [...new Set(z.array(v.id).min(1).max(500).parse(taskIds))];
    const tasks = await db.task.findMany({ where: { id: { in: ids }, project: visibleProjectsWhere(user) }, select: { id: true, projectId: true } });
    if (tasks.length !== ids.length) throw notFound();
    noteProject(tasks[0]?.projectId);
    addUndo(...(await captureTasks((await db.task.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } })).map((t) => t.id), ARCHIVE_FIELDS)));
    await db.$executeRaw`UPDATE "Task" SET "archivedAt" = NOW(), "archivedFromColumnId" = "columnId", "evergreen" = false WHERE "id" IN (${Prisma.join(ids)}) AND "archivedAt" IS NULL`;
    describeAction(`Archivó ${ids.length === 1 ? "1 tarea" : `${ids.length} tareas`}`, { taskIds: ids });
    return { archived: ids.length };
  });
}

/** Tareas archivadas del proyecto, las más recientes primero. */
export async function getArchivedTasks(projectId: string) {
  return runAction({ name: "tasks.getArchivedTasks", args: [projectId] }, async (): Promise<ArchivedTask[]> => {
    const user = await requireUser();
    await assertProjectAccess(user, v.id.parse(projectId));
    describeAction("Consultó las tareas archivadas");
    const rows = await db.task.findMany({
      where: { projectId, archivedAt: { not: null } },
      orderBy: { archivedAt: "desc" },
      take: 500,
      select: {
        id: true,
        title: true,
        kindId: true,
        archivedAt: true,
        archivedFromColumnId: true,
        releases: { select: { release: { select: { id: true, title: true, deployedAt: true } } } },
      },
    });
    const columns = await db.column.findMany({ where: { projectId }, select: { id: true, name: true } });
    const names = new Map(columns.map((c) => [c.id, c.name]));
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      kindId: t.kindId,
      archivedAt: t.archivedAt!.toISOString(),
      columnName: (t.archivedFromColumnId && names.get(t.archivedFromColumnId)) || null,
      releases: t.releases
        .map((r) => ({ id: r.release.id, title: r.release.title, deployedAt: r.release.deployedAt.toISOString() }))
        .sort((a, b) => b.deployedAt.localeCompare(a.deployedAt)),
    }));
  });
}
export async function deleteTask(taskId: string) {
  return runAction({ name: "tasks.deleteTask", args: [taskId] }, async () => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    describeAction(`Borró la tarea «${(await taskLabel(taskId)).title}»`, { taskId });
    // Los ficheros de sus adjuntos se conservan mientras se pueda deshacer (ver undo.ts).
    addUndo(...(await snapshotTasks([taskId])));
    await db.task.delete({ where: { id: taskId } });
  });
}

/** Borra varias tareas (selección múltiple) con sus adjuntos. Solo las que el usuario puede ver. */
export async function deleteTasks(taskIds: string[]) {
  return runAction({ name: "tasks.deleteTasks", args: [taskIds] }, async () => {
    const user = await requireUser();
    const ids = [...new Set(z.array(v.id).min(1).max(500).parse(taskIds))];
    const tasks = await db.task.findMany({ where: { id: { in: ids }, project: visibleProjectsWhere(user) }, select: { id: true, projectId: true } });
    if (tasks.length !== ids.length) throw notFound();
    // Todas deben ser del mismo proyecto: el deshacer se guarda por proyecto.
    if (new Set(tasks.map((t) => t.projectId)).size > 1) throw new AppError("Las tareas son de proyectos distintos.");
    noteProject(tasks[0]?.projectId);
    addUndo(...(await snapshotTasks(ids)));
    const titles = await db.task.findMany({ where: { id: { in: ids } }, select: { title: true } });
    describeAction(`Borró ${ids.length === 1 ? "1 tarea" : `${ids.length} tareas`}: ${titles.map((t) => `«${t.title}»`).join(", ").slice(0, 600)}`, { taskIds: ids });
    await db.task.deleteMany({ where: { id: { in: ids } } });
    return { deleted: ids.length };
  });
}

export async function getTaskDetail(taskId: string) {
  return runAction({ name: "tasks.getTaskDetail", args: [taskId] }, async (): Promise<TaskDetail> => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    describeAction(`Abrió la tarea «${(await taskLabel(taskId)).title}»`, { taskId });
    const task = await db.task.findUniqueOrThrow({
      where: { id: taskId },
      select: {
        id: true,
        description: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        contentUpdatedAt: true,
        subtasks: { orderBy: { position: "asc" }, select: { id: true, title: true, done: true, position: true } },
        attachments: { orderBy: { createdAt: "asc" }, select: { id: true, originalName: true, mimeType: true, isImage: true, size: true, width: true, height: true } },
        links: { orderBy: { createdAt: "asc" }, select: linkSelect },
        comments: { orderBy: { createdAt: "asc" }, take: 300, select: commentSelect },
      },
    });
    return {
      id: task.id,
      description: task.description,
      createdAt: task.createdAt.toISOString(),
      createdByName: task.createdBy?.name ?? null,
      textVersion: task.contentUpdatedAt?.toISOString() ?? null,
      subtasks: task.subtasks,
      attachments: task.attachments,
      links: task.links,
      comments: task.comments.map(toCommentInfo),
    };
  });
}

// --- Subtareas ---------------------------------------------------------------

async function assertSubtaskAccess(subtaskId: string) {
  const user = await requireUser();
  const sub = await db.subtask.findFirst({
    where: { id: v.id.parse(subtaskId), task: { project: visibleProjectsWhere(user) } },
    select: { id: true, taskId: true, title: true, done: true, position: true, task: { select: { projectId: true } } },
  });
  if (!sub) throw notFound();
  noteProject(sub.task.projectId);
  const { task: _task, ...row } = sub;
  return row;
}

export async function addSubtask(taskId: string, title: string) {
  return runAction({ name: "tasks.addSubtask", args: [taskId, title] }, async (): Promise<SubtaskInfo> => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    const last = await db.subtask.findFirst({ where: { taskId }, orderBy: { position: "desc" }, select: { position: true } });
    const sub = await db.subtask.create({
      data: { taskId, title: v.title.parse(title), position: positionBetween(last?.position, null) },
      select: { id: true, title: true, done: true, position: true },
    });
    addUndo({ t: "subtask.remove", id: sub.id });
    describeAction(`Añadió la subtarea «${sub.title}» en «${(await taskLabel(taskId)).title}»`, { taskId });
    return sub;
  });
}

export async function updateSubtask(subtaskId: string, patch: { title?: string; done?: boolean }) {
  return runAction({ name: "tasks.updateSubtask", args: [subtaskId, patch] }, async () => {
    const sub = await assertSubtaskAccess(subtaskId);
    const data = z.object({ title: v.title.optional(), done: z.boolean().optional() }).parse(patch);
    addUndo({ t: "subtask.set", id: sub.id, data: { ...(data.title !== undefined ? { title: sub.title } : {}), ...(data.done !== undefined ? { done: sub.done } : {}) } });
    describeAction(
      data.title !== undefined ? `Renombró la subtarea «${sub.title}» a «${data.title}»` : `${data.done ? "Marcó" : "Desmarcó"} la subtarea «${sub.title}»`,
      { subtaskId: sub.id },
    );
    await db.subtask.update({ where: { id: subtaskId }, data });
  });
}

/** Mueve una subtarea entre sus nuevos vecinos (prevId/nextId; null en los extremos). */
export async function reorderSubtask(subtaskId: string, prevId: string | null, nextId: string | null) {
  return runAction({ name: "tasks.reorderSubtask", args: [subtaskId, prevId, nextId] }, async (): Promise<{ position: number }> => {
    const sub = await assertSubtaskAccess(subtaskId);
    addUndo({ t: "subtask.set", id: sub.id, data: { position: sub.position } });
    const neighbour = async (id: string | null) => {
      if (!id) return null;
      const n = await db.subtask.findFirst({ where: { id: v.id.parse(id), taskId: sub.taskId }, select: { position: true } });
      if (!n) throw new AppError("La subtarea no existe.");
      return n.position;
    };
    const prev = await neighbour(prevId);
    const next = await neighbour(nextId);
    let position = positionBetween(prev, next);
    if (needsRebalance(prev, next)) {
      // Posiciones agotadas (muy raro): se renumera la lista y se recalcula.
      const all = await db.subtask.findMany({ where: { taskId: sub.taskId }, orderBy: { position: "asc" }, select: { id: true } });
      await db.$transaction(all.map((s, i) => db.subtask.update({ where: { id: s.id }, data: { position: (i + 1) * POSITION_STEP } })));
      const fresh = async (id: string | null) => (id ? (await db.subtask.findUnique({ where: { id }, select: { position: true } }))?.position ?? null : null);
      position = positionBetween(await fresh(prevId), await fresh(nextId));
    }
    describeAction(`Reordenó la subtarea «${sub.title}»`, { subtaskId: sub.id });
    await db.subtask.update({ where: { id: sub.id }, data: { position } });
    return { position };
  });
}

export async function deleteSubtask(subtaskId: string) {
  return runAction({ name: "tasks.deleteSubtask", args: [subtaskId] }, async () => {
    const sub = await assertSubtaskAccess(subtaskId);
    addUndo({ t: "subtask.restore", row: sub });
    describeAction(`Borró la subtarea «${sub.title}»`, { subtaskId: sub.id });
    await db.subtask.delete({ where: { id: subtaskId } });
  });
}

// --- Adjuntos ----------------------------------------------------------------

export async function deleteAttachment(attachmentId: string) {
  return runAction({ name: "tasks.deleteAttachment", args: [attachmentId] }, async () => {
    const user = await requireUser();
    const att = await db.taskAttachment.findFirst({
      where: { id: v.id.parse(attachmentId), task: { project: visibleProjectsWhere(user) } },
    });
    if (!att) throw notFound();
    noteProject((await db.task.findUnique({ where: { id: att.taskId }, select: { projectId: true } }))?.projectId);
    describeAction(`Borró el adjunto «${att.originalName}» de «${(await taskLabel(att.taskId)).title}»`, { attachmentId: att.id });
    // El fichero se conserva mientras se pueda deshacer (ver undo.ts).
    addUndo({ t: "attachment.restore", row: { ...att, createdAt: att.createdAt.toISOString() } });
    await db.taskAttachment.delete({ where: { id: att.id } });
  });
}

/** Recupera una tarea archivada: vuelve a su columna de origen (o al backlog si ya no existe), al final. */
export async function restoreTask(taskId: string) {
  return runAction({ name: "tasks.restoreTask", args: [taskId] }, async () => {
    const user = await requireUser();
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { archivedFromColumnId: true } });
    const origin = task.archivedFromColumnId
      ? await db.column.findFirst({ where: { id: task.archivedFromColumnId, projectId }, select: { id: true, name: true } })
      : null;
    const column = origin ?? (await db.column.findFirst({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true } }));
    if (!column) throw new AppError("El proyecto no tiene columnas.");
    const position = positionBetween(await lastPosition(column.id), null);
    addUndo(...(await captureTasks([taskId], ARCHIVE_FIELDS)));
    await db.task.update({ where: { id: taskId }, data: { archivedAt: null, archivedFromColumnId: null, columnId: column.id, position } });
    describeAction(`Recuperó «${(await taskLabel(taskId)).title}» en «${column.name}»`, { taskId });
    return { task: await loadBoardTask(taskId), columnName: column.name };
  });
}

// --- Comentarios y menciones ---------------------------------------------------

const commentSelect = { id: true, body: true, createdAt: true, authorId: true, author: { select: { name: true } } } as const;

function toCommentInfo(c: { id: string; body: string; createdAt: Date; authorId: string | null; author: { name: string } | null }): CommentInfo {
  return { id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), authorId: c.authorId, authorName: c.author?.name ?? null };
}

const commentBody = z.string().trim().min(1, "El comentario está vacío.").max(10_000, "El comentario es demasiado largo.");

export async function addComment(taskId: string, body: string) {
  return runAction({ name: "tasks.addComment", args: [taskId, body] }, async (): Promise<CommentInfo> => {
    const user = await requireUser();
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    const text = commentBody.parse(body);
    const comment = await db.taskComment.create({ data: { taskId, authorId: user.id, body: text }, select: commentSelect });
    addUndo({ t: "comment.remove", id: comment.id });
    await notifyMentions({ actorId: user.id, taskId, projectId, recipientIds: extractMentionIds(text), text });
    describeAction(`Comentó en «${(await taskLabel(taskId)).title}»`, { taskId });
    return toCommentInfo(comment);
  });
}

/** Solo el autor (o un admin) puede borrar un comentario. */
export async function deleteComment(commentId: string) {
  return runAction({ name: "tasks.deleteComment", args: [commentId] }, async () => {
    const user = await requireUser();
    const comment = await db.taskComment.findFirst({
      where: { id: v.id.parse(commentId), task: { project: visibleProjectsWhere(user) } },
      include: { task: { select: { projectId: true, title: true } } },
    });
    if (!comment) throw notFound();
    if (comment.authorId !== user.id && user.role !== "ADMIN") throw new AppError("Solo puedes borrar tus comentarios.", 403);
    noteProject(comment.task.projectId);
    const { task, ...row } = comment;
    addUndo({ t: "comment.restore", row: { ...row, createdAt: row.createdAt.toISOString(), editedAt: row.editedAt?.toISOString() ?? null } });
    describeAction(`Borró un comentario de «${task.title}»`, { taskId: row.taskId });
    await db.taskComment.delete({ where: { id: comment.id } });
  });
}

// --- Documentos de Google ------------------------------------------------------

const linkSelect = { id: true, kind: true, title: true, url: true } as const;

/** Crea un Google Doc o Sheet en el Drive del usuario y lo enlaza a la tarea. */
export async function createGoogleFile(taskId: string, kind: GoogleFileKind, title: string) {
  return runAction({ name: "tasks.createGoogleFile", args: [taskId, kind, title] }, async (): Promise<TaskLinkInfo> => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    const fileKind = z.enum(["GOOGLE_DOC", "GOOGLE_SHEET"]).parse(kind);
    const name = v.title.parse(title);
    const file = await createDriveFile(user.id, fileKind, name);
    if (!/^https:\/\/(docs|drive)\.google\.com\//.test(file.url)) throw new AppError("Google devolvió un enlace inesperado.");
    const link = await db.taskLink.create({
      data: { taskId, kind: fileKind, title: file.name, url: file.url, externalId: file.id, createdById: user.id },
      select: linkSelect,
    });
    // Deshacer quita el enlace; el archivo sigue en Google Drive.
    addUndo({ t: "link.remove", id: link.id });
    return link;
  });
}

/** Quita el enlace de la tarea (el archivo sigue en Google Drive). */
export async function deleteTaskLink(linkId: string) {
  return runAction({ name: "tasks.deleteTaskLink", args: [linkId] }, async () => {
    const user = await requireUser();
    const link = await db.taskLink.findFirst({
      where: { id: v.id.parse(linkId), task: { project: visibleProjectsWhere(user) } },
      include: { task: { select: { projectId: true } } },
    });
    if (!link) throw notFound();
    noteProject(link.task.projectId);
    const { task: _task, ...row } = link;
    addUndo({ t: "link.restore", row: { ...row, createdAt: row.createdAt.toISOString() } });
    describeAction(`Quitó el enlace «${row.title}»`, { taskId: row.taskId });
    await db.taskLink.delete({ where: { id: link.id } });
  });
}
