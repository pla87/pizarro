"use server";

import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { forgetAttachments, forgetTaskAttachments } from "@/lib/attachment-cache";
import { runAction } from "@/lib/action";
import { assertAssignable, assertNotArchived, assertNotArchivedRow, assertProjectAccess, assertTaskAccess, loadTaskWithAccess, visibleProjectsWhere } from "@/lib/access";
import { appTimeZone, attachmentTotals, listKinds, loadBoardTask, loadBoardTasksByIds, projectClients, projectUsers } from "@/lib/board";
import { MAX_BULK_TASKS } from "@/lib/bulk";
import { MAX_SUBTASKS, MAX_TITLE, MAX_TITLE_UNITS } from "@/lib/constants";
import { clampTitle, graphemeCount } from "@/lib/title-clamp";
import { describeAction, noteProject, noteTask, recordTaskEvent, skipTaskEvents, trackUndoEntry } from "@/lib/action-context";
import { assertCanBlock, blockProblem, lockBlocking } from "@/lib/blocking";
import { addUndo, captureTasks, entriesMayBeTrimmed, snapshotTasks, TASK_UNDO_SELECT, taskSetOp, touchEverything, touchedTask, type OthersActivity, type TaskField, type UndoOp } from "@/lib/undo";
import { subtasksN, tasksN, type Label } from "@/lib/undo-label";
import { AppError, notFound } from "@/lib/errors";
import { needsRebalance, positionBetween, POSITION_STEP } from "@/lib/positions";
import { lastPositionIn, lockColumns, lockTaskRows, placeBlockInColumn, placeInColumn, resolvePositionTies, setTaskColumnPositions, TASK_ORDER } from "@/lib/task-positions";
import { rateLimit } from "@/lib/rate-limit";
import { assertTaskCapacity, assertTaskCreateRate } from "@/lib/caps";
import { getMaxCommentsPerTask } from "@/lib/app-settings";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";
import { dateToIso, isoToDate, todayIso } from "@/lib/dates";
import { normalizeRecurrence, RECURRENCES } from "@/lib/recurrence-date";
import { spawnRecurrences } from "@/lib/recurrence";
import { createDriveFile, type GoogleFileKind } from "@/lib/google";
import { shareRule } from "@/lib/google-share";
import { excerpt as makeExcerpt, extractMentionIds, mentionsToPlain } from "@/lib/mentions";
import { ACCENTED, foldedContains, UNACCENTED } from "@/lib/search-accents";
import { dropPendingDueChanges, queueDueChange } from "@/lib/due-notices";
import { assignedBatchExcerpt } from "@/lib/notification-text";
import { commentNoticesWhere, followTask, notifyMentions, notifyTask, taskFollowerIds } from "@/lib/notify";
import { isFollowing } from "@/lib/followers";
import { loadTaskHistory } from "@/lib/task-events";
import { localizeGeneralKinds } from "@/lib/kinds-localize";
import { normalizeTaskFields } from "@/lib/task-fields";
import { assertFieldsEnabled, assertStartBeforeDue, enabledTaskFields, fieldData, fieldKeyOf, onlyChangedFields, patchedFieldKeys, pickTaskFields, taskFieldSchema, taskFieldShape } from "@/lib/task-field-input";
import { effectiveFileMaxMb } from "@/lib/upload-size";
import { textConflicts, type TextSince } from "@/lib/text-version";
import type { ArchivedTask, BoardTask, CommentInfo, ProjectFormData, SubtaskInfo, TaskDetail, TaskLinkInfo } from "@/lib/types";
import { getLocale, getT } from "@/i18n/server";
import { intlLocale } from "@/i18n/core";
import { copyTaskAttachments, type AttachmentCopyResult } from "@/lib/attachment-copy";
import { remapAttachmentRefs } from "@/lib/attachment-refs";
import { mbNumber, quotaError } from "@/lib/quota-message";

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

/** Texto de la cadencia de una tarea fija, para el historial. */
function evergreenEveryLabel(every: number): Label {
  return { k: every === 2 ? "Cada dos" : every === 3 ? "Cada tres" : "En todas" };
}

async function columnName(columnId: string): Promise<string> {
  return (await db.column.findUnique({ where: { id: columnId }, select: { name: true } }))?.name ?? "?";
}

const CHANGE_LABELS: Record<string, string> = {
  title: "título", description: "descripción", kindId: "tipo", color: "color", linkUrl: "enlace",
  assigneeId: "responsable", labelIds: "etiquetas", dueDate: "fecha límite", deliverableId: "entregable", evergreen: "fija en la release", evergreenEvery: "cadencia en la release",
  recurrence: "repetición", recurrenceDay: "repetición",
  cost: "coste", costPaid: "pago", estimatedHours: "horas estimadas", actualHours: "horas reales", priority: "prioridad",
  client: "cliente", startDate: "fecha de inicio", blockedById: "bloqueo",
};

/** «tipo, responsable y fecha límite» a partir de los campos cambiados. */
function describeChanges(data: Record<string, unknown>): Label {
  const names: Label[] = [...new Set(Object.keys(data).filter((k) => data[k] !== undefined).map((k) => CHANGE_LABELS[k] ?? k))].map((k) => ({ k }));
  if (names.length <= 1) return names[0] ?? { k: "sin cambios" };
  return { k: "{list} y {last}", p: { list: names.slice(0, -1), last: names.at(-1)! } };
}

/** Límites por tarea / usuario, para que nadie sature la base de datos ni la API de Google (y MAX_SUBTASKS, en constants). */
/** Comentarios que trae la tarea al abrirla, y los que añade cada «Ver anteriores». */
const COMMENTS_FIRST_PAGE = 20;
const COMMENTS_MORE_PAGE = 100;

/** Campos que cambian al archivar o recuperar una tarea. */
const ARCHIVE_FIELDS: TaskField[] = ["archivedAt", "archivedFromColumnId", "columnId", "position", "evergreen", "evergreenEvery"];

/** Caracteres a los que se recortó el título que llegó demasiado largo (para el aviso del cliente; menos de 210 si mandó el tope de unidades); undefined si cupo. */
function clipOf(raw: unknown): number | undefined {
  const c = typeof raw === "string" ? clampTitle(raw.trim()) : null;
  return c?.clipped ? (c.limit ?? MAX_TITLE) : undefined;
}

/** Tarea del tablero con el aviso de título recortado, solo si se recortó (el cliente lo muestra y no lo guarda). */
function withClip<T extends object>(task: T, clip: number | undefined): T & { titleClipped?: number } {
  return clip ? { ...task, titleClipped: clip } : task;
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
  /** Repetir (como en el detalle): el día se deja coherente con la regla al guardar. */
  recurrence: z.enum(RECURRENCES).default("NONE"),
  recurrenceDay: z.number().int().min(1).max(31).nullable().default(null),
  subtasks: z.array(v.title).max(50).default([]),
  ...taskFieldShape,
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
    const optional = pickTaskFields(data);
    if (patchedFieldKeys(optional).length) {
      const enabled = await enabledTaskFields(data.projectId);
      await assertFieldsEnabled(enabled, optional);
      assertStartBeforeDue(enabled, data.startDate, data.dueDate);
    }
    // Solo se admite evergreen en la columna de la release.
    const evergreen = data.evergreen && (await db.column.count({ where: { id: data.columnId, role: "NEXT_RELEASE" } })) > 0;
    const repeat = normalizeRecurrence(data.recurrence, data.recurrenceDay, data.dueDate, todayIso(appTimeZone()));
    assertTaskCreateRate(user.id);
    const task = await db.$transaction(async (tx) => {
      await assertTaskCapacity(tx, data.projectId);
      // Al final de la columna, con la columna bloqueada: dos altas a la vez no comparten posición.
      await lockColumns(tx, [data.columnId]);
      const position = positionBetween(await lastPositionIn(tx, data.columnId), null);
      return tx.task.create({
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
          ...repeat,
          ...fieldData(optional),
          position,
          createdById: user.id,
          labels: { create: [...new Set(data.labelIds)].map((labelId) => ({ labelId })) },
          // Subtareas iniciales en el orden recibido (misma transacción que la tarea).
          subtasks: { create: data.subtasks.map((title, i) => ({ title, position: (i + 1) * POSITION_STEP })) },
        },
        select: { id: true },
      });
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
    return withClip(await loadBoardTask(task.id), clipOf(input.title));
  });
}

/**
 * Opciones de un proyecto para crear una tarea desde otro tablero: columnas, tipos (con las reglas de los
 * generales y su traducción), entregables, personas asignables y límites de adjuntos. Exige acceso al proyecto.
 */
export async function getProjectFormData(projectId: string) {
  return runAction({ name: "tasks.getProjectFormData", args: [projectId] }, async (): Promise<ProjectFormData> => {
    const user = await requireUser();
    const id = v.id.parse(projectId);
    await assertProjectAccess(user, id);
    const project = await db.project.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, isPrivate: true, taskAttachMaxMb: true, fileMaxMb: true, taskFields: true } });
    const [columns, users, deliverables, kinds, locale, labels, clients] = await Promise.all([
      db.column.findMany({ where: { projectId: id }, orderBy: { position: "asc" }, select: { id: true, name: true, position: true, role: true, isDone: true, waitingDays: true, routineTargetColumnId: true, wipLimit: true } }),
      projectUsers(id, project),
      db.deliverable.findMany({ where: { projectId: id }, orderBy: [{ position: "asc" }], select: { id: true, name: true, dueDate: true } }),
      listKinds(id),
      getLocale(),
      db.label.findMany({ where: { projectId: id }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
      project.taskFields.includes("client") ? projectClients(id) : [],
    ]);
    return {
      project: { id: project.id, name: project.name, attachMaxMb: project.taskAttachMaxMb, fileMaxMb: effectiveFileMaxMb(project.fileMaxMb), taskFields: normalizeTaskFields(project.taskFields) },
      columns,
      users,
      kinds: localizeGeneralKinds(kinds, locale),
      deliverables: deliverables.map((d) => ({ id: d.id, name: d.name, dueDate: dateToIso(d.dueDate) })),
      labels,
      clients,
    };
  });
}

