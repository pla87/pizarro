import "server-only";
import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { visibleProjectsWhere } from "./access";
import { db } from "./db";
import type { CurrentUser } from "./session";

/**
 * Avisos que la persona puede ver: los de tareas de proyectos a los que sigue teniendo acceso y los de proyecto
 * (PROJECT_TO_TEAM, sin tarea) de esos mismos proyectos. Para la campana, su contador y la insignia de la app.
 */
export function visibleNotificationsWhere(user: CurrentUser): Prisma.NotificationWhereInput {
  const projects = visibleProjectsWhere(user);
  return { userId: user.id, OR: [{ task: { project: projects } }, { taskId: null, project: projects }] };
}

/** Tope del recuento de sin leer: la interfaz dice «99+» o «Más de 99 sin leer» a partir de 100 (AppShell, Avisos). */
export const UNREAD_COUNT_CAP = 100;

/**
 * Avisos visibles sin leer, como mucho `UNREAD_COUNT_CAP`. Va en cada página (layout) y en cada `router.refresh()`.
 * No es un `count({ take })`: Prisma lo traduce a `… ORDER BY "id" LIMIT 100`, y con ese orden PostgreSQL puede
 * recorrer la clave primaria de los avisos de todas las personas (50–100 ms con 300.000). Ordenado por `createdAt`
 * usa el índice `(userId, readAt, createdAt)`, que solo toca los de esta persona. Memoizado por petición: el layout
 * y la página de Avisos piden el mismo número.
 */
export const unreadCount = cache(async (userId: string, role: CurrentUser["role"]): Promise<number> => {
  const user = { id: userId, role } as CurrentUser;
  const rows = await db.notification.findMany({
    where: { ...visibleNotificationsWhere(user), readAt: null },
    orderBy: { createdAt: "desc" },
    take: UNREAD_COUNT_CAP,
    select: { id: true },
  });
  return rows.length;
});
