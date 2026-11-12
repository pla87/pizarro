import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { dateToIso } from "./dates";
import { projectUsersWhere } from "./access";
import { db } from "./db";
import { TASK_ORDER } from "./task-positions";
import type { AttachmentTotals, BoardTask } from "./types";

const boardTaskSelect = {
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
  // Solo id y título de la tarea que bloquea (una consulta por lote, sin N+1).
  blockedBy: { select: { id: true, title: true } },
  labels: { select: { labelId: true } },
  subtasks: { select: { done: true } },
  // Solo el flag de cada adjunto: la tarjeta distingue imágenes de otros ficheros.
  attachments: { select: { isImage: true, size: true } },
  // Para UNA tarea (loadBoardTask) el planificador filtra el recuento por su id. Para listas no: Prisma 7 lo convierte en
  // un LEFT JOIN a un GROUP BY de TODA la tabla de comentarios y de enlaces del servidor; ahí se cuenta aparte (taskCounts).
  _count: { select: { comments: { where: { deletedAt: null } }, links: true } },
} satisfies Prisma.TaskSelect;

/** Igual que boardTaskSelect pero sin recuentos (taskCounts). */
const { _count: _counts, ...boardTaskManySelect } = boardTaskSelect;
/** Además sin la descripción: en el tablero completo solo hace falta saber si la hay. */
const { description: _description, ...boardTaskListSelect } = boardTaskManySelect;

type BoardTaskBaseRow = Omit<Prisma.TaskGetPayload<{ select: typeof boardTaskManySelect }>, "description"> & { description?: string };
type BoardTaskRow = BoardTaskBaseRow & { _count: TaskCounts };
interface TaskCounts { comments: number; links: number }

function toBoardTask(t: BoardTaskRow): BoardTask {
  return toBoardTaskWith(t, (t.description ?? "").trim().length > 0, t._count);
}

/**
 * Comentarios (sin los borrados) y enlaces por tarea, con dos groupBy filtrados (por proyecto o por ids) que usan los
 * índices por taskId: solo leen las filas de esas tareas, no las de todo el servidor.
 */
async function taskCounts(scope: { task: Prisma.TaskWhereInput } | { taskId: { in: string[] } }): Promise<(id: string) => TaskCounts> {
  const [comments, links] = await Promise.all([
    db.taskComment.groupBy({ by: ["taskId"], where: { deletedAt: null, ...scope }, _count: { _all: true } }),
    db.taskLink.groupBy({ by: ["taskId"], where: scope, _count: { _all: true } }),
  ]);
  const c = new Map(comments.map((r) => [r.taskId, r._count._all]));
  const l = new Map(links.map((r) => [r.taskId, r._count._all]));
  return (id) => ({ comments: c.get(id) ?? 0, links: l.get(id) ?? 0 });
}

function toBoardTaskWith(t: BoardTaskBaseRow, hasDescription: boolean, counts: TaskCounts): BoardTask {
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
    commentCount: counts.comments,
    linkCount: counts.links,
    evergreen: t.evergreen,
    evergreenEvery: t.evergreenEvery,
    recurrence: t.recurrence,
    recurrenceDay: t.recurrenceDay,
    textVersion: t.contentUpdatedAt?.toISOString() ?? null,
    columnEnteredAt: t.columnEnteredAt.toISOString(),
    blockedBy: t.blockedBy,
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
  const [rows, described, counts] = await Promise.all([
    db.task.findMany({ where, orderBy: TASK_ORDER, select: boardTaskListSelect }),
    db.task.findMany({ where: { ...where, description: { not: "" } }, select: { id: true } }),
    taskCounts({ task: where }),
  ]);
  const withText = new Set(described.map((d) => d.id));
  return rows.map((r) => toBoardTaskWith(r, withText.has(r.id), counts(r.id)));
}

/** Varias tareas por id (p. ej. las recién creadas), en el orden del tablero y con sus recuentos. */
export async function loadBoardTasksByIds(ids: string[]): Promise<BoardTask[]> {
  if (!ids.length) return [];
  const [rows, counts] = await Promise.all([
    db.task.findMany({ where: { id: { in: ids } }, orderBy: TASK_ORDER, select: boardTaskManySelect }),
    taskCounts({ taskId: { in: ids } }),
  ]);
  return rows.map((r) => toBoardTaskWith(r, r.description.trim().length > 0, counts(r.id)));
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

/** Selección común de los tipos (con su automatización). */
const kindSelect = { id: true, name: true, color: true, titleTemplate: true, descriptionTemplate: true, subtaskTemplate: true } as const;

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
