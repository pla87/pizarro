"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { applyNewPassword } from "@/lib/account";
import { runAction } from "@/lib/action";
import { sendEmailChangedMail, sendNewLoginMail, sendPasswordResetMail } from "@/lib/auth-mail";
import { consumeToken, findUsableToken, issueAuthToken } from "@/lib/auth-token";
import { registerDevice } from "@/lib/devices";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { appUrl, emailEnabled, sendMailInBackground } from "@/lib/mail";
import { requestContext } from "@/lib/request-context";
import { dummyVerify, hashPassword, passwordSchema, verifyPassword } from "@/lib/password";
import { loginRateKeys, rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { safeNextPath } from "@/lib/redirect";
import { createSession, destroySession, getCurrentUser, requirePendingUser } from "@/lib/session";
import { deviceLabel } from "@/lib/user-agent";
import * as v from "@/lib/validation";
import { getT } from "@/i18n/server";
import { makeT, toLocale } from "@/i18n/core";

export interface LoginState {
  error?: string;
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(200),
  password: z.string().min(1).max(200),
});

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = await getT();
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: t("Introduce email y contraseña.") };
  const { email, password } = parsed.data;

  const ip = clientIp(await headers());
  // Límite estricto por pareja IP+email (un tercero no puede bloquear a otra persona desde su IP) y otro más holgado por IP.
  const keys = loginRateKeys(ip, email);
  if (!rateLimit(keys.ip, 60, 15 * 60_000) || !rateLimit(keys.pair, 8, 15 * 60_000)) {
    logEvent({
      level: "warn", category: "auth", action: "auth.loginFailed", message: `Inicio de sesión bloqueado por demasiados intentos (${email})`,
      path: "/login", ip, details: { email, reason: "rate_limited" },
    });
    return { error: t("Demasiados intentos. Espera unos minutos.") };
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, locale: true, passwordHash: true, active: true, mustChangePassword: true } });
  const valid = user ? await verifyPassword(password, user.passwordHash) : await dummyVerify(password);
  if (!user || !valid || !user.active) {
    const reason = !user ? "unknown_email" : !valid ? "wrong_password" : "inactive";
    const why = reason === "inactive" ? "usuario desactivado" : reason === "unknown_email" ? "email desconocido" : "contraseña incorrecta";
    logEvent({
      level: "warn", category: "auth", action: "auth.loginFailed", message: `Inicio de sesión fallido (${email}): ${why}`,
      userId: user?.id ?? null, userName: user?.name ?? null, path: "/login", ip, details: { email, reason },
    });
    return { error: t("Credenciales incorrectas.") };
  }

  resetRateLimit(keys.pair);
  await createSession(user.id, { mustChangePassword: user.mustChangePassword });
  // Aviso si es un dispositivo nuevo (no en el primer acceso de la cuenta).
  const device = await registerDevice(user.id);
  if (device.alert && emailEnabled()) {
    const ua = (await headers()).get("user-agent");
    sendMailInBackground("aviso de nuevo inicio de sesión", () =>
      sendNewLoginMail(user, { when: new Date(), device: deviceLabel(ua, makeT(toLocale(user.locale))), ip: ip === "unknown" ? null : ip }),
    );
  }
  logEvent({
    category: "auth", action: "auth.login", message: `${user.name} ha iniciado sesión`,
    userId: user.id, userName: user.name, path: "/login", ip, details: { email },
  });
  if (user.mustChangePassword) redirect("/change-password");
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function logout(): Promise<void> {
  const [user, ctx] = await Promise.all([getCurrentUser().catch(() => null), requestContext()]);
  if (user) logEvent({ category: "auth", action: "auth.logout", message: `${user.name} ha cerrado sesión`, userId: user.id, userName: user.name, path: ctx.path, ip: ctx.ip });
  await destroySession();
  redirect("/login");
}

/** «¿Olvidaste tu contraseña?»: la respuesta es siempre la misma exista o no la cuenta (el texto lo pone la pantalla). */
export async function requestPasswordReset(email: string) {
  return runAction({ name: "auth.requestPasswordReset", args: [] }, async () => {
    if (!emailEnabled()) throw new AppError("El envío de emails no está configurado.");
    const ip = clientIp(await headers());
    const parsed = v.email.safeParse(email);
    const key = parsed.success ? parsed.data : String(email).slice(0, 200).toLowerCase();
    // Los dos límites cuentan igual con cuentas que existen y que no: no delatan nada.
    if (!rateLimit(`reset:ip:${ip}`, 10, 15 * 60_000) || !rateLimit(`reset:email:${key}`, 3, 15 * 60_000)) {
      throw new AppError("Demasiados intentos. Espera unos minutos.");
    }
    if (parsed.success) {
      const address = parsed.data;
      // El envío va tras la respuesta: así tampoco se nota por el tiempo que tarde.
      sendMailInBackground("restablecer contraseña", async () => {
        const user = await db.user.findUnique({ where: { email: address }, select: { id: true, name: true, email: true, locale: true, active: true } });
        if (!user?.active) return;
        const token = await issueAuthToken(user.id, "PASSWORD_RESET");
        await sendPasswordResetMail(user, `${appUrl()}/reset/${token}`);
        logEvent({ category: "auth", action: "auth.resetRequested", message: `Enlace de restablecimiento enviado a ${user.name}`, userId: user.id, userName: user.name, ip });
      });
    }
  });
}

