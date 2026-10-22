"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { sendTwoFactorChangedMail } from "@/lib/auth-mail";
import { hashAuthToken, newToken } from "@/lib/auth-token-core";
import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { completeLogin } from "@/lib/login";
import { logEvent } from "@/lib/log";
import { emailEnabled, sendMailInBackground } from "@/lib/mail";
import { verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { safeNextPath } from "@/lib/redirect";
import { requireUser } from "@/lib/session";
import {
  CHALLENGE_TTL_MS, checkCode, clearTwoFactor, commitEnrollment, dropChallenge, readChallenge, replaceRecoveryCodes, sendEmailCode, verifyEmailCode, } from "@/lib/two-factor";
import { generateTotpSecret, otpauthUri } from "@/lib/two-factor-core";
import { getT } from "@/i18n/server";

// Acciones de la verificación en dos pasos. NUNCA se pasan códigos ni contraseñas como args de runAction:
// los args van al registro de actividad.

const ISSUER = "Pizarro";
const methodSchema = z.enum(["TOTP", "EMAIL"]);

export interface VerifyState {
  error?: string;
}

async function ipLimit(): Promise<string> {
  const ip = clientIp(await headers());
  if (!rateLimit(`2fa:ip:${ip}`, 60, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
  return ip;
}

// --- Durante el inicio de sesión (sin sesión: solo el estado pendiente de la cookie pz_2fa) ---

/** Segundo paso de un acceso: código de la app, código por email o código de recuperación. */
export async function verifyLoginCode(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const t = await getT();
  const ch = await readChallenge();
  if (!ch || ch.kind !== "LOGIN") redirect("/login?error=twofactor_expired");
  const ip = clientIp(await headers());
  if (!rateLimit(`2fa:ip:${ip}`, 60, 15 * 60_000)) return { error: t("Demasiados intentos. Espera unos minutos.") };
  const result = await checkCode(ch, String(formData.get("code") ?? ""));
  if (result === "locked") {
    logEvent({ level: "warn", category: "auth", action: "auth.secondStepLocked", message: `${ch.user.name}: demasiados códigos incorrectos, hay que volver a entrar`, userId: ch.userId, userName: ch.user.name, path: "/login/verify", ip });
    // El desafío ya no existe: la página se volvería a pintar redirigiendo a /login, así que el aviso viaja allí.
    redirect("/login?error=twofactor_locked");
  }
  if (result === "wrong") {
    logEvent({ level: "warn", category: "auth", action: "auth.secondStepFailed", message: `${ch.user.name}: código de verificación incorrecto`, userId: ch.userId, userName: ch.user.name, path: "/login/verify", ip });
    return { error: t("Código incorrecto o caducado.") };
  }
  await dropChallenge(ch.id);
  await completeLogin(ch.user, { method: "password+2fa", rememberDevice: formData.get("remember") === "on", path: "/login/verify" });
  redirect(ch.user.mustChangePassword ? "/change-password" : safeNextPath(ch.next ?? ""));
}

/** Reenvía el código por email del segundo paso. */
export async function resendLoginCode() {
  return runAction({ name: "auth.resendLoginCode", args: [] }, async () => {
    await ipLimit();
    const ch = await readChallenge();
    if (!ch || ch.kind !== "LOGIN" || ch.user.twoFactorMethod !== "EMAIL") throw new AppError("La verificación ha caducado. Vuelve a entrar.");
    await sendEmailCode(ch, ch.user);
  });
}

/** «Volver»: descarta el estado pendiente y regresa a la pantalla de acceso. */
export async function cancelSecondStep(): Promise<void> {
  const ch = await readChallenge();
  if (ch) await dropChallenge(ch.id);
  redirect("/login");
}

/** Administrador sin método: elige cuál configurar. TOTP devuelve el secreto para la app; EMAIL envía un código de prueba. */
export async function chooseSetupMethod(method: string) {
  return runAction({ name: "auth.chooseSetupMethod", args: [] }, async () => {
    await ipLimit();
    const m = methodSchema.parse(method);
    const ch = await readChallenge();
    if (!ch || ch.kind !== "SETUP" || ch.confirmed) throw new AppError("La verificación ha caducado. Vuelve a entrar.");
    const started = await startMethod(ch.id, ch.user, m);
    // App nueva con email disponible: también se pide un código enviado al email, para que quien solo tenga
    // la contraseña (filtrada) no pueda registrar su propia app en una cuenta que aún no tenía segundo paso.
    if (m === "TOTP" && emailEnabled()) {
      await sendEmailCode({ id: ch.id }, ch.user);
      return { ...started, emailCodeSent: true };
    }
    return started;
  });
}

/** Comprueba el primer código del método elegido, lo deja activado y devuelve los códigos de recuperación (se ven una sola vez). */
export async function confirmSetup(code: string, emailCode?: string) {
  return runAction({ name: "auth.confirmSetup", args: [] }, async () => {
    await ipLimit();
    const ch = await readChallenge();
    if (!ch || ch.kind !== "SETUP" || ch.confirmed || !ch.method) throw new AppError("La verificación ha caducado. Vuelve a entrar.");
    const result = await checkCode(ch, String(code));
    if (result === "locked") throw new AppError("Demasiados intentos. Vuelve a introducir tu contraseña.");
    if (result === "wrong") throw new AppError("Código incorrecto o caducado.");
    if (ch.method === "TOTP" && emailEnabled() && !(await verifyEmailCode(ch, String(emailCode ?? "").replace(/\s/g, "")))) {
      throw new AppError("El código del email no es correcto o ha caducado.");
    }
    const codes = await commitEnrollment(ch.userId, ch.method, ch.pendingSecretEnc);
    await db.loginChallenge.update({ where: { id: ch.id }, data: { confirmed: true, pendingSecretEnc: null } });
    logEvent({ category: "auth", action: "auth.twoFactorEnabled", message: `${ch.user.name} ha activado la verificación en dos pasos (${ch.method})`, userId: ch.userId, userName: ch.user.name, details: { method: ch.method } });
    if (emailEnabled()) sendMailInBackground("aviso de verificación en dos pasos", () => sendTwoFactorChangedMail(ch.user, "enabled"));
    return { codes };
  });
}

/** Tras guardar los códigos de recuperación: abre la sesión (solo si el alta se confirmó con un código válido). */
export async function finishSetup(): Promise<void> {
  const ch = await readChallenge();
  if (!ch || ch.kind !== "SETUP" || !ch.confirmed) redirect("/login");
  await dropChallenge(ch.id);
  await completeLogin(ch.user, { method: "password+2fa", path: "/login/verify" });
  redirect(ch.user.mustChangePassword ? "/change-password" : safeNextPath(ch.next ?? ""));
}

async function startMethod(challengeId: string, user: { name: string; email: string; locale: string }, method: "TOTP" | "EMAIL") {
  if (method === "EMAIL") {
    if (!emailEnabled()) throw new AppError("El envío de emails no está configurado.");
    await db.loginChallenge.update({ where: { id: challengeId }, data: { method, pendingSecretEnc: null, codeHash: null, codeExpiresAt: null } });
    await sendEmailCode({ id: challengeId }, user);
    return { method };
  }
  const secret = generateTotpSecret();
  await db.loginChallenge.update({ where: { id: challengeId }, data: { method, pendingSecretEnc: encryptSecret(secret), codeHash: null, codeExpiresAt: null } });
  return { method, secret, uri: otpauthUri({ secret, account: user.email, issuer: ISSUER }) };
}

// --- Desde «Mi perfil» (con sesión) ---

async function requirePassword(userId: string, password: string): Promise<void> {
  if (!rateLimit(`2fa:pw:${userId}`, 10, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
  const row = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  if (!(await verifyPassword(String(password).slice(0, 200), row.passwordHash))) throw new AppError("La contraseña actual no es correcta.");
}

const enrollInclude = {
  user: { select: { id: true, name: true, email: true, locale: true, role: true, active: true, mustChangePassword: true, twoFactorMethod: true, totpSecretEnc: true, totpLastStep: true } },
} as const;

/** Empieza a activar o cambiar el método (pide la contraseña). Igual que en el acceso: secreto TOTP o código por email. */
export async function beginEnrollment(method: string, password: string) {
  return runAction({ name: "profile.beginTwoFactor", args: [] }, async () => {
    const user = await requireUser();
    const m = methodSchema.parse(method);
    await requirePassword(user.id, password);
    const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, email: true, locale: true } });
    await db.loginChallenge.deleteMany({ where: { userId: user.id, kind: "ENROLL" } });
    const row = await db.loginChallenge.create({
      data: { userId: user.id, kind: "ENROLL", tokenHash: hashAuthToken(newToken()), expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
      select: { id: true },
    });
    return startMethod(row.id, me, m);
  });
}

/** Comprueba el código del método nuevo, lo activa y devuelve 10 códigos de recuperación nuevos. */
export async function confirmEnrollment(code: string) {
  return runAction({ name: "profile.confirmTwoFactor", args: [] }, async () => {
    const user = await requireUser();
    const ch = await db.loginChallenge.findFirst({ where: { userId: user.id, kind: "ENROLL", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, include: enrollInclude });
    if (!ch?.method) throw new AppError("La configuración ha caducado. Empieza de nuevo.");
    const result = await checkCode(ch, String(code));
    if (result === "locked") throw new AppError("Demasiados intentos. Empieza de nuevo.");
    if (result === "wrong") throw new AppError("Código incorrecto o caducado.");
    const codes = await commitEnrollment(user.id, ch.method, ch.pendingSecretEnc);
    logEvent({ category: "auth", action: "auth.twoFactorEnabled", message: `${user.name} ha activado la verificación en dos pasos (${ch.method})`, userId: user.id, userName: user.name, details: { method: ch.method } });
    if (emailEnabled()) sendMailInBackground("aviso de verificación en dos pasos", () => sendTwoFactorChangedMail(ch.user, "enabled"));
    return { codes };
  });
}

/** Desactiva el segundo paso (no para administradores, donde es obligatorio). */
export async function disableTwoFactor(password: string) {
  return runAction({ name: "profile.disableTwoFactor", args: [] }, async () => {
    const user = await requireUser();
    if (user.role === "ADMIN") throw new AppError("La verificación en dos pasos es obligatoria para administradores. Puedes cambiar de método.");
    await requirePassword(user.id, password);
    await clearTwoFactor(user.id);
    logEvent({ category: "auth", action: "auth.twoFactorDisabled", message: `${user.name} ha desactivado la verificación en dos pasos`, userId: user.id, userName: user.name });
    if (emailEnabled()) {
      const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, email: true, locale: true } });
      sendMailInBackground("aviso de verificación en dos pasos", () => sendTwoFactorChangedMail(me, "disabled"));
    }
  });
}

/** Genera 10 códigos de recuperación nuevos y anula los anteriores. */
export async function regenerateRecoveryCodes(password: string) {
  return runAction({ name: "profile.regenerateRecoveryCodes", args: [] }, async () => {
    const user = await requireUser();
    const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorMethod: true } });
    if (!me.twoFactorMethod) throw new AppError("Activa primero la verificación en dos pasos.");
    await requirePassword(user.id, password);
    const codes = await replaceRecoveryCodes(user.id);
    logEvent({ category: "auth", action: "auth.recoveryCodesRegenerated", message: `${user.name} ha generado códigos de recuperación nuevos`, userId: user.id, userName: user.name });
    return { codes };
  });
}
