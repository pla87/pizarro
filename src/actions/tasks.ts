"use server";

import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertAssignable, assertProjectAccess, assertTaskAccess, visibleProjectsWhere } from "@/lib/access";
import { appTimeZone, boardTaskSelect, loadBoardTask, toBoardTask } from "@/lib/board";
import { MAX_BULK_TASKS } from "@/lib/bulk";
import { describeAction, noteProject, noteTask, recordTaskEvent, skipTaskEvents } from "@/lib/action-context";
import { addUndo, captureTasks, snapshotTasks, type TaskField } from "@/lib/undo";
import { subtasksN, tasksN, type Label } from "@/lib/undo-label";
import { AppError, notFound } from "@/lib/errors";
import { needsRebalance, positionBetween, POSITION_STEP } from "@/lib/positions";
import { rateLimit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";
import { dateToIso, isoToDate, todayIso } from "@/lib/dates";
import { normalizeRecurrence, RECURRENCES } from "@/lib/recurrence-date";
import { spawnRecurrences } from "@/lib/recurrence";
import { createDriveFile, type GoogleFileKind } from "@/lib/google";
import { excerpt as makeExcerpt, extractMentionIds, mentionsToPlain } from "@/lib/mentions";
import { dueChangeExcerpt } from "@/lib/notification-text";
import { followTask, notifyMentions, notifyTask, taskFollowerIds } from "@/lib/notify";
import { isFollowing } from "@/lib/followers";
import { loadTaskHistory } from "@/lib/task-events";
import type { ArchivedTask, BoardTask, CommentInfo, SubtaskInfo, TaskDetail, TaskLinkInfo } from "@/lib/types";
import { getT } from "@/i18n/server";

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
  return { title: t ? mentionsToPlain(t.title) : "(tarea)", column: t?.column.name ?? "?" };
}

async function columnName(columnId: string): Promise<string> {
  return (await db.column.findUnique({ where: { id: columnId }, select: { name: true } }))?.name ?? "?";
}

async function columnIsDone(columnId: string): Promise<boolean> {
  return (await db.column.findUnique({ where: { id: columnId }, select: { isDone: true } }))?.isDone ?? false;
}

const CHANGE_LABELS: Record<string, string> = {
  title: "título", description: "descripción", kindId: "tipo", color: "color", linkUrl: "enlace",
  assigneeId: "responsable", labelIds: "etiquetas", dueDate: "fecha límite", deliverableId: "entregable", evergreen: "fija en la release",
  recurrence: "repetición", recurrenceDay: "repetición",
};

/** «tipo, responsable y fecha límite» a partir de los campos cambiados. */
function describeChanges(data: Record<string, unknown>): Label {
  const names: Label[] = [...new Set(Object.keys(data).filter((k) => data[k] !== undefined).map((k) => CHANGE_LABELS[k] ?? k))].map((k) => ({ k }));
  if (names.length <= 1) return names[0] ?? { k: "sin cambios" };
  return { k: "{list} y {last}", p: { list: names.slice(0, -1), last: names.at(-1)! } };
}

/** Campos que cambian al archivar o recuperar una tarea. */
/** Las tareas archivadas solo se recuperan (restoreTask): no se editan ni se mueven. */
async function assertNotArchived(taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { archivedAt: true } });
  if (task?.archivedAt) throw new AppError("La tarea está archivada. Recupérala para modificarla.");
}

/** Límites por tarea / usuario, para que nadie sature la base de datos ni la API de Google. */
const MAX_SUBTASKS = 100;
const MAX_COMMENTS = 1000;

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
  title: v.taskTitle,
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
    noteTask(task.id);
    addUndo({ t: "task.remove", id: task.id });
    describeAction(
      data.subtasks.length ? "Creó la tarea «{title}» en «{col}» con {subs}" : "Creó la tarea «{title}» en «{col}»",
      { title: mentionsToPlain(data.title), col: await columnName(data.columnId), subs: subtasksN(data.subtasks.length) },
      { taskId: task.id },
    );
    const descMentions = extractMentionIds(data.description);
    await notifyMentions({ actorId: user.id, taskId: task.id, projectId: data.projectId, recipientIds: descMentions, text: data.description });
    await notifyMentions({ actorId: user.id, taskId: task.id, projectId: data.projectId, recipientIds: extractMentionIds(data.title).filter((id) => !descMentions.includes(id)), text: data.title });
    if (data.assigneeId) await notifyTask({ type: "ASSIGNED", actorId: user.id, taskId: task.id, projectId: data.projectId, recipientIds: [data.assigneeId], excerpt: makeExcerpt(data.title) });
    return loadBoardTask(task.id);
  });
}