const createManySchema = z.object({
  projectId: v.id,
  columnId: v.id,
  tasks: z.array(z.object({ title: v.taskTitle, kindId: v.id })).min(1, "No hay tareas que crear.").max(MAX_BULK_TASKS, "Máximo 100 tareas de una vez."),
  assigneeId: v.id.nullable().default(null),
  labelIds: z.array(v.id).max(20).default([]),
  dueDate: v.dayIso.default(null),
  deliverableId: v.id.nullable().default(null),
  /** Campos opcionales que admite el alta masiva (si el proyecto los tiene activados). */
  priority: v.taskPriority.optional(),
  client: v.taskClient.optional(),
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
    const optional = pickTaskFields({ priority: data.priority, client: data.client });
    if (patchedFieldKeys(optional).length) await assertFieldsEnabled(await enabledTaskFields(data.projectId), optional);
    const labelIds = [...new Set(data.labelIds)];
    const dueDate = data.dueDate ? isoToDate(data.dueDate) : null;
    const templates = new Map<string, string[]>();
    if (data.applySubtaskTemplates) {
      const kinds = await db.taskKind.findMany({ where: { id: { in: [...new Set(data.tasks.map((t) => t.kindId))] } }, select: { id: true, subtaskTemplate: true } });
      for (const k of kinds) if (k.subtaskTemplate.length) templates.set(k.id, k.subtaskTemplate);
    }
    assertTaskCreateRate(user.id, data.tasks.length);
    const ids = await db.$transaction(async (tx) => {
      // Todo o nada: si el lote no cabe, no se crea ninguna.
      await assertTaskCapacity(tx, data.projectId, data.tasks.length);
      await lockColumns(tx, [data.columnId]);
      let position = await lastPositionIn(tx, data.columnId);
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
            ...fieldData(optional),
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
    // Un solo aviso para todo el lote (enlaza a la primera tarea), como createTask pero sin inundar al responsable.
    if (data.assigneeId && ids[0]) {
      await notifyTask({ type: "ASSIGNED", actorId: user.id, taskId: ids[0], projectId: data.projectId, recipientIds: [data.assigneeId], excerpt: ids.length === 1 ? makeExcerpt(data.tasks[0]!.title) : assignedBatchExcerpt(ids.length) });
    }
    const rows = await loadBoardTasksByIds(ids);
    // `ids` conserva el orden de entrada (la tarea i es la línea i): ahí se sabe qué título llegó demasiado largo.
    const clips = new Map(ids.map((id, i) => [id, clipOf(input.tasks[i]?.title)] as const));
    return rows.map((row) => withClip(row, clips.get(row.id)));
  });
}

/**
 * Duplica una tarea: copia título (con « (copia)»), tipo, descripción, etiquetas, responsable, fecha límite,
 * entregable, color, enlace, subtareas (sin marcar), documentos de Google enlazados (el mismo documento, no una copia
 * en Drive) y adjuntos (cada uno con su propio fichero: ver attachment-copy.ts; las imágenes de la descripción pasan a
 * apuntar a esas copias); no copia comentarios, historial ni repetición. Los adjuntos que no caben (tope por tarea,
 * cuotas) o cuyo fichero falta se omiten y la respuesta lleva `copyNotice`, el aviso para quien duplica.
 * Queda justo detrás de la original en su columna o, con `target` (Ctrl/Alt al soltar una tarjeta arrastrada),
 * en esa columna entre las vecinas indicadas, como moveTask. Se deshace de una vez (borra la copia; los ficheros de sus
 * adjuntos se conservan mientras se pueda rehacer y después se borran, como al borrar una tarea).
 */
const duplicateTargetSchema = z.object({ columnId: v.id, prevId: v.id.nullable(), nextId: v.id.nullable() }).nullable().default(null);

export async function duplicateTask(taskId: string, target?: z.input<typeof duplicateTargetSchema>) {
  return runAction({ name: "tasks.duplicateTask", args: [taskId, target] }, async () => {
    const user = await requireUser();
    if (!rateLimit(`duplicate:${user.id}`, 60, 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const task = await loadTaskWithAccess(user, v.id.parse(taskId), { archivedAt: true });
    const { projectId } = task;
    const dest = duplicateTargetSchema.parse(target);
    assertTaskCreateRate(user.id);
    assertNotArchivedRow(task);
    if (dest) await assertColumnInProject(dest.columnId, projectId);
    const src = await db.task.findUniqueOrThrow({
      where: { id: taskId },
      select: {
        title: true, description: true, kindId: true, color: true, linkUrl: true, assigneeId: true, dueDate: true, deliverableId: true,
        cost: true, costPaid: true, estimatedHours: true, actualHours: true, priority: true, client: true, startDate: true,
        columnId: true, blockedById: true,
        labels: { select: { labelId: true } },
        subtasks: { orderBy: { position: "asc" }, select: { title: true, position: true } },
        links: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, title: true, url: true, externalId: true, createdById: true, shareStatus: true, shareFailed: true, createdAt: true } },
      },
    });
    const t = await getT();
    const suffix = ` ${t("(copia)")}`;
    // Si no cabe, se recorta el original (caracteres visibles, sin partir emojis ni menciones) y se conserva «(copia)».
    const title = `${clampTitle(src.title, MAX_TITLE - graphemeCount(suffix), MAX_TITLE_UNITS - suffix.length).value}${suffix}`;
    const columnId = dest?.columnId ?? src.columnId;
    const copy = await db.$transaction(async (tx) => {
      await assertTaskCapacity(tx, projectId);
      await lockColumns(tx, [columnId]);
      // Sin destino, entre la original y la siguiente de su columna; con destino, donde se soltó (si las
      // posiciones se agotan, se renumera la columna). La original cuenta como una tarea más de la columna.
      const { position } = dest
        ? await placeInColumn(tx, columnId, dest.prevId, dest.nextId)
        : await placeInColumn(tx, columnId, taskId, null);
      return tx.task.create({
        data: {
          projectId,
          columnId,
          title,
          description: src.description,
          kindId: src.kindId,
          color: src.color,
          linkUrl: src.linkUrl,
          assigneeId: src.assigneeId,
          dueDate: src.dueDate,
          deliverableId: src.deliverableId,
          cost: src.cost, costPaid: src.costPaid, estimatedHours: src.estimatedHours, actualHours: src.actualHours,
          priority: src.priority, client: src.client, startDate: src.startDate,
          // La copia queda bloqueada por la misma tarea que la original.
          blockedById: src.blockedById,
          position,
          createdById: user.id,
          labels: { create: src.labels.map((l) => ({ labelId: l.labelId })) },
          subtasks: { create: src.subtasks.map((s) => ({ title: s.title, position: s.position })) },
          // El enlace apunta al mismo documento de Drive: quitarlo de una de las dos no lo borra de Drive ni de la otra.
          links: { create: src.links },
        },
        select: { id: true },
      });
    });
    addUndo({ t: "task.remove", id: copy.id });
    if (columnId === src.columnId) describeAction("Duplicó «{title}»", { title: src.title }, { taskId: copy.id });
    else describeAction("Duplicó «{title}» en «{col}»", { title: src.title, col: await columnName(columnId) }, { taskId: copy.id });
    // Después de crear la tarea (los ficheros pueden tardar): lo que no se copie se avisa, pero la copia ya existe.
    const copied = await copyTaskAttachments(taskId, copy.id);
    // Las imágenes de la descripción (`![…](/api/attachments/<id>)`) apuntan a los adjuntos de la original: en la copia,
    // a sus propias copias. Si no, borrar el adjunto (o la tarea) original dejaba la imagen rota en la copia.
    const description = remapAttachmentRefs(src.description, copied.ids);
    if (description !== src.description) await db.task.updateMany({ where: { id: copy.id, description: src.description }, data: { description } });
    const notice = await copyNoticeText(copied, projectId, user.role === "ADMIN");
    const row: BoardTask & { copyNotice?: string } = await loadBoardTask(copy.id);
    return notice ? { ...row, copyNotice: notice } : row;
  });
}

/** Aviso de los adjuntos que no se copiaron al duplicar (null si se copiaron todos). */
async function copyNoticeText(res: AttachmentCopyResult, projectId: string, isAdmin: boolean): Promise<string | null> {
  if (!res.skipped.length) return null;
  const t = await getT();
  const locale = intlLocale(await getLocale());
  const shown = res.skipped.slice(0, 3).map((s) => `«${s.name}»`).join(", ");
  const names = res.skipped.length > 3 ? t("{names} y {n} más", { names: shown, n: res.skipped.length - 3 }) : shown;
  const parts = [res.skipped.length === 1 ? t("No se ha copiado un adjunto: {names}.", { names }) : t("No se han copiado {n} adjuntos: {names}.", { n: res.skipped.length, names })];
  const why = new Set(res.skipped.map((s) => s.reason));
  if (why.has("task_total") && res.taskLimitMb != null) {
    parts.push(t("No caben en el máximo de adjuntos por tarea del proyecto ({limit} MB).", { limit: mbNumber(res.taskLimitMb, locale) }));
  }
  if (why.has("quota") && res.quota) parts.push(quotaError(t, res.quota, { projectId, isAdmin, locale }).message);
  if (why.has("missing")) parts.push(t("El archivo de la tarea original ya no estaba disponible."));
  if (why.has("error")) parts.push(t("No se pudieron guardar en el servidor; inténtalo de nuevo más tarde."));
  return parts.join(" ");
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
  /** Cadencia de la tarea fija: 1 = todas las releases, 2 = las pares, 3 = múltiplos de 3. */
  evergreenEvery: z.number().int().min(1).max(3).optional(),
  recurrence: z.enum(RECURRENCES).optional(),
  recurrenceDay: z.number().int().min(1).max(31).nullable().optional(),
  /** Tarea del mismo proyecto que bloquea a esta (null = sin bloqueo). */
  blockedById: v.id.nullable().optional(),
});

