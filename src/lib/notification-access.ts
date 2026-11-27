import "server-only";
import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { visibleProjectsWhere } from "./access";
import { db } from "./db";
import type { CurrentUser } from "./session";
import { UNREAD_COUNT_CAP } from "./unread-core";

/**
 * Avisos que la persona puede ver: los de tareas de proyectos a los que sigue teniendo acceso, los de proyecto
 * (PROJECT_TO_TEAM, sin tarea) de esos mismos proyectos y las menciones en notas de Documentación de esos proyectos
 * (también si la nota está en la papelera: al abrirlo, Documentación lo dice). Para la campana, su contador y la insignia.
 */
export function visibleNotificationsWhere(user: CurrentUser): Prisma.NotificationWhereInput {
  const projects = visibleProjectsWhere(user);
  return { userId: user.id, OR: [{ task: { project: projects } }, { taskId: null, project: projects }, { taskId: null, document: { project: projects } }] };
}

/**
 * Avisos visibles sin leer, como mucho `UNREAD_COUNT_CAP`. No es un `count({ take })`: Prisma lo traduce a
 * `… ORDER BY "id" LIMIT 100`, y con ese orden PostgreSQL puede recorrer la clave primaria de los avisos de todas las
 * personas (50–100 ms con 300.000). Ordenado por `createdAt` usa el índice `(userId, readAt, createdAt)`, que solo toca
 * los de esta persona. Sin memoizar: lo usan también las acciones que marcan avisos como leídos, que devuelven el número
 * de después.
 */
export async function countUnread(userId: string, role: CurrentUser["role"]): Promise<number> {
  const user = { id: userId, role } as CurrentUser;
  const rows = await db.notification.findMany({
    where: { ...visibleNotificationsWhere(user), readAt: null },
    orderBy: { createdAt: "desc" },
    take: UNREAD_COUNT_CAP,
    select: { id: true },
  });
  return rows.length;
}

/**
 * `countUnread` memoizado por petición: va en cada página (layout) y en cada `router.refresh()`, y el layout y la página
 * de Avisos piden el mismo número.
 */
export const unreadCount = cache(countUnread);
