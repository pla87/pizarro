import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { dateToIso } from "./dates";
import { db } from "./db";
import type { BoardTask } from "./types";

export const boardTaskSelect = {
  id: true,
  columnId: true,
  title: true,
  type: true,
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
    type: t.type,
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
