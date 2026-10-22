"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { MAX_TEMPLATE } from "@/lib/constants";
import { AppError, notFound } from "@/lib/errors";
import { applyNewPassword } from "@/lib/account";
import { sendEmailChangeMail, sendEmailChangeRequestedMail, sendPasswordChangeMail } from "@/lib/auth-mail";
import { issueAuthToken } from "@/lib/auth-token";
import { appUrl, emailEnabled } from "@/lib/mail";
import { hashPassword, passwordSchema, verifyPassword } from "@/lib/password";
import { POSITION_STEP } from "@/lib/positions";
import { createSession, currentSessionId, requireUser } from "@/lib/session";
import { disconnectGoogleAccount } from "@/lib/google";
import { rateLimit } from "@/lib/rate-limit";
import * as v from "@/lib/validation";

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

/**
 * Cambio de contraseña desde el perfil. Con email configurado hay que confirmarlo desde un enlace (30 min) y
 * la contraseña nueva solo se guarda, ya cifrada, dentro del enlace; sin email se cambia en el acto.
 */
export async function changePassword(current: string, next: string) {
  return runAction({ name: "profile.changePassword", args: [] }, async () => {
    const user = await requireUser();
    const pw = passwordSchema("La nueva contraseña debe tener al menos 10 caracteres.").parse(next);
    if (!rateLimit(`password:${user.id}`, 5, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (!(await verifyPassword(z.string().max(200).parse(current), row.passwordHash))) {
      throw new AppError("La contraseña actual no es correcta.");
    }
    if (await verifyPassword(pw, row.passwordHash)) throw new AppError("La contraseña nueva debe ser distinta de la actual.");
    const passwordHash = await hashPassword(pw);
    if (emailEnabled()) {
      const token = await issueAuthToken(user.id, "PASSWORD_CHANGE", { passwordHash });
      try {
        await sendPasswordChangeMail(user, `${appUrl()}/confirm/${token}`);
      } catch (err) {
        console.error("[profile] email de confirmación", err);
        throw new AppError("No se pudo enviar el email de confirmación. Inténtalo más tarde.");
      }
      return { pending: true };
    }
    await applyNewPassword(user.id, passwordHash, { notice: false });
    // Se cierran todas las sesiones y se abre una nueva en este dispositivo.
    await createSession(user.id);
    return { pending: false };
  });
}

/** Pide cambiar el email: se confirma desde un enlace enviado a la dirección NUEVA y se avisa a la antigua. */
export async function requestEmailChange(newEmail: string, currentPassword: string) {
  return runAction({ name: "profile.requestEmailChange", args: [] }, async () => {
    const user = await requireUser();
    if (!emailEnabled()) throw new AppError("El envío de emails no está configurado.");
    const email = v.email.parse(newEmail);
    if (!rateLimit(`email-change:${user.id}`, 5, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (!(await verifyPassword(z.string().max(200).parse(currentPassword), row.passwordHash))) throw new AppError("La contraseña actual no es correcta.");
    if (email === user.email) throw new AppError("Ese ya es tu email.");
    if (await db.user.count({ where: { email } })) throw new AppError("Ya existe un usuario con ese email.");
    const token = await issueAuthToken(user.id, "EMAIL_CHANGE", { newEmail: email });
    try {
      await sendEmailChangeMail(user, email, `${appUrl()}/confirm/${token}`);
    } catch (err) {
      console.error("[profile] email de confirmación", err);
      throw new AppError("No se pudo enviar el email de confirmación. Inténtalo más tarde.");
    }
    // Aviso a la dirección actual; si falla, el cambio sigue pendiente de confirmar.
    await sendEmailChangeRequestedMail(user, email).catch((err) => console.error("[profile] aviso al email antiguo", err));
  });
}

/** Cierra una sesión del propio usuario (nunca la actual: para eso está «Cerrar sesión»). */
export async function revokeSession(sessionId: string) {
  return runAction({ name: "profile.revokeSession", args: [] }, async () => {
    const user = await requireUser();
    const id = z.string().min(1).max(100).parse(sessionId);
    if (id === (await currentSessionId())) throw new AppError("Esta es tu sesión actual: usa «Cerrar sesión».");
    await db.session.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/settings");
  });
}

/** Cierra todas las sesiones del usuario salvo la actual. */
export async function revokeOtherSessions() {
  return runAction({ name: "profile.revokeOtherSessions", args: [] }, async () => {
    const user = await requireUser();
    const current = await currentSessionId();
    await db.session.deleteMany({ where: { userId: user.id, ...(current ? { id: { not: current } } : {}) } });
    revalidatePath("/settings");
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