/** Anota en el historial qué ha cambiado realmente al editar la tarea (una línea por cambio). */
async function recordUpdateEvents(
  taskId: string,
  prev: { title: string; description: string; kindId: string; assigneeId: string | null; dueDate: Date | null; color: string | null; linkUrl: string | null; deliverableId: string | null; evergreen: boolean; evergreenEvery: number; blockedById: string | null },
  data: z.infer<typeof updateSchema>,
  dueDate: string | null | undefined,
  optional: Record<string, unknown> = {},
) {
  const add = (label: Label) => recordTaskEvent(taskId, "update", label);
  if (data.title !== undefined && data.title !== prev.title) add({ k: "Cambió el título de «{from}» a «{to}»", p: { from: mentionsToPlain(prev.title), to: mentionsToPlain(data.title) } });
  if (data.description !== undefined && data.description !== prev.description) add({ k: "Editó la descripción" });
  if (data.kindId !== undefined && data.kindId !== prev.kindId) {
    const kinds = await db.taskKind.findMany({ where: { id: { in: [prev.kindId, data.kindId] } }, select: { id: true, name: true } });
    const name = (id: string) => kinds.find((k) => k.id === id)?.name;
    add({ k: "Cambió el tipo de «{from}» a «{to}»", p: { from: name(prev.kindId) ?? "?", to: name(data.kindId) ?? "?" } });
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
  if (data.evergreenEvery !== undefined && data.evergreenEvery !== prev.evergreenEvery && (data.evergreen ?? prev.evergreen)) {
    add({ k: "Cambió la cadencia en la release a «{to}»", p: { to: evergreenEveryLabel(data.evergreenEvery) } });
  }
  if (data.blockedById !== undefined && data.blockedById !== prev.blockedById) {
    if (data.blockedById) {
      const by = await db.task.findUnique({ where: { id: data.blockedById }, select: { title: true } });
      add({ k: "Marcó la tarea como bloqueada por «{title}»", p: { title: by ? mentionsToPlain(by.title) : "?" } });
    } else add({ k: "Quitó el bloqueo de la tarea" });
  }
  if (data.labelIds !== undefined) others.labelIds = true;
  for (const k of Object.keys(optional)) others[k] = true;
  if (Object.keys(others).length) add({ k: "Cambió {changes}", p: { changes: describeChanges(others) } });
  // Sin cambios reales (p. ej. se guardó el mismo texto): ni siquiera la línea genérica.
  skipTaskEvents();
}

/** `since` llega del navegador: una versión (cadena o null) o una versión con las huellas del texto (ver text-version.ts). */
const sinceSchema = z.union([
  z.string().max(64),
  z.null(),
  z.object({ version: z.string().max(64).nullable(), title: z.string().max(16).optional(), description: z.string().max(16).optional() }).strict(),
]).optional();

/**
 * 409 si el texto ha cambiado después de `since` (la versión del texto que se está editando, `textVersion`). Con las
 * huellas del título y la descripción editados, solo si cambió el mismo campo que se guarda (`patch`): otra persona que
 * cambia solo la descripción no impide guardar el título (ver textConflicts). Cuenta también un cambio de la misma
 * persona: desde otra pestaña u otro dispositivo pisaría lo guardado allí sin aviso. Los guardados seguidos de una misma
 * pestaña no chocan porque cada uno envía la versión (y el texto) que devolvió el anterior (ver `save` en TaskDialog).
 */
async function assertNoTextConflict(
  taskId: string,
  row: { contentUpdatedAt: Date | null; contentUpdatedById: string | null; title?: string; description?: string },
  userId: string,
  since: string | null | TextSince | undefined,
  patch: { title?: unknown; description?: unknown },
  client: Prisma.TransactionClient = db,
) {
  const fields = textConflicts(row, since ?? null, patch);
  if (!fields.length) return;
  const t = await getT();
  // Quién cambió el campo: el último que cambió el texto, salvo que fuera quien guarda (su guardado del otro campo pasó
  // después del cambio ajeno); entonces, el último que cambió ese campo según el historial.
  let whoId = row.contentUpdatedById;
  if (whoId === userId && since !== null && typeof since === "object") {
    const labels = fields.map((f) => (f === "title" ? '{"k":"Cambió el título de ' : '{"k":"Editó la descripción"'));
    const last = await client.taskEvent.findFirst({ where: { taskId, OR: labels.map((l) => ({ label: { startsWith: l } })) }, orderBy: { createdAt: "desc" }, select: { userId: true } });
    if (last?.userId) whoId = last.userId;
  }
  if (whoId === userId) {
    throw new AppError(t("Has cambiado el texto de esta tarea en otra pestaña u otro dispositivo mientras la editabas aquí. Se ha recargado con ese texto: vuelve a aplicar tus cambios."), 409);
  }
  const who = whoId ? (await client.user.findUnique({ where: { id: whoId }, select: { name: true } }))?.name : null;
  throw new AppError(who ? t("{who} ha cambiado el texto de esta tarea mientras la editabas. Se ha recargado con sus cambios: vuelve a aplicar los tuyos.", { who }) : t("Otra persona ha cambiado el texto de esta tarea mientras la editabas. Se ha recargado con sus cambios: vuelve a aplicar los tuyos."), 409);
}

/**
 * `since`: versión del título/descripción que se está editando (`textVersion`), con las huellas del texto editado si se
 * conocen (ver text-version.ts). Si después ha cambiado el campo que se guarda (otra persona, u otra pestaña o
 * dispositivo de la misma), no se pisa: se avisa para recargar.
 */
export async function updateTask(taskId: string, patch: z.input<typeof updateSchema> & z.input<typeof taskFieldSchema>, since?: string | null | TextSince) {
  return runAction({ name: "tasks.updateTask", args: [taskId, patch, since] }, async () => {
    const user = await requireUser();
    since = sinceSchema.parse(since);
    const data = updateSchema.parse(patch);
    const optionalIn = taskFieldSchema.parse(patch);
    // Una sola lectura de la tarea (con el permiso) para todo lo que sigue: archivada, conflicto de edición,
    // fija, repetición, valores para deshacer y valores anteriores para el historial y los avisos.
    // Las relaciones (etiquetas) van en una consulta aparte en paralelo: como relación, Prisma la haría después.
    const id = v.id.parse(taskId);
    const [task, labels] = await Promise.all([
      loadTaskWithAccess(user, id, { id: true, ...TASK_UNDO_SELECT }),
      data.labelIds !== undefined ? db.taskLabel.findMany({ where: { taskId: id }, select: { labelId: true } }) : undefined,
    ]);
    const { projectId } = task;
    assertNotArchivedRow(task);
    const editsText = data.title !== undefined || data.description !== undefined;
    const checkConflict = editsText && since !== undefined;
    // Comprobación rápida (sin candado); la definitiva se repite dentro de la transacción con la fila bloqueada.
    if (checkConflict) await assertNoTextConflict(id, task, user.id, since, data);
    // Las comprobaciones van a la vez; si fallan varias, gana la primera en el orden de siempre.
    const checks = await Promise.allSettled([
      data.assigneeId ? assertAssignable(projectId, data.assigneeId) : null,
      data.labelIds ? assertLabelsInProject(data.labelIds, projectId) : null,
      assertDeliverableInProject(data.deliverableId, projectId),
      assertKindsInProject([data.kindId], projectId),
      data.blockedById ? assertCanBlock(id, data.blockedById, projectId) : null,
      // Evergreen solo tiene sentido en la columna de la release.
      data.evergreen ? db.column.count({ where: { id: task.columnId, role: "NEXT_RELEASE" } }).then((ok) => {
        if (!ok) throw new AppError("Solo las tareas de la columna de la release pueden ser fijas.");
      }) : null,
    ]);
    for (const c of checks) if (c.status === "rejected") throw c.reason;
    // Campos opcionales: solo los que cambian de verdad y solo los que el proyecto tiene activados.
    const optional = onlyChangedFields(task, optionalIn);
    if (patchedFieldKeys(optional).length || optionalIn.startDate !== undefined || data.dueDate !== undefined) {
      const enabled = await enabledTaskFields(projectId);
      await assertFieldsEnabled(enabled, optional);
      if (optionalIn.startDate !== undefined || data.dueDate !== undefined) {
        assertStartBeforeDue(enabled, optionalIn.startDate !== undefined ? optionalIn.startDate : dateToIso(task.startDate), data.dueDate !== undefined ? data.dueDate : dateToIso(task.dueDate));
      }
    }
    const { labelIds, dueDate, recurrence, recurrenceDay, ...rest } = data;
    // La cadencia solo existe en una tarea fija: al dejar de serlo (o si no lo es) vuelve a 1.
    const stillFixed = data.evergreen ?? task.evergreen;
    if (!stillFixed && (data.evergreenEvery !== undefined || task.evergreenEvery !== 1)) rest.evergreenEvery = 1;
    // Repetición: el día se deja coherente con la regla (semanal 1-7, mensual 1-31) y, si falta, sale de la fecha límite o de hoy.
    let repeat: { recurrence: (typeof RECURRENCES)[number]; recurrenceDay: number | null } | null = null;
    if (recurrence !== undefined || recurrenceDay !== undefined) {
      const rule = recurrence ?? task.recurrence;
      const day = recurrenceDay !== undefined ? recurrenceDay : recurrence !== undefined && recurrence !== task.recurrence ? null : task.recurrenceDay;
      repeat = normalizeRecurrence(rule, day, dueDate !== undefined ? dueDate : dateToIso(task.dueDate), todayIso(appTimeZone()));
    }
    const fields = {
      ...rest,
      ...(repeat ?? {}),
      ...fieldData(optional),
      ...(dueDate !== undefined ? { dueDate: dueDate ? isoToDate(dueDate) : null } : {}),
      ...(editsText ? { contentUpdatedAt: new Date(), contentUpdatedById: user.id } : {}),
    };
    const changed = Object.keys(fields).filter((k) => k !== "labelIds") as TaskField[];
    addUndo(taskSetOp(task, changed, labels));
    const prev = task;
    const newMentions = await db.$transaction(async (tx) => {
      // Bloqueo: la comprobación de antes vale para el mensaje rápido, pero la definitiva va aquí, con el candado del
      // proyecto, junto a la escritura (dos bloqueos A → B y B → A a la vez no pueden cerrar un ciclo).
      if (data.blockedById) {
        await lockBlocking(tx, projectId);
        await assertCanBlock(id, data.blockedById, projectId, tx);
      }
      // Menciones nuevas en la descripción (las que ya estaban no vuelven a avisar).
      // Se lee la versión anterior con bloqueo de fila para que dos ediciones simultáneas no avisen dos veces.
      // Con la misma fila bloqueada se repite la comprobación de conflicto: dos guardados casi a la vez pasan los dos
      // la de fuera, pero aquí el segundo ya ve el texto del primero y recibe el 409.
      let added: string[] = [];
      if (data.description !== undefined || checkConflict) {
        const [before] = await tx.$queryRaw<{ title: string; description: string; contentUpdatedAt: Date | null; contentUpdatedById: string | null }[]>`SELECT "title", "description", "contentUpdatedAt", "contentUpdatedById" FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`;
        if (checkConflict && before) await assertNoTextConflict(id, before, user.id, since, data, tx);
        if (data.description !== undefined) {
          const old = new Set(extractMentionIds(before?.description ?? ""));
          added = extractMentionIds(data.description).filter((id) => !old.has(id));
        }
      }
      await tx.task.update({ where: { id: taskId }, data: fields });
      if (labelIds) {
        await tx.taskLabel.deleteMany({ where: { taskId } });
        await tx.taskLabel.createMany({ data: [...new Set(labelIds)].map((labelId) => ({ taskId, labelId })) });
      }
      return added;
    });
    describeAction("Modificó «{title}»: {changes}", { title: mentionsToPlain(data.title ?? prev.title), changes: describeChanges({ ...data, ...optional }) }, { taskId });
    await recordUpdateEvents(taskId, prev, data, dueDate, optional);
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
    // Cambio de fecha: no avisa al instante, sino tras unos minutos sin más cambios y con la fecha final
    // (due-notices.ts). Al cambiar de responsable se descarta lo pendiente de quien ya no lo es.
    if (assigneeChanged) await dropPendingDueChanges(taskId, data.assigneeId);
    if (dueDate !== undefined && dueDate !== oldDue && assigneeNow && !assigneeChanged) {
      await queueDueChange({ taskId, recipientId: assigneeNow, actorId: user.id, from: oldDue, to: dueDate });
    }
    return withClip(await loadBoardTask(taskId), clipOf(patch.title));
  });
}

/**
 * Mueve una tarjeta entre dos vecinas (por id) de la columna destino. Si entre ellas hay tareas que el cliente
 * no ve (fijas, archivadas, recién llegadas), queda justo detrás de `prevId`; nunca con la posición de otra.
 */
export async function moveTask(taskId: string, columnId: string, prevId: string | null, nextId: string | null) {
  return runAction({ name: "tasks.moveTask", args: [taskId, columnId, prevId, nextId] }, async () => {
    const user = await requireUser();
    const id = v.id.parse(taskId);
    // Es la acción más frecuente del tablero: la tarea (con el permiso) y la columna destino se leen
    // a la vez, y los errores se lanzan después en el mismo orden que si se comprobaran uno a uno.
    const col = v.id.safeParse(columnId);
    // La columna actual va en su propia consulta (en paralelo) en vez de como relación de la tarea, que Prisma
    // resolvería con otra consulta después. Las vecinas se leen después, con la columna destino bloqueada.
    const columnSelect = { id: true, name: true, isDone: true } as const;
    const [task, current, target] = await Promise.all([
      loadTaskWithAccess(user, id, { archivedAt: true, title: true, position: true, evergreen: true, evergreenEvery: true }),
      db.column.findFirst({ where: { tasks: { some: { id } } }, select: columnSelect }),
      col.success ? db.column.findUnique({ where: { id: col.data }, select: { projectId: true, name: true, isDone: true } }) : null,
    ]);
    const { projectId, columnId: fromColumnId } = task;
    assertNotArchivedRow(task);
    // Si la tarjeta ha cambiado de columna entre las dos lecturas, se lee la que corresponde (rarísimo).
    const from = current?.id === fromColumnId ? current : await db.column.findUniqueOrThrow({ where: { id: fromColumnId }, select: columnSelect });
    v.id.parse(columnId);
    if (target?.projectId !== projectId) throw new AppError("La columna no existe.");
    prevId = v.id.nullable().parse(prevId);
    nextId = v.id.nullable().parse(nextId);
    const before = { title: mentionsToPlain(task.title), column: from.name };
    // Sin vecinas (selector «Columna» del detalle, o columna vacía) o con una que ya no está: al final, como la pinta el tablero.
    const { position, undoPosition } = await db.$transaction(async (tx) => {
      await lockColumns(tx, [columnId]);
      const placed = await placeInColumn(tx, columnId, prevId === taskId ? null : prevId, nextId === taskId ? null : nextId, taskId);
      // Deshacer: la posición ya leída, salvo si se ha renumerado su propia columna (la habrá movido).
      const undoPosition = placed.rebalanced && fromColumnId === columnId
        ? (await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: { position: true } })).position
        : task.position;
      await tx.task.update({ where: { id: taskId }, data: { columnId, position: placed.position, evergreen: false, evergreenEvery: 1 } });
      return { position: placed.position, undoPosition };
    });
    addUndo({ t: "task.set", id: taskId, data: { columnId: fromColumnId, position: undoPosition, evergreen: task.evergreen, ...(task.evergreen ? { evergreenEvery: task.evergreenEvery } : {}) } });
    // Recurrente que llega a una columna terminada: nace la siguiente aparición.
    const spawned = target.isDone && !from.isDone ? await spawnRecurrences([taskId], user.id) : [];
    const to = target.name;
    describeAction(
      before.column === to ? "Reordenó «{title}» en «{to}»" : "Movió «{title}» de «{from}» a «{to}»",
      { title: before.title, from: before.column, to },
      { taskId },
    );
    // Historial: solo si cambia de columna (reordenar dentro de la misma no cuenta). «done» alimenta el resumen diario.
    if (before.column === to) skipTaskEvents();
    else recordTaskEvent(taskId, target.isDone ? "done" : "move", { k: "Movió la tarea de «{from}» a «{to}»", p: { from: before.column, to } });
    return { position, spawned };
  });
}

