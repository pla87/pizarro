"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { MAX_TEMPLATE } from "@/lib/constants";
import { AppError, notFound } from "@/lib/errors";
import { hashPassword, MIN_PASSWORD, verifyPassword } from "@/lib/password";
import { POSITION_STEP } from "@/lib/positions";
import { createSession, requireUser } from "@/lib/session";
import { disconnectGoogleAccount } from "@/lib/google";
import { rateLimit } from "@/lib/rate-limit";
import * as v from "@/lib/validation";
import { getT } from "@/i18n/server";

export async function updateProfileName(name: string) {
  return runAction({ name: "profile.updateProfileName", args: [name] }, async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { name: v.name.parse(name) } });
  });
}

const templateSchema = z.object({
  name: v.name.max(60, "Máximo 60 caracteres."),
  content: z.string().max(MAX_TEMPLATE, "La plantilla es demasiado larga."),
});

/** Plantillas de cabecera y pie de release: cada usuario puede tener varias de cada tipo. */
export async function createReleaseTemplate(kind: "HEADER" | "FOOTER", input: { name: string; content: string }) {
  return runAction({ name: "profile.createReleaseTemplate", args: [kind, input] }, async () => {
    const user = await requireUser();
    const k = z.enum(["HEADER", "FOOTER"]).parse(kind);
    const data = templateSchema.parse(input);
    if ((await db.releaseTemplate.count({ where: { userId: user.id } })) >= 40) throw new AppError("Máximo 40 plantillas.");
    const last = await db.releaseTemplate.findFirst({ where: { userId: user.id, kind: k }, orderBy: { position: "desc" }, select: { position: true } });
    return db.releaseTemplate.create({
      data: { userId: user.id, kind: k, ...data, position: (last?.position ?? 0) + POSITION_STEP },
      select: { id: true, name: true, content: true },
    });
  });
}

async function ownTemplate(templateId: string) {
  const user = await requireUser();
  const t = await db.releaseTemplate.findFirst({ where: { id: v.id.parse(templateId), userId: user.id }, select: { id: true } });
  if (!t) throw notFound();
  return t;
}

export async function updateReleaseTemplate(templateId: string, input: { name: string; content: string }) {
  return runAction({ name: "profile.updateReleaseTemplate", args: [templateId, input] }, async () => {
    const t = await ownTemplate(templateId);
    await db.releaseTemplate.update({ where: { id: t.id }, data: templateSchema.parse(input) });
  });
}

export async function deleteReleaseTemplate(templateId: string) {
  return runAction({ name: "profile.deleteReleaseTemplate", args: [templateId] }, async () => {
    const t = await ownTemplate(templateId);
    await db.releaseTemplate.delete({ where: { id: t.id } });
  });
}

export async function updateCardStyle(style: "STRIPE" | "FILLED") {
  return runAction({ name: "profile.updateCardStyle", args: [style] }, async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { cardStyle: z.enum(["STRIPE", "FILLED"]).parse(style) } });
  });
}

/** Modo de edición de descripciones: Markdown escrito o editor con barra de formato. */
export async function updateEditorMode(mode: "MARKDOWN" | "WYSIWYG") {
  return runAction({ name: "profile.updateEditorMode", args: [mode] }, async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { editorMode: z.enum(["MARKDOWN", "WYSIWYG"]).parse(mode) } });
    revalidatePath("/", "layout");
  });
}

/** Tema de color del usuario: SYSTEM sigue al sistema operativo. */
export async function updateTheme(theme: "SYSTEM" | "LIGHT" | "DARK") {
  return runAction({ name: "profile.updateTheme", args: [theme] }, async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { theme: z.enum(["SYSTEM", "LIGHT", "DARK"]).parse(theme) } });
    // El atributo data-theme se pinta en el layout raíz.
    revalidatePath("/", "layout");
  });
}

/** Idioma de la interfaz. */
export async function updateLocale(locale: "ES" | "EN") {
  return runAction({ name: "profile.updateLocale", args: [locale] }, async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { locale: z.enum(["ES", "EN"]).parse(locale) } });
    // El idioma se aplica en el layout raíz (lang y traducciones).
    revalidatePath("/", "layout");
  });
}

/** Color de acento de la app (variables --color-brand-*). */
export async function updateAccent(accent: "BLUE" | "FOREST" | "SIENNA" | "MUSTARD" | "MONO") {
  return runAction({ name: "profile.updateAccent", args: [accent] }, async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { accent: z.enum(["BLUE", "FOREST", "SIENNA", "MUSTARD", "MONO"]).parse(accent) } });
    // El atributo data-accent se pinta en el layout raíz.
    revalidatePath("/", "layout");
  });
}

export async function changePassword(current: string, next: string) {
  return runAction({ name: "profile.changePassword", args: [current, next] }, async () => {
    const user = await requireUser();
    const pw = z.string().min(MIN_PASSWORD, "La nueva contraseña debe tener al menos 10 caracteres.").max(200).parse(next);
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
  return runAction({ name: "profile.updateNotificationPrefs", args: [input] }, async () => {
    const user = await requireUser();
    const data = z
      .object({ notifyEmail: z.boolean(), notifyWhatsapp: z.boolean(), whatsappPhone: v.phoneE164 })
      .parse(input);
    if (data.notifyWhatsapp && !data.whatsappPhone) throw new AppError("Indica tu número de WhatsApp para activar los avisos.");
    await db.user.update({ where: { id: user.id }, data });
  });
}

export async function disconnectGoogle() {
  return runAction({ name: "profile.disconnectGoogle", args: [] }, async () => {
    const user = await requireUser();
    await disconnectGoogleAccount(user.id);
  });
}
