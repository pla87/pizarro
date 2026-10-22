import "server-only";
import { db } from "./db";

/**
 * ¿Puede salir el informe de este proyecto hacia esta dirección? Sí si es de un usuario activo que ve el
 * proyecto. Una dirección externa solo la acepta un administrador, y nunca en un proyecto privado.
 */
export async function reportRecipientAllowed(projectId: string, recipient: string, setterRole: "ADMIN" | "MEMBER"): Promise<boolean> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { isPrivate: true, restricted: true } });
  if (!project) return false;
  const user = await db.user.findFirst({
    where: { email: { equals: recipient, mode: "insensitive" } },
    select: { active: true, role: true, memberships: { where: { projectId }, select: { userId: true } } },
  });
  if (user) {
    if (!user.active) return false;
    if (project.isPrivate) return user.memberships.length > 0;
    if (project.restricted) return user.role === "ADMIN" || user.memberships.length > 0;
    return true;
  }
  return setterRole === "ADMIN" && !project.isPrivate;
}
