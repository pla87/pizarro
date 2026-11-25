"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { applyNewPassword } from "@/lib/account";
import { runAction } from "@/lib/action";
import { sendEmailChangedMail, sendPasswordResetMail } from "@/lib/auth-mail";
import { googleOnly, passwordLoginAllowed } from "@/lib/auth-policy";
import { googlePolicyEnv } from "@/lib/google-config";
import { consumeToken, findUsableToken, issueAuthToken } from "@/lib/auth-token";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { maskEmail } from "@/lib/mask-email";
import { appUrl, emailEnabled, sendMailInBackground } from "@/lib/mail";
import { completeLogin } from "@/lib/login";
import { requestContext } from "@/lib/request-context";
import { dummyVerify, hashPassword, isPasswordBusy, passwordSchema, verifyPassword, verifyPasswordCounted } from "@/lib/password";
import { LOGIN_ACCOUNT_LIMIT, LOGIN_ACCOUNT_LIMIT_TRUSTED, loginRateKeys, rateIp, rateLimit, rateLimitReached, releaseRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { retargetReportSchedules } from "@/lib/report-recipient";
import { safeNextPath } from "@/lib/redirect";
import { createSession, destroySession, getCurrentUser, requirePendingUser } from "@/lib/session";
import { isKnownDevice } from "@/lib/devices";
import { secondStepFor, sendEmailCode, startChallenge } from "@/lib/two-factor";
import * as v from "@/lib/validation";
import { getT } from "@/i18n/server";

export interface LoginState {
  error?: string;
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(200),
  password: z.string().min(1).max(200),
});

/**
 * Reserva un intento de acceso con contraseña para esta cuenta, ANTES de comprobar la contraseña (así no se salta con
 * peticiones en paralelo); un acceso correcto lo devuelve (resetRateLimit). Tras LOGIN_ACCOUNT_LIMIT intentos sin acierto
 * (desde cualquier conexión), solo se sigue desde un dispositivo conocido de la cuenta (uno desde el que ya se ha entrado en
 * ella, con o sin «Recordar» en el segundo paso), hasta LOGIN_ACCOUNT_LIMIT_TRUSTED.
 * `false`: bloqueado.
 */