const INVALID_LINK = "El enlace no es válido o ha caducado.";

/** Página /reset/[token]: elige la contraseña con un enlace de restablecimiento o de invitación. */
export async function resetPassword(token: string, password: string) {
  return runAction({ name: "auth.resetPassword", args: [] }, async () => {
    const ip = clientIp(await headers());
    if (!rateLimit(`reset-submit:ip:${ip}`, 20, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const pw = passwordSchema().parse(password);
    const row = await findUsableToken(String(token), ["PASSWORD_RESET", "INVITE"]);
    if (!row || !(await consumeToken(row.id))) throw new AppError(INVALID_LINK);
    await applyNewPassword(row.userId, await hashPassword(pw), { notice: row.purpose === "PASSWORD_RESET" });
    logEvent({
      category: "auth", action: row.purpose === "INVITE" ? "auth.inviteAccepted" : "auth.passwordReset",
      message: row.purpose === "INVITE" ? `${row.user.name} ha elegido su contraseña inicial` : `${row.user.name} ha restablecido su contraseña`,
      userId: row.userId, userName: row.user.name, ip,
    });
  });
}

/** Página /confirm/[token]: confirma un cambio de contraseña o de email pedido desde el perfil. */
export async function confirmAccountChange(token: string) {
  return runAction({ name: "auth.confirmAccountChange", args: [] }, async () => {
    const ip = clientIp(await headers());
    if (!rateLimit(`confirm:ip:${ip}`, 30, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const row = await findUsableToken(String(token), ["PASSWORD_CHANGE", "EMAIL_CHANGE"]);
    if (!row) throw new AppError(INVALID_LINK);
    const data = z.object({ passwordHash: z.string().min(20).optional(), newEmail: v.email.optional() }).parse(row.data ?? {});
    if (row.purpose === "PASSWORD_CHANGE") {
      if (!data.passwordHash) throw new AppError(INVALID_LINK);
      if (!(await consumeToken(row.id))) throw new AppError(INVALID_LINK);
      await applyNewPassword(row.userId, data.passwordHash);
      logEvent({ category: "auth", action: "auth.passwordChanged", message: `${row.user.name} ha confirmado el cambio de contraseña`, userId: row.userId, userName: row.user.name, ip });
      return { kind: "PASSWORD" as const };
    }
    if (!data.newEmail) throw new AppError(INVALID_LINK);
    // La unicidad se vuelve a comprobar: otra cuenta pudo quedarse con esa dirección mientras tanto.
    if (await db.user.count({ where: { email: data.newEmail, id: { not: row.userId } } })) throw new AppError("Ya existe un usuario con ese email.");
    if (!(await consumeToken(row.id))) throw new AppError(INVALID_LINK);
    const oldEmail = row.user.email;
    await db.user.update({ where: { id: row.userId }, data: { email: data.newEmail } });
    sendMailInBackground("aviso de email cambiado", () => sendEmailChangedMail(row.user, oldEmail, data.newEmail!));
    logEvent({ category: "auth", action: "auth.emailChanged", message: `${row.user.name} ha confirmado su nuevo email`, userId: row.userId, userName: row.user.name, ip });
    return { kind: "EMAIL" as const };
  });
}

/** Pantalla «Elige una contraseña nueva» tras un cambio forzado o un alta con clave inicial. */
export async function setNewPassword(password: string) {
  return runAction({ name: "auth.setNewPassword", args: [] }, async () => {
    const user = await requirePendingUser();
    if (!rateLimit(`password:${user.id}`, 10, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const pw = passwordSchema().parse(password);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (await verifyPassword(pw, row.passwordHash)) throw new AppError("La contraseña nueva debe ser distinta de la actual.");
    await applyNewPassword(user.id, await hashPassword(pw));
    await createSession(user.id, { mustChangePassword: false });
    logEvent({ category: "auth", action: "auth.passwordChosen", message: `${user.name} ha elegido una contraseña nueva`, userId: user.id, userName: user.name });
  });
}