const createManySchema = z.object({
  projectId: v.id,
  columnId: v.id,
  tasks: z.array(z.object({ title: v.title, kindId: v.id })).min(1, "No hay tareas que crear.").max(MAX_BULK_TASKS, "Máximo 100 tareas de una vez."),
  assigneeId: v.id.nullable().default(null),
  labelIds: z.array(v.id).max(20).default([]),
  dueDate: v.dayIso.default(null),
  deliverableId: v.id.nullable().default(null),
  /** Añade a cada tarea las subtareas predefinidas de su tipo. */
  applySubtaskTemplates: z.boolean().default(false),
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
    const templates = new Map<string, string[]>();
    if (data.applySubtaskTemplates) {
      const kinds = await db.taskKind.findMany({ where: { id: { in: [...new Set(data.tasks.map((t) => t.kindId))] } }, select: { id: true, subtaskTemplate: true } });
      for (const k of kinds) if (k.subtaskTemplate.length) templates.set(k.id, k.subtaskTemplate);
    }
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
      if (templates.size) {
        // `createManyAndReturn` conserva el orden de entrada: la tarea i es la línea i.
        await tx.subtask.createMany({
          data: created.flatMap((t, i) =>
            (templates.get(data.tasks[i]!.kindId) ?? []).map((title, j) => ({ taskId: t.id, title, position: (j + 1) * POSITION_STEP })),
          ),
        });
      }
      return created.map((t) => t.id);
    });
    addUndo(...ids.map((id) => ({ t: "task.remove" as const, id })));
    describeAction("Creó {count} en «{col}»: {titles}", { count: tasksN(ids.length), col: await columnName(data.columnId), titles: data.tasks.map((t) => `«${t.title}»`).join(", ").slice(0, 600) }, { taskIds: ids });
    const rows = await db.task.findMany({ where: { id: { in: ids } }, orderBy: { position: "asc" }, select: boardTaskSelect });
    return rows.map(toBoardTask);
  });
}

/**
 * Duplica una tarea: copia título (con « (copia)»), tipo, descripción, etiquetas, responsable, fecha límite,
 * entregable, color, enlace y subtareas (sin marcar); no copia comentarios, adjuntos, historial ni repetición.
 * Queda justo detrás de la original en su columna. Se deshace de una vez (borra la copia).
 */
export async function duplicateTask(taskId: string) {
  return runAction({ name: "tasks.duplicateTask", args: [taskId] }, async () => {
    const user = await requireUser();
    if (!rateLimit(`duplicate:${user.id}`, 60, 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    await assertNotArchived(taskId);
    const src = await db.task.findUniqueOrThrow({
      where: { id: taskId },
      select: {
        title: true, description: true, kindId: true, color: true, linkUrl: true, assigneeId: true, dueDate: true, deliverableId: true,
        columnId: true, position: true,
        labels: { select: { labelId: true } },
        subtasks: { orderBy: { position: "asc" }, select: { title: true, position: true } },
      },
    });
    const t = await getT();
    const suffix = ` ${t("(copia)")}`;
    const title = src.title.length + suffix.length > 200 ? `${src.title.slice(0, 200 - suffix.length).trimEnd()}${suffix}` : `${src.title}${suffix}`;
    // Entre la original y la siguiente de su columna (si las posiciones se agotan, se renumera la columna).
    const nextAfter = async (pos: number) => (await db.task.findFirst({ where: { columnId: src.columnId, position: { gt: pos } }, orderBy: { position: "asc" }, select: { position: true } }))?.position ?? null;
    let from = src.position;
    let next = await nextAfter(from);
    if (needsRebalance(from, next)) {
      await rebalanceColumn(src.columnId);
      from = (await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { position: true } })).position;
      next = await nextAfter(from);
    }
    const copy = await db.task.create({
      data: {
        projectId,
        columnId: src.columnId,
        title,
        description: src.description,
        kindId: src.kindId,
        color: src.color,
        linkUrl: src.linkUrl,
        assigneeId: src.assigneeId,
        dueDate: src.dueDate,
        deliverableId: src.deliverableId,
        position: positionBetween(from, next),
        createdById: user.id,
        labels: { create: src.labels.map((l) => ({ labelId: l.labelId })) },
        subtasks: { create: src.subtasks.map((s) => ({ title: s.title, position: s.position })) },
      },
      select: { id: true },
    });
    addUndo({ t: "task.remove", id: copy.id });
    describeAction("Duplicó «{title}»", { title: src.title }, { taskId: copy.id });
    return loadBoardTask(copy.id);
  });
}