async function reserveAccountAttempt(key: string, email: string): Promise<boolean> {
  const window = 15 * 60_000;
  if (rateLimitReached(key, LOGIN_ACCOUNT_LIMIT_TRUSTED)) return false;
  // Comprobar y reservar sin ningún await entre medias: dos peticiones a la vez no pueden ver el mismo contador.
  if (!rateLimitReached(key, LOGIN_ACCOUNT_LIMIT)) return rateLimit(key, LOGIN_ACCOUNT_LIMIT_TRUSTED, window);
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user || !(await isKnownDevice(user.id))) return false;
  return rateLimit(key, LOGIN_ACCOUNT_LIMIT_TRUSTED, window);
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = await getT();
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: t("Introduce email y contraseña.") };
  const { email, password } = parsed.data;

  const ip = clientIp(await headers());
  // Límite por IP (todas las peticiones) y por cuenta (los intentos sin acierto, desde cualquier conexión).
  const keys = loginRateKeys(ip, email);
  // En los logs solo se anota si parece un email (si alguien pega ahí su contraseña, no queda guardada). Entero solo si es
  // el de una cuenta; si no lo es, o aún no se ha mirado (bloqueo por intentos, «solo Google»), enmascarado
  // («a***@example.com»): es un dato personal de alguien que quizá no es usuario, y la inicial y el dominio bastan para
  // reconocer un ataque.
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const shownEmail = (account: boolean) => (!looksLikeEmail ? "[no es un email]" : account ? email : maskEmail(email));
  // En la plantilla del mensaje, el aviso de «no es un email» se traduce; el email, tal cual.
  const emailParam = (account: boolean) => (looksLikeEmail ? shownEmail(account) : { k: shownEmail(account) });
  if (!rateLimit(keys.ip, 60, 15 * 60_000) || !(await reserveAccountAttempt(keys.account, email))) {
    // Si el bloqueo es sobre una cuenta que existe, su email entero y su usuario: es la señal más útil de un ataque a
    // esa cuenta (una consulta por el índice único del email, solo en los intentos bloqueados).
    const target = looksLikeEmail ? await db.user.findUnique({ where: { email }, select: { id: true, name: true } }).catch(() => null) : null;
    logEvent({
      level: "warn", category: "auth", action: "auth.loginFailed", label: { k: "Inicio de sesión bloqueado por demasiados intentos ({email})", p: { email: emailParam(!!target) } },
      userId: target?.id ?? null, userName: target?.name ?? null, path: "/login", ip, details: { email: shownEmail(!!target), reason: "rate_limited" },
    });
    return { error: t("Demasiados intentos. Espera unos minutos.") };
  }

  // Con «solo Google» la contraseña no abre la puerta (salvo el acceso de emergencia de los administradores), y la
  // respuesta no puede depender de si es correcta: se decide ANTES de comprobarla. El intento reservado queda gastado,
  // como un fallo, sea cual sea la contraseña.
  const policy = googlePolicyEnv();
  if (!passwordLoginAllowed("ADMIN", policy)) {
    // Nadie entra con contraseña: la misma respuesta para todos, sin buscar siquiera la cuenta (tampoco delata si existe).
    logEvent({
      level: "warn", category: "auth", action: "auth.loginFailed", label: { k: "Inicio de sesión con contraseña rechazado ({email}): solo se admite Google", p: { email: emailParam(false) } },
      path: "/login", ip, details: { email: shownEmail(false), reason: "google_only" },
    });
    return { error: t("El acceso con contraseña está desactivado en este servidor. Entra con Google.") };
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, locale: true, role: true, passwordHash: true, active: true, mustChangePassword: true, twoFactorMethod: true } });
  // Con el acceso de emergencia, un rol sin contraseña no llega a comprobarla (bcrypt de relleno, para que tampoco lo
  // delate el tiempo) y recibe la misma respuesta que un email desconocido o una contraseña incorrecta.
  const googleOnlyRole = !!user && !passwordLoginAllowed(user.role, policy);
  let valid: boolean;
  try {
    valid = user && !googleOnlyRole ? await verifyPassword(password, user.passwordHash) : await dummyVerify(password);
  } catch (err) {
    if (!isPasswordBusy(err)) throw err;
    // Demasiadas comprobaciones a la vez en el servidor: no se ha llegado a mirar la contraseña, así que el intento
    // reservado se devuelve (no cuenta como fallo de la cuenta) y la respuesta es la misma exista o no la cuenta.
    releaseRateLimit(keys.account);
    return { error: t("Demasiados intentos a la vez, prueba en unos segundos.") };
  }
  if (!user || googleOnlyRole || !valid || !user.active) {
    const reason = !user ? "unknown_email" : googleOnlyRole ? "google_only" : !valid ? "wrong_password" : "inactive";
    const why = { unknown_email: "email desconocido", google_only: "solo se admite Google", wrong_password: "contraseña incorrecta", inactive: "usuario desactivado" }[reason];
    logEvent({
      level: "warn", category: "auth", action: "auth.loginFailed", label: { k: "Inicio de sesión fallido ({email}): {why}", p: { email: emailParam(!!user), why: { k: why } } },
      userId: user?.id ?? null, userName: user?.name ?? null, path: "/login", ip, details: { email: shownEmail(!!user), reason },
    });
    return {
      error: googleOnly(policy)
        ? t("Credenciales incorrectas. En este servidor solo los administradores entran con contraseña (acceso de emergencia); los demás, con Google.")
        : t("Credenciales incorrectas."),
    };
  }
  // Contraseña correcta: el intento reservado no cuenta como fallo.
  resetRateLimit(keys.account);

  const next = safeNextPath(String(formData.get("next") ?? ""));
  // Segundo paso: todavía NO hay sesión, solo un estado pendiente (cookie pz_2fa, 10 min) hasta que el código sea correcto.
  const step = await secondStepFor(user);
  if (step) {
    const challenge = await startChallenge(user.id, step === "VERIFY" ? "LOGIN" : "SETUP", { next });
    if (step === "VERIFY" && user.twoFactorMethod === "EMAIL") await sendEmailCode(challenge, user).catch(() => {});
    logEvent({ category: "auth", action: "auth.secondStepRequested", label: { k: "{name}: contraseña correcta, falta la verificación en dos pasos", p: { name: user.name } }, userId: user.id, userName: user.name, path: "/login", ip });
    redirect("/login/verify");
  }
  await completeLogin(user, { method: "password", path: "/login" });
  if (user.mustChangePassword) redirect("/change-password");
  redirect(next);
}

export async function logout(): Promise<void> {
  const [user, ctx] = await Promise.all([getCurrentUser().catch(() => null), requestContext()]);
  if (user) logEvent({ category: "auth", action: "auth.logout", label: { k: "{name} ha cerrado sesión", p: { name: user.name } }, userId: user.id, userName: user.name, path: ctx.path, ip: ctx.ip });
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
    if (!rateLimit(`reset:ip:${rateIp(ip)}`, 10, 15 * 60_000) || !rateLimit(`reset:email:${key}`, 3, 15 * 60_000)) {
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
        logEvent({ category: "auth", action: "auth.resetRequested", label: { k: "Enlace de restablecimiento enviado a {name}", p: { name: user.name } }, userId: user.id, userName: user.name, ip });
      });
    }
  });
}

const INVALID_LINK = "El enlace no es válido o ha caducado.";

