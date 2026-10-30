import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { dateToIso } from "./dates";
import { projectUsersWhere } from "./access";
import { db } from "./db";
import { TASK_ORDER } from "./task-positions";
import type { AttachmentTotals, BoardTask } from "./types";

export const boardTaskSelect = {
  id: true,
  columnId: true,
  title: true,
  kindId: true,
  color: true,
  linkUrl: true,
  position: true,
  assigneeId: true,
  dueDate: true,
  deliverableId: true,
  description: true,
  evergreen: true,
  evergreenEvery: true,
  recurrence: true,
  recurrenceDay: true,
  contentUpdatedAt: true,
  columnEnteredAt: true,
  cost: true, costPaid: true, estimatedHours: true, actualHours: true, priority: true, client: true, startDate: true,
  labels: { select: { labelId: true } },
  subtasks: { select: { done: true } },
  // Solo el flag de cada adjunto: la tarjeta distingue imágenes de otros ficheros.
  attachments: { select: { isImage: true, size: true } },
  _count: { select: { comments: { where: { deletedAt: null } }, links: true } },
} satisfies Prisma.TaskSelect;

/** Igual que boardTaskSelect pero sin la descripción: en el tablero completo solo hace falta saber si la hay. */
const { description: _description, ...boardTaskListSelect } = boardTaskSelect;

type BoardTaskRow = Omit<Prisma.TaskGetPayload<{ select: typeof boardTaskSelect }>, "description"> & { description?: string };

export function toBoardTask(t: BoardTaskRow): BoardTask {
  return toBoardTaskWith(t, (t.description ?? "").trim().length > 0);
}

function toBoardTaskWith(t: BoardTaskRow, hasDescription: boolean): BoardTask {
  return {
    id: t.id,
    columnId: t.columnId,
    title: t.title,
    kindId: t.kindId,
    color: t.color,
    linkUrl: t.linkUrl,
    position: t.position,
    assigneeId: t.assigneeId,
    labelIds: t.labels.map((l) => l.labelId),
    subtaskTotal: t.subtasks.length,
    subtaskDone: t.subtasks.filter((s) => s.done).length,
    imageCount: t.attachments.filter((a) => a.isImage).length,
    fileCount: t.attachments.filter((a) => !a.isImage).length,
    attachBytes: t.attachments.reduce((n, a) => n + a.size, 0),
    hasDescription,
    dueDate: dateToIso(t.dueDate),
    deliverableId: t.deliverableId,
    commentCount: t._count.comments,
    linkCount: t._count.links,
    evergreen: t.evergreen,
    evergreenEvery: t.evergreenEvery,
    recurrence: t.recurrence,
    recurrenceDay: t.recurrenceDay,
    textVersion: t.contentUpdatedAt?.toISOString() ?? null,
    columnEnteredAt: t.columnEnteredAt.toISOString(),
    cost: t.cost?.toFixed(2) ?? null,
    costPaid: t.costPaid,
    estimatedHours: t.estimatedHours?.toFixed(2) ?? null,
    actualHours: t.actualHours?.toFixed(2) ?? null,
    priority: t.priority,
    client: t.client,
    startDate: dateToIso(t.startDate),
  };
}

/**
 * Tareas activas del tablero. No se traen las descripciones (pueden ser largas y se enviarían
 * todas al cliente): una consulta ligera dice cuáles tienen y el detalle se pide al abrir la tarea.
 */
export async function loadBoardTasks(projectId: string): Promise<BoardTask[]> {
  const where = { projectId, archivedAt: null };
  const [rows, described] = await Promise.all([
    db.task.findMany({ where, orderBy: TASK_ORDER, select: boardTaskListSelect }),
    db.task.findMany({ where: { ...where, description: { not: "" } }, select: { id: true } }),
  ]);
  const withText = new Set(described.map((d) => d.id));
  return rows.map((r) => toBoardTaskWith(r, withText.has(r.id)));
}

/**
 * Contadores de adjuntos de una tarea según las filas de TaskAttachment (nunca los ficheros del disco, que se
 * conservan un tiempo para poder deshacer un borrado). El cliente los usa como valor absoluto, no como suma.
 */
export async function attachmentTotals(taskId: string, client: Pick<typeof db, "taskAttachment"> = db): Promise<AttachmentTotals> {
  const rows = await client.taskAttachment.groupBy({ by: ["isImage"], where: { taskId }, _count: { _all: true }, _sum: { size: true } });
  const imgs = rows.find((r) => r.isImage);
  const files = rows.find((r) => !r.isImage);
  return { imageCount: imgs?._count._all ?? 0, fileCount: files?._count._all ?? 0, attachBytes: (imgs?._sum.size ?? 0) + (files?._sum.size ?? 0) };
}

export async function loadBoardTask(id: string): Promise<BoardTask> {
  return toBoardTask(await db.task.findUniqueOrThrow({ where: { id }, select: boardTaskSelect }));
}

/** Usuarios activos que pueden ver el proyecto (para el selector de asignación). */
export async function projectUsers(projectId: string, project: { isPrivate: boolean }) {
  return db.user.findMany({
    where: { active: true, ...projectUsersWhere(project, projectId) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Zona horaria de referencia para «hoy» en plazos e informes (la misma que usa el navegador, ver format.ts). */
export { appTimeZone } from "./format";

/** Tipos de tarea: sin proyecto, solo los generales; con proyecto, los generales y después los de ese proyecto. */
/** Selección común de los tipos (con su automatización). */
export const kindSelect = { id: true, name: true, color: true, titleTemplate: true, descriptionTemplate: true, subtaskTemplate: true } as const;

/**
 * Tipos de tarea: sin proyecto, solo los generales; con proyecto, los generales que el proyecto
 * usa (los que haya ocultado no aparecen) y después los propios del proyecto.
 */
export function listKinds(projectId?: string) {
  return db.taskKind.findMany({
    where: projectId
      ? { OR: [{ projectId: null, hiddenIn: { none: { projectId } } }, { projectId }] }
      : { projectId: null },
    orderBy: [{ projectId: { sort: "asc", nulls: "first" } }, { position: "asc" }, { createdAt: "asc" }],
    select: kindSelect,
  });
}

export async function userTemplates(userId: string) {
  const rows = await db.releaseTemplate.findMany({
    where: { userId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, kind: true, name: true, content: true },
  });
  const pick = (kind: "HEADER" | "FOOTER") => rows.filter((r) => r.kind === kind).map(({ id, name, content }) => ({ id, name, content }));
  return { headers: pick("HEADER"), footers: pick("FOOTER") };
}

/** Cabeceras y pies de release definidos en el proyecto, en el orden que se les dio. */
export async function projectReleaseTemplates(projectId: string) {
  const rows = await db.projectReleaseTemplate.findMany({
    where: { projectId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, kind: true, name: true, content: true },
  });
  const pick = (kind: "HEADER" | "FOOTER") => rows.filter((r) => r.kind === kind).map(({ id, name, content }) => ({ id, name, content }));
  return { headers: pick("HEADER"), footers: pick("FOOTER") };
}

/** Clientes distintos ya usados en las tareas del proyecto (para sugerir en el campo «Cliente»). */
export async function projectClients(projectId: string): Promise<string[]> {
  const rows = await db.task.groupBy({ by: ["client"], where: { projectId, client: { not: null } }, orderBy: { client: "asc" }, take: 200 });
  return rows.map((r) => r.client!).filter(Boolean);
}
