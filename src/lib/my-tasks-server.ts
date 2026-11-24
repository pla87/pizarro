import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { visibleProjectsWhere } from "./access";
import { isoToDate } from "./dates";
import { db } from "./db";
import type { CurrentUser } from "./session";

/** Lo que sale en «Mis tareas»: asignadas a la persona, sin archivar, fuera de las columnas «hechas» y de proyectos que ve. */
export function myOpenTasksWhere(user: CurrentUser): Prisma.TaskWhereInput {
  return { assigneeId: user.id, archivedAt: null, column: { isDone: false }, project: visibleProjectsWhere(user) };
}

/**
 * Cuántas de «Mis tareas» están vencidas (fecha límite antes de `today`, YYYY-MM-DD en la zona de la app): el grupo
 * «Vencidas» de esa página. Un solo `count` (lo pide la página de Avisos para no decir «Estás al día» con tareas vencidas).
 */
export async function overdueMyTasksCount(user: CurrentUser, today: string): Promise<number> {
  return db.task.count({ where: { ...myOpenTasksWhere(user), dueDate: { lt: isoToDate(today) } } });
}