/** Página /reset/[token]: elige la contraseña con un enlace de restablecimiento o de invitación. */
export async function resetPassword(token: string, password: string) {
  return runAction({ name: "auth.resetPassword", args: [] }, async () => {
    const ip = clientIp(await headers());
    if (!rateLimit(`reset-submit:ip:${rateIp(ip)}`, 20, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const pw = passwordSchema().parse(password);
    const row = await findUsableToken(String(token), ["PASSWORD_RESET", "INVITE"]);
    if (!row || !(await consumeToken(row.id))) throw new AppError(INVALID_LINK);
    await applyNewPassword(row.userId, await hashPassword(pw), { notice: row.purpose === "PASSWORD_RESET" });
    // Quien demuestra que controla su email sale del bloqueo por intentos fallidos (si no, seguía sin poder entrar).
    resetRateLimit(loginRateKeys(ip, row.user.email).account);
    logEvent({
      category: "auth", action: row.purpose === "INVITE" ? "auth.inviteAccepted" : "auth.passwordReset",
      label: { k: row.purpose === "INVITE" ? "{name} ha elegido su contraseña inicial" : "{name} ha restablecido su contraseña", p: { name: row.user.name } },
      userId: row.userId, userName: row.user.name, ip,
    });
  });
}

/** Página /confirm/[token]: confirma un cambio de contraseña o de email pedido desde el perfil. */
export async function confirmAccountChange(token: string) {
  return runAction({ name: "auth.confirmAccountChange", args: [] }, async () => {
    const ip = clientIp(await headers());
    if (!rateLimit(`confirm:ip:${rateIp(ip)}`, 30, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const row = await findUsableToken(String(token), ["PASSWORD_CHANGE", "EMAIL_CHANGE"]);
    if (!row) throw new AppError(INVALID_LINK);
    const data = z.object({ passwordHash: z.string().min(20).optional(), newEmail: v.email.optional() }).parse(row.data ?? {});
    if (row.purpose === "PASSWORD_CHANGE") {
      if (!data.passwordHash) throw new AppError(INVALID_LINK);
      if (!(await consumeToken(row.id))) throw new AppError(INVALID_LINK);
      await applyNewPassword(row.userId, data.passwordHash);
      logEvent({ category: "auth", action: "auth.passwordChanged", label: { k: "{name} ha confirmado el cambio de contraseña", p: { name: row.user.name } }, userId: row.userId, userName: row.user.name, ip });
      return { kind: "PASSWORD" as const };
    }
    if (!data.newEmail) throw new AppError(INVALID_LINK);
    // La unicidad se vuelve a comprobar: otra cuenta pudo quedarse con esa dirección mientras tanto.
    if (await db.user.count({ where: { email: data.newEmail, id: { not: row.userId } } })) throw new AppError("Ya existe un usuario con ese email.");
    if (!(await consumeToken(row.id))) throw new AppError(INVALID_LINK);
    const oldEmail = row.user.email;
    const newEmail = data.newEmail;
    await db.$transaction(async (tx) => {
      // La cuenta de Google vinculada era la de la dirección anterior; los enlaces enviados allí dejan de valer.
      await tx.user.update({ where: { id: row.userId }, data: { email: newEmail, googleSub: null } });
      await tx.authToken.deleteMany({ where: { userId: row.userId, purpose: { in: ["INVITE", "PASSWORD_RESET", "PASSWORD_CHANGE", "EMAIL_CHANGE"] } } });
      // Los informes semanales que le llegaban siguen llegándole, ahora a la dirección nueva.
      await retargetReportSchedules(tx, oldEmail, newEmail);
    });
    sendMailInBackground("aviso de email cambiado", () => sendEmailChangedMail(row.user, oldEmail, data.newEmail!));
    logEvent({ category: "auth", action: "auth.emailChanged", label: { k: "{name} ha confirmado su nuevo email", p: { name: row.user.name } }, userId: row.userId, userName: row.user.name, ip });
    return { kind: "EMAIL" as const };
  });
}

/** Pantalla «Elige una contraseña nueva» tras un cambio forzado o al entrar con Google sin haber usado aún la invitación. */
export async function setNewPassword(password: string) {
  return runAction({ name: "auth.setNewPassword", args: [] }, async () => {
    const user = await requirePendingUser();
    const rateKey = `password:${user.id}`;
    if (!rateLimit(rateKey, 10, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const pw = passwordSchema().parse(password);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (await verifyPasswordCounted(pw, row.passwordHash, rateKey)) throw new AppError("La contraseña nueva debe ser distinta de la actual.");
    await applyNewPassword(user.id, await hashPassword(pw));
    await createSession(user.id, { mustChangePassword: false });
    logEvent({ category: "auth", action: "auth.passwordChosen", label: { k: "{name} ha elegido una contraseña nueva", p: { name: user.name } }, userId: user.id, userName: user.name });
  });
}
