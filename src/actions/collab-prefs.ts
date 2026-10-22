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
    const prev = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { dailyDigest: true, digestHour: true } });
    // Al activar el resumen o cambiar la hora se reinicia el «ya enviado hoy»: si la hora aún no ha pasado, llegará hoy.
    const reset = data.dailyDigest && (!prev.dailyDigest || prev.digestHour !== data.digestHour);
    await db.user.update({ where: { id: user.id }, data: { ...data, ...(reset ? { lastDigestAt: null } : {}) } });
  });
}
