"use server";

import { z } from "zod";
import { assertProjectAccess } from "@/lib/access";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getT } from "@/i18n/server";
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

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Informe semanal por email de un proyecto: quien tenga acceso al proyecto lo configura (destinatario, día de la semana
 * y hora). Activarlo reinicia el «ya enviado»; cambiar el día o la hora no (lo ya enviado esta semana no se repite). Nadie escribe el email de otra persona: se
 * elige de la lista por nombre, así que la respuesta no dice si una dirección es de alguien.
 */
export async function saveReportSchedule(projectId: string, input: z.input<typeof schema>) {
  return runAction({ name: "projects.saveReportSchedule", args: [projectId, logged(input)] }, async () => {
    const user = await requireUser();
    const pid = v.id.parse(projectId);
    const data = schema.parse(input);
    await assertProjectAccess(user, pid);
    if (!rateLimit(`report-schedule:${user.id}`, 20, 60 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const prev = await db.reportSchedule.findUnique({ where: { projectId: pid }, select: { enabled: true, recipient: true, unsubscribedEmail: true } });
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
    // Su destinatario se dio de baja con el enlace del email: nadie más puede volver a activarlo hacia esa dirección, ni
    // siquiera un administrador (no sabe si esa persona lo quiere; si lo quiere, lo activa ella con su sesión). Elegir a
    // otra persona sí se puede. Al activarlo la propia persona, la baja se olvida.
    const unsubscribed = prev?.unsubscribedEmail ?? null;
    const resubscribing = data.enabled && unsubscribed !== null && sameEmail(unsubscribed, recipient);
    if (resubscribing && !sameEmail(user.email, recipient)) {
      const t = await getT();
      const person = await db.user.findFirst({ where: { email: { equals: recipient, mode: "insensitive" } }, select: { name: true } });
      throw new AppError(person
        ? t("{name} se dio de baja de este informe: solo esa persona puede volver a activarlo para sí misma. Elige a otra.", { name: person.name })
        : t("Esa dirección se dio de baja de este informe: no se le puede volver a enviar. Elige otra."));
    }
    // lastSentAt no se reinicia: cambiar el día o la hora, o desactivarlo y volver a activarlo, no lo repite si el último
    // salió hace menos de 3 días (reportDue). Uno más antiguo (o ninguno) ya cuenta como pendiente.
    const row = { enabled: data.enabled, recipient, weekday: data.weekday, hour: data.hour, ...(resubscribing ? { unsubscribedEmail: null, unsubscribedAt: null } : {}) };
    await db.reportSchedule.upsert({
      where: { projectId: pid },
      create: { projectId: pid, ...row, createdById: user.id },
      // Quien guarda pasa a ser quien «firma» el informe (su acceso al proyecto es el que se comprueba al enviar).
      update: { ...row, createdById: user.id },
    });
    describeAction(
      resubscribing ? "Volvió a activar para sí el informe semanal por email del que se había dado de baja" : data.enabled ? "Programó el informe semanal por email" : "Desactivó el informe semanal por email",
      { weekday: data.weekday, hour: data.hour },
    );
  });
}
