import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { visibleProjectsWhere } from "./access";
import type { CurrentUser } from "./session";

/**
 * Avisos que la persona puede ver: los de tareas de proyectos a los que sigue teniendo acceso y los de proyecto
 * (PROJECT_TO_TEAM, sin tarea) de esos mismos proyectos. Para la campana, su contador y la insignia de la app.
 */
export function visibleNotificationsWhere(user: CurrentUser): Prisma.NotificationWhereInput {
  const projects = visibleProjectsWhere(user);
  return { userId: user.id, OR: [{ task: { project: projects } }, { taskId: null, project: projects }] };
}