const updateSchema = z.object({
  title: v.taskTitle.optional(),
  description: v.description.optional(),
  kindId: v.id.optional(),
  color: v.color.optional(),
  linkUrl: v.linkUrl.optional(),
  assigneeId: v.id.nullable().optional(),
  labelIds: z.array(v.id).max(20).optional(),
  dueDate: v.dayIso.optional(),
  deliverableId: v.id.nullable().optional(),
  evergreen: z.boolean().optional(),
  recurrence: z.enum(RECURRENCES).optional(),
  recurrenceDay: z.number().int().min(1).max(31).nullable().optional(),
});

/** Anota en el historial qué ha cambiado realmente al editar la tarea (una línea por cambio). */
async function recordUpdateEvents(
  taskId: string,
  prev: { title: string; description: string; kindId: string; kind: { name: string }; assigneeId: string | null; dueDate: Date | null; color: string | null; linkUrl: string | null; deliverableId: string | null; evergreen: boolean },
  data: z.infer<typeof updateSchema>,
  dueDate: string | null | undefined,
) {
  const add = (label: Label) => recordTaskEvent(taskId, "update", label);
  if (data.title !== undefined && data.title !== prev.title) add({ k: "Cambió el título de «{from}» a «{to}»", p: { from: mentionsToPlain(prev.title), to: mentionsToPlain(data.title) } });
  if (data.description !== undefined && data.description !== prev.description) add({ k: "Editó la descripción" });
  if (data.kindId !== undefined && data.kindId !== prev.kindId) {
    const kind = await db.taskKind.findUnique({ where: { id: data.kindId }, select: { name: true } });
    add({ k: "Cambió el tipo de «{from}» a «{to}»", p: { from: prev.kind.name, to: kind?.name ?? "?" } });
  }
  if (data.assigneeId !== undefined && data.assigneeId !== prev.assigneeId) {
    const who = data.assigneeId ? (await db.user.findUnique({ where: { id: data.assigneeId }, select: { name: true } }))?.name ?? "?" : null;
    add(who ? { k: "Asignó la tarea a {name}", p: { name: who } } : { k: "Quitó el responsable" });
  }
  if (dueDate !== undefined && dueDate !== dateToIso(prev.dueDate)) add(dueDate ? { k: "Puso la fecha límite el {date}", p: { date: dueDate } } : { k: "Quitó la fecha límite" });
  const others: Record<string, unknown> = {};
  if (data.color !== undefined && data.color !== prev.color) others.color = true;
  if (data.linkUrl !== undefined && (data.linkUrl ?? null) !== prev.linkUrl) others.linkUrl = true;
  if (data.deliverableId !== undefined && data.deliverableId !== prev.deliverableId) others.deliverableId = true;
  if (data.evergreen !== undefined && data.evergreen !== prev.evergreen) others.evergreen = true;
  if (data.labelIds !== undefined) others.labelIds = true;
  if (Object.keys(others).length) add({ k: "Cambió {changes}", p: { changes: describeChanges(others) } });
  // Sin cambios reales (p. ej. se guardó el mismo texto): ni siquiera la línea genérica.
  skipTaskEvents();
}

/**
 * `since`: cuándo se cargó el título/descripción que se está editando. Si otra persona los ha
 * cambiado después, no se pisa su texto: se avisa para recargar.
 */
