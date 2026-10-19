import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { notFound } from "./errors";
import type { CurrentUser } from "./session";

/**
 * Filtro Prisma con los proyectos visibles para el usuario. Un proyecto privado solo lo ve su
 * dueño (tampoco el resto de administradores); los admins ven todos los demás; los miembros,
 * los no restringidos y aquellos en los que figuran.
 */
export function visibleProjectsWhere(user: CurrentUser): Prisma.ProjectWhereInput {
  const notOthersPrivate: Prisma.ProjectWhereInput = { OR: [{ privateOwnerId: null }, { privateOwnerId: user.id }] };
  if (user.role === "ADMIN") return notOthersPrivate;
  return { AND: [notOthersPrivate, { OR: [{ restricted: false }, { members: { some: { userId: user.id } } }] }] };
}

export async function listVisibleProjects(user: CurrentUser) {
  return db.project.findMany({
    where: visibleProjectsWhere(user),
    select: { id: true, name: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

export async function assertProjectAccess(user: CurrentUser, projectId: string): Promise<void> {
  const found = await db.project.count({ where: { id: projectId, ...visibleProjectsWhere(user) } });
  if (!found) throw notFound();
}

/** Devuelve el projectId de la tarea si el usuario puede verla. */
export async function assertTaskAccess(user: CurrentUser, taskId: string): Promise<{ projectId: string; columnId: string }> {
  const task = await db.task.findFirst({
    where: { id: taskId, project: visibleProjectsWhere(user) },
    select: { projectId: true, columnId: true },
  });
  if (!task) throw notFound();
  return task;
}

/** Lanza error si el usuario no puede ser asignado a tareas del proyecto. */
export async function assertAssignable(projectId: string, userId: string): Promise<void> {
  const [user, project] = await Promise.all([
    db.user.findFirst({
      where: { id: userId, active: true },
      select: { role: true, memberships: { where: { projectId }, select: { userId: true } } },
    }),
    db.project.findUnique({ where: { id: projectId }, select: { restricted: true, privateOwnerId: true } }),
  ]);
  if (!user || !project) throw notFound();
  if (project.privateOwnerId && project.privateOwnerId !== userId) throw notFound();
  if (project.restricted && user.role !== "ADMIN" && user.memberships.length === 0) throw notFound();
}
