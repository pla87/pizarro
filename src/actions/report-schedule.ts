"use server";

import { z } from "zod";
import { assertProjectAccess } from "@/lib/access";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { maskEmail } from "@/lib/mask-email";
import { rateLimit } from "@/lib/rate-limit";
import { reportRecipientAllowed, reportRecipientPeople } from "@/lib/report-recipient";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";

const schema = z.object({
  enabled: z.boolean(),
  /**
   * A quién va: una persona del proyecto (su id, elegida de la lista por nombre), una dirección externa (solo un
   * administrador, en un proyecto de equipo) o el destinatario que ya tenía guardado (que quien no es administrador no ve
   * entero y no puede volver a escribir).
   */
  recipient: z.union([
    z.object({ userId: v.id }).strict(),
    z.object({ email: v.email }).strict(),
    z.object({ keep: z.literal(true) }).strict(),
  ]),
  weekday: z.number().int().min(1).max(7),
  hour: z.number().int().min(0).max(23),
});

/** Lo que va al registro: la dirección escrita a mano, enmascarada. */
function logged(input: unknown): unknown {
  const r = (input as { recipient?: unknown } | null)?.recipient;
  if (!r || typeof r !== "object" || !("email" in r)) return input;
  return { ...(input as object), recipient: { email: maskEmail(String((r as { email: unknown }).email)) } };
}

const NOT_ALLOWED = "El destinatario debe ser alguien con acceso al proyecto.";

/**
 * Informe semanal por email de un proyecto: quien tenga acceso al proyecto lo configura (destinatario, día de la semana
 * y hora). Guardar reinicia el «ya enviado» para que no se pierda el próximo. Nadie escribe el email de otra persona: se
 * elige de la lista por nombre, así que la respuesta no dice si una dirección es de alguien.
 */
export async function saveReportSchedule(projectId: string, input: z.input<typeof schema>) {
  return runAction({ name: "projects.saveReportSchedule", args: [projectId, logged(input)] }, async () => {
    const user = await requireUser();
    const pid = v.id.parse(projectId);
    const data = schema.parse(input);
    await assertProjectAccess(user, pid);
    if (!rateLimit(`report-schedule:${user.id}`, 20, 60 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const prev = await db.reportSchedule.findUnique({ where: { projectId: pid }, select: { weekday: true, hour: true, enabled: true, recipient: true } });
    let recipient: string;
    if ("userId" in data.recipient) {
      const person = (await reportRecipientPeople(pid)).find((p) => p.id === (data.recipient as { userId: string }).userId);
      if (!person) throw new AppError(NOT_ALLOWED);
      recipient = person.email;
    } else if ("email" in data.recipient) {
      // Una dirección escrita a mano solo la pone un administrador (ve los emails de todos en Administración → Usuarios).
      if (user.role !== "ADMIN") throw new AppError("Elige a una persona del proyecto.");
      recipient = data.recipient.email;
    } else {
      if (!prev) throw new AppError("Elige a una persona del proyecto.");
      recipient = prev.recipient;
    }
    // El informe solo puede salir hacia alguien que ya ve el proyecto. Una dirección externa solo la
    // puede poner un administrador, y nunca en un proyecto privado (también al conservar la que había).
    if (data.enabled && !(await reportRecipientAllowed(pid, recipient, user.role))) {
      if ("keep" in data.recipient) {
        // Una dirección externa que puso un administrador: quien no lo es no puede conservarla (ni al cambiar solo el día o la hora).
        const external = user.role !== "ADMIN" && !(await db.user.count({ where: { email: { equals: recipient, mode: "insensitive" } } }));
        if (external) throw new AppError("Solo un administrador puede mantener una dirección externa: elige a una persona del proyecto.");
        throw new AppError("El destinatario guardado ya no vale: elige a una persona del proyecto.");
      }
      throw new AppError(NOT_ALLOWED);
    }
    const reset = !prev || prev.weekday !== data.weekday || prev.hour !== data.hour || prev.enabled !== data.enabled;
    const row = { enabled: data.enabled, recipient, weekday: data.weekday, hour: data.hour };
    await db.reportSchedule.upsert({
      where: { projectId: pid },
      create: { projectId: pid, ...row, createdById: user.id },
      // Quien guarda pasa a ser quien «firma» el informe (su acceso al proyecto es el que se comprueba al enviar).
      update: { ...row, createdById: user.id, ...(reset ? { lastSentAt: null } : {}) },
    });
    describeAction(data.enabled ? "Programó el informe semanal por email" : "Desactivó el informe semanal por email", { weekday: data.weekday, hour: data.hour });
  });
}