export async function updateTask(taskId: string, patch: z.input<typeof updateSchema>, since?: string | null) {
  return runAction({ name: "tasks.updateTask", args: [taskId, patch, since] }, async () => {
    const user = await requireUser();
    const data = updateSchema.parse(patch);
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    await assertNotArchived(taskId);
    const editsText = data.title !== undefined || data.description !== undefined;
    if (editsText && since !== undefined) {
      const current = await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { contentUpdatedAt: true, contentUpdatedById: true } });
      const base = since ? new Date(since).getTime() : 0;
      if (current.contentUpdatedAt && current.contentUpdatedById !== user.id && current.contentUpdatedAt.getTime() > base) {
        const who = current.contentUpdatedById ? (await db.user.findUnique({ where: { id: current.contentUpdatedById }, select: { name: true } }))?.name : null;
        const t = await getT();
        throw new AppError(who ? t("{who} ha cambiado el texto de esta tarea mientras la editabas. Se ha recargado con sus cambios: vuelve a aplicar los tuyos.", { who }) : t("Otra persona ha cambiado el texto de esta tarea mientras la editabas. Se ha recargado con sus cambios: vuelve a aplicar los tuyos."), 409);
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
    const { labelIds, dueDate, recurrence, recurrenceDay, ...rest } = data;
    // Repetición: el día se deja coherente con la regla (semanal 1-7, mensual 1-31) y, si falta, sale de la fecha límite o de hoy.
    let repeat: { recurrence: (typeof RECURRENCES)[number]; recurrenceDay: number | null } | null = null;
    if (recurrence !== undefined || recurrenceDay !== undefined) {
      const cur = await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { recurrence: true, recurrenceDay: true, dueDate: true } });
      const rule = recurrence ?? cur.recurrence;
      const day = recurrenceDay !== undefined ? recurrenceDay : recurrence !== undefined && recurrence !== cur.recurrence ? null : cur.recurrenceDay;
      repeat = normalizeRecurrence(rule, day, dueDate !== undefined ? dueDate : dateToIso(cur.dueDate), todayIso(appTimeZone()));
    }
    const fields = {
      ...rest,
      ...(repeat ?? {}),
      ...(dueDate !== undefined ? { dueDate: dueDate ? isoToDate(dueDate) : null } : {}),
      ...(editsText ? { contentUpdatedAt: new Date(), contentUpdatedById: user.id } : {}),
    };
    const changed = Object.keys(fields).filter((k) => k !== "labelIds") as TaskField[];
    addUndo(...(await captureTasks([taskId], changed, labelIds !== undefined)));
    const prev = await db.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { title: true, description: true, kindId: true, kind: { select: { name: true } }, assigneeId: true, dueDate: true, color: true, linkUrl: true, deliverableId: true, evergreen: true },
    });
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
    describeAction("Modificó «{title}»: {changes}", { title: mentionsToPlain(data.title ?? prev.title), changes: describeChanges(data) }, { taskId });
    await recordUpdateEvents(taskId, prev, data, dueDate);
    if (newMentions.length) {
      await notifyMentions({ actorId: user.id, taskId, projectId, recipientIds: newMentions, text: data.description ?? "" });
    }
    if (data.title !== undefined) {
      const oldTitle = new Set(extractMentionIds(prev.title));
      const added = extractMentionIds(data.title).filter((id) => !oldTitle.has(id) && !newMentions.includes(id));
      if (added.length) await notifyMentions({ actorId: user.id, taskId, projectId, recipientIds: added, text: data.title });
    }
    // Asignación y cambio de fecha: avisan a la persona asignada (nunca a quien hace el cambio).
    const assigneeChanged = data.assigneeId !== undefined && data.assigneeId !== prev.assigneeId;
    if (assigneeChanged && data.assigneeId) {
      await notifyTask({ type: "ASSIGNED", actorId: user.id, taskId, projectId, recipientIds: [data.assigneeId], excerpt: makeExcerpt(data.title ?? prev.title) });
    }
    const oldDue = dateToIso(prev.dueDate);
    const assigneeNow = data.assigneeId !== undefined ? data.assigneeId : prev.assigneeId;
    if (dueDate !== undefined && dueDate !== oldDue && assigneeNow && !assigneeChanged) {
      await notifyTask({ type: "DUE_CHANGED", actorId: user.id, taskId, projectId, recipientIds: [assigneeNow], excerpt: dueChangeExcerpt(oldDue, dueDate) });
    }
    return loadBoardTask(taskId);
  });
}

