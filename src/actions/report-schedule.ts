"use server";

import { z } from "zod";
import { assertProjectAccess } from "@/lib/access";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { reportRecipientAllowed } from "@/lib/report-recipient";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";

const schema = z.object({
  enabled: z.boolean(),
  recipient: v.email,
  weekday: z.number().int().min(1).max(7),
  hour: z.number().int().min(0).max(23),
});

/**
 * Informe semanal por email de un proyecto: quien tenga acceso al proyecto lo configura (destinatario
 * cualquiera, día de la semana y hora). Guardar reinicia el «ya enviado» para que no se pierda el próximo.
 */
export async function saveReportSchedule(projectId: string, input: z.input<typeof schema>) {
  return runAction({ name: "projects.saveReportSchedule", args: [projectId, input] }, async () => {
    const user = await requireUser();
    const pid = v.id.parse(projectId);
    const data = schema.parse(input);
    await assertProjectAccess(user, pid);
    if (!rateLimit(`report-schedule:${user.id}`, 20, 60 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    // El informe solo puede salir hacia alguien que ya ve el proyecto. Una dirección externa solo la
    // puede poner un administrador, y nunca en un proyecto privado.
    if (data.enabled && !(await reportRecipientAllowed(pid, data.recipient, user.role))) {
      throw new AppError("El destinatario debe ser alguien con acceso al proyecto.");
    }
    const prev = await db.reportSchedule.findUnique({ where: { projectId: pid }, select: { weekday: true, hour: true, enabled: true } });
    const reset = !prev || prev.weekday !== data.weekday || prev.hour !== data.hour || prev.enabled !== data.enabled;
    await db.reportSchedule.upsert({
      where: { projectId: pid },
      create: { projectId: pid, ...data, createdById: user.id },
      // Quien guarda pasa a ser quien «firma» el informe (su acceso al proyecto es el que se comprueba al enviar).
      update: { ...data, createdById: user.id, ...(reset ? { lastSentAt: null } : {}) },
    });
    describeAction(data.enabled ? "Programó el informe semanal por email" : "Desactivó el informe semanal por email", { weekday: data.weekday, hour: data.hour });
  });
}