/**
 * Mueve varias tarjetas al final de una columna, conservando su orden relativo («Mover a…» de la barra de selección).
 * Con `at` (arrastrar una selección, o Alt+flechas sobre ella) las deja seguidas entre esas dos vecinas de la columna
 * destino, en el orden del tablero (columna y posición), también las que ya estaban en ella; las mismas reglas que
 * moveTask si las vecinas ya no están (al final). Un solo paso de deshacer en los dos casos.
 */
export async function moveTasks(taskIds: string[], columnId: string, at?: { prevId: string | null; nextId: string | null } | null) {
  return runAction({ name: "tasks.moveTasks", args: [taskIds, columnId, at] }, async () => {
    const user = await requireUser();
    const ids = z.array(v.id).min(1).max(500).parse(taskIds);
    const place = at == null ? null : z.object({ prevId: v.id.nullable(), nextId: v.id.nullable() }).parse(at);
    const column = await db.column.findFirst({
      where: { id: v.id.parse(columnId), project: visibleProjectsWhere(user) },
      select: { id: true, projectId: true, name: true, isDone: true },
    });
    if (!column) throw notFound();
    noteProject(column.projectId);
    const tasks = await db.task.findMany({
      where: { id: { in: ids }, projectId: column.projectId, archivedAt: null },
      orderBy: [{ column: { position: "asc" } }, ...TASK_ORDER],
      select: { id: true, columnId: true, column: { select: { isDone: true } } },
    });
    // En bloque entre dos vecinas también se recolocan las que ya estaban en la columna.
    const toMove = place ? tasks : tasks.filter((t) => t.columnId !== column.id);
    const undo = await captureTasks(toMove.map((t) => t.id), ["columnId", "position", "evergreen", "evergreenEvery"]);
    const moved = await db.$transaction(async (tx) => {
      await lockColumns(tx, [column.id]);
      // Columna → tareas (en orden de id), como moveTask y el despliegue de una release.
      await lockTaskRows(tx, toMove.map((t) => t.id));
      let list: { id: string; position: number }[];
      if (place) {
        const ids = toMove.map((t) => t.id);
        const placed = await placeBlockInColumn(tx, column.id, place.prevId, place.nextId, ids, ids.length);
        // Renumerada la columna destino: el deshacer de las que ya estaban en ella usa su posición renumerada (si no,
        // volverían a un orden que ya no casa con el de sus vecinas), como moveTask.
        if (placed.rebalanced) {
          const here = toMove.filter((t) => t.columnId === column.id).map((t) => t.id);
          const now = new Map((await tx.task.findMany({ where: { id: { in: here } }, select: { id: true, position: true } })).map((r) => [r.id, r.position]));
          for (const op of undo) if (op.t === "task.set" && now.has(op.id)) op.data = { ...op.data, position: now.get(op.id)! };
        }
        list = ids.map((id, i) => ({ id, position: placed.positions[i]! }));
      } else {
        let pos = (await lastPositionIn(tx, column.id)) ?? 0;
        list = toMove.map((t) => ({ id: t.id, position: (pos += POSITION_STEP) }));
      }
      await setTaskColumnPositions(list, column.id, { clearEvergreen: true, client: tx });
      return list;
    });
    addUndo(...undo);
    // Las recurrentes que no estaban en una columna terminada y llegan a una: nace la siguiente aparición.
    let spawned: BoardTask[] = [];
    if (column.isDone) spawned = await spawnRecurrences(toMove.filter((t) => !t.column.isDone).map((t) => t.id), user.id);
    const colName = column.name;
    describeAction("Movió {count} a «{col}»", { count: tasksN(moved.length), col: colName }, { taskIds: moved.map((m) => m.id) });
    const code = column.isDone ? "done" : "move";
    skipTaskEvents();
    // Historial: solo las que cambian de columna (reordenar dentro de la misma no cuenta, como en moveTask).
    for (const t of toMove) if (t.columnId !== column.id) recordTaskEvent(t.id, code, { k: "Movió la tarea a «{to}»", p: { to: colName } });
    return { columnId: column.id, moved, spawned };
  });
}

/** Convierte una tarea en fija (evergreen): la lleva al final de la columna de la release del proyecto. */
export async function makeEvergreen(taskId: string) {
  return runAction({ name: "tasks.makeEvergreen", args: [taskId] }, async () => {
    const user = await requireUser();
    const task = await loadTaskWithAccess(user, v.id.parse(taskId), { archivedAt: true });
    assertNotArchivedRow(task);
    const { projectId } = task;
    addUndo(...(await captureTasks([taskId], ["columnId", "position", "evergreen"])));
    const result = await db.$transaction(async (tx) => {
      const column = await tx.column.findFirst({ where: { projectId, role: "NEXT_RELEASE" }, select: { id: true } });
      if (!column) throw new AppError("El proyecto no tiene columna de release.");
      await lockColumns(tx, [column.id]);
      const position = positionBetween(await lastPositionIn(tx, column.id, taskId), null);
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
    const task = await loadTaskWithAccess(user, v.id.parse(taskId), { archivedAt: true });
    assertNotArchivedRow(task);
    const { columnId } = task;
    describeAction("Archivó «{title}»", { title: (await taskLabel(taskId)).title }, { taskId });
    addUndo(...(await captureTasks([taskId], ARCHIVE_FIELDS)));
    await db.task.update({ where: { id: taskId }, data: { archivedAt: new Date(), archivedFromColumnId: columnId, evergreen: false, evergreenEvery: 1 } });
    return { spawned: await spawnRecurrences([taskId], user.id) };
  });
}

/** Archiva varias tareas (selección múltiple), recordando la columna de la que salen. */
export async function archiveTasks(taskIds: string[]) {
  return runAction({ name: "tasks.archiveTasks", args: [taskIds] }, async () => {
    const user = await requireUser();
    const requested = [...new Set(z.array(v.id).min(1).max(500).parse(taskIds))];
    // Las que ya no existen o no se ven (borradas desde otra pestaña, p. ej.) se ignoran en vez de fallar toda la acción.
    const tasks = await db.task.findMany({ where: { id: { in: requested }, project: visibleProjectsWhere(user) }, select: { id: true, projectId: true } });
    if (!tasks.length) return { archived: 0, spawned: await spawnRecurrences([], user.id) };
    const ids = tasks.map((t) => t.id);
    // Como en el borrado múltiple: el deshacer se guarda por proyecto, así que todas deben ser del mismo.
    if (new Set(tasks.map((t) => t.projectId)).size > 1) throw new AppError("Las tareas son de proyectos distintos.");
    noteProject(tasks[0]?.projectId);
    const active = (await db.task.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } })).map((t) => t.id);
    // Las que ya estaban archivadas (otra pestaña) no cuentan ni se registran: sin ninguna activa no se toca nada.
    if (!active.length) return { archived: 0, spawned: [] as Awaited<ReturnType<typeof spawnRecurrences>> };
    addUndo(...(await captureTasks(active, ARCHIVE_FIELDS)));
    // Filas bloqueadas antes, en orden de id: el UPDATE solo las bloquearía en el orden en que las recorre (40P01).
    await db.$transaction(async (tx) => {
      await lockTaskRows(tx, active);
      await tx.$executeRaw`UPDATE "Task" SET "archivedAt" = NOW(), "archivedFromColumnId" = "columnId", "evergreen" = false, "evergreenEvery" = 1 WHERE "id" IN (${Prisma.join(active)}) AND "archivedAt" IS NULL`;
    });
    const spawned = await spawnRecurrences(active, user.id);
    describeAction("Archivó {count}", { count: tasksN(active.length) }, { taskIds: active });
    for (const id of active) recordTaskEvent(id, "archive", { k: "Archivó la tarea" });
    return { archived: active.length, spawned };
  });
}

const ARCHIVED_PAGE = 100;

function parseArchivedCursor(raw: string): { archivedAt: Date; id: string } {
  const [at, id] = z.string().max(100).parse(raw).split("|");
  return { archivedAt: new Date(z.iso.datetime().parse(at)), id: v.id.parse(id) };
}

/**
 * Ids de la página siguiente de archivadas que coinciden con la búsqueda, por título de la tarea o título/número de una
 * release suya, sin distinguir mayúsculas ni tildes («camion» encuentra «Camión»), como la búsqueda de releases.
 */
