"use server";

import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { forgetAttachments, forgetTaskAttachments } from "@/lib/attachment-cache";
import { runAction } from "@/lib/action";
import { assertAssignable, assertNotArchived, assertNotArchivedRow, assertProjectAccess, assertTaskAccess, loadTaskWithAccess, visibleProjectsWhere } from "@/lib/access";
import { appTimeZone, attachmentTotals, listKinds, loadBoardTask, loadBoardTasksByIds, projectClients, projectUsers } from "@/lib/board";
import { MAX_BULK_TASKS } from "@/lib/bulk";
import { EVERGREEN_COLUMN_ROLES, MAX_SELECTION_ACTION, MAX_SUBTASKS, MAX_TASK_LABELS, MAX_TITLE, MAX_TITLE_UNITS } from "@/lib/constants";
import { clampTitle, graphemeCount } from "@/lib/title-clamp";
import { cutText } from "@/lib/graphemes";
import { describeAction, needOwnRefresh, noteProject, noteTask, noteTasks, recordTaskEvent, skipTaskEvents, trackUndoEntry } from "@/lib/action-context";
import { assertCanBlock, blockProblem, lockBlocking } from "@/lib/blocking";
import { addUndo, captureTasks, dependentLinkOps, entriesMayBeTrimmed, snapshotTasks, TASK_UNDO_SELECT, taskSetOp, touchEverything, touchedTask, type OthersActivity, type TaskField, type UndoOp } from "@/lib/undo";
import { switchKindDescription, switchKindSubtaskRows, titleWithoutKindPrefix } from "@/lib/kinds-special";
import { andList, quotedList, subtasksN, tasksN, type Label } from "@/lib/undo-label";
import { AppError, notFound } from "@/lib/errors";
import { needsRebalance, positionBetween, POSITION_STEP } from "@/lib/positions";
import { COLUMN_ORDER, lastPositionIn, lockColumns, lockTaskRows, placeBlockInColumn, placeInColumn, resolvePositionTies, setTaskColumnPositions, TASK_ORDER } from "@/lib/task-positions";
import { rateLimit } from "@/lib/rate-limit";
import { assertTaskCapacity, assertTaskCreateRate } from "@/lib/caps";
import { assertColumnRoom } from "@/lib/column-capacity";
import { assignedPatches, assignOnEnter, assignUndoOps, columnAssignment, finishAssignOnEnter, newTaskAssignment, notifyAssigned, type AssignedPatch } from "@/lib/column-assign";
import { getMaxCommentsPerTask } from "@/lib/app-settings";
import { requireUser, type CurrentUser } from "@/lib/session";
import * as v from "@/lib/validation";
import { dateToIso, isoToDate, todayIso } from "@/lib/dates";
import { normalizeRecurrence, RECURRENCES } from "@/lib/recurrence-date";
import { spawnRecurrences } from "@/lib/recurrence";
import { createDriveFile } from "@/lib/google";
import { GOOGLE_FILE_KINDS, type GoogleFileKind } from "@/lib/google-files";
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
import { parseTasksText, stringifyTaskJson, TASK_JSON_MAX_CHARS } from "@/lib/task-json";
import { checkPastedTask, foldName, fromOtherProject, MAX_TASK_DOCS, PASTE_FIELD_NAME, pastedDocs, quoteName, TaskJsonResolver, taskJsonObjects } from "@/lib/task-json-resolve";

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
  return names.length ? andList(names) : { k: "sin cambios" };
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
    const optional = pickTaskFields(data);
    // Solo se admite evergreen en la columna de la release o en una de plan de trabajo para IA.
    const evergreenColumn = data.evergreen ? db.column.count({ where: { id: data.columnId, role: { in: [...EVERGREEN_COLUMN_ROLES] } } }) : Promise.resolve(0);
    // Con el acceso ya comprobado, las comprobaciones van a la vez (como en updateTask); si fallan varias, gana la
    // primera en el orden de siempre.
    const checks = await Promise.allSettled([
      assertColumnInProject(data.columnId, data.projectId),
      assertLabelsInProject(data.labelIds, data.projectId),
      data.assigneeId ? assertAssignable(data.projectId, data.assigneeId) : null,
      assertDeliverableInProject(data.deliverableId, data.projectId),
      assertKindsInProject([data.kindId], data.projectId),
      patchedFieldKeys(optional).length ? enabledTaskFields(data.projectId).then(async (enabled) => {
        await assertFieldsEnabled(enabled, optional);
        assertStartBeforeDue(enabled, data.startDate, data.dueDate);
      }) : null,
      evergreenColumn,
    ]);
    for (const c of checks) if (c.status === "rejected") throw c.reason;
    const evergreen = data.evergreen && (await evergreenColumn) > 0;
    const repeat = normalizeRecurrence(data.recurrence, data.recurrenceDay, data.dueDate, todayIso(appTimeZone()));
    assertTaskCreateRate(user.id);
    const { task, assigneeId } = await db.$transaction(async (tx) => {
      await assertTaskCapacity(tx, data.projectId);
      // Al final de la columna, con la columna bloqueada: dos altas a la vez no comparten posición.
      await lockColumns(tx, [data.columnId]);
      // Columna «Programa del curso»: como mucho PROGRAM_MAX_SESSIONS sesiones (column-capacity.ts).
      const room = await assertColumnRoom(tx, data.columnId, 1);
      // Columna «Asignación a persona»: la tarea nace de su persona y, sin fecha, con la del plazo (column-assign.ts).
      // Con la columna ya leída por assertColumnRoom: en una columna normal, ninguna consulta más.
      const assigned = newTaskAssignment(await columnAssignment(tx, room), {
        assigneeId: data.assigneeId, dueDate: data.dueDate ? isoToDate(data.dueDate) : null, startDate: optional.startDate ? isoToDate(optional.startDate) : null,
      });
      const position = positionBetween(await lastPositionIn(tx, data.columnId), null);
      const task = await tx.task.create({
        data: {
          projectId: data.projectId,
          columnId: data.columnId,
          title: data.title,
          kindId: data.kindId,
          description: data.description,
          assigneeId: assigned.assigneeId,
          color: data.color,
          linkUrl: data.linkUrl,
          dueDate: assigned.dueDate,
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
      return { task, assigneeId: assigned.assigneeId };
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
    if (assigneeId) await notifyTask({ type: "ASSIGNED", actorId: user.id, taskId: task.id, projectId: data.projectId, recipientIds: [assigneeId], excerpt: makeExcerpt(data.title) });
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
      db.column.findMany({ where: { projectId: id }, orderBy: COLUMN_ORDER, select: { id: true, name: true, position: true, role: true, isDone: true, waitingDays: true, routineTargetColumnId: true, wipLimit: true, assigneeId: true, assignDueDays: true, defaultKindId: true } }),
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
    const optional = pickTaskFields({ priority: data.priority, client: data.client });
    // Plantillas de los tipos elegidos: el texto inicial de la descripción (siempre, como en «Nueva tarea») y, si se piden,
    // las subtareas predefinidas. La descripción, en el idioma de quien crea (los tipos generales de serie se traducen).
    const kindTemplates = Promise.all([
      db.taskKind.findMany({ where: { id: { in: [...new Set(data.tasks.map((t) => t.kindId))] } }, select: { id: true, name: true, titleTemplate: true, descriptionTemplate: true, subtaskTemplate: true } }),
      getLocale(),
    ]).then(([kinds, locale]) => localizeGeneralKinds(kinds, locale));
    // A la vez, como en createTask; si fallan varias, gana la primera en el orden de siempre.
    const checks = await Promise.allSettled([
      assertColumnInProject(data.columnId, data.projectId),
      assertLabelsInProject(data.labelIds, data.projectId),
      data.assigneeId ? assertAssignable(data.projectId, data.assigneeId) : null,
      assertDeliverableInProject(data.deliverableId, data.projectId),
      assertKindsInProject(data.tasks.map((t) => t.kindId), data.projectId),
      patchedFieldKeys(optional).length ? enabledTaskFields(data.projectId).then((enabled) => assertFieldsEnabled(enabled, optional)) : null,
      kindTemplates,
    ]);
    for (const c of checks) if (c.status === "rejected") throw c.reason;
    const labelIds = [...new Set(data.labelIds)];
    const dueDate = data.dueDate ? isoToDate(data.dueDate) : null;
    const templates = new Map<string, string[]>();
    const descriptions = new Map<string, string>();
    for (const k of await kindTemplates) {
      if (data.applySubtaskTemplates && k.subtaskTemplate.length) templates.set(k.id, k.subtaskTemplate);
      // Lo mismo que pone «Nueva tarea» al elegir el tipo (switchKindDescription sin tipo anterior y sin texto).
      const description = switchKindDescription(null, k, "");
      if (description) descriptions.set(k.id, description);
    }
    assertTaskCreateRate(user.id, data.tasks.length);
    const { ids, assigneeId } = await db.$transaction(async (tx) => {
      // Todo o nada: si el lote no cabe, no se crea ninguna.
      await assertTaskCapacity(tx, data.projectId, data.tasks.length);
      await lockColumns(tx, [data.columnId]);
      const room = await assertColumnRoom(tx, data.columnId, data.tasks.length);
      // Columna «Asignación a persona»: todas nacen de su persona (y, sin fecha, con la del plazo).
      const assigned = newTaskAssignment(await columnAssignment(tx, room), { assigneeId: data.assigneeId, dueDate });
      let position = await lastPositionIn(tx, data.columnId);
      const created = await tx.task.createManyAndReturn({
        data: data.tasks.map((t) => {
          position = positionBetween(position, null);
          return {
            projectId: data.projectId,
            columnId: data.columnId,
            title: t.title,
            kindId: t.kindId,
            description: descriptions.get(t.kindId) ?? "",
            assigneeId: assigned.assigneeId,
            dueDate: assigned.dueDate,
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
      return { ids: created.map((t) => t.id), assigneeId: assigned.assigneeId };
    });
    addUndo(...ids.map((id) => ({ t: "task.remove" as const, id })));
    describeAction("Creó {count} en «{col}»: {titles}", { count: tasksN(ids.length), col: await columnName(data.columnId), titles: cutText(data.tasks.map((t) => `«${mentionsToPlain(t.title)}»`).join(", "), 600) }, { taskIds: ids });
    // Un solo aviso para todo el lote (enlaza a la primera tarea), como createTask pero sin inundar al responsable.
    if (assigneeId && ids[0]) {
      await notifyTask({ type: "ASSIGNED", actorId: user.id, taskId: ids[0], projectId: data.projectId, recipientIds: [assigneeId], excerpt: ids.length === 1 ? makeExcerpt(data.tasks[0]!.title) : assignedBatchExcerpt(ids.length) });
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
 * cuotas, disco del servidor) o cuyo fichero falta se omiten y la respuesta lleva `copyNotice`, el aviso para quien duplica.
 * Queda justo detrás de la original en su columna o, con `target` (Ctrl/Alt al soltar una tarjeta arrastrada),
 * en esa columna entre las vecinas indicadas, como moveTask. Con `target.evergreen` (soltada con Ctrl/Alt en el panel de
 * fijas de una columna de release o de plan de trabajo para IA) la copia nace fija, al final de ese panel, con la cadencia
 * de la original si ya era fija: en la misma acción, sin un makeEvergreen después (un solo paso de deshacer y sin que nadie
 * vea un momento la copia como tarea normal). Se deshace de una vez (borra la copia; los ficheros de sus
 * adjuntos se conservan mientras se pueda rehacer y después se borran, como al borrar una tarea).
 */
const duplicateTargetSchema = z
  .object({ columnId: v.id, prevId: v.id.nullable(), nextId: v.id.nullable(), evergreen: z.boolean().optional() })
  .nullable()
  .default(null);

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
        columnId: true, blockedById: true, evergreen: true, evergreenEvery: true, recurrence: true,
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
    const evergreen = dest?.evergreen === true;
    const copy = await db.$transaction(async (tx) => {
      await assertTaskCapacity(tx, projectId);
      if (evergreen) {
        // Solo la columna de la release y las de plan de trabajo para IA tienen panel de fijas (como makeEvergreen).
        const column = await tx.column.findFirst({ where: { id: columnId, projectId, role: { in: [...EVERGREEN_COLUMN_ROLES] } }, select: { id: true } });
        if (!column) throw new AppError("Solo pueden ser fijas las tareas de la columna de la release o de un plan de trabajo para IA.");
      }
      await lockColumns(tx, [columnId]);
      const room = await assertColumnRoom(tx, columnId, 1);
      // Sin destino, entre la original y la siguiente de su columna; con destino, donde se soltó (si las
      // posiciones se agotan, se renumera la columna). La original cuenta como una tarea más de la columna. Fija: al final.
      const { position } = evergreen
        ? { position: positionBetween(await lastPositionIn(tx, columnId), null) }
        : dest
          ? await placeInColumn(tx, columnId, dest.prevId, dest.nextId)
          : await placeInColumn(tx, columnId, taskId, null);
      // Columna «Asignación a persona» (también la propia: la original pudo cambiar de responsable después de entrar).
      const rule = await columnAssignment(tx, room);
      const assigned = newTaskAssignment(rule, { assigneeId: src.assigneeId, dueDate: src.dueDate, startDate: src.startDate });
      const row = await tx.task.create({
        data: {
          projectId,
          columnId,
          title,
          description: src.description,
          kindId: src.kindId,
          color: src.color,
          linkUrl: src.linkUrl,
          assigneeId: assigned.assigneeId,
          dueDate: assigned.dueDate,
          deliverableId: src.deliverableId,
          cost: src.cost, costPaid: src.costPaid, estimatedHours: src.estimatedHours, actualHours: src.actualHours,
          priority: src.priority, client: src.client, startDate: src.startDate,
          // La copia queda bloqueada por la misma tarea que la original.
          blockedById: src.blockedById,
          position,
          ...(evergreen ? { evergreen: true, evergreenEvery: src.evergreen ? src.evergreenEvery : 1 } : {}),
          createdById: user.id,
          labels: { create: src.labels.map((l) => ({ labelId: l.labelId })) },
          subtasks: { create: src.subtasks.map((s) => ({ title: s.title, position: s.position })) },
          // El enlace apunta al mismo documento de Drive: quitarlo de una de las dos no lo borra de Drive ni de la otra.
          links: { create: src.links },
        },
        select: { id: true },
      });
      // Aviso solo si la copia cambia de manos (duplicar una tarea suya en la misma columna no avisa a nadie).
      return { id: row.id, notify: rule && rule.assigneeId !== src.assigneeId ? rule : null };
    });
    addUndo({ t: "task.remove", id: copy.id });
    if (copy.notify) await notifyAssigned(copy.notify, [copy.id], user.id, [{ id: copy.id, title }]);
    noteTasks([copy.id]);
    if (evergreen) describeAction("Duplicó «{title}» como fija en «{col}»", { title: mentionsToPlain(src.title), col: await columnName(columnId) }, { taskId: copy.id });
    else if (columnId === src.columnId) describeAction("Duplicó «{title}»", { title: mentionsToPlain(src.title) }, { taskId: copy.id });
    else describeAction("Duplicó «{title}» en «{col}»", { title: mentionsToPlain(src.title), col: await columnName(columnId) }, { taskId: copy.id });
    // Después de crear la tarea (los ficheros pueden tardar): lo que no se copie se avisa, pero la copia ya existe.
    const copied = await copyTaskAttachments(taskId, copy.id);
    // Las imágenes de la descripción (`![…](/api/attachments/<id>)`) apuntan a los adjuntos de la original: en la copia,
    // a sus propias copias. Si no, borrar el adjunto (o la tarea) original dejaba la imagen rota en la copia.
    const description = remapAttachmentRefs(src.description, copied.ids);
    if (description !== src.description) await db.task.updateMany({ where: { id: copy.id, description: src.description }, data: { description } });
    const notice = await copyNoticeText(copied, projectId, user.role === "ADMIN");
    const row: BoardTask & { copyNotice?: string; repeatDropped?: true } = await loadBoardTask(copy.id);
    // La repetición no se copia (decisión: una copia que también se repitiera duplicaría cada aparición); quien duplica lo
    // ve en el aviso de «Tarea duplicada» (duplicatedMessage, cardActions.ts).
    return { ...row, ...(notice ? { copyNotice: notice } : {}), ...(src.recurrence !== "NONE" ? { repeatDropped: true as const } : {}) };
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
  if (why.has("disk")) parts.push(isAdmin ? t("El disco del servidor está casi lleno: libera espacio y vuelve a duplicarla.") : t("El disco del servidor está casi lleno: avisa a un administrador."));
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
  labelIds: z.array(v.id).max(MAX_TASK_LABELS).optional(),
  /** Cambio de etiquetas en lugar de la lista entera (el detalle): se aplica sobre las de ahora, con la fila bloqueada, y dos personas a la vez no se pisan. */
  addLabelIds: z.array(v.id).max(MAX_TASK_LABELS).optional(),
  removeLabelIds: z.array(v.id).max(MAX_TASK_LABELS).optional(),
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
  prev: { title: string; description?: string; kindId: string; assigneeId: string | null; dueDate: Date | null; color: string | null; linkUrl: string | null; deliverableId: string | null; evergreen: boolean; evergreenEvery: number; blockedById: string | null },
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
    await applyTaskUpdate(user, taskId, patch, since);
    // `undo`: la entrada de deshacer de este guardado, para que el «Deshacer» de un aviso («Descripción borrada») deshaga
    // eso y no lo último que se haya hecho en la tarea después.
    return { ...withClip(await loadBoardTask(taskId), clipOf(patch.title)), undo: trackUndoEntry() };
  });
}

const kindChangeSchema = z.object({ kindId: v.id, title: v.taskTitle.optional(), description: v.description.optional() }).strict();

/**
 * Cambio de tipo desde el detalle (con el título y la descripción que deja la plantilla del nuevo, si cambian): como
 * updateTask y, en la misma transacción, las subtareas del tipo anterior que siguen sin marcar y sin cambiar se
 * sustituyen por las del nuevo que falten (switchKindSubtaskRows). Un solo «Deshacer» devuelve tipo, título, descripción
 * y subtareas. `kindSubtasks`: la lista que queda, solo si ha cambiado alguna (con cuántas se quitan y se añaden).
 */
export async function changeTaskKind(taskId: string, patch: z.input<typeof kindChangeSchema>, since?: string | null | TextSince) {
  return runAction({ name: "tasks.changeTaskKind", args: [taskId, patch, since] }, async () => {
    const user = await requireUser();
    const data = kindChangeSchema.parse(patch);
    let swap: { removed: SubtaskInfo[]; added: SubtaskInfo[]; subtasks: SubtaskInfo[] } | null = null;
    // Nombre del tipo nuevo si el tipo cambia de verdad (para el texto de la acción y del deshacer).
    let kindName: string | null = null;
    // Prefijos de título del tipo anterior y del nuevo: el texto de la acción nombra la tarea sin ellos.
    let kindPrefixes: { titleTemplate: string }[] = [];
    await applyTaskUpdate(user, taskId, data, since, async (tx, prev) => {
      if (prev.kindId === data.kindId) return;
      // La tarea ya está bloqueada (el UPDATE de arriba): nadie añade subtareas a la vez. Las subtareas se leen con su
      // propio candado: quien marca, renombra o borra una a la vez espera, y lo marcado justo antes ya se ve aquí y se
      // queda (si no, se borraba aunque ya estuviera marcada).
      const [kinds, subs] = await Promise.all([
        tx.taskKind.findMany({ where: { id: { in: [prev.kindId, data.kindId] } }, select: { id: true, name: true, subtaskTemplate: true, titleTemplate: true } }),
        tx.$queryRaw<{ id: string; taskId: string; title: string; done: boolean; position: number }[]>`SELECT "id", "taskId", "title", "done", "position" FROM "Subtask" WHERE "taskId" = ${taskId} ORDER BY "position" ASC FOR UPDATE`,
      ]);
      const next = kinds.find((k) => k.id === data.kindId);
      if (!next) return;
      kindName = next.name;
      kindPrefixes = kinds;
      const { remove, add } = switchKindSubtaskRows(kinds.find((k) => k.id === prev.kindId), next, subs, MAX_SUBTASKS);
      if (!remove.length && !add.length) return;
      if (remove.length) await tx.subtask.deleteMany({ where: { id: { in: remove.map((s) => s.id) } } });
      let position = subs.at(-1)?.position;
      const rows = add.length
        ? await tx.subtask.createManyAndReturn({
          data: add.map((title) => ({ taskId, title, position: (position = positionBetween(position, null)) })),
          select: { id: true, title: true, done: true, position: true },
        })
        : [];
      const gone = new Set(remove.map((s) => s.id));
      const strip = ({ taskId: _t, ...s }: (typeof subs)[number]): SubtaskInfo => s;
      swap = {
        removed: remove.map(strip),
        added: rows,
        subtasks: [...subs.filter((s) => !gone.has(s.id)).map(strip), ...rows].sort((a, b) => a.position - b.position),
      };
    });
    const done = swap as { removed: SubtaskInfo[]; added: SubtaskInfo[]; subtasks: SubtaskInfo[] } | null;
    if (done) {
      addUndo(
        ...done.removed.map((s) => ({ t: "subtask.restore" as const, row: { ...s, taskId } })),
        ...done.added.map((s) => ({ t: "subtask.remove" as const, id: s.id })),
      );
      // Historial: qué subtareas se han quitado y cuáles añadido, tras la línea del cambio de tipo.
      recordTaskEvent(taskId, "subtask", kindSubtasksEvent(done.removed.map((s) => s.title), done.added.map((s) => s.title)));
    }
    const task = withClip(await loadBoardTask(taskId), clipOf(patch.title));
    // Un cambio de tipo de verdad se nombra así (en Logs y en el deshacer: «Deshecho el cambio de tipo de «…»»), no como
    // «Modificó «…»: título, descripción y tipo», que es lo que deja applyTaskUpdate. La tarea, sin el prefijo que pone el
    // tipo: «Deshecho el cambio de tipo de «Mudanza: Varias dos»» nombraba la tarea con el del tipo que se deshace.
    if (kindName !== null) describeAction("Cambió el tipo de «{title}» a «{kind}»", { title: mentionsToPlain(titleWithoutKindPrefix(task.title, kindPrefixes)), kind: kindName }, { taskId });
    // `removed`/`added`: cuántas se han quitado y añadido (para el aviso); `undo` (y `kindUndo`, también sin subtareas que
    // cambiar, para el aviso de la plantilla de la descripción): la entrada que deshace todo el cambio.
    const undo = trackUndoEntry();
    return {
      ...task,
      undo,
      ...(kindName !== null ? { kindUndo: undo } : {}),
      ...(done ? { kindSubtasks: { subtasks: done.subtasks, removed: done.removed.length, added: done.added.length, undo } } : {}),
    };
  });
}

/**
 * Línea del historial con las subtareas que ha cambiado el tipo: los títulos (como mucho 3 de cada lista, y «y N más»).
 * `removed` o `added` pueden ir vacías, pero no las dos.
 */
function kindSubtasksEvent(removed: string[], added: string[]): Label {
  const r = quotedList(removed.map((x) => mentionsToPlain(x)));
  const a = quotedList(added.map((x) => mentionsToPlain(x)));
  if (!added.length) return { k: "Quitó las subtareas del tipo anterior: {removed}", p: { removed: r } };
  if (!removed.length) return { k: "Añadió las subtareas del tipo: {added}", p: { added: a } };
  return { k: "Cambió las subtareas del tipo: quitó {removed}; añadió {added}", p: { removed: r, added: a } };
}

/**
 * El cuerpo de updateTask (permiso, validaciones, conflicto de texto, escritura, deshacer, historial y avisos), para
 * usarlo también desde pasteTaskJson dentro de su misma acción (una sola entrada de deshacer).
 */
async function applyTaskUpdate(
  user: CurrentUser,
  taskId: string,
  patch: z.input<typeof updateSchema> & z.input<typeof taskFieldSchema>,
  since?: string | null | TextSince,
  /** Algo más que hacer en la misma transacción, tras escribir la tarea (con `prev`, los valores de antes). */
  alsoInTx?: (tx: Prisma.TransactionClient, prev: { kindId: string }) => Promise<void>,
): Promise<void> {
  {
    since = sinceSchema.parse(since);
    const data = updateSchema.parse(patch);
    if (data.labelIds !== undefined && (data.addLabelIds || data.removeLabelIds)) throw new AppError("Etiquetas: o la lista entera o los cambios, no las dos cosas.");
    // Cambio de etiquetas (no la lista entera): lo que queda se calcula dentro de la transacción.
    const labelDelta = data.addLabelIds || data.removeLabelIds ? { add: [...new Set(data.addLabelIds ?? [])], remove: [...new Set(data.removeLabelIds ?? [])] } : null;
    const optionalIn = taskFieldSchema.parse(patch);
    // Una sola lectura de la tarea (con el permiso) para todo lo que sigue: archivada, conflicto de edición,
    // fija, repetición, valores para deshacer y valores anteriores para el historial y los avisos.
    // Las relaciones (etiquetas) van en una consulta aparte en paralelo: como relación, Prisma la haría después.
    const id = v.id.parse(taskId);
    // La descripción (hasta 20 KB) solo si se edita: es lo único que la usa (deshacer, conflicto e historial).
    const editsDescription = data.description !== undefined;
    const [loaded, labels] = await Promise.all([
      loadTaskWithAccess(user, id, { id: true, ...TASK_UNDO_SELECT, description: editsDescription }),
      data.labelIds !== undefined ? db.taskLabel.findMany({ where: { taskId: id }, select: { labelId: true } }) : undefined,
    ]);
    const task = loaded as Omit<typeof loaded, "description"> & { description?: string };
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
      labelDelta?.add.length ? assertLabelsInProject(labelDelta.add, projectId) : null,
      assertDeliverableInProject(data.deliverableId, projectId),
      assertKindsInProject([data.kindId], projectId),
      data.blockedById ? assertCanBlock(id, data.blockedById, projectId) : null,
      // Evergreen solo tiene sentido en la columna de la release o en una de plan de trabajo para IA.
      data.evergreen ? db.column.count({ where: { id: task.columnId, role: { in: [...EVERGREEN_COLUMN_ROLES] } } }).then((ok) => {
        if (!ok) throw new AppError("Solo pueden ser fijas las tareas de la columna de la release o de un plan de trabajo para IA.");
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
    const { labelIds, addLabelIds: _add, removeLabelIds: _remove, dueDate, recurrence, recurrenceDay, ...rest } = data;
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
    // `changed` solo incluye la descripción si se edita, y entonces se ha leído.
    // Con un cambio de etiquetas, las de antes se leen dentro de la transacción (con la fila bloqueada): el deshacer
    // devuelve la lista que había justo antes de este cambio, no la que se leyó antes de esperar a otra persona.
    if (!labelDelta) addUndo(taskSetOp(task as typeof loaded, changed, labels));
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
        const description = editsDescription ? Prisma.sql`, "description"` : Prisma.empty;
        const [before] = await tx.$queryRaw<{ title: string; description?: string; contentUpdatedAt: Date | null; contentUpdatedById: string | null }[]>`SELECT "title"${description}, "contentUpdatedAt", "contentUpdatedById" FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`;
        if (checkConflict && before) await assertNoTextConflict(id, before, user.id, since, data, tx);
        if (data.description !== undefined) {
          const old = new Set(extractMentionIds(before?.description ?? ""));
          added = extractMentionIds(data.description).filter((id) => !old.has(id));
        }
      } else if (labelIds || labelDelta) {
        // Las etiquetas se borran y se vuelven a crear con la fila bloqueada (la consulta de arriba ya la bloquea): dos
        // cambios a la vez creaban las mismas filas y el segundo fallaba con «Los datos han cambiado mientras tanto».
        await lockTaskRow(tx, taskId);
      }
      // El tipo de antes, leído aquí con la fila bloqueada: otro cambio de tipo que acaba de confirmarse ya cuenta (si no,
      // dos cambios seguidos A → B → C quitaban las subtareas de A, no las de B, y la tarea quedaba con las de B y C).
      const kindBefore = alsoInTx
        ? (await tx.$queryRaw<{ kindId: string }[]>`SELECT "kindId" FROM "Task" WHERE "id" = ${taskId} FOR NO KEY UPDATE`)[0]?.kindId ?? task.kindId
        : task.kindId;
      await tx.task.update({ where: { id: taskId }, data: fields, select: { id: true } });
      if (labelIds) {
        await tx.taskLabel.deleteMany({ where: { taskId } });
        await tx.taskLabel.createMany({ data: [...new Set(labelIds)].map((labelId) => ({ taskId, labelId })) });
      }
      if (labelDelta) {
        const now = (await tx.taskLabel.findMany({ where: { taskId }, select: { labelId: true } })).map((l) => l.labelId);
        addUndo(taskSetOp(task as typeof loaded, changed, now.map((labelId) => ({ labelId }))));
        const have = new Set(now);
        const toAdd = labelDelta.add.filter((l) => !have.has(l) && !labelDelta.remove.includes(l));
        const toRemove = labelDelta.remove.filter((l) => have.has(l));
        if (have.size + toAdd.length - toRemove.length > MAX_TASK_LABELS) throw new AppError("Una tarea no puede tener tantas etiquetas.");
        if (toRemove.length) await tx.taskLabel.deleteMany({ where: { taskId, labelId: { in: toRemove } } });
        if (toAdd.length) await tx.taskLabel.createMany({ data: toAdd.map((labelId) => ({ taskId, labelId })), skipDuplicates: true });
      }
      if (alsoInTx) await alsoInTx(tx, { kindId: kindBefore });
      return added;
    });
    // Para el texto de la acción y el historial, un cambio de etiquetas cuenta como «etiquetas».
    const shown = labelDelta ? { ...data, addLabelIds: undefined, removeLabelIds: undefined, labelIds: [] } : data;
    describeAction("Modificó «{title}»: {changes}", { title: mentionsToPlain(data.title ?? prev.title), changes: describeChanges({ ...shown, ...optional }) }, { taskId });
    await recordUpdateEvents(taskId, prev, shown, dueDate, optional);
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
  }
}

/** Una escritura no ha encontrado la tarea activa: se ha archivado o borrado después de comprobarlo. */
async function inactiveTaskError(client: Pick<typeof db, "task">, taskId: string): Promise<Error> {
  return (await client.task.count({ where: { id: taskId } })) ? new AppError("La tarea está archivada. Restáurala para modificarla.") : notFound();
}

/**
 * Mueve una tarjeta entre dos vecinas (por id) de la columna destino. Si entre ellas hay tareas que el cliente
 * no ve (fijas, archivadas, recién llegadas), queda justo detrás de `prevId`; nunca con la posición de otra.
 */
export async function moveTask(taskId: string, columnId: string, prevId: string | null, nextId: string | null) {
  return runAction({ name: "tasks.moveTask", args: [taskId, columnId, prevId, nextId] }, async () => {
    // `undo`: la entrada de deshacer del movimiento (el aviso «Asignada a…» del tablero lleva «Deshacer»).
    return { ...(await applyTaskMove(await requireUser(), taskId, columnId, prevId, nextId)), undo: trackUndoEntry() };
  });
}

/** El cuerpo de moveTask, para usarlo también desde pasteTaskJson dentro de su misma acción. */
async function applyTaskMove(user: CurrentUser, taskId: string, columnId: string, prevId: string | null, nextId: string | null): Promise<{ position: number; spawned: BoardTask[]; assigned: AssignedPatch[] }> {
  {
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
    const { position, undoPosition, assigned } = await db.$transaction(async (tx) => {
      await lockColumns(tx, [columnId]);
      // Solo cuenta si llega de otra columna: reordenar dentro de la misma no suma.
      const room = await assertColumnRoom(tx, columnId, [taskId]);
      const placed = await placeInColumn(tx, columnId, prevId === taskId ? null : prevId, nextId === taskId ? null : nextId, taskId);
      // Deshacer: la posición ya leída, salvo si se ha renumerado su propia columna (la habrá movido).
      const undoPosition = placed.rebalanced && fromColumnId === columnId
        ? (await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: { position: true } })).position
        : task.position;
      // Solo si sigue activa: otra persona puede haberla archivado después de la comprobación de arriba (quedaría
      // archivada en la columna nueva y con la de antes como origen).
      const { count } = await tx.task.updateMany({ where: { id: taskId, archivedAt: null }, data: { columnId, position: placed.position, evergreen: false, evergreenEvery: 1 } });
      if (!count) throw await inactiveTaskError(tx, taskId);
      // Columna «Asignación a persona»: solo al llegar de otra columna (reordenar dentro de la misma no es entrar). La regla
      // sale de la lectura de assertColumnRoom, hecha con la columna bloqueada: una columna que se convierte a la vez no
      // se escapa, y en una columna normal no hay ninguna consulta más.
      const assigned = fromColumnId !== columnId ? await assignOnEnter(tx, room, [taskId]) : null;
      return { position: placed.position, undoPosition, assigned };
    });
    // Un solo paso de deshacer: vuelve a su columna con el responsable y la fecha límite que tenía.
    const assignUndo = assignUndoOps(assigned)[0]?.data ?? {};
    addUndo({ t: "task.set", id: taskId, data: { columnId: fromColumnId, position: undoPosition, evergreen: task.evergreen, ...(task.evergreen ? { evergreenEvery: task.evergreenEvery } : {}), ...assignUndo } });
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
    await finishAssignOnEnter(assigned, user.id, { undo: false });
    // `assigned`: responsable y fecha nuevos de la tarjeta (columna «Asignación a persona»), para la pestaña que mueve.
    return { position, spawned, assigned: assignedPatches(assigned) };
  }
}

/**
 * Mueve varias tarjetas al final de una columna, conservando su orden relativo («Mover a…» de la barra de selección).
 * Con `at` (arrastrar una selección, o Alt+flechas sobre ella) las deja seguidas entre esas dos vecinas de la columna
 * destino, en el orden del tablero (columna y posición), también las que ya estaban en ella; las mismas reglas que
 * moveTask si las vecinas ya no están (al final). Un solo paso de deshacer en los dos casos.
 */
/** Mismo texto que el aviso del navegador (Board.tsx). */
const TOO_MANY_SELECTED = "Como mucho 500 tarjetas a la vez: selecciona menos.";

export async function moveTasks(taskIds: string[], columnId: string, at?: { prevId: string | null; nextId: string | null } | null) {
  return runAction({ name: "tasks.moveTasks", args: [taskIds, columnId, at] }, async () => {
    const user = await requireUser();
    const ids = z.array(v.id).min(1).max(MAX_SELECTION_ACTION, TOO_MANY_SELECTED).parse(taskIds);
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
    let toMove = place ? tasks : tasks.filter((t) => t.columnId !== column.id);
    noteTasks(toMove.map((t) => t.id));
    let undo = await captureTasks(toMove.map((t) => t.id), ["columnId", "position", "evergreen", "evergreenEvery"]);
    const { moved, assigned } = await db.$transaction(async (tx) => {
      await lockColumns(tx, [column.id]);
      // Columna → tareas (en orden de id), como moveTask y el despliegue de una release.
      await lockTaskRows(tx, toMove.map((t) => t.id));
      // Con las filas bloqueadas se vuelve a mirar cuáles siguen activas: otra persona pudo archivar alguna desde la
      // lectura de arriba, y moverla la dejaría archivada en la columna nueva (como moveTask, que mueve solo si archivedAt es null).
      const alive = new Set((await tx.task.findMany({ where: { id: { in: toMove.map((t) => t.id) }, archivedAt: null }, select: { id: true } })).map((r) => r.id));
      if (alive.size < toMove.length) {
        toMove = toMove.filter((t) => alive.has(t.id));
        undo = undo.filter((op) => op.t !== "task.set" || alive.has(op.id));
      }
      // Todo o nada: si no caben todas las que llegan de otras columnas, no se mueve ninguna.
      const room = await assertColumnRoom(tx, column.id, toMove.map((t) => t.id));
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
      // Columna «Asignación a persona»: las que llegan de otra columna (las que ya estaban solo se recolocan). Con la regla
      // de la lectura de assertColumnRoom, hecha con la columna bloqueada (como moveTask).
      const assigned = await assignOnEnter(tx, room, toMove.filter((t) => t.columnId !== column.id).map((t) => t.id));
      return { moved: list, assigned };
    });
    // Un solo paso de deshacer: también vuelven el responsable y la fecha límite que tenían.
    addUndo(...undo, ...assignUndoOps(assigned));
    // Las recurrentes que no estaban en una columna terminada y llegan a una: nace la siguiente aparición.
    let spawned: BoardTask[] = [];
    if (column.isDone) spawned = await spawnRecurrences(toMove.filter((t) => !t.column.isDone).map((t) => t.id), user.id);
    const colName = column.name;
    describeAction("Movió {count} a «{col}»", { count: tasksN(moved.length), col: colName }, { taskIds: moved.map((m) => m.id) });
    const code = column.isDone ? "done" : "move";
    skipTaskEvents();
    // Historial: solo las que cambian de columna (reordenar dentro de la misma no cuenta, como en moveTask).
    for (const t of toMove) if (t.columnId !== column.id) recordTaskEvent(t.id, code, { k: "Movió la tarea a «{to}»", p: { to: colName } });
    // Un solo aviso a la persona de la columna por todo el lote (como al crear varias asignadas).
    await finishAssignOnEnter(assigned, user.id, { undo: false });
    return { columnId: column.id, moved, spawned, assigned: assignedPatches(assigned), undo: trackUndoEntry() };
  });
}

/**
 * Convierte una tarea en fija (evergreen): la lleva al final de `columnId` (una columna del proyecto con tareas fijas: la
 * de la release o una de plan de trabajo para IA) o, sin ella, al de la columna de la release del proyecto.
 */
export async function makeEvergreen(taskId: string, columnId?: string) {
  return runAction({ name: "tasks.makeEvergreen", args: [taskId, columnId] }, async () => {
    const user = await requireUser();
    const task = await loadTaskWithAccess(user, v.id.parse(taskId), { archivedAt: true });
    assertNotArchivedRow(task);
    const { projectId } = task;
    const target = columnId === undefined ? undefined : v.id.parse(columnId);
    addUndo(...(await captureTasks([taskId], ["columnId", "position", "evergreen"])));
    const result = await db.$transaction(async (tx) => {
      const column = await tx.column.findFirst({
        where: target ? { id: target, projectId, role: { in: [...EVERGREEN_COLUMN_ROLES] } } : { projectId, role: "NEXT_RELEASE" },
        select: { id: true, role: true },
      });
      if (!column) throw new AppError(target ? "Solo pueden ser fijas las tareas de la columna de la release o de un plan de trabajo para IA." : "El proyecto no tiene columna de release.");
      await lockColumns(tx, [column.id]);
      const position = positionBetween(await lastPositionIn(tx, column.id, taskId), null);
      // Solo si sigue activa: otra persona puede haberla archivado después de la comprobación de arriba (quedaría
      // archivada y marcada como fija), como en applyTaskMove.
      const { count } = await tx.task.updateMany({ where: { id: taskId, archivedAt: null }, data: { columnId: column.id, position, evergreen: true } });
      if (!count) throw await inactiveTaskError(tx, taskId);
      return { columnId: column.id, position, plan: column.role === "AI_PLAN" };
    });
    describeAction(result.plan ? "Marcó «{title}» como fija en el plan" : "Marcó «{title}» como fija en la release", { title: (await taskLabel(taskId)).title }, { taskId, columnId: result.columnId });
    return { columnId: result.columnId, position: result.position };
  });
}

export async function archiveTask(taskId: string) {
  return runAction({ name: "tasks.archiveTask", args: [taskId] }, async () => {
    const user = await requireUser();
    const task = await loadTaskWithAccess(user, v.id.parse(taskId), { archivedAt: true });
    assertNotArchivedRow(task);
    describeAction("Archivó «{title}»", { title: (await taskLabel(taskId)).title }, { taskId });
    addUndo(...(await captureTasks([taskId], ARCHIVE_FIELDS)));
    // La columna de origen, la que tiene al archivarla (como archiveTasks): si otra persona la mueve a la vez, la leída
    // antes ya no vale. Y solo si sigue activa (archivada a la vez desde otra pestaña).
    const now = new Date();
    const archived = await db.$executeRaw`UPDATE "Task" SET "archivedAt" = ${now}, "archivedFromColumnId" = "columnId", "evergreen" = false, "evergreenEvery" = 1, "updatedAt" = ${now} WHERE "id" = ${taskId} AND "archivedAt" IS NULL`;
    if (!archived) throw await inactiveTaskError(db, taskId);
    return { spawned: await spawnRecurrences([taskId], user.id) };
  });
}

/** Archiva varias tareas (selección múltiple), recordando la columna de la que salen. */
export async function archiveTasks(taskIds: string[]) {
  return runAction({ name: "tasks.archiveTasks", args: [taskIds] }, async () => {
    const user = await requireUser();
    const requested = [...new Set(z.array(v.id).min(1).max(MAX_SELECTION_ACTION, TOO_MANY_SELECTED).parse(taskIds))];
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
    noteTasks(active);
    addUndo(...(await captureTasks(active, ARCHIVE_FIELDS)));
    // Filas bloqueadas antes, en orden de id: el UPDATE solo las bloquearía en el orden en que las recorre (40P01).
    await db.$transaction(async (tx) => {
      await lockTaskRows(tx, active);
      await tx.$executeRaw`UPDATE "Task" SET "archivedAt" = ${new Date()}, "archivedFromColumnId" = "columnId", "evergreen" = false, "evergreenEvery" = 1 WHERE "id" IN (${Prisma.join(active)}) AND "archivedAt" IS NULL`;
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

export async function deleteTask(taskId: string) {
  return runAction({ name: "tasks.deleteTask", args: [taskId] }, async () => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    describeAction("Borró la tarea «{title}»", { title: (await taskLabel(taskId)).title }, { taskId });
    // Los ficheros de sus adjuntos se conservan mientras se pueda deshacer (ver undo.ts). La base de datos quita el
    // bloqueo de las que dependían de ella (SetNull): dependentLinkOps se lo devuelve al deshacer, si siguen sin otro.
    addUndo(...(await dependentLinkOps([taskId])), ...(await snapshotTasks([taskId])));
    await db.task.delete({ where: { id: taskId } });
    forgetTaskAttachments([taskId]);
  });
}

/** Borra varias tareas (selección múltiple) con sus adjuntos. Solo las que el usuario puede ver. */
export async function deleteTasks(taskIds: string[]) {
  return runAction({ name: "tasks.deleteTasks", args: [taskIds] }, async () => {
    const user = await requireUser();
    const requested = [...new Set(z.array(v.id).min(1).max(MAX_SELECTION_ACTION, TOO_MANY_SELECTED).parse(taskIds))];
    // Las que ya no existen o no se ven se ignoran en vez de fallar toda la acción.
    const tasks = await db.task.findMany({ where: { id: { in: requested }, project: visibleProjectsWhere(user) }, select: { id: true, projectId: true } });
    if (!tasks.length) return { deleted: 0 };
    const ids = tasks.map((t) => t.id);
    // Todas deben ser del mismo proyecto: el deshacer se guarda por proyecto.
    if (new Set(tasks.map((t) => t.projectId)).size > 1) throw new AppError("Las tareas son de proyectos distintos.");
    noteProject(tasks[0]?.projectId);
    noteTasks(ids);
    addUndo(...(await dependentLinkOps(ids)), ...(await snapshotTasks(ids)));
    const titles = await db.task.findMany({ where: { id: { in: ids } }, select: { title: true } });
    describeAction("Borró {count}: {titles}", { count: tasksN(ids.length), titles: cutText(titles.map((t) => `«${mentionsToPlain(t.title)}»`).join(", "), 600) }, { taskIds: ids });
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
    // El acceso va dentro de la propia consulta (mismo filtro que assertTaskAccess); los comentarios y su recuento, en
    // paralelo (se descartan si la tarea no se ve). Los comentarios van aparte y no anidados: Prisma no pone LIMIT a un
    // `take` anidado (los leería todos y recortaría en memoria), y una tarea puede tener cientos.
    const [task, firstComments, commentCount] = await Promise.all([db.task.findFirst({
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
      },
    }),
    // Solo los más recientes; los anteriores se piden con getOlderComments.
    db.taskComment.findMany({ where: { taskId: id }, orderBy: COMMENT_ORDER, take: COMMENTS_FIRST_PAGE, select: commentSelect }),
    db.taskComment.count({ where: { taskId: id, deletedAt: null } })]);
    if (!task) throw notFound();
    noteProject(task.projectId);
    noteTask(id);
    const oldest = firstComments.at(-1);
    const olderComments = oldest && firstComments.length === COMMENTS_FIRST_PAGE ? await db.taskComment.count({ where: olderThan(task.id, oldest) }) : 0;
    return {
      id: task.id,
      description: task.description,
      createdAt: task.createdAt.toISOString(),
      createdByName: task.createdBy?.name ?? null,
      textVersion: task.contentUpdatedAt?.toISOString() ?? null,
      subtasks: task.subtasks,
      attachments: task.attachments,
      links: task.links,
      comments: firstComments.reverse().map(toCommentInfo),
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
      const data = names.slice(0, room).map((title) => ({ taskId, title, position: (position = positionBetween(position, null)) }));
      // Una sola consulta para todas (antes, una por subtarea con la tarea bloqueada).
      const rows = await tx.subtask.createManyAndReturn({ data, select: { id: true, title: true, done: true, position: true } });
      const created: SubtaskInfo[] = rows.sort((a, b) => a.position - b.position);
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
      // Posiciones agotadas (muy raro): se renumera la lista y se recalcula. Cambian las posiciones de todas, no solo la
      // devuelta: la propia pestaña también se refresca (la acción va en ECHO_SAFE_ACTIONS).
      needOwnRefresh();
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
  labelIds: z.array(v.id).max(MAX_TASK_LABELS),
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
  links: z.array(z.object({ id: v.id, kind: z.enum(GOOGLE_FILE_KINDS), title: z.string().max(300), url: z.string().max(2000), shareStatus: z.string().max(20).nullish(), shareFailed: z.number().int().min(0).optional() })).max(100).optional(),
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
  return runAction({ name: "tasks.restoreTaskSnapshot", args: [taskId, snapshot, since] }, async (): Promise<{ task: BoardTask; changed: boolean; removed: string[]; undo?: { id?: string } }> => {
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
    // La tarea fija solo existe en la columna de la release (o de un plan para IA): si la columna en la que queda no lo es, no se restaura la
    // marca, y si la tenía (p. ej. otra persona la fijó después de que la llevaras allí) la pierde, como al moverla.
    const finalColumn = (fields.columnId as string | undefined) ?? task.columnId;
    if (((fields.evergreen as boolean | undefined) ?? task.evergreen) && !(await db.column.count({ where: { id: finalColumn, role: { in: [...EVERGREEN_COLUMN_ROLES] } } }))) {
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
    // Etiquetas que creó un pegado en JSON en el rato y que, con las etiquetas devueltas, ya no usa ninguna tarea: se borran.
    const createdHere = labelsChanged ? [...mine.labelsCreated].filter((l) => !wantedLabels.includes(l)) : [];
    const removedLabels = await db.$transaction(async (tx) => {
      if (typeof fields.blockedById === "string") {
        // Misma regla que updateTask: comprobación y escritura bajo el candado de bloqueos del proyecto.
        // Si entretanto otra petición lo hizo imposible, ese campo se deja como está (como hace la comprobación previa).
        await lockBlocking(tx, projectId);
        if (await blockProblem(id, fields.blockedById, projectId, tx)) delete fields.blockedById;
      }
      // Etiquetas: borrar y volver a crear con la fila bloqueada, como updateTask.
      if (labelsChanged) await lockTaskRow(tx, id);
      if (Object.keys(fields).length) await tx.task.update({ where: { id }, data: fields, select: { id: true } });
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
      if (!createdHere.length) return [];
      const unused = await tx.label.findMany({ where: { id: { in: createdHere }, projectId, tasks: { none: {} } }, select: { id: true, projectId: true, name: true, color: true } });
      if (unused.length) await tx.label.deleteMany({ where: { id: { in: unused.map((l) => l.id) }, tasks: { none: {} } } });
      return unused;
    });
    // Deshacer «Cancelar» las devuelve antes que las etiquetas de la tarea (van al final: se aplica de la última a la primera).
    if (removedLabels.length) {
      addUndo(...removedLabels.map((row) => ({ t: "label.restore" as const, row })));
      needOwnRefresh();
    }
    forgetAttachments([...attDelete, ...spawnedAtts]);
    if (fields.columnId !== undefined) await resolvePositionTies([id]);
    describeAction("Canceló los cambios en «{title}»", { title: mentionsToPlain(task.title) }, { taskId: id });
    // `removed`: tareas que han desaparecido del tablero (la siguiente aparición retirada), para quitarlas sin esperar al refresco.
    // `undo`: la entrada que devuelve lo descartado (el «Deshacer» de «Cambios descartados» deshace eso y nada más).
    return { task: await loadBoardTask(id), changed: true, removed: spawned, undo: trackUndoEntry() };
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
    const column = origin ?? (await db.column.findFirst({ where: { projectId }, orderBy: COLUMN_ORDER, select: { id: true, name: true } }));
    if (!column) throw new AppError("El proyecto no tiene columnas.");
    const undo = await captureTasks([taskId], ARCHIVE_FIELDS);
    const assigned = await db.$transaction(async (tx) => {
      // Al recuperarla vuelve a contar como activa: si el proyecto está en el tope, no cabe.
      await assertTaskCapacity(tx, projectId);
      await lockColumns(tx, [column.id]);
      // Se vuelve a comprobar dentro de la transacción y con la fila bloqueada (después de los candados del proyecto y
      // la columna, como al mover): otra pestaña pudo recuperarla entre medias, y sin el bloqueo las dos salían bien.
      const [fresh] = await tx.$queryRaw<{ archivedAt: Date | null }[]>`SELECT "archivedAt" FROM "Task" WHERE "id" = ${taskId} FOR NO KEY UPDATE`;
      if (!fresh?.archivedAt) throw new AppError("La tarea no está archivada.");
      const room = await assertColumnRoom(tx, column.id, [taskId]);
      const position = positionBetween(await lastPositionIn(tx, column.id, taskId), null);
      // columnEnteredAt/waitingNotifiedAt a mano: si la columna no cambia, el disparador no actúa.
      await tx.task.update({ where: { id: taskId }, data: { archivedAt: null, archivedFromColumnId: null, columnId: column.id, position, columnEnteredAt: new Date(), waitingNotifiedAt: null }, select: { id: true } });
      // Vuelve a entrar en su columna: si es «Asignación a persona», pasa a su persona (como al moverla allí).
      return assignOnEnter(tx, room, [taskId]);
    });
    addUndo(...undo, ...assignUndoOps(assigned));
    describeAction("Restauró «{title}» en «{col}»", { title: (await taskLabel(taskId)).title, col: column.name }, { taskId });
    await finishAssignOnEnter(assigned, user.id, { undo: false });
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

/**
 * Refresco en vivo de los comentarios (otra persona comentó, editó o borró): la primera página, la misma que trae el
 * detalle al abrirse (lo nuevo siempre cae en ella), con los recuentos. No relee lo cargado con «Ver anteriores»: un
 * cambio en un comentario más antiguo se ve al volver a abrir la tarea. Solo lectura.
 */
export async function getRecentComments(taskId: string) {
  return runAction({ name: "tasks.getRecentComments", args: [taskId] }, async (): Promise<{ comments: CommentInfo[]; olderComments: number; commentCount: number }> => {
    const user = await requireUser();
    await assertTaskAccess(user, v.id.parse(taskId));
    const [rows, commentCount] = await Promise.all([
      db.taskComment.findMany({ where: { taskId }, orderBy: COMMENT_ORDER, take: COMMENTS_FIRST_PAGE, select: commentSelect }),
      db.taskComment.count({ where: { taskId, deletedAt: null } }),
    ]);
    const oldest = rows.at(-1);
    const olderComments = oldest && rows.length === COMMENTS_FIRST_PAGE ? await db.taskComment.count({ where: olderThan(taskId, oldest) }) : 0;
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
    describeAction("Editó un comentario en «{title}»", { title: mentionsToPlain(found.task.title) }, { taskId });
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
    describeAction("Borró un comentario de «{title}»", { title: mentionsToPlain(comment.task.title) }, { taskId: comment.taskId });
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

/** Crea un Google Doc, Sheet o Slides en el Drive del usuario y lo enlaza a la tarea. */
export async function createGoogleFile(taskId: string, kind: GoogleFileKind, title: string) {
  return runAction({ name: "tasks.createGoogleFile", args: [taskId, kind, title] }, async (): Promise<TaskLinkInfo> => {
    const user = await requireUser();
    const task = await loadTaskWithAccess(user, v.id.parse(taskId), { archivedAt: true });
    assertNotArchivedRow(task);
    const { projectId } = task;
    if (!rateLimit(`google-file:${user.id}`, 20, 60_000)) throw new AppError("Demasiados documentos creados seguidos. Espera un minuto.");
    const fileKind = z.enum(GOOGLE_FILE_KINDS).parse(kind);
    const name = v.title.parse(title);
    // El mismo tope de documentos por tarea que al pegar o importar; se mira antes de crear el archivo en Google Drive.
    if ((await db.taskLink.count({ where: { taskId } })) >= MAX_TASK_DOCS) {
      const t = await getT();
      throw new AppError(t("Esta tarea ya tiene el máximo de {max} documentos de Google.", { max: MAX_TASK_DOCS }));
    }
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

// --- Copiar y pegar una tarea como JSON (formato en lib/task-json.ts) ----------------

/**
 * La tarea como JSON (texto listo para el portapapeles): solo lo que ve quien la copia, con nombres en vez de ids. Del
 * responsable van su id y su nombre, nunca su email (ver la cabecera de lib/task-json.ts): al pegar se busca por id y,
 * en otra instalación, por nombre.
 */
export async function getTaskJson(taskId: string) {
  return runAction({ name: "tasks.getTaskJson", args: [taskId] }, async (): Promise<string> => {
    const user = await requireUser();
    const id = v.id.parse(taskId);
    const [row] = await taskJsonObjects({ id, project: visibleProjectsWhere(user) }, await getLocale());
    if (!row) throw notFound();
    noteProject(row.projectId);
    noteTask(id);
    describeAction("Copió la tarea «{title}» como JSON", { title: mentionsToPlain(row.title) }, { taskId: id });
    return stringifyTaskJson(row.json);
  });
}

/** Campos de la tarjeta que puede escribir un pegado (los de updateTask). */
type PastePatch = z.input<typeof updateSchema> & z.input<typeof taskFieldSchema>;

/**
 * Quita del pegado lo que no cambia nada (mismo valor que ya tiene la tarea): así un pegado repetido no deja entrada de
 * deshacer ni línea en el historial.
 */
function dropUnchanged(patch: PastePatch, task: Prisma.TaskGetPayload<{ select: typeof TASK_UNDO_SELECT }>, labelsNow: string[] | null): void {
  if (patch.title !== undefined && clampTitle(patch.title.trim()).value === task.title) delete patch.title;
  if (patch.description !== undefined && patch.description === task.description) delete patch.description;
  if (patch.color !== undefined && patch.color === task.color) delete patch.color;
  if (patch.linkUrl !== undefined && patch.linkUrl === task.linkUrl) delete patch.linkUrl;
  if (patch.dueDate !== undefined && patch.dueDate === dateToIso(task.dueDate)) delete patch.dueDate;
  if (patch.kindId !== undefined && patch.kindId === task.kindId) delete patch.kindId;
  if (patch.assigneeId !== undefined && patch.assigneeId === task.assigneeId) delete patch.assigneeId;
  if (patch.deliverableId !== undefined && patch.deliverableId === task.deliverableId) delete patch.deliverableId;
  if (patch.blockedById !== undefined && patch.blockedById === task.blockedById) delete patch.blockedById;
  if (patch.recurrence !== undefined && patch.recurrence === task.recurrence && (patch.recurrenceDay === undefined || patch.recurrenceDay === task.recurrenceDay)) {
    delete patch.recurrence;
    delete patch.recurrenceDay;
  }
  const optional = pickTaskFields(patch as z.infer<typeof taskFieldSchema>);
  const changedOptional = onlyChangedFields(task, optional);
  for (const k of patchedFieldKeys(optional)) if (!(k in changedOptional)) delete (patch as Record<string, unknown>)[k];
  if (patch.labelIds && labelsNow) {
    const want = new Set(patch.labelIds);
    if (want.size === labelsNow.length && labelsNow.every((l) => want.has(l))) delete patch.labelIds;
  }
}

/**
 * Pegar una tarea en JSON (formato «pizarro.task», ver lib/task-json.ts) sobre la tarea abierta: escribe los campos que
 * trae el JSON (los que no trae no se tocan) en UNA acción, con una sola entrada de deshacer. `text` es el texto del
 * portapapeles (o del fichero) tal cual: se interpreta y valida aquí; nada de lo que diga se usa sin comprobarlo contra el
 * proyecto de la tarea (tipo, columna, etiquetas, responsable, entregable y dependencia se buscan SOLO en ese proyecto;
 * ver TaskJsonResolver). Si el texto trae varias tareas, no se pega ninguna (eso es «Importar» del tablero). Reglas de
 * siempre: acceso a la tarea, no archivada, longitudes, 20 etiquetas y 100 subtareas por tarea, campos opcionales activos,
 * responsable con acceso, columna con sitio, tope y ritmo de etiquetas nuevas, conflicto de texto (`since`, como
 * updateTask). Lo que no se puede aplicar no detiene el pegado: se devuelve en `skipped` (textos breves, ya traducidos).
 * Los adjuntos no se tocan. Deshacer también borra las etiquetas que creó el pegado, si ya no las usa nadie. Si no cambia
 * nada (`changed: false`), no deja entrada de deshacer ni línea en el historial.
 */
export async function pasteTaskJson(taskId: string, text: string, since?: string | null | TextSince) {
  // El texto no va al registro (puede ser largo y lo que cambia ya queda en el historial de la tarea).
  return runAction({ name: "tasks.pasteTaskJson", args: [taskId] }, async (): Promise<{ task: BoardTask; skipped: string[]; spawned: BoardTask[]; changed: boolean }> => {
    const user = await requireUser();
    const id = v.id.parse(taskId);
    const raw = z.string().max(TASK_JSON_MAX_CHARS, "El JSON de la tarea es demasiado largo.").parse(text);
    const task = await loadTaskWithAccess(user, id, TASK_UNDO_SELECT);
    assertNotArchivedRow(task);
    const { projectId } = task;
    if (!rateLimit(`paste-task:${user.id}`, 30, 60_000)) throw new AppError("Demasiados pegados seguidos. Espera un momento.");
    const [t, locale] = await Promise.all([getT(), getLocale()]);
    const read = parseTasksText(raw, { t, timeZone: appTimeZone(), locale });
    if (read.error) throw new AppError(read.error);
    if (read.tasks.length > 1 || read.tooMany) throw new AppError(t("Hay {n} tareas. Para importar varias, usa «Importar» en el tablero.", { n: read.total }));
    const one = read.tasks[0];
    if (!one) throw new AppError("El JSON de la tarea no es válido.");
    const checked = checkPastedTask(one.task, t);
    if (!checked.ok) throw new AppError(checked.error);
    const json = checked.data;
    const skipped: string[] = one.problems.map((f) => t(PASTE_FIELD_NAME[f]));
    const skip = (what: string) => {
      if (!skipped.includes(what)) skipped.push(what);
    };
    const r = new TaskJsonResolver(user, projectId, t, locale);
    const patch: PastePatch = { ...(await r.fields(json, skip, { dueDate: dateToIso(task.dueDate), startDate: dateToIso(task.startDate) })) };
    // Dependencia: de otro proyecto (según `info`) se ignora sin avisar; si no, por id y después por título.
    if (json.dependsOn !== undefined && !fromOtherProject(json, projectId)) {
      if (json.dependsOn === null) patch.blockedById = null;
      else {
        const [blocker] = await r.blockers([{ ...json.dependsOn, exclude: id }]);
        if (blocker && !(await blockProblem(id, blocker, projectId))) patch.blockedById = blocker;
        else skip(t("dependencia «{name}»", { name: quoteName(json.dependsOn.title ?? json.dependsOn.id ?? "") }));
      }
    }
    // Etiquetas: las que existen (sin mirar mayúsculas ni tildes) y, las que no, se crean si caben (tope del proyecto y ritmo).
    let createdLabels: string[] = [];
    if (json.labels !== undefined) {
      const names = r.labelNames(json.labels, skip);
      const { ids, created } = await r.ensureLabels(names, () => skip);
      createdLabels = created;
      patch.labelIds = [...new Set(names.flatMap((n) => ids.get(foldName(n)) ?? []))];
    }
    const labelsNow = patch.labelIds ? (await db.taskLabel.findMany({ where: { taskId: id }, select: { labelId: true } })).map((l) => l.labelId) : null;
    dropUnchanged(patch, task, labelsNow);
    let changed = false;
    // Deshacer: las etiquetas creadas se borran después de devolver las de la tarea (se anotan antes; se aplica al revés).
    if (createdLabels.length) addUndo(...createdLabels.map((labelId) => ({ t: "label.remove" as const, id: labelId, taskId: id })));
    // Campos de la tarjeta: todo o nada (si el texto cambió entretanto, 409 y no se escribe nada).
    if (Object.keys(patch).length) {
      try {
        await applyTaskUpdate(user, id, patch, since);
        changed = true;
      } catch (err) {
        // Las etiquetas recién creadas no se quedan sin uso si el pegado no llega a hacerse.
        if (createdLabels.length) await db.label.deleteMany({ where: { id: { in: createdLabels }, projectId, tasks: { none: {} } } }).catch(() => undefined);
        throw err;
      }
    }
    // Etiquetas nuevas: la pestaña que pega también tiene que volver a leer las del proyecto.
    if (createdLabels.length) needOwnRefresh();
    // Desde aquí ya hay cambios guardados: lo que falle se avisa y no se pierde ni el resto ni el deshacer.
    const soft = async (what: string, run: () => Promise<void>) => {
      try {
        await run();
      } catch (err) {
        if (err instanceof AppError) skip(`${what}: ${t(err.message)}`);
        else {
          console.error("[paste-task]", err);
          skip(what);
        }
      }
    };
    let spawned: BoardTask[] = [];
    if (json.column !== undefined) {
      const column = await r.columnId(json.column);
      if (!column) skip(t("columna «{name}» (no existe)", { name: quoteName(json.column) }));
      else if (column !== task.columnId) {
        await soft(t("columna"), async () => {
          spawned = (await applyTaskMove(user, id, column, null, null)).spawned;
          changed = true;
        });
      }
    }
    if (json.subtasks !== undefined) {
      const wanted = r.subtasks(json.subtasks, skip);
      await soft(t("subtareas"), async () => {
        if (!rateLimit(`subtask:${user.id}`, 60, 60_000)) throw new AppError("Demasiadas subtareas seguidas. Espera un momento.");
        const ops = await db.$transaction(async (tx) => {
          await lockTaskRow(tx, id);
          const now = await tx.subtask.findMany({ where: { taskId: id }, orderBy: { position: "asc" }, select: { id: true, taskId: true, title: true, done: true, position: true } });
          if (now.length === wanted.length && now.every((s, i) => s.title === wanted[i]!.title && s.done === wanted[i]!.done)) return null;
          await tx.subtask.deleteMany({ where: { taskId: id } });
          const created = wanted.length
            ? await tx.subtask.createManyAndReturn({ data: wanted.map((s, i) => ({ taskId: id, title: s.title, done: s.done, position: (i + 1) * POSITION_STEP })), select: { id: true } })
            : [];
          // Deshacer (se aplica de la última a la primera): primero se quitan las pegadas y luego vuelven las de antes.
          return [...now.map((row) => ({ t: "subtask.restore" as const, row })), ...created.map((s) => ({ t: "subtask.remove" as const, id: s.id }))];
        });
        if (!ops) return;
        addUndo(...ops);
        recordTaskEvent(id, "subtask", { k: "Sustituyó las subtareas por las pegadas ({subs})", p: { subs: subtasksN(wanted.length) } });
        changed = true;
      });
    }
    if (json.googleDocs?.length) {
      const fresh = pastedDocs(json.googleDocs);
      await soft(t("documentos de Google"), async () => {
        // Con la fila de la tarea bloqueada: dos pegados a la vez no pasan del tope de documentos por tarea.
        const res = await db.$transaction(async (tx) => {
          await lockTaskRow(tx, id);
          const have = new Set((await tx.taskLink.findMany({ where: { taskId: id }, select: { url: true } })).map((h) => h.url));
          const missing = fresh.filter((d) => !have.has(d.url));
          const room = Math.max(0, MAX_TASK_DOCS - have.size);
          const add = missing.slice(0, room);
          const created = add.length
            ? await tx.taskLink.createManyAndReturn({ data: add.map((d) => ({ taskId: id, kind: d.kind, title: d.title, url: d.url, createdById: user.id })), select: { id: true } })
            : [];
          return { created, over: missing.length > room };
        });
        if (res.over) skip(t("documentos de Google (máximo {max} por tarea)", { max: MAX_TASK_DOCS }));
        if (!res.created.length) return;
        addUndo(...res.created.map((l) => ({ t: "link.remove" as const, id: l.id })));
        recordTaskEvent(id, "other", { k: "Enlazó documentos de Google pegados ({n})", p: { n: res.created.length } });
        changed = true;
      });
    }
    // En el historial, delante de los cambios que detalla; si no cambió nada, ni eso.
    if (changed) recordTaskEvent(id, "update", { k: "Pegó el contenido de una tarea en JSON" }, true);
    else skipTaskEvents();
    describeAction("Pegó una tarea en JSON sobre «{title}»", { title: mentionsToPlain(task.title) }, { taskId: id, fields: Object.keys(json), skipped: skipped.length, changed });
    return { task: await loadBoardTask(id), skipped, spawned, changed };
  });
}
