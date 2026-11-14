import "server-only";
import { db } from "./db";
import type { CurrentUser } from "./session";

/** Proyecto de equipo abierto por un administrador que no lo tiene en «Proyectos en los que trabajo». */
export interface OutsideListProject {
  id: string;
  name: string;
}

/**
 * Si `projectId` es un proyecto de equipo que el administrador puede abrir pero no está en su lista (no lo ha elegido y
 * no es miembro), su id y nombre; si no, null. El selector y la navegación del proyecto lo muestran igualmente, marcado
 * «No está en tus proyectos», sin añadirlo solo a la lista. Para quien no es administrador siempre es null: su lista
 * son todos los proyectos a los que tiene acceso, y uno sin acceso no existe para él.
 */
export async function outsideListProject(user: Pick<CurrentUser, "id" | "role">, projectId: string): Promise<OutsideListProject | null> {
  if (user.role !== "ADMIN" || !projectId || projectId.length > 40 || projectId.includes("\0")) return null;
  return db.project.findFirst({
    where: { id: projectId, isPrivate: false, adminPicks: { none: { userId: user.id } }, members: { none: { userId: user.id } } },
    select: { id: true, name: true },
  });
}