async function archivedMatchIds(projectId: string, q: string, releaseNumber: number | null, cursor: { archivedAt: Date; id: string } | null): Promise<string[]> {
  const needle = foldedContains(q);
  const fold = (column: Prisma.Sql) => Prisma.sql`translate(lower(${column}), ${ACCENTED}, ${UNACCENTED})`;
  const after = cursor ? Prisma.sql`AND (t."archivedAt" < ${cursor.archivedAt} OR (t."archivedAt" = ${cursor.archivedAt} AND t."id" < ${cursor.id}))` : Prisma.empty;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT t."id" FROM "Task" t
    WHERE t."projectId" = ${projectId} AND t."archivedAt" IS NOT NULL ${after}
      AND (${fold(Prisma.sql`t."title"`)} LIKE ${needle}
        OR EXISTS (SELECT 1 FROM "ReleaseTask" rt JOIN "Release" r ON r."id" = rt."releaseId"
          WHERE rt."taskId" = t."id" AND (${fold(Prisma.sql`r."title"`)} LIKE ${needle} OR r."number" = ${releaseNumber ?? -1})))
    ORDER BY t."archivedAt" DESC, t."id" DESC
    LIMIT ${ARCHIVED_PAGE + 1}`;
  return rows.map((r) => r.id);
}

/**
 * Tareas archivadas del proyecto, las más recientes primero, en páginas (`cursor` = «archivedAt|id» de la última recibida:
 * paginación por claves, que no se rompe si esa fila se desarchiva o se borra entre dos páginas).
 * `query` busca en el servidor por título de la tarea o por título/número de release.
 */
export async function getArchivedTasks(projectId: string, opts: { query?: string; cursor?: string | null } = {}) {
  return runAction({ name: "tasks.getArchivedTasks", args: [projectId, opts] }, async (): Promise<{ items: ArchivedTask[]; nextCursor: string | null }> => {
    const user = await requireUser();
    await assertProjectAccess(user, v.id.parse(projectId));
    const q = (opts.query ?? "").trim().slice(0, 200);
    const cursor = opts.cursor ? parseArchivedCursor(opts.cursor) : null;
    describeAction("Consultó las tareas archivadas");
    const num = /^R?(\d{1,9})$/i.exec(q);
    const where: Prisma.TaskWhereInput = {
      projectId,
      archivedAt: { not: null },
      ...(cursor ? { AND: [{ OR: [{ archivedAt: { lt: cursor.archivedAt } }, { archivedAt: cursor.archivedAt, id: { lt: cursor.id } }] }] } : {}),
      ...(q ? { id: { in: await archivedMatchIds(projectId, q, num ? Number(num[1]) : null, cursor) } } : {}),
    };
    const found = await db.task.findMany({
      where,
      orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
      take: ARCHIVED_PAGE + 1,
      select: {
        id: true,
        title: true,
        kindId: true,
        archivedAt: true,
        archivedFromColumnId: true,
        releases: { select: { release: { select: { id: true, title: true, deployedAt: true } } } },
      },
    });
    const rows = found.slice(0, ARCHIVED_PAGE);
    const last = rows[rows.length - 1];
    const nextCursor = found.length > ARCHIVED_PAGE && last ? `${last.archivedAt!.toISOString()}|${last.id}` : null;
    const columns = await db.column.findMany({ where: { projectId }, select: { id: true, name: true } });
    const names = new Map(columns.map((c) => [c.id, c.name]));
    const items = rows.map((t) => ({
      id: t.id,
      title: t.title,
      kindId: t.kindId,
      archivedAt: t.archivedAt!.toISOString(),
      columnName: (t.archivedFromColumnId && names.get(t.archivedFromColumnId)) || null,
      releases: t.releases
        .map((r) => ({ id: r.release.id, title: r.release.title, deployedAt: r.release.deployedAt.toISOString() }))
        .sort((a, b) => b.deployedAt.localeCompare(a.deployedAt)),
    }));
    return { items, nextCursor };
  });
}
/**
 * Al borrar tareas, el servidor quita solo el bloqueo de las que dependían de ellas (SetNull). Para poder devolverlo al
 * deshacer se guarda el bloqueo actual de esas tareas y de las borradas que se bloqueaban entre sí (se aplica después de
 * recrearlas, porque las operaciones de deshacer van en orden inverso).
 */
async function blockLinkOps(ids: string[]): Promise<UndoOp[]> {
  const dependents = await db.task.findMany({ where: { blockedById: { in: ids } }, select: { id: true } });
  return captureTasks(dependents.map((t) => t.id), ["blockedById"]);
}

export async function deleteTask(taskId: string) {
  return runAction({ name: "tasks.deleteTask", args: [taskId] }, async () => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    describeAction("Borró la tarea «{title}»", { title: (await taskLabel(taskId)).title }, { taskId });
    // Los ficheros de sus adjuntos se conservan mientras se pueda deshacer (ver undo.ts).
    addUndo(...(await blockLinkOps([taskId])), ...(await snapshotTasks([taskId])));
    await db.task.delete({ where: { id: taskId } });
    forgetTaskAttachments([taskId]);
  });
}

/** Borra varias tareas (selección múltiple) con sus adjuntos. Solo las que el usuario puede ver. */
export async function deleteTasks(taskIds: string[]) {
  return runAction({ name: "tasks.deleteTasks", args: [taskIds] }, async () => {
    const user = await requireUser();
    const requested = [...new Set(z.array(v.id).min(1).max(500).parse(taskIds))];
    // Las que ya no existen o no se ven se ignoran en vez de fallar toda la acción.
    const tasks = await db.task.findMany({ where: { id: { in: requested }, project: visibleProjectsWhere(user) }, select: { id: true, projectId: true } });
    if (!tasks.length) return { deleted: 0 };
    const ids = tasks.map((t) => t.id);
    // Todas deben ser del mismo proyecto: el deshacer se guarda por proyecto.
    if (new Set(tasks.map((t) => t.projectId)).size > 1) throw new AppError("Las tareas son de proyectos distintos.");
    noteProject(tasks[0]?.projectId);
    addUndo(...(await blockLinkOps(ids)), ...(await snapshotTasks(ids)));
    const titles = await db.task.findMany({ where: { id: { in: ids } }, select: { title: true } });
    describeAction("Borró {count}: {titles}", { count: tasksN(ids.length), titles: titles.map((t) => `«${t.title}»`).join(", ").slice(0, 600) }, { taskIds: ids });
    await db.task.deleteMany({ where: { id: { in: ids } } });
    forgetTaskAttachments(ids);
    return { deleted: ids.length };
  });
}

export async function getTaskDetail(taskId: string) {
  return runAction({ name: "tasks.getTaskDetail", args: [taskId] }, async (): Promise<TaskDetail> => {
    // Antes de leer nada: cualquier cambio que se haga con el detalle abierto queda después de esta hora.
    const loadedAt = new Date().toISOString();
    const user = await requireUser();
    const id = v.id.parse(taskId);
    // El acceso va dentro de la propia consulta (mismo filtro que assertTaskAccess); el recuento de comentarios, en paralelo.
    const [task, commentCount] = await Promise.all([db.task.findFirst({
      where: { id, project: visibleProjectsWhere(user) },
      select: {
        id: true,
        projectId: true,
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
        // Solo los más recientes; los anteriores se piden con getOlderComments.
        comments: { orderBy: COMMENT_ORDER, take: COMMENTS_FIRST_PAGE, select: commentSelect },
      },
    }), db.taskComment.count({ where: { taskId: id, deletedAt: null } })]);
    if (!task) throw notFound();
    noteProject(task.projectId);
    noteTask(id);
    const oldest = task.comments.at(-1);
    const olderComments = oldest && task.comments.length === COMMENTS_FIRST_PAGE ? await db.taskComment.count({ where: olderThan(task.id, oldest) }) : 0;
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
      olderComments,
      commentCount,
      following: isFollowing(user.id, { createdById: task.createdById, assigneeId: task.assigneeId, rows: task.followers }),
      loadedAt,
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

/**
 * Bloquea la fila de la tarea hasta el final de la transacción: dos altas a la vez en la misma tarea (subtareas,
 * comentarios) no pueden pasarse del tope juntas. FOR NO KEY UPDATE serializa esas altas entre sí sin frenar las
 * demás inserciones que solo referencian la tarea (adjuntos, historial), que toman FOR KEY SHARE.
 */
async function lockTaskRow(tx: Prisma.TransactionClient, taskId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id" = ${taskId} FOR NO KEY UPDATE`;
}

async function assertSubtaskAccess(subtaskId: string) {
  const user = await requireUser();
  const sub = await db.subtask.findFirst({
    where: { id: v.id.parse(subtaskId), task: { project: visibleProjectsWhere(user) } },
    select: { id: true, taskId: true, title: true, done: true, position: true, task: { select: { projectId: true, archivedAt: true } } },
  });
  if (!sub) throw notFound();
  assertNotArchivedRow(sub.task);
  noteProject(sub.task.projectId);
  noteTask(sub.taskId);
  const { task: _task, ...row } = sub;
  return row;
}

export async function addSubtask(taskId: string, title: string) {
  return runAction({ name: "tasks.addSubtask", args: [taskId, title] }, async (): Promise<SubtaskInfo> => {
    const user = await requireUser();
    assertNotArchivedRow(await loadTaskWithAccess(user, v.id.parse(taskId), { archivedAt: true }));
    const name = v.title.parse(title);
    if (!rateLimit(`subtask:${user.id}`, 60, 60_000)) throw new AppError("Demasiadas subtareas seguidas. Espera un momento.");
    // Recuento, última posición y alta con la tarea bloqueada: dos altas a la vez no pasan del tope ni comparten posición.
    const sub = await db.$transaction(async (tx) => {
      await lockTaskRow(tx, taskId);
      if ((await tx.subtask.count({ where: { taskId } })) >= MAX_SUBTASKS) throw new AppError("Una tarea no puede tener más de 100 subtareas.");
      const last = await tx.subtask.findFirst({ where: { taskId }, orderBy: { position: "desc" }, select: { position: true } });
      return tx.subtask.create({
        data: { taskId, title: name, position: positionBetween(last?.position, null) },
        select: { id: true, title: true, done: true, position: true },
      });
    });
    addUndo({ t: "subtask.remove", id: sub.id });
    describeAction("Añadió la subtarea «{subtask}» en «{task}»", { subtask: sub.title, task: (await taskLabel(taskId)).title }, { taskId });
    return sub;
  });
}

/**
 * Varias subtareas de una vez (texto pegado con una por línea), al final de la lista y en una sola acción: un único
 * «Deshacer» las quita todas. Si no caben todas (máximo por tarea), se añaden las primeras y `skipped` dice cuántas no.
 * Cada título debe venir ya limpio (sin viñetas) y dentro del máximo de longitud (ver lib/subtask-lines.ts).
 */
export async function addSubtasks(taskId: string, titles: string[]) {
  return runAction({ name: "tasks.addSubtasks", args: [taskId, titles] }, async (): Promise<{ created: SubtaskInfo[]; skipped: number; undo: { id?: string } }> => {
    const user = await requireUser();
    assertNotArchivedRow(await loadTaskWithAccess(user, v.id.parse(taskId), { archivedAt: true }));
    const names = z.array(v.title).min(1).max(MAX_SUBTASKS).parse(titles);
    if (!rateLimit(`subtask:${user.id}`, 60, 60_000)) throw new AppError("Demasiadas subtareas seguidas. Espera un momento.");
    const { created, skipped } = await db.$transaction(async (tx) => {
      await lockTaskRow(tx, taskId);
      const room = MAX_SUBTASKS - (await tx.subtask.count({ where: { taskId } }));
      if (room <= 0) throw new AppError("Una tarea no puede tener más de 100 subtareas.");
      const last = await tx.subtask.findFirst({ where: { taskId }, orderBy: { position: "desc" }, select: { position: true } });
      let position = last?.position;
      const created: SubtaskInfo[] = [];
      for (const title of names.slice(0, room)) {
        position = positionBetween(position, null);
        created.push(await tx.subtask.create({ data: { taskId, title, position }, select: { id: true, title: true, done: true, position: true } }));
      }
      return { created, skipped: Math.max(0, names.length - room) };
    });
    addUndo(...created.map((s) => ({ t: "subtask.remove" as const, id: s.id })));
    const task = (await taskLabel(taskId)).title;
    if (created.length === 1) describeAction("Añadió la subtarea «{subtask}» en «{task}»", { subtask: created[0]!.title, task }, { taskId });
    else describeAction("Añadió {subs} en «{task}»", { subs: subtasksN(created.length), task }, { taskId });
    // Id de la entrada de deshacer: el aviso «Deshacer» quita justo estas subtareas.
    return { created, skipped, undo: trackUndoEntry() };
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
    await assertNotArchived(att.taskId);
    describeAction("Borró el adjunto «{name}» de «{task}»", { name: att.originalName, task: (await taskLabel(att.taskId)).title }, { attachmentId: att.id });
    // El fichero se conserva mientras se pueda deshacer (ver undo.ts).
    addUndo({ t: "attachment.restore", row: { ...att, createdAt: att.createdAt.toISOString() } });
    await db.taskAttachment.delete({ where: { id: att.id } });
    forgetAttachments([att.id]);
    // Id de la entrada de deshacer, para que el aviso «Deshacer» deshaga justo este borrado; y los contadores reales de la tarea.
    return { undo: trackUndoEntry(), totals: await attachmentTotals(att.taskId) };
  });
}

// --- Cancelar la edición ---------------------------------------------------------

const snapshotSchema = z.object({
  title: v.taskTitle,
  description: v.description.optional(),
  kindId: v.id,
  color: v.color,
  linkUrl: v.linkUrl,
  assigneeId: v.id.nullable(),
  labelIds: z.array(v.id).max(20),
  dueDate: v.dayIso,
  deliverableId: v.id.nullable(),
  evergreen: z.boolean(),
  evergreenEvery: z.number().int().min(1).max(3).optional(),
  recurrence: z.enum(RECURRENCES),
  recurrenceDay: z.number().int().min(1).max(31).nullable(),
  columnId: v.id,
  position: z.number().finite(),
  /** Bloqueo: si falta, no se toca. */
  blockedById: v.id.nullable().optional(),
  // Campos opcionales del proyecto: si faltan (o el proyecto ya no los tiene activados), no se tocan.
  ...taskFieldShape,
  // Solo si el detalle estaba cargado al abrir el diálogo; si faltan, no se tocan.
  subtasks: z.array(z.object({ id: v.id, title: v.title, done: z.boolean(), position: z.number().finite() })).max(MAX_SUBTASKS).optional(),
  attachmentIds: z.array(v.id).max(1000).optional(),
  links: z.array(z.object({ id: v.id, kind: z.enum(["GOOGLE_DOC", "GOOGLE_SHEET"]), title: z.string().max(300), url: z.string().max(2000), shareStatus: z.string().max(20).nullish(), shareFailed: z.number().int().min(0).optional() })).max(100).optional(),
  /** Cuándo se abrió el detalle (hora del servidor: TaskDetail.loadedAt). Solo se deshace lo hecho desde entonces. */
  openedAt: z.iso.datetime(),
});
export type TaskEditSnapshot = z.input<typeof snapshotSchema>;

/**
 * Lo que otras personas (o procesos sin autor) hicieron en la tarea desde `since`: sus entradas de deshacer/rehacer y su
 * historial. `complete` es false si alguna de sus pilas se llenó en el rato o hay cambios sin autor en el historial.
 */
