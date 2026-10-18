import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { dateToIso } from "./dates";
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
  labels: { select: { labelId: true } },
  subtasks: { select: { done: true } },
  _count: { select: { attachments: true, comments: true, links: true } },
} satisfies Prisma.TaskSelect;

type BoardTaskRow = Prisma.TaskGetPayload<{ select: typeof boardTaskSelect }>;

export function toBoardTask(t: BoardTaskRow): BoardTask {
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
    attachmentCount: t._count.attachments,
    hasDescription: t.description.trim().length > 0,
    dueDate: dateToIso(t.dueDate),
    deliverableId: t.deliverableId,
    commentCount: t._count.comments,
    linkCount: t._count.links,
  };
}

export async function loadBoardTask(id: string): Promise<BoardTask> {
  return toBoardTask(await db.task.findUniqueOrThrow({ where: { id }, select: boardTaskSelect }));
}

/** Usuarios activos que pueden ver el proyecto (para el selector de asignación). */
export async function projectUsers(projectId: string, restricted: boolean) {
  return db.user.findMany({
    where: restricted
      ? { active: true, OR: [{ role: "ADMIN" }, { memberships: { some: { projectId } } }] }
      : { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Zona horaria de referencia para «hoy» en plazos e informes. */
export function appTimeZone(): string {
  return process.env.APP_TIMEZONE || "Europe/Madrid";
}

/** Tipos de tarea: sin proyecto, solo los generales; con proyecto, los generales y después los de ese proyecto. */
export function listKinds(projectId?: string) {
  return db.taskKind.findMany({
    where: projectId ? { OR: [{ projectId: null }, { projectId }] } : { projectId: null },
    orderBy: [{ projectId: { sort: "asc", nulls: "first" } }, { position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, color: true },
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
