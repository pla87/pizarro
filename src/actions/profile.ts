"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { MAX_TEMPLATE } from "@/lib/constants";
import { AppError } from "@/lib/errors";
import { hashPassword, MIN_PASSWORD, verifyPassword } from "@/lib/password";
import { createSession, requireUser } from "@/lib/session";
import { disconnectGoogleAccount } from "@/lib/google";
import { rateLimit } from "@/lib/rate-limit";
import * as v from "@/lib/validation";

export async function updateProfileName(name: string) {
  return runAction(async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { name: v.name.parse(name) } });
  });
}

const templateText = z.string().max(MAX_TEMPLATE, "La plantilla es demasiado larga.");

export async function updateReleaseTemplates(header: string, footer: string) {
  return runAction(async () => {
    const user = await requireUser();
    await db.user.update({
      where: { id: user.id },
      data: { releaseHeaderTemplate: templateText.parse(header), releaseFooterTemplate: templateText.parse(footer) },
    });
  });
}

export async function changePassword(current: string, next: string) {
  return runAction(async () => {
    const user = await requireUser();
    const pw = z.string().min(MIN_PASSWORD, `La nueva contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`).max(200).parse(next);
    if (!rateLimit(`password:${user.id}`, 5, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (!(await verifyPassword(z.string().max(200).parse(current), row.passwordHash))) {
      throw new AppError("La contraseña actual no es correcta.");
    }
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pw) } }),
      db.session.deleteMany({ where: { userId: user.id } }),
    ]);
    // Se cierran todas las sesiones y se abre una nueva en este dispositivo.
    await createSession(user.id);
  });
}

export async function updateNotificationPrefs(input: { notifyEmail: boolean; notifyWhatsapp: boolean; whatsappPhone: string }) {
  return runAction(async () => {
    const user = await requireUser();
    const data = z
      .object({ notifyEmail: z.boolean(), notifyWhatsapp: z.boolean(), whatsappPhone: v.phoneE164 })
      .parse(input);
    if (data.notifyWhatsapp && !data.whatsappPhone) throw new AppError("Indica tu número de WhatsApp para activar los avisos.");
    await db.user.update({ where: { id: user.id }, data });
  });
}

export async function disconnectGoogle() {
  return runAction(async () => {
    const user = await requireUser();
    await disconnectGoogleAccount(user.id);
  });
}