/** `true` si `toId` es una columna terminada y ninguna de las de origen lo era (la tarea acaba de terminarse). */
async function finishedNow(fromIds: string[], toId: string): Promise<boolean> {
  const cols = await db.column.findMany({ where: { id: { in: [...new Set([...fromIds, toId])] } }, select: { id: true, isDone: true } });
  const done = new Set(cols.filter((c) => c.isDone).map((c) => c.id));
  return done.has(toId) && !fromIds.every((id) => done.has(id));
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
    const { projectId, columnId: fromColumnId } = await assertTaskAccess(user, v.id.parse(taskId));
    await assertNotArchived(taskId);
    await assertColumnInProject(v.id.parse(columnId), projectId);
    prevId = v.id.nullable().parse(prevId);
    nextId = v.id.nullable().parse(nextId);
    let n = await neighbourPositions(columnId, prevId, nextId);
    if (!n.stale && needsRebalance(n.prev, n.next)) {
      await rebalanceColumn(columnId);
      n = await neighbourPositions(columnId, prevId, nextId);
    }
    const position = n.stale ? positionBetween(await lastPosition(columnId), null) : positionBetween(n.prev, n.next);
    const before = await taskLabel(taskId);
    addUndo(...(await captureTasks([taskId], ["columnId", "position", "evergreen"])));
    await db.task.update({ where: { id: taskId }, data: { columnId, position, evergreen: false } });
    // Recurrente que llega a una columna terminada: nace la siguiente aparición.
    const spawned = (await finishedNow([fromColumnId], columnId)) ? await spawnRecurrences([taskId], user.id) : [];
    const to = await columnName(columnId);
    describeAction(
      before.column === to ? "Reordenó «{title}» en «{to}»" : "Movió «{title}» de «{from}» a «{to}»",
      { title: before.title, from: before.column, to },
      { taskId },
    );
    // Historial: solo si cambia de columna (reordenar dentro de la misma no cuenta). «done» alimenta el resumen diario.
    if (before.column === to) skipTaskEvents();
    else recordTaskEvent(taskId, (await columnIsDone(columnId)) ? "done" : "move", { k: "Movió la tarea de «{from}» a «{to}»", p: { from: before.column, to } });
    return { position, spawned };
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
      where: { id: { in: ids }, projectId: column.projectId, archivedAt: null },
      orderBy: [{ column: { position: "asc" } }, { position: "asc" }],
      select: { id: true, columnId: true },
    });
    const toMove = tasks.filter((t) => t.columnId !== column.id);
    let pos = (await lastPosition(column.id)) ?? 0;
    const moved = toMove.map((t) => ({ id: t.id, position: (pos += POSITION_STEP) }));
    addUndo(...(await captureTasks(moved.map((m) => m.id), ["columnId", "position", "evergreen"])));
    await db.$transaction(moved.map((m) => db.task.update({ where: { id: m.id }, data: { columnId: column.id, position: m.position, evergreen: false } })));
    // Las recurrentes que no estaban en una columna terminada y llegan a una: nace la siguiente aparición.
    const target = await db.column.findUnique({ where: { id: column.id }, select: { isDone: true } });
    let spawned: BoardTask[] = [];
    if (target?.isDone) {
      const doneBefore = new Set((await db.column.findMany({ where: { id: { in: [...new Set(toMove.map((t) => t.columnId))] }, isDone: true }, select: { id: true } })).map((c) => c.id));
      spawned = await spawnRecurrences(toMove.filter((t) => !doneBefore.has(t.columnId)).map((t) => t.id), user.id);
    }
    const colName = await columnName(column.id);
    describeAction("Movió {count} a «{col}»", { count: tasksN(moved.length), col: colName }, { taskIds: moved.map((m) => m.id) });
    const code = target?.isDone ? "done" : "move";
    skipTaskEvents();
    for (const m of moved) recordTaskEvent(m.id, code, { k: "Movió la tarea a «{to}»", p: { to: colName } });
    return { columnId: column.id, moved, spawned };
  });
}

/** Convierte una tarea en fija (evergreen): la lleva al final de la columna de la release del proyecto. */
export async function makeEvergreen(taskId: string) {
  return runAction({ name: "tasks.makeEvergreen", args: [taskId] }, async () => {
    const user = await requireUser();
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    await assertNotArchived(taskId);
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
    describeAction("Marcó «{title}» como fija en la release", { title: result.title }, { taskId, columnId: result.columnId });
    return { columnId: result.columnId, position: result.position };
  });
}

