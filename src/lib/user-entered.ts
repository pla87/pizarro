import type { Prisma } from "@/generated/prisma/client";

// ¿Ha entrado alguna vez? Un solo criterio para «Invitación pendiente» (Administración → Usuarios, «Reenviar invitación»)
// y para contar los administradores que pueden sostener la instalación (borrar la propia cuenta, quitar el rol).
//
// Invitación pendiente: debe elegir contraseña y nunca ha entrado: sin sesiones, sin dispositivos conocidos (cada acceso
// deja uno, que se conserva 400 días) y sin Google enlazado.

/** Filtro de Prisma: la cuenta ya ha entrado alguna vez (lo contrario de una invitación pendiente). */
export const HAS_ENTERED: Prisma.UserWhereInput = {
  OR: [{ mustChangePassword: false }, { googleSub: { not: null } }, { sessions: { some: {} } }, { knownDevices: { some: {} } }],
};

/** Lo mismo sobre una fila ya leída (con `_count` de sesiones y dispositivos conocidos). */
export function invitePendingFrom(u: { mustChangePassword: boolean; googleSub: string | null; _count: { sessions: number; knownDevices: number } }): boolean {
  return u.mustChangePassword && u.googleSub === null && u._count.sessions === 0 && u._count.knownDevices === 0;
}