async function othersActivity(userId: string, projectId: string, taskId: string, since: Date): Promise<OthersActivity> {
  const [entries, events] = await Promise.all([
    db.undoEntry.findMany({ where: { projectId, userId: { not: userId }, createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, select: { userId: true, kind: true, ops: true } }),
    db.taskEvent.findMany({ where: { taskId, createdAt: { gte: since }, OR: [{ userId: null }, { userId: { not: userId } }] }, select: { userId: true, code: true } }),
  ]);
  const byUser = new Map<string, typeof entries>();
  for (const e of entries) byUser.set(e.userId, [...(byUser.get(e.userId) ?? []), e]);
  const relevant = events.filter((e) => e.code !== "comment");
  return {
    touched: touchedTask(entries, taskId),
    complete: ![...byUser.values()].some(entriesMayBeTrimmed) && !relevant.some((e) => e.userId === null),
    fields: relevant.some((e) => e.code !== "subtask"),
    subtasks: relevant.some((e) => e.code === "subtask"),
  };
}

/** Ejecuta la comprobación y dice si pasó (para saltarse un campo cuyo destino ya no existe, sin fallar). */
async function passes(check: () => Promise<unknown>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch {
    return false;
  }
}

/**
 * Botón «Cancelar» del detalle: deshace, en UNA sola acción deshacible, lo que ESTA persona hizo en la tarea desde
 * que abrió el detalle (`snapshot.openedAt`), y nada de lo que hayan hecho otras personas a la vez. Lo que hizo se
 * lee de sus entradas de deshacer y rehacer de ese rato (ver touchedTask): solo esos campos, etiquetas, columna,
 * subtareas, enlaces y adjuntos vuelven a como estaban al abrirlo (`snapshot`). Los creados por ella se quitan (los
 * adjuntos y enlaces también si los subió o creó en ese rato, aunque su entrada ya no esté); los que borró vuelven
 * con la fila guardada en su entrada. Si al mover la tarjeta nació la siguiente aparición de una tarea recurrente y
 * Cancelar la devuelve, esa aparición también se retira. Los comentarios no se tocan.
 * `since`: versión del texto al abrirlo; si otra persona lo cambió después, no se pisa (como updateTask).
 * Si no hay nada que restaurar, no hace nada ni deja entrada de deshacer.
 */
export async function restoreTaskSnapshot(taskId: string, snapshot: TaskEditSnapshot, since?: string | null) {
  return runAction({ name: "tasks.restoreTaskSnapshot", args: [taskId, snapshot, since] }, async (): Promise<{ task: BoardTask; changed: boolean; removed: string[] }> => {
    const user = await requireUser();
    const snap = snapshotSchema.parse(snapshot);
    const id = v.id.parse(taskId);
    const openedAt = new Date(snap.openedAt);
    const [task, labels, subs, atts, links] = await Promise.all([
      loadTaskWithAccess(user, id, { id: true, ...TASK_UNDO_SELECT }),
      db.taskLabel.findMany({ where: { taskId: id }, select: { labelId: true } }),
      snap.subtasks ? db.subtask.findMany({ where: { taskId: id }, select: { id: true, taskId: true, title: true, done: true, position: true } }) : [],
      snap.attachmentIds ? db.taskAttachment.findMany({ where: { taskId: id } }) : [],
      snap.links ? db.taskLink.findMany({ where: { taskId: id } }) : [],
    ]);
    const { projectId } = task;
    assertNotArchivedRow(task);
    // Lo que hizo esta persona desde que abrió el detalle (como mucho sus 10 últimas entradas de cada pila).
    const entries = await db.undoEntry.findMany({ where: { userId: user.id, projectId, createdAt: { gte: openedAt } }, orderBy: { createdAt: "asc" }, select: { kind: true, ops: true } });
    const mine = touchedTask(entries, id);
    // Si esas entradas llenan una pila, las primeras del rato pudieron descartarse (p. ej. marcar 12 subtareas): no se sabe
    // todo lo que hizo, así que vuelve todo lo que guarda la instantánea. El texto sigue protegido por `since` (más abajo).
    // Lo que otras personas hicieron en el rato no se pisa: se lee de sus entradas y de su historial.
    if (entriesMayBeTrimmed(entries)) touchEverything(mine, id, snap.subtasks, subs.map((s) => s.id), await othersActivity(user.id, projectId, id, openedAt));
    const touched = (k: TaskField) => mine.fields.has(k);

    // --- Campos de la tarjeta: solo los que tocó, solo si difieren y solo si el destino sigue existiendo.
    const fields: Record<string, unknown> = {};
    if (touched("title") && snap.title !== task.title) fields.title = snap.title;
    if (touched("description") && snap.description !== undefined && snap.description !== task.description) fields.description = snap.description;
    if (touched("color") && snap.color !== task.color) fields.color = snap.color;
    if (touched("linkUrl") && snap.linkUrl !== task.linkUrl) fields.linkUrl = snap.linkUrl;
    if (touched("evergreen") && snap.evergreen !== task.evergreen) fields.evergreen = snap.evergreen;
    if (touched("evergreenEvery") && snap.evergreenEvery !== undefined && snap.evergreenEvery !== task.evergreenEvery) fields.evergreenEvery = snap.evergreenEvery;
    if (touched("recurrence") && snap.recurrence !== task.recurrence) fields.recurrence = snap.recurrence;
    if (touched("recurrenceDay") && snap.recurrenceDay !== task.recurrenceDay) fields.recurrenceDay = snap.recurrenceDay;
    if (touched("kindId") && snap.kindId !== task.kindId && (await passes(() => assertKindsInProject([snap.kindId], projectId)))) fields.kindId = snap.kindId;
    if (touched("assigneeId") && snap.assigneeId !== task.assigneeId && (!snap.assigneeId || (await passes(() => assertAssignable(projectId, snap.assigneeId!))))) fields.assigneeId = snap.assigneeId;
    if (touched("deliverableId") && snap.deliverableId !== task.deliverableId && (await passes(() => assertDeliverableInProject(snap.deliverableId, projectId)))) fields.deliverableId = snap.deliverableId;
    if (touched("blockedById") && snap.blockedById !== undefined && snap.blockedById !== task.blockedById && (!snap.blockedById || (await passes(() => assertCanBlock(id, snap.blockedById!, projectId))))) fields.blockedById = snap.blockedById;
    if (touched("dueDate") && snap.dueDate !== dateToIso(task.dueDate)) fields.dueDate = snap.dueDate ? isoToDate(snap.dueDate) : null;
    const optionalSnap = onlyChangedFields(task, pickTaskFields(snap));
    for (const k of patchedFieldKeys(optionalSnap)) if (!touched(k)) delete optionalSnap[k];
    if (patchedFieldKeys(optionalSnap).length) {
      const enabled = await enabledTaskFields(projectId);
      for (const k of patchedFieldKeys(optionalSnap)) if (!enabled.includes(fieldKeyOf(k))) delete optionalSnap[k];
      Object.assign(fields, fieldData(optionalSnap));
    }
    if (touched("columnId") && snap.columnId !== task.columnId && (await passes(() => assertColumnInProject(snap.columnId, projectId)))) {
      fields.columnId = snap.columnId;
      // La posición viene del navegador: si ya la ocupa otra tarjeta, se desempata al terminar (resolvePositionTies).
      fields.position = snap.position;
    }
    // La tarea fija solo existe en la columna de la release: si la columna en la que queda no lo es, no se restaura la
    // marca, y si la tenía (p. ej. otra persona la fijó después de que la llevaras allí) la pierde, como al moverla.
    const finalColumn = (fields.columnId as string | undefined) ?? task.columnId;
    if (((fields.evergreen as boolean | undefined) ?? task.evergreen) && !(await db.column.count({ where: { id: finalColumn, role: "NEXT_RELEASE" } }))) {
      if (task.evergreen) Object.assign(fields, { evergreen: false, evergreenEvery: 1 });
      else {
        delete fields.evergreen;
        delete fields.evergreenEvery;
      }
    }
    const editsText = fields.title !== undefined || fields.description !== undefined;
    if (editsText && since !== undefined) {
      // Misma regla que updateTask: no se pisa el texto cambiado (por otra persona o desde otra pestaña) mientras se editaba.
      await assertNoTextConflict(id, task, user.id, since, fields);
    }
    const fieldKeys = Object.keys(fields) as TaskField[];
    if (editsText) Object.assign(fields, { contentUpdatedAt: new Date(), contentUpdatedById: user.id });

    // Etiquetas (si las cambió): las del principio que siguen existiendo en el proyecto.
    const nowLabels = new Set(labels.map((l) => l.labelId));
    const wantedLabels = !mine.labels ? [...nowLabels] : snap.labelIds.length ? (await db.label.findMany({ where: { id: { in: snap.labelIds }, projectId }, select: { id: true } })).map((l) => l.id) : [];
    const labelsChanged = mine.labels && (wantedLabels.length !== nowLabels.size || wantedLabels.some((l) => !nowLabels.has(l)));

    // Se borró en el rato y debe volver: estaba al abrir, o la borró una acción suya y no la había creado ella en el rato
    // (la de otra persona, creada después de abrir). Lo que solo quitó su «Deshacer» y no estaba al abrir, no vuelve.
    const returns = (d: { byUndo: boolean }, wasThere: boolean, createdHere: boolean) => wasThere || (d.byUndo && !createdHere);

    // --- Subtareas
    const undo: UndoOp[] = [];
    const subCreate: { id: string; title: string; done: boolean; position: number }[] = [];
    const subUpdate: { id: string; data: { title?: string; done?: boolean; position?: number } }[] = [];
    const subDelete: string[] = [];
    if (snap.subtasks) {
      const want = new Map(snap.subtasks.map((s) => [s.id, s]));
      for (const s of subs) {
        const w = want.get(s.id);
        if (!w) {
          // No estaba al abrir: se quita si la creó ella; si es de otra persona, se deshacen solo sus cambios.
          if (mine.subtasksCreated.has(s.id)) {
            subDelete.push(s.id);
            undo.push({ t: "subtask.restore", row: s });
            continue;
          }
        }
        const keys = mine.subtaskFields.get(s.id);
        if (!keys) continue;
        const before = w ?? mine.subtaskBefore.get(s.id) ?? {};
        const data: { title?: string; done?: boolean; position?: number } = {};
        const old: { title?: string; done?: boolean; position?: number } = {};
        for (const k of keys) {
          const value = (before as Record<string, unknown>)[k];
          if (value === undefined || value === s[k]) continue;
          (data as Record<string, unknown>)[k] = value;
          (old as Record<string, unknown>)[k] = s[k];
        }
        if (!Object.keys(data).length) continue;
        subUpdate.push({ id: s.id, data });
        undo.push({ t: "subtask.set", id: s.id, data: old });
      }
      const have = new Set(subs.map((s) => s.id));
      for (const [sid, d] of mine.subtasksDeleted) {
        if (have.has(sid) || !returns(d, want.has(sid), mine.subtasksCreated.has(sid))) continue;
        const w = want.get(sid);
        subCreate.push(w ? { id: sid, title: w.title, done: w.done, position: w.position } : { id: sid, title: d.row.title, done: d.row.done, position: d.row.position });
        undo.push({ t: "subtask.remove", id: sid });
      }
    }

    // --- Enlaces de Google: los creados por ella en el rato se quitan; los que borró vuelven con la fila de su entrada.
    const linkCreate: Extract<UndoOp, { t: "link.restore" }>["row"][] = [];
    const linkDelete: string[] = [];
    if (snap.links) {
      const want = new Set(snap.links.map((l) => l.id));
      const mineHere = (l: { id: string; createdById: string | null; createdAt: Date | string }) =>
        mine.linksCreated.has(l.id) || (l.createdById === user.id && new Date(l.createdAt) >= openedAt);
      for (const l of links) {
        if (want.has(l.id) || !mineHere(l)) continue;
        linkDelete.push(l.id);
        undo.push({ t: "link.restore", row: { id: l.id, taskId: l.taskId, kind: l.kind, title: l.title, url: l.url, externalId: l.externalId, createdById: l.createdById, shareStatus: l.shareStatus, shareFailed: l.shareFailed, createdAt: l.createdAt.toISOString() } });
      }
      const have = new Set(links.map((l) => l.id));
      for (const [lid, d] of mine.linksDeleted) {
        if (have.has(lid) || !returns(d, want.has(lid), mineHere(d.row))) continue;
        linkCreate.push(d.row);
        undo.push({ t: "link.remove", id: lid });
      }
    }

    // --- Adjuntos: los subidos por ella en el rato se quitan (su fichero se conserva mientras exista la entrada de
    // deshacer); los que borró vuelven con la fila de su entrada, que también conserva su fichero.
    const attDelete: string[] = [];
    const attRestore: Extract<UndoOp, { t: "attachment.restore" }>["row"][] = [];
    if (snap.attachmentIds) {
      const want = new Set(snap.attachmentIds);
      const mineHere = (a: { id: string; createdById: string | null; createdAt: Date | string }) =>
        mine.attachmentsCreated.has(a.id) || (a.createdById === user.id && new Date(a.createdAt) >= openedAt);
      for (const a of atts) {
        if (want.has(a.id) || !mineHere(a)) continue;
        attDelete.push(a.id);
        undo.push({ t: "attachment.restore", row: { id: a.id, taskId: a.taskId, originalName: a.originalName, mimeType: a.mimeType, isImage: a.isImage, width: a.width, height: a.height, size: a.size, createdById: a.createdById, createdAt: a.createdAt.toISOString() } });
      }
      const have = new Set(atts.map((a) => a.id));
      for (const [aid, d] of mine.attachmentsDeleted) {
        if (have.has(aid) || !returns(d, want.has(aid), mineHere(d.row))) continue;
        attRestore.push(d.row);
        undo.push({ t: "attachment.remove", id: aid });
      }
    }

    // --- Recurrente: si Cancelar devuelve la tarjeta y al moverla nació su siguiente aparición, esa aparición se retira.
    const spawned = fields.columnId !== undefined && mine.spawned.size
      ? (await db.task.findMany({ where: { id: { in: [...mine.spawned] }, projectId, recurrenceFromId: id }, select: { id: true } })).map((s) => s.id)
      : [];
    const spawnedAtts = spawned.length ? (await db.taskAttachment.findMany({ where: { taskId: { in: spawned } }, select: { id: true } })).map((a) => a.id) : [];
    if (spawned.length) undo.push(...(await snapshotTasks(spawned)));

    if (!fieldKeys.length && !labelsChanged && !undo.length) return { task: await loadBoardTask(id), changed: false, removed: [] };

    // Deshacer: primero los campos (con sus valores actuales y las etiquetas), luego lo de las filas hijas.
    const touchedKeys = editsText ? [...fieldKeys, "contentUpdatedAt", "contentUpdatedById"] as TaskField[] : fieldKeys;
    addUndo(taskSetOp(task, touchedKeys, labelsChanged ? labels : undefined), ...undo);
    await db.$transaction(async (tx) => {
      if (typeof fields.blockedById === "string") {
        // Misma regla que updateTask: comprobación y escritura bajo el candado de bloqueos del proyecto.
        // Si entretanto otra petición lo hizo imposible, ese campo se deja como está (como hace la comprobación previa).
        await lockBlocking(tx, projectId);
        if (await blockProblem(id, fields.blockedById, projectId, tx)) delete fields.blockedById;
      }
      if (Object.keys(fields).length) await tx.task.update({ where: { id }, data: fields });
      if (labelsChanged) {
        await tx.taskLabel.deleteMany({ where: { taskId: id } });
        await tx.taskLabel.createMany({ data: wantedLabels.map((labelId) => ({ taskId: id, labelId })) });
      }
      if (subDelete.length) await tx.subtask.deleteMany({ where: { id: { in: subDelete }, taskId: id } });
      for (const s of subUpdate) await tx.subtask.update({ where: { id: s.id }, data: s.data });
      if (subCreate.length) await tx.subtask.createMany({ data: subCreate.map((s) => ({ ...s, taskId: id })) });
      if (linkDelete.length) await tx.taskLink.deleteMany({ where: { id: { in: linkDelete }, taskId: id } });
      for (const l of linkCreate) {
        const creator = l.createdById && (await tx.user.count({ where: { id: l.createdById } })) ? l.createdById : null;
        await tx.taskLink.create({ data: { ...l, kind: l.kind as Prisma.TaskLinkCreateInput["kind"], taskId: id, createdById: creator, createdAt: new Date(l.createdAt) } });
      }
      if (attDelete.length) await tx.taskAttachment.deleteMany({ where: { id: { in: attDelete }, taskId: id } });
      for (const r of attRestore) {
        const creator = r.createdById && (await tx.user.count({ where: { id: r.createdById } })) ? r.createdById : null;
        await tx.taskAttachment.create({ data: { ...r, taskId: id, createdById: creator, createdAt: new Date(r.createdAt) } });
      }
      // Sus ficheros se conservan: la instantánea de la entrada de deshacer los retiene.
      if (spawned.length) await tx.task.deleteMany({ where: { id: { in: spawned }, projectId, recurrenceFromId: id } });
    });
    forgetAttachments([...attDelete, ...spawnedAtts]);
    if (fields.columnId !== undefined) await resolvePositionTies([id]);
    describeAction("Canceló los cambios en «{title}»", { title: mentionsToPlain(task.title) }, { taskId: id });
    // `removed`: tareas que han desaparecido del tablero (la siguiente aparición retirada), para quitarlas sin esperar al refresco.
    return { task: await loadBoardTask(id), changed: true, removed: spawned };
  });
}

/** Recupera una tarea archivada: vuelve a su columna de origen (o al backlog si ya no existe), al final. */
export async function restoreTask(taskId: string) {
  return runAction({ name: "tasks.restoreTask", args: [taskId] }, async () => {
    const user = await requireUser();
    const { projectId } = await assertTaskAccess(user, v.id.parse(taskId));
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { archivedFromColumnId: true, archivedAt: true } });
    // Una segunda pestaña (o un doble clic) puede llegar tarde: si ya está activa no se mueve.
    if (!task.archivedAt) throw new AppError("La tarea no está archivada.");
    const origin = task.archivedFromColumnId
      ? await db.column.findFirst({ where: { id: task.archivedFromColumnId, projectId }, select: { id: true, name: true } })
      : null;
    const column = origin ?? (await db.column.findFirst({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true } }));
    if (!column) throw new AppError("El proyecto no tiene columnas.");
    addUndo(...(await captureTasks([taskId], ARCHIVE_FIELDS)));
    await db.$transaction(async (tx) => {
      // Se vuelve a comprobar dentro de la transacción: otra pestaña pudo recuperarla entre medias.
      const fresh = await tx.task.findUnique({ where: { id: taskId }, select: { archivedAt: true } });
      if (!fresh?.archivedAt) throw new AppError("La tarea no está archivada.");
      // Al recuperarla vuelve a contar como activa: si el proyecto está en el tope, no cabe.
      await assertTaskCapacity(tx, projectId);
      await lockColumns(tx, [column.id]);
      const position = positionBetween(await lastPositionIn(tx, column.id, taskId), null);
      // columnEnteredAt/waitingNotifiedAt a mano: si la columna no cambia, el disparador no actúa.
      await tx.task.update({ where: { id: taskId }, data: { archivedAt: null, archivedFromColumnId: null, columnId: column.id, position, columnEnteredAt: new Date(), waitingNotifiedAt: null } });
    });
    describeAction("Recuperó «{title}» en «{col}»", { title: (await taskLabel(taskId)).title, col: column.name }, { taskId });
    return { task: await loadBoardTask(taskId), columnName: column.name };
  });
}

