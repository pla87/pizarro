"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { MAX_TEMPLATE } from "@/lib/constants";
import { AppError, notFound } from "@/lib/errors";
import { applyNewPassword } from "@/lib/account";
import { sendAccountDeletedMail, sendEmailChangeMail, sendEmailChangeRequestedMail, sendPasswordChangeMail } from "@/lib/auth-mail";
import { issueAuthToken } from "@/lib/auth-token";
import { appUrl, emailEnabled, sendMailInBackground } from "@/lib/mail";
import { logMailError } from "@/lib/mask-email";
import { hashPassword, passwordSchema, verifyPasswordCounted } from "@/lib/password";
import { POSITION_STEP } from "@/lib/positions";
import { createSession, currentSessionId, destroySession, requireUser } from "@/lib/session";
import { disconnectGoogleAccount } from "@/lib/google";
import { rateLimit } from "@/lib/rate-limit";
import * as v from "@/lib/validation";
import { revokeSession as cutSessionStreams } from "@/lib/revoke";
import { describeAction } from "@/lib/action-context";
import { accountDeleteChallenge, checkCode, sendEmailCode } from "@/lib/two-factor";
import { deletionBlock, eraseUser, soloPrivateProjectIds } from "@/lib/user-delete";
import { DELETION_BLOCK_MESSAGES } from "@/lib/user-delete-core";

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
    // Recuento y alta con un candado por persona: dos altas a la vez no pasan del máximo.
    return db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pz:release-templates:${user.id}`}))::text`;
      if ((await tx.releaseTemplate.count({ where: { userId: user.id } })) >= 40) throw new AppError("Máximo 40 plantillas.");
      const last = await tx.releaseTemplate.findFirst({ where: { userId: user.id, kind: k }, orderBy: { position: "desc" }, select: { position: true } });
      return tx.releaseTemplate.create({
        data: { userId: user.id, kind: k, ...data, position: (last?.position ?? 0) + POSITION_STEP },
        select: { id: true, name: true, content: true },
      });
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