export async function archiveTask(taskId: string) {
  return runAction({ name: "tasks.archiveTask", args: [taskId] }, async () => {
    const user = await requireUser();
    const { columnId } = await assertTaskAccess(user, v.id.parse(taskId));
    await assertNotArchived(taskId);
    describeAction("Archivó «{title}»", { title: (await taskLabel(taskId)).title }, { taskId });
    addUndo(...(await captureTasks([taskId], ARCHIVE_FIELDS)));
    await db.task.update({ where: { id: taskId }, data: { archivedAt: new Date(), archivedFromColumnId: columnId, evergreen: false } });
    return { spawned: await spawnRecurrences([taskId], user.id) };
  });
}

/** Archiva varias tareas (selección múltiple), recordando la columna de la que salen. */
export async function archiveTasks(taskIds: string[]) {
  return runAction({ name: "tasks.archiveTasks", args: [taskIds] }, async () => {
    const user = await requireUser();
    const ids = [...new Set(z.array(v.id).min(1).max(500).parse(taskIds))];
    const tasks = await db.task.findMany({ where: { id: { in: ids }, project: visibleProjectsWhere(user) }, select: { id: true, projectId: true } });
    if (tasks.length !== ids.length) throw notFound();
    // Como en el borrado múltiple: el deshacer se guarda por proyecto, así que todas deben ser del mismo.
    if (new Set(tasks.map((t) => t.projectId)).size > 1) throw new AppError("Las tareas son de proyectos distintos.");
    noteProject(tasks[0]?.projectId);
    const active = (await db.task.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } })).map((t) => t.id);
    addUndo(...(await captureTasks(active, ARCHIVE_FIELDS)));
    await db.$executeRaw`UPDATE "Task" SET "archivedAt" = NOW(), "archivedFromColumnId" = "columnId", "evergreen" = false WHERE "id" IN (${Prisma.join(ids)}) AND "archivedAt" IS NULL`;
    const spawned = await spawnRecurrences(active, user.id);
    describeAction("Archivó {count}", { count: tasksN(ids.length) }, { taskIds: ids });
    for (const id of ids) recordTaskEvent(id, "archive", { k: "Archivó la tarea" });
    return { archived: ids.length, spawned };
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
    describeAction("Borró la tarea «{title}»", { title: (await taskLabel(taskId)).title }, { taskId });
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
    describeAction("Borró {count}: {titles}", { count: tasksN(ids.length), titles: titles.map((t) => `«${t.title}»`).join(", ").slice(0, 600) }, { taskIds: ids });
    await db.task.deleteMany({ where: { id: { in: ids } } });
    return { deleted: ids.length };
  });
}

export async function getTaskDetail(taskId: string) {
  return runAction({ name: "tasks.getTaskDetail", args: [taskId] }, async (): Promise<TaskDetail> => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    const task = await db.task.findUniqueOrThrow({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        description: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        createdById: true,
        assigneeId: true,
        followers: { select: { userId: true, muted: true } },
        contentUpdatedAt: true,
        subtasks: { orderBy: { position: "asc" }, select: { id: true, title: true, done: true, position: true } },
        attachments: { orderBy: { createdAt: "asc" }, select: { id: true, originalName: true, mimeType: true, isImage: true, size: true, width: true, height: true } },
        links: { orderBy: { createdAt: "asc" }, select: linkSelect },
        // Los 300 más recientes (si hubiera más, se pierden los antiguos, no los nuevos).
        comments: { orderBy: { createdAt: "desc" }, take: 300, select: commentSelect },
      },
    });
    describeAction(`Abrió la tarea «${task.title}»`, { taskId });
    return {
      id: task.id,
      description: task.description,
      createdAt: task.createdAt.toISOString(),
      createdByName: task.createdBy?.name ?? null,
      textVersion: task.contentUpdatedAt?.toISOString() ?? null,
      subtasks: task.subtasks,
      attachments: task.attachments,
      links: task.links,
      comments: task.comments.reverse().map(toCommentInfo),
      following: isFollowing(user.id, { createdById: task.createdById, assigneeId: task.assigneeId, rows: task.followers }),
    };
  });
}