// --- Comentarios y menciones ---------------------------------------------------

const commentSelect = { id: true, body: true, createdAt: true, editedAt: true, authorId: true, authorName: true, parentId: true, deletedAt: true, author: { select: { name: true } } } as const;
/** Orden estable para paginar con cursor (createdAt puede repetirse: el id desempata). */
const COMMENT_ORDER: Prisma.TaskCommentOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

function toCommentInfo(c: { id: string; body: string; createdAt: Date; editedAt: Date | null; authorId: string | null; authorName: string | null; parentId: string | null; deletedAt: Date | null; author: { name: string } | null }): CommentInfo {
  // Un comentario borrado que conserva respuestas no enseña ni texto ni autor.
  if (c.deletedAt) return { id: c.id, body: "", createdAt: c.createdAt.toISOString(), authorId: null, authorName: null, parentId: c.parentId, deleted: true };
  return {
    id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), authorId: c.authorId, authorName: c.author?.name ?? c.authorName ?? null, parentId: c.parentId,
    ...(c.editedAt ? { editedAt: c.editedAt.toISOString() } : {}),
  };
}

/** Comentarios de la tarea anteriores al cursor, en el orden de COMMENT_ORDER. */
const olderThan = (taskId: string, c: { createdAt: Date; id: string }): Prisma.TaskCommentWhereInput => ({
  taskId,
  OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }],
});

const commentCursor = z.object({ createdAt: z.iso.datetime(), id: v.id });

/** «Ver anteriores»: los 100 comentarios previos al cursor (el más antiguo que ya se tiene). Solo lectura. */
export async function getOlderComments(taskId: string, cursor: { createdAt: string; id: string }) {
  return runAction({ name: "tasks.getOlderComments", args: [taskId, cursor] }, async (): Promise<{ comments: CommentInfo[]; olderComments: number }> => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    const c = commentCursor.parse(cursor);
    const from = { createdAt: new Date(c.createdAt), id: c.id };
    const rows = await db.taskComment.findMany({ where: olderThan(taskId, from), orderBy: COMMENT_ORDER, take: COMMENTS_MORE_PAGE, select: commentSelect });
    const oldest = rows.at(-1);
    const olderComments = oldest && rows.length === COMMENTS_MORE_PAGE ? await db.taskComment.count({ where: olderThan(taskId, oldest) }) : 0;
    return { comments: rows.reverse().map(toCommentInfo), olderComments };
  });
}

/** Tope de comentarios que devuelve un refresco (el máximo configurable por tarea es 1000). */
const COMMENTS_REFRESH_MAX = 1000;

/**
 * Refresco en vivo de los comentarios que ya se ven (otra persona comentó, editó o borró): todos desde `cursor` (el más
 * antiguo cargado, incluido) hasta el más reciente; sin cursor, la primera página. Solo lectura.
 */
export async function getRecentComments(taskId: string, cursor?: { createdAt: string; id: string } | null) {
  return runAction({ name: "tasks.getRecentComments", args: [taskId, cursor] }, async (): Promise<{ comments: CommentInfo[]; olderComments: number; commentCount: number }> => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    const c = cursor ? commentCursor.parse(cursor) : null;
    const from = c ? { createdAt: new Date(c.createdAt), id: c.id } : null;
    const where: Prisma.TaskCommentWhereInput = from
      ? { taskId, OR: [{ createdAt: { gt: from.createdAt } }, { createdAt: from.createdAt, id: { gte: from.id } }] }
      : { taskId };
    const [rows, commentCount] = await Promise.all([
      db.taskComment.findMany({ where, orderBy: COMMENT_ORDER, take: from ? COMMENTS_REFRESH_MAX : COMMENTS_FIRST_PAGE, select: commentSelect }),
      db.taskComment.count({ where: { taskId, deletedAt: null } }),
    ]);
    const oldest = rows.at(-1) ?? from;
    const olderComments = oldest ? await db.taskComment.count({ where: olderThan(taskId, oldest) }) : 0;
    return { comments: rows.reverse().map(toCommentInfo), olderComments, commentCount };
  });
}

const commentBody = z.string().trim().min(1, "El comentario está vacío.").max(10_000, "El comentario es demasiado largo.");

