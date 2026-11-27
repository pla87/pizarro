"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { requireUser } from "@/lib/session";
import { NOTE_MENTION_EMAIL_MODES } from "@/lib/note-mention-pref";

const schema = z.object({
  notifyEmail: z.boolean(),
  notifyAssignedEmail: z.boolean(),
  notifyDueEmail: z.boolean(),
  notifyCommentEmail: z.boolean(),
  dailyDigest: z.boolean(),
  digestHour: z.number().int().min(0).max(23),
  /** Menciones en notas: solo si la persona la ha elegido (sin elegir, sigue a las demás opciones; noteMentionEmailMode). */
  noteMentionEmail: z.enum(NOTE_MENTION_EMAIL_MODES).optional(),
}).strict();

/**
 * «Avisos por email» de Mi perfil → Avisos: todas las casillas de email (menciones, asignaciones, cambios de fecha,
 * comentarios), las menciones en notas y el resumen diario con su hora, a la vez y en una sola escritura (los avisos en la app son siempre;
 * Telegram y WhatsApp se guardan aparte, actions/messaging.ts).
 */
export async function updateEmailPrefs(input: z.input<typeof schema>) {
  return runAction({ name: "profile.updateEmailPrefs", args: [input] }, async () => {
    const user = await requireUser();
    const data = schema.parse(input);
    // «Ya enviado hoy» (lastDigestAt) no se reinicia nunca: ni al cambiar la hora ni al desactivarlo y volver a activarlo
    // el mismo día, que repetiría el resumen. Con uno antiguo (o ninguno), digestDue ya lo da por pendiente, y gatherDigest
    // no mira más de 48 h atrás.
    await db.user.update({ where: { id: user.id }, data });
    describeAction("Cambió sus avisos por email");
  });
}