/** Sube (-1) o baja (+1) una plantilla dentro de su tipo; la primera es la que «Generar release» elige por defecto. */
export async function moveReleaseTemplate(templateId: string, direction: number) {
  return runAction({ name: "profile.moveReleaseTemplate", args: [templateId, direction] }, async () => {
    const t = await ownTemplate(templateId);
    const dir = z.union([z.literal(-1), z.literal(1)]).parse(direction);
    const current = await db.releaseTemplate.findUniqueOrThrow({ where: { id: t.id }, select: { userId: true, kind: true } });
    const list = await db.releaseTemplate.findMany({
      where: { userId: current.userId, kind: current.kind },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const idx = list.findIndex((x) => x.id === t.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target]!, list[idx]!];
    // Se renumera la lista entera: el orden queda fijo aunque hubiera posiciones repetidas.
    await db.$transaction(list.map((x, i) => db.releaseTemplate.update({ where: { id: x.id }, data: { position: (i + 1) * POSITION_STEP } })));
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

/** «Borrar los borradores al cerrar sesión»: lo ejecuta el navegador al enviar el cierre de sesión. */
export async function updateClearDraftsOnLogout(enabled: boolean) {
  return runAction({ name: "profile.updateClearDraftsOnLogout", args: [enabled] }, async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { clearDraftsOnLogout: z.boolean().parse(enabled) } });
    // El usuario actual llega al AppShell desde el layout.
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
export async function updateAccent(accent: "BLUE" | "FOREST" | "SIENNA" | "MUSTARD" | "MONO" | "EVA") {
  return runAction({ name: "profile.updateAccent", args: [accent] }, async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { accent: z.enum(["BLUE", "FOREST", "SIENNA", "MUSTARD", "MONO", "EVA"]).parse(accent) } });
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
    const rateKey = `password:${user.id}`;
    if (!rateLimit(rateKey, 5, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    // Con el servidor ocupado, el intento no cuenta (verifyPasswordCounted lo devuelve).
    if (!(await verifyPasswordCounted(z.string().max(200).parse(current), row.passwordHash, rateKey))) {
      throw new AppError("La contraseña actual no es correcta.");
    }
    if (await verifyPasswordCounted(pw, row.passwordHash, rateKey)) throw new AppError("La contraseña nueva debe ser distinta de la actual.");
    const passwordHash = await hashPassword(pw);
    if (emailEnabled()) {
      const token = await issueAuthToken(user.id, "PASSWORD_CHANGE", { passwordHash });
      try {
        await sendPasswordChangeMail(user, `${appUrl()}/confirm/${token}`);
      } catch (err) {
        logMailError("[profile] email de confirmación", err);
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
    const rateKey = `email-change:${user.id}`;
    if (!rateLimit(rateKey, 5, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (!(await verifyPasswordCounted(z.string().max(200).parse(currentPassword), row.passwordHash, rateKey))) throw new AppError("La contraseña actual no es correcta.");
    if (email === user.email) throw new AppError("Ese ya es tu email.");
    if (await db.user.count({ where: { email } })) throw new AppError("Ya existe un usuario con ese email.");
    const token = await issueAuthToken(user.id, "EMAIL_CHANGE", { newEmail: email });
    try {
      await sendEmailChangeMail(user, email, `${appUrl()}/confirm/${token}`);
    } catch (err) {
      logMailError("[profile] email de confirmación", err);
      throw new AppError("No se pudo enviar el email de confirmación. Inténtalo más tarde.");
    }
    // Aviso a la dirección actual; si falla, el cambio sigue pendiente de confirmar.
    await sendEmailChangeRequestedMail(user, email).catch((err) => logMailError("[profile] aviso al email antiguo", err));
  });
}

/** Cierra una sesión del propio usuario (nunca la actual: para eso está «Cerrar sesión»). */
export async function revokeSession(sessionId: string) {
  return runAction({ name: "profile.revokeSession", args: [] }, async () => {
    const user = await requireUser();
    const id = z.string().min(1).max(100).parse(sessionId);
    if (id === (await currentSessionId())) throw new AppError("Esta es tu sesión actual: usa «Cerrar sesión».");
    const { count } = await db.session.deleteMany({ where: { id, userId: user.id } });
    // También se corta su canal en vivo del tablero.
    if (count) cutSessionStreams(id);
    revalidatePath("/settings");
  });
}

/** Cierra todas las sesiones del usuario salvo la actual. */
export async function revokeOtherSessions() {
  return runAction({ name: "profile.revokeOtherSessions", args: [] }, async () => {
    const user = await requireUser();
    const current = await currentSessionId();
    const where = { userId: user.id, ...(current ? { id: { not: current } } : {}) };
    const others = await db.session.findMany({ where, select: { id: true } });
    await db.session.deleteMany({ where });
    for (const s of others) cutSessionStreams(s.id);
    revalidatePath("/settings");
  });
}

/** Email de las menciones (Telegram y WhatsApp se conectan aparte: actions/messaging.ts). */
export async function updateNotificationPrefs(input: { notifyEmail: boolean }) {
  return runAction({ name: "profile.updateNotificationPrefs", args: [input] }, async () => {
    const user = await requireUser();
    const data = z.object({ notifyEmail: z.boolean() }).parse(input);
    await db.user.update({ where: { id: user.id }, data });
  });
}

export async function disconnectGoogle() {
  return runAction({ name: "profile.disconnectGoogle", args: [] }, async () => {
    const user = await requireUser();
    await disconnectGoogleAccount(user.id);
  });
}

// --- «Borrar mi cuenta» (pestaña «Cuenta») ---
// Nunca se pasan la contraseña ni el código como args de runAction: los args van al registro de actividad.

/** Envía el código por email para borrar la cuenta (solo si su verificación en dos pasos usa el email). */
export async function sendAccountDeleteCode() {
  return runAction({ name: "profile.sendAccountDeleteCode", args: [] }, async () => {
    const user = await requireUser();
    const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, email: true, locale: true, twoFactorMethod: true } });
    if (me.twoFactorMethod !== "EMAIL") throw new AppError("Tu verificación en dos pasos no usa códigos por email.");
    await sendEmailCode(await accountDeleteChallenge(user.id), me);
  });
}

const deleteAccountSchema = z.object({
  password: z.string().max(200),
  code: z.string().max(40).optional(),
  confirmPrivate: z.boolean().optional(),
});

/**
 * Borra la cuenta de quien la pide, igual que un administrador desde «Usuarios» (eraseUser): pide la contraseña actual
 * y, si tiene la verificación en dos pasos, su código (de la app, por email o de recuperación), con los mismos límites
 * de intentos que el acceso. No se puede borrar la única cuenta ni el último administrador activo. Al terminar cierra
 * la sesión de este navegador (las demás ya no existen) y avisa por email.
 */
export async function deleteMyAccount(input: z.input<typeof deleteAccountSchema>) {
  return runAction({ name: "profile.deleteMyAccount", args: [] }, async () => {
    const user = await requireUser();
    const data = deleteAccountSchema.parse(input);
    const block = await deletionBlock(user.id);
    if (block) throw new AppError(DELETION_BLOCK_MESSAGES[block]);
    const privates = await soloPrivateProjectIds(user.id);
    if (privates.length > 0 && data.confirmPrivate !== true) throw new AppError("Confirma que se borran tus proyectos privados.");
    const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, email: true, locale: true, passwordHash: true, twoFactorMethod: true } });
    const code = (data.code ?? "").trim();
    if (me.twoFactorMethod && !code) throw new AppError("Escribe el código de verificación.");
    const rateKey = `account-delete:${user.id}`;
    if (!rateLimit(rateKey, 5, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    // Con el servidor ocupado, el intento no cuenta (verifyPasswordCounted lo devuelve).
    if (!(await verifyPasswordCounted(data.password, me.passwordHash, rateKey))) throw new AppError("La contraseña actual no es correcta.");
    if (me.twoFactorMethod) {
      const result = await checkCode(await accountDeleteChallenge(user.id), code);
      if (result === "locked") throw new AppError("Demasiados intentos. Empieza de nuevo.");
      if (result === "wrong") throw new AppError("Código incorrecto o caducado.");
    }
    await eraseUser(user.id, privates, { self: true });
    describeAction(
      privates.length
        ? `«${me.name}» borró su cuenta y ${privates.length === 1 ? "su proyecto privado" : `sus ${privates.length} proyectos privados`}`
        : `«${me.name}» borró su cuenta`,
    );
    // Sus sesiones ya no existen: aquí solo queda quitar la cookie de este navegador.
    await destroySession();
    if (emailEnabled()) sendMailInBackground("aviso de cuenta borrada", () => sendAccountDeletedMail(me));
  });
}
