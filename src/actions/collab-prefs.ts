"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { requireUser } from "@/lib/session";

const schema = z.object({
  notifyAssignedEmail: z.boolean(),
  notifyDueEmail: z.boolean(),
  notifyCommentEmail: z.boolean(),
  dailyDigest: z.boolean(),
  digestHour: z.number().int().min(0).max(23),
});

/** Avisos por email de asignaciones, cambios de fecha y comentarios, y resumen diario (los avisos en la app son siempre). */
export async function updateCollabPrefs(input: z.input<typeof schema>) {
  return runAction({ name: "profile.updateCollabPrefs", args: [input] }, async () => {
    const user = await requireUser();
    const data = schema.parse(input);
    // «Ya enviado hoy» (lastDigestAt) no se reinicia nunca: ni al cambiar la hora ni al desactivarlo y volver a activarlo
    // el mismo día, que repetiría el resumen. Con uno antiguo (o ninguno), digestDue ya lo da por pendiente, y gatherDigest
    // no mira más de 48 h atrás.
    await db.user.update({ where: { id: user.id }, data });
  });
}
