import "server-only";
import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { noteProject, noteTask } from "./action-context";
import { db } from "./db";
import { AppError, forbidden, notFound } from "./errors";
import * as v from "./validation";
import type { CurrentUser } from "./session";

/**
 * Filtro Prisma con los proyectos a los que el usuario puede acceder. Un proyecto privado solo lo ven sus
 * miembros (tampoco los administradores). Los de equipo los ven sus usuarios asignados (ProjectMember) y
 * todos los administradores, estén o no entre los que han elegido para trabajar.
 */
export function visibleProjectsWhere(user: CurrentUser): Prisma.ProjectWhereInput {
  const member: Prisma.ProjectWhereInput = { members: { some: { userId: user.id } } };
  if (user.role === "ADMIN") return { OR: [{ isPrivate: false }, member] };
  return member;
}

/**
 * Proyectos en los que el usuario trabaja: los que salen en selectores, menús y filtros. Para quien no es
 * administrador son todos los accesibles; un administrador, solo los de equipo que ha elegido en su perfil
 * (AdminProjectPick) y los privados de los que es miembro.
 */
export function workingProjectsWhere(user: CurrentUser): Prisma.ProjectWhereInput {
  if (user.role !== "ADMIN") return visibleProjectsWhere(user);
  return { OR: [{ isPrivate: false, adminPicks: { some: { userId: user.id } } }, { members: { some: { userId: user.id } } }] };
}

/** Usuarios que pueden ver y usar un proyecto: sus miembros y, si no es privado, también todos los administradores. */
export function projectUsersWhere(project: { isPrivate: boolean }, projectId: string): Prisma.UserWhereInput {
  const member: Prisma.UserWhereInput = { memberships: { some: { projectId } } };
  return project.isPrivate ? member : { OR: [{ role: "ADMIN" }, member] };
}

/** Proyectos para menús y selectores. Con `all`, todos los accesibles (p. ej. pantallas de administración). */
export async function listVisibleProjects(user: CurrentUser, opts?: { all?: boolean }) {
  return listProjectsCached(user.id, user.role, !!opts?.all);
}

// Memoizado por petición: el layout y la página piden la misma lista.
const listProjectsCached = cache(async (userId: string, role: CurrentUser["role"], all: boolean) => {
  const user = { id: userId, role } as CurrentUser;
  return db.project.findMany({
    where: all ? visibleProjectsWhere(user) : workingProjectsWhere(user),
    select: { id: true, name: true, isPrivate: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
});

export async function assertProjectAccess(user: CurrentUser, projectId: string): Promise<void> {
  const found = await db.project.count({ where: { id: projectId, ...visibleProjectsWhere(user) } });
  if (!found) throw notFound();
  noteProject(projectId);
}

/**
 * Proyecto sobre el que el usuario puede actuar (renombrar, borrar, cambiar miembros): los administradores
 * en cualquier proyecto que vean; el resto, solo en privados de los que son miembros (las
 * consultas ya filtran por visibilidad, así que un privado ajeno no existe para nadie).
 */
export async function findManageableProject(user: CurrentUser, projectId: string) {
  const project = await db.project.findFirst({ where: { id: v.id.parse(projectId), ...visibleProjectsWhere(user) }, select: { id: true, name: true, isPrivate: true } });
  if (!project) throw notFound();
  noteProject(project.id, project.isPrivate);
  if (user.role !== "ADMIN" && !project.isPrivate) throw forbidden();
  return project;
}

/** Devuelve el projectId de la tarea si el usuario puede verla. */
export async function assertTaskAccess(user: CurrentUser, taskId: string): Promise<{ projectId: string; columnId: string }> {
  return loadTaskWithAccess(user, taskId, {});
}

/**
 * Como assertTaskAccess, pero en la misma consulta trae además los campos de `select` (p. ej. archivedAt,
 * título o la columna actual): las acciones más usadas se ahorran así varias idas y vueltas a la base de datos.
 */
export async function loadTaskWithAccess<S extends Prisma.TaskSelect>(
  user: CurrentUser,
  taskId: string,
  select: S,
): Promise<Prisma.TaskGetPayload<{ select: S }> & { projectId: string; columnId: string }> {
  const task = (await db.task.findFirst({
    where: { id: taskId, project: visibleProjectsWhere(user) },
    select: { ...(select as Prisma.TaskSelect), projectId: true, columnId: true },
  })) as unknown as (Prisma.TaskGetPayload<{ select: S }> & { projectId: string; columnId: string }) | null;
  if (!task) throw notFound();
  noteProject(task.projectId);
  noteTask(taskId);
  return task;
}

/** Mismo error que assertNotArchived, con la fecha ya cargada. */
export function assertNotArchivedRow(task: { archivedAt: Date | null }): void {
  if (task.archivedAt) throw new AppError("La tarea está archivada. Recupérala para modificarla.");
}

/** Lanza error si el usuario no puede ser asignado a tareas del proyecto. */
export async function assertAssignable(projectId: string, userId: string): Promise<void> {
  const [user, project] = await Promise.all([
    db.user.findFirst({ where: { id: userId, active: true }, select: { role: true, memberships: { where: { projectId }, select: { userId: true } } } }),
    db.project.findUnique({ where: { id: projectId }, select: { isPrivate: true } }),
  ]);
  if (!user || !project) throw notFound();
  // Privado: solo sus miembros. Equipo: miembros asignados y administradores.
  if (user.memberships.length === 0 && (project.isPrivate || user.role !== "ADMIN")) throw notFound();
}

/** Las tareas archivadas son de solo lectura: solo se recuperan (restoreTask) o se borran. */
export async function assertNotArchived(taskId: string): Promise<void> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { archivedAt: true } });
  if (task) assertNotArchivedRow(task);
}