/** `parentId`: comentario al que responde (un solo nivel: si es una respuesta, se cuelga del comentario raíz). */
export async function addComment(taskId: string, body: string, parentId?: string | null) {
  return runAction({ name: "tasks.addComment", args: [taskId, body, parentId] }, async (): Promise<CommentInfo> => {
    const user = await requireUser();
    const task = await loadTaskWithAccess(user, v.id.parse(taskId), { archivedAt: true });
    assertNotArchivedRow(task);
    const { projectId } = task;
    const text = commentBody.parse(body);
    // Los comentarios borrados que conservan respuestas no cuentan para el máximo (ajuste de administración).
    const maxComments = await getMaxCommentsPerTask();
    if (!rateLimit(`comment:${user.id}`, 30, 60_000)) throw new AppError("Demasiados comentarios seguidos. Espera un momento.");
    const parent = parentId ? await db.taskComment.findFirst({ where: { id: v.id.parse(parentId), taskId, deletedAt: null }, select: { id: true, parentId: true, authorId: true } }) : null;
    if (parentId && !parent) throw new AppError("El comentario al que respondes ya no existe.");
    // Recuento y alta con la tarea bloqueada: dos comentarios a la vez no pueden pasarse del máximo.
    const comment = await db.$transaction(async (tx) => {
      await lockTaskRow(tx, taskId);
      if ((await tx.taskComment.count({ where: { taskId, deletedAt: null } })) >= maxComments) {
        const t = await getT();
        throw new AppError(maxComments === 1 ? t("Esta tarea ya tiene el máximo de 1 comentario.") : t("Esta tarea ya tiene el máximo de {n} comentarios.", { n: maxComments }));
      }
      return tx.taskComment.create({ data: { taskId, authorId: user.id, body: text, parentId: parent ? (parent.parentId ?? parent.id) : null }, select: commentSelect });
    });
    addUndo({ t: "comment.remove", id: comment.id });
    const mentioned = await notifyMentions({ actorId: user.id, taskId, projectId, recipientIds: extractMentionIds(text), text, commentId: comment.id });
    // Quien comenta sigue la tarea. Avisos: respuesta al autor del comentario; comentario a quien la sigue (sin repetir a nadie).
    await followTask(taskId, [user.id]);
    const notified = [user.id, ...mentioned];
    if (parent?.authorId && !notified.includes(parent.authorId)) {
      const { recipients } = await notifyTask({ type: "REPLY", actorId: user.id, taskId, projectId, recipientIds: [parent.authorId], excerpt: makeExcerpt(text), commentId: comment.id });
      notified.push(...recipients, parent.authorId);
    }
    const followers = await taskFollowerIds(taskId, notified);
    if (followers.length) await notifyTask({ type: "COMMENT", actorId: user.id, taskId, projectId, recipientIds: followers, excerpt: makeExcerpt(text), commentId: comment.id });
    describeAction(parent ? "Respondió a un comentario en «{title}»" : "Comentó en «{title}»", { title: (await taskLabel(taskId)).title }, { taskId });
    return toCommentInfo(comment);
  });
}

/**
 * Edita un comentario propio. Solo su autor: un admin puede borrar comentarios ajenos, pero no cambiar lo que otra
 * persona escribió. Mismas reglas de texto que al crear; avisa solo a quien se menciona por primera vez en este
 * comentario (ni a quien ya estaba en el texto anterior ni a quien ya tiene un aviso de mención de él: quitar y volver
 * a poner una mención no avisa otra vez), actualiza el extracto de los avisos que creó y se puede deshacer.
 */
export async function editComment(commentId: string, body: string) {
  return runAction({ name: "tasks.editComment", args: [commentId, body] }, async (): Promise<CommentInfo> => {
    const user = await requireUser();
    const found = await db.taskComment.findFirst({
      where: { id: v.id.parse(commentId), deletedAt: null, task: { project: visibleProjectsWhere(user) } },
      select: { id: true, taskId: true, authorId: true, createdAt: true, task: { select: { projectId: true, title: true } } },
    });
    if (!found) throw notFound();
    if (found.authorId !== user.id) throw new AppError("Solo puedes editar tus comentarios.", 403);
    const { taskId } = found;
    const { projectId } = found.task;
    noteProject(projectId);
    noteTask(taskId);
    await assertNotArchived(taskId);
    const text = commentBody.parse(body);
    if (!rateLimit(`comment:${user.id}`, 30, 60_000)) throw new AppError("Demasiados comentarios seguidos. Espera un momento.");
    // Con la fila bloqueada: dos ediciones a la vez (dos pestañas) no calculan las menciones nuevas sobre el mismo texto.
    const { before, updated } = await db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ body: string; editedAt: Date | null; deletedAt: Date | null }[]>`SELECT "body", "editedAt", "deletedAt" FROM "TaskComment" WHERE "id" = ${found.id} FOR UPDATE`;
      if (!row || row.deletedAt) throw notFound();
      if (row.body === text) return { before: row, updated: null };
      const updated = await tx.taskComment.update({ where: { id: found.id }, data: { body: text, editedAt: new Date() }, select: commentSelect });
      // Los avisos que creó el comentario llevan un extracto de su texto: pasan a mostrar el nuevo.
      await tx.notification.updateMany({ where: commentNoticesWhere({ ...found, body: row.body }), data: { excerpt: makeExcerpt(text) } });
      return { before: row, updated };
    });
    // Sin cambios: no hay nada que anotar ni deshacer.
    if (!updated) return toCommentInfo((await db.taskComment.findUniqueOrThrow({ where: { id: found.id }, select: commentSelect })));
    addUndo({ t: "comment.set", id: found.id, body: before.body, editedAt: before.editedAt?.toISOString() ?? null });
    describeAction("Editó un comentario en «{title}»", { title: found.task.title }, { taskId });
    const old = new Set(extractMentionIds(before.body));
    const candidates = extractMentionIds(text).filter((id) => !old.has(id));
    const notified = candidates.length
      ? new Set((await db.notification.findMany({ where: { commentId: found.id, type: "MENTION", userId: { in: candidates } }, select: { userId: true } })).map((n) => n.userId))
      : new Set<string>();
    const added = candidates.filter((id) => !notified.has(id));
    if (added.length) await notifyMentions({ actorId: user.id, taskId, projectId, recipientIds: added, text, commentId: found.id });
    return toCommentInfo(updated);
  });
}

type CommentRowSource = { id: string; taskId: string; authorId: string | null; authorName: string | null; body: string; createdAt: Date; editedAt: Date | null; parentId: string | null; deletedAt: Date | null };
const commentRow = (c: CommentRowSource) => ({
  id: c.id, taskId: c.taskId, authorId: c.authorId, authorName: c.authorName, body: c.body, parentId: c.parentId,
  createdAt: c.createdAt.toISOString(), editedAt: c.editedAt?.toISOString() ?? null, deletedAt: c.deletedAt?.toISOString() ?? null,
});

/**
 * Solo el autor (o un admin) puede borrar un comentario. Si tiene respuestas no se borra la fila (las respuestas
 * quedarían sueltas): se vacía y se marca como borrado, y el hilo sigue entero. Sin respuestas se borra de verdad;
 * si era la última respuesta de un comentario ya borrado, ese marcador también se retira.
 */
export async function deleteComment(commentId: string) {
  return runAction({ name: "tasks.deleteComment", args: [commentId] }, async (): Promise<{ soft: boolean; removed: string[] }> => {
    const user = await requireUser();
    const comment = await db.taskComment.findFirst({
      where: { id: v.id.parse(commentId), deletedAt: null, task: { project: visibleProjectsWhere(user) } },
      select: { id: true, taskId: true, authorId: true, task: { select: { projectId: true, title: true } } },
    });
    if (!comment) throw notFound();
    if (comment.authorId !== user.id && user.role !== "ADMIN") throw new AppError("Solo puedes borrar tus comentarios.", 403);
    noteProject(comment.task.projectId);
    noteTask(comment.taskId);
    await assertNotArchived(comment.taskId);
    describeAction("Borró un comentario de «{title}»", { title: comment.task.title }, { taskId: comment.taskId });
    // Se relee con la fila bloqueada: si se editó entre la comprobación y el borrado, el deshacer guarda el texto vigente
    // (y se vacían los avisos que lo muestran).
    const { ops, soft } = await db.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ deletedAt: Date | null }[]>`SELECT "deletedAt" FROM "TaskComment" WHERE "id" = ${comment.id} FOR UPDATE`;
      if (!locked || locked.deletedAt) throw notFound();
      const row = await tx.taskComment.findUniqueOrThrow({ where: { id: comment.id } });
      // Los avisos ya creados llevan un extracto del texto: se vacía para que no sobreviva al borrado.
      await tx.notification.updateMany({ where: commentNoticesWhere(row), data: { excerpt: "" } });
      if ((await tx.taskComment.count({ where: { parentId: comment.id } })) > 0) {
        await tx.taskComment.update({ where: { id: comment.id }, data: { body: "", deletedAt: new Date() } });
        const undelete: UndoOp[] = [{ t: "comment.undelete", id: comment.id, body: row.body }];
        return { ops: undelete, soft: true };
      }
      const ops: UndoOp[] = [{ t: "comment.restore", row: commentRow(row) }];
      await tx.taskComment.delete({ where: { id: comment.id } });
      // Era la última respuesta de un comentario borrado: el marcador ya no sirve. Se restaura primero (las operaciones se aplican de la última a la primera).
      if (row.parentId) {
        await tx.$queryRaw`SELECT 1 FROM "TaskComment" WHERE "id" = ${row.parentId} FOR UPDATE`;
        const parent = await tx.taskComment.findUnique({ where: { id: row.parentId } });
        if (parent?.deletedAt && (await tx.taskComment.count({ where: { parentId: parent.id } })) === 0) {
          ops.push({ t: "comment.restore", row: commentRow(parent) });
          await tx.taskComment.delete({ where: { id: parent.id } });
        }
      }
      return { ops, soft: false };
    });
    addUndo(...ops);
    if (soft) return { soft: true, removed: [] };
    return { soft: false, removed: ops.map((op) => (op.t === "comment.restore" ? op.row.id : "")) };
  });
}

// --- Documentos de Google ------------------------------------------------------

const linkSelect = { id: true, kind: true, title: true, url: true, shareStatus: true, shareFailed: true } as const;

/** Crea un Google Doc o Sheet en el Drive del usuario y lo enlaza a la tarea. */
export async function createGoogleFile(taskId: string, kind: GoogleFileKind, title: string) {
  return runAction({ name: "tasks.createGoogleFile", args: [taskId, kind, title] }, async (): Promise<TaskLinkInfo> => {
    const user = await requireUser();
    const task = await loadTaskWithAccess(user, v.id.parse(taskId), { archivedAt: true });
    assertNotArchivedRow(task);
    const { projectId } = task;
    if (!rateLimit(`google-file:${user.id}`, 20, 60_000)) throw new AppError("Demasiados documentos creados seguidos. Espera un minuto.");
    const fileKind = z.enum(["GOOGLE_DOC", "GOOGLE_SHEET"]).parse(kind);
    const name = v.title.parse(title);
    // Con quién se comparte lo decide el proyecto (googleShareMode); en uno privado nunca es con el dominio.
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { isPrivate: true, googleShareMode: true, members: { where: { user: { active: true }, userId: { not: user.id } }, select: { user: { select: { email: true } } } } },
    });
    const rule = shareRule(project?.googleShareMode, Boolean(project?.isPrivate), { role: process.env.GOOGLE_SHARE_ROLE });
    const share = rule.scope === "domain" ? ({ type: "domain" } as const) : rule.scope === "members" ? ({ type: "users", emails: project!.members.map((m) => m.user.email) } as const) : null;
    const file = await createDriveFile(user.id, fileKind, name, share, rule.role);
    if (!/^https:\/\/(docs|drive)\.google\.com\//.test(file.url)) throw new AppError("Google devolvió un enlace inesperado.");
    const link = await db.taskLink.create({
      data: { taskId, kind: fileKind, title: file.name, url: file.url, externalId: file.id, createdById: user.id, shareStatus: file.share.status, shareFailed: file.share.failed },
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
    await assertNotArchived(link.taskId);
    const { task: _task, ...row } = link;
    addUndo({ t: "link.restore", row: { ...row, createdAt: row.createdAt.toISOString() } });
    describeAction("Quitó el enlace «{title}»", { title: row.title }, { taskId: row.taskId });
    await db.taskLink.delete({ where: { id: link.id } });
  });
}