/** «Seguir / Dejar de seguir»: quien deja de seguir una tarea no recibe sus avisos de cambios y comentarios. */
export async function setTaskFollowing(taskId: string, follow: boolean) {
  return runAction({ name: "tasks.setTaskFollowing", args: [taskId, follow] }, async () => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    const muted = !z.boolean().parse(follow);
    await db.taskFollower.upsert({
      where: { taskId_userId: { taskId, userId: user.id } },
      create: { taskId, userId: user.id, muted },
      update: { muted },
    });
    describeAction(muted ? "Dejó de seguir «{title}»" : "Empezó a seguir «{title}»", { title: (await taskLabel(taskId)).title }, { taskId });
    skipTaskEvents();
  });
}

/** Historial de la tarea (quién cambió qué y cuándo); se pide al desplegar la sección. */
export async function getTaskHistory(taskId: string) {
  return runAction({ name: "tasks.getTaskHistory", args: [taskId] }, async () => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    return loadTaskHistory(taskId, await getT());
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
  noteTask(sub.taskId);
  const { task: _task, ...row } = sub;
  return row;
}

export async function addSubtask(taskId: string, title: string) {
  return runAction({ name: "tasks.addSubtask", args: [taskId, title] }, async (): Promise<SubtaskInfo> => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    if ((await db.subtask.count({ where: { taskId } })) >= MAX_SUBTASKS) throw new AppError("Una tarea no puede tener más de 100 subtareas.");
    const last = await db.subtask.findFirst({ where: { taskId }, orderBy: { position: "desc" }, select: { position: true } });
    const sub = await db.subtask.create({
      data: { taskId, title: v.title.parse(title), position: positionBetween(last?.position, null) },
      select: { id: true, title: true, done: true, position: true },
    });
    addUndo({ t: "subtask.remove", id: sub.id });
    describeAction("Añadió la subtarea «{subtask}» en «{task}»", { subtask: sub.title, task: (await taskLabel(taskId)).title }, { taskId });
    return sub;
  });
}

export async function updateSubtask(subtaskId: string, patch: { title?: string; done?: boolean }) {
  return runAction({ name: "tasks.updateSubtask", args: [subtaskId, patch] }, async () => {
    const sub = await assertSubtaskAccess(subtaskId);
    const data = z.object({ title: v.title.optional(), done: z.boolean().optional() }).parse(patch);
    addUndo({ t: "subtask.set", id: sub.id, data: { ...(data.title !== undefined ? { title: sub.title } : {}), ...(data.done !== undefined ? { done: sub.done } : {}) } });
    describeAction(
      data.title !== undefined ? "Renombró la subtarea «{subtask}» a «{to}»" : data.done ? "Marcó la subtarea «{subtask}»" : "Desmarcó la subtarea «{subtask}»",
      { subtask: sub.title, to: data.title ?? "" },
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
    describeAction("Reordenó la subtarea «{subtask}»", { subtask: sub.title }, { subtaskId: sub.id });
    await db.subtask.update({ where: { id: sub.id }, data: { position } });
    return { position };
  });
}

export async function deleteSubtask(subtaskId: string) {
  return runAction({ name: "tasks.deleteSubtask", args: [subtaskId] }, async () => {
    const sub = await assertSubtaskAccess(subtaskId);
    addUndo({ t: "subtask.restore", row: sub });
    describeAction("Borró la subtarea «{subtask}»", { subtask: sub.title }, { subtaskId: sub.id });
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
    noteTask(att.taskId);
    describeAction("Borró el adjunto «{name}» de «{task}»", { name: att.originalName, task: (await taskLabel(att.taskId)).title }, { attachmentId: att.id });
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
    describeAction("Recuperó «{title}» en «{col}»", { title: (await taskLabel(taskId)).title, col: column.name }, { taskId });
    return { task: await loadBoardTask(taskId), columnName: column.name };
  });
}

// --- Comentarios y menciones ---------------------------------------------------

const commentSelect = { id: true, body: true, createdAt: true, authorId: true, parentId: true, author: { select: { name: true } } } as const;

function toCommentInfo(c: { id: string; body: string; createdAt: Date; authorId: string | null; parentId: string | null; author: { name: string } | null }): CommentInfo {
  return { id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), authorId: c.authorId, authorName: c.author?.name ?? null, parentId: c.parentId };
}

const commentBody = z.string().trim().min(1, "El comentario está vacío.").max(10_000, "El comentario es demasiado largo.");

