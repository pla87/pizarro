import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { dateToIso } from "./dates";
import { projectUsersWhere } from "./access";
import { db } from "./db";
import type { BoardTask } from "./types";

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
  recurrence: true,
  recurrenceDay: true,
  contentUpdatedAt: true,
  labels: { select: { labelId: true } },
  subtasks: { select: { done: true } },
  // Solo el flag de cada adjunto: la tarjeta distingue imágenes de otros ficheros.
  attachments: { select: { isImage: true } },
  _count: { select: { comments: true, links: true } },
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
    hasDescription,
    dueDate: dateToIso(t.dueDate),
    deliverableId: t.deliverableId,
    commentCount: t._count.comments,
    linkCount: t._count.links,
    evergreen: t.evergreen,
    recurrence: t.recurrence,
    recurrenceDay: t.recurrenceDay,
    textVersion: t.contentUpdatedAt?.toISOString() ?? null,
  };
}

/**
 * Tareas activas del tablero. No se traen las descripciones (pueden ser largas y se enviarían
 * todas al cliente): una consulta ligera dice cuáles tienen y el detalle se pide al abrir la tarea.
 */
export async function loadBoardTasks(projectId: string): Promise<BoardTask[]> {
  const where = { projectId, archivedAt: null };
  const [rows, described] = await Promise.all([
    db.task.findMany({ where, orderBy: { position: "asc" }, select: boardTaskListSelect }),
    db.task.findMany({ where: { ...where, description: { not: "" } }, select: { id: true } }),
  ]);
  const withText = new Set(described.map((d) => d.id));
  return rows.map((r) => toBoardTaskWith(r, withText.has(r.id)));
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

/** Zona horaria de referencia para «hoy» en plazos e informes. */
export function appTimeZone(): string {
  return process.env.APP_TIMEZONE || "Europe/Madrid";
}

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
