import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { maskEmail } from "./mask-email";

/**
 * ¿Puede salir el informe de este proyecto hacia esta dirección? Sí si es de un usuario activo que ve el
 * proyecto. Una dirección externa solo la acepta un administrador, y nunca en un proyecto privado.
 */
export async function reportRecipientAllowed(projectId: string, recipient: string, setterRole: "ADMIN" | "MEMBER"): Promise<boolean> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { isPrivate: true } });
  if (!project) return false;
  const user = await db.user.findFirst({
    where: { email: { equals: recipient, mode: "insensitive" } },
    select: { active: true, role: true, memberships: { where: { projectId }, select: { userId: true } } },
  });
  if (user) {
    if (!user.active) return false;
    return user.memberships.length > 0 || (!project.isPrivate && user.role === "ADMIN");
  }
  return setterRole === "ADMIN" && !project.isPrivate;
}

/** Personas a las que puede ir el informe (por nombre, sin email): miembros activos y, en un proyecto de equipo, administradores activos. */
export async function reportRecipientPeople(projectId: string): Promise<{ id: string; name: string; email: string }[]> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { isPrivate: true } });
  if (!project) return [];
  return db.user.findMany({
    where: { active: true, OR: [{ memberships: { some: { projectId } } }, ...(project.isPrivate ? [] : [{ role: "ADMIN" as const }])] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
}

/**
 * Destinatario guardado tal como lo ve quien abre los ajustes: una persona del proyecto (solo su id: la lista la muestra
 * por nombre) o una dirección que no es de ninguna de ellas. Esa dirección la ve entera un administrador (las pone él y ve
 * los emails de todos en Administración); a los demás les llega enmascarada («a***@example.com»).
 */
export type ReportRecipientView = { kind: "user"; userId: string } | { kind: "external"; shown: string };

export function reportRecipientView(recipient: string, people: { id: string; email: string }[], viewerIsAdmin: boolean): ReportRecipientView {
  const lower = recipient.toLowerCase();
  const person = people.find((p) => p.email.toLowerCase() === lower);
  if (person) return { kind: "user", userId: person.id };
  return { kind: "external", shown: viewerIsAdmin ? recipient : maskEmail(recipient) };
}

/**
 * La baja del destinatario, tal como la ve quien abre los ajustes («<nombre> se dio de baja el <fecha>»): `who` es el
 * nombre de la persona o, si no tiene cuenta, la dirección (entera para un administrador, enmascarada para los demás,
 * como en reportRecipientView). `choice`: la opción de la lista que apunta a esa dirección (para avisar antes de
 * guardar); `external`, la dirección entera solo para un administrador (para compararla con «Otra dirección…»). `self`:
 * es quien mira, que sí puede volver a activárselo.
 */
export type ReportUnsubscribedView = { who: string; at: string; choice: string | null; external: string | null; self: boolean };

export async function reportUnsubscribedView(
  s: { recipient: string; unsubscribedEmail: string | null; unsubscribedAt: Date | null },
  people: { id: string; email: string }[],
  viewer: { email: string; role: "ADMIN" | "MEMBER" },
): Promise<ReportUnsubscribedView | null> {
  if (!s.unsubscribedEmail || !s.unsubscribedAt) return null;
  const email = s.unsubscribedEmail;
  const lower = email.toLowerCase();
  const admin = viewer.role === "ADMIN";
  const account = await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { name: true } });
  const person = people.find((p) => p.email.toLowerCase() === lower);
  return {
    who: account?.name ?? (admin ? email : maskEmail(email)),
    at: s.unsubscribedAt.toISOString(),
    choice: person ? `user:${person.id}` : s.recipient.toLowerCase() === lower ? "keep" : null,
    external: admin && !person ? email : null,
    self: viewer.email.toLowerCase() === lower,
  };
}

/**
 * Una persona cambia de email (lo confirma en Mi perfil o se lo edita un administrador): los informes semanales que iban
 * a su dirección anterior pasan a la nueva, en la misma transacción. Si no, seguían saliendo hacia la vieja (que ya no es
 * de nadie y contaba como «externa») o se desactivaban sin avisar. Devuelve cuántos ha cambiado.
 */
export async function retargetReportSchedules(tx: Prisma.TransactionClient, oldEmail: string, newEmail: string): Promise<number> {
  if (oldEmail === newEmail) return 0;
  // La baja que dio con la dirección anterior sigue valiendo con la nueva (si no, cualquiera podía volver a activárselo).
  await tx.reportSchedule.updateMany({ where: { unsubscribedEmail: { equals: oldEmail, mode: "insensitive" } }, data: { unsubscribedEmail: newEmail } });
  return (await tx.reportSchedule.updateMany({ where: { recipient: { equals: oldEmail, mode: "insensitive" } }, data: { recipient: newEmail } })).count;
}