/** `parentId`: comentario al que responde (un solo nivel: si es una respuesta, se cuelga del comentario raíz). */
export async function addComment(taskId: string, body: string, parentId?: string | null) {
  return runAction({ name: "tasks.addComment", args: [taskId, body, parentId] }, async (): Promise<CommentInfo> => {
    const user = await requireUser();
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    const text = commentBody.parse(body);
    if ((await db.taskComment.count({ where: { taskId } })) >= MAX_COMMENTS) throw new AppError("Esta tarea ya tiene el máximo de 1000 comentarios.");
    if (!rateLimit(`comment:${user.id}`, 30, 60_000)) throw new AppError("Demasiados comentarios seguidos. Espera un momento.");
    const parent = parentId ? await db.taskComment.findFirst({ where: { id: v.id.parse(parentId), taskId }, select: { id: true, parentId: true, authorId: true } }) : null;
    if (parentId && !parent) throw new AppError("El comentario al que respondes ya no existe.");
    const comment = await db.taskComment.create({ data: { taskId, authorId: user.id, body: text, parentId: parent ? (parent.parentId ?? parent.id) : null }, select: commentSelect });
    addUndo({ t: "comment.remove", id: comment.id });
    const mentioned = await notifyMentions({ actorId: user.id, taskId, projectId, recipientIds: extractMentionIds(text), text });
    // Quien comenta sigue la tarea. Avisos: respuesta al autor del comentario; comentario a quien la sigue (sin repetir a nadie).
    await followTask(taskId, [user.id]);
    const notified = [user.id, ...mentioned];
    if (parent?.authorId && !notified.includes(parent.authorId)) {
      const { recipients } = await notifyTask({ type: "REPLY", actorId: user.id, taskId, projectId, recipientIds: [parent.authorId], excerpt: makeExcerpt(text) });
      notified.push(...recipients, parent.authorId);
    }
    const followers = await taskFollowerIds(taskId, notified);
    if (followers.length) await notifyTask({ type: "COMMENT", actorId: user.id, taskId, projectId, recipientIds: followers, excerpt: makeExcerpt(text) });
    describeAction(parent ? "Respondió a un comentario en «{title}»" : "Comentó en «{title}»", { title: (await taskLabel(taskId)).title }, { taskId });
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
    noteTask(comment.taskId);
    const { task, ...row } = comment;
    addUndo({ t: "comment.restore", row: { ...row, createdAt: row.createdAt.toISOString(), editedAt: row.editedAt?.toISOString() ?? null } });
    describeAction("Borró un comentario de «{title}»", { title: task.title }, { taskId: row.taskId });
    await db.taskComment.delete({ where: { id: comment.id } });
  });
}

// --- Documentos de Google ------------------------------------------------------

const linkSelect = { id: true, kind: true, title: true, url: true } as const;

/** Crea un Google Doc o Sheet en el Drive del usuario y lo enlaza a la tarea. */
export async function createGoogleFile(taskId: string, kind: GoogleFileKind, title: string) {
  return runAction({ name: "tasks.createGoogleFile", args: [taskId, kind, title] }, async (): Promise<TaskLinkInfo> => {
    const user = await requireUser();
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    if (!rateLimit(`google-file:${user.id}`, 20, 60_000)) throw new AppError("Demasiados documentos creados seguidos. Espera un minuto.");
    const fileKind = z.enum(["GOOGLE_DOC", "GOOGLE_SHEET"]).parse(kind);
    const name = v.title.parse(title);
    // En un proyecto privado el documento no se comparte con todo el dominio, solo con los miembros del proyecto.
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { isPrivate: true, members: { where: { user: { active: true }, userId: { not: user.id } }, select: { user: { select: { email: true } } } } },
    });
    const share = project?.isPrivate ? ({ type: "users", emails: project.members.map((m) => m.user.email) } as const) : ({ type: "domain" } as const);
    const file = await createDriveFile(user.id, fileKind, name, share);
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
    noteTask(link.taskId);
    const { task: _task, ...row } = link;
    addUndo({ t: "link.restore", row: { ...row, createdAt: row.createdAt.toISOString() } });
    describeAction("Quitó el enlace «{title}»", { title: row.title }, { taskId: row.taskId });
    await db.taskLink.delete({ where: { id: link.id } });
  });
}
