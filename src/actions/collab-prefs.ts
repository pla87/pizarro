"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { requireUser } from "@/lib/session";

const schema = z.object({
  notifyEmail: z.boolean(),
  notifyAssignedEmail: z.boolean(),
  notifyDueEmail: z.boolean(),
  notifyCommentEmail: z.boolean(),
  dailyDigest: z.boolean(),
  digestHour: z.number().int().min(0).max(23),
  /** Casilla principal «Recibir avisos por email» (v1.79). Sin ella, no se cambia. */
  emailNotices: z.boolean().optional(),
  /** Emails de administración: solo la guarda un administrador (los demás no la ven; su valor no cambia). */
  notifyAdminEmail: z.boolean().optional(),
}).strict();

/**
 * «Notificaciones por email» de Mi perfil → Avisos: la casilla principal, los emails de administración, las de proyectos
 * (menciones en tareas y notas, asignaciones, fechas, comentarios) y su frecuencia (dailyDigest: resumen diario, con su
 * hora), a la vez y en una sola escritura (Telegram y WhatsApp se guardan aparte, actions/messaging.ts).
 */
export async function updateEmailPrefs(input: z.input<typeof schema>) {
  return runAction({ name: "profile.updateEmailPrefs", args: [input] }, async () => {
    const user = await requireUser();
    const { notifyAdminEmail, ...data } = schema.parse(input);
    // «Ya enviado hoy» (lastDigestAt) no se reinicia nunca: ni al cambiar la hora ni al desactivarlo y volver a activarlo
    // el mismo día, que repetiría el resumen. Con uno antiguo (o ninguno), digestDue ya lo da por pendiente, y gatherDigest
    // no mira más de 48 h atrás.
    await db.user.update({ where: { id: user.id }, data: user.role === "ADMIN" && notifyAdminEmail !== undefined ? { ...data, notifyAdminEmail } : data });
    describeAction("Cambió sus avisos por email");
  });
}
