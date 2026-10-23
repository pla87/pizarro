import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { sendTwoFactorCodeMail } from "./auth-mail";
import { hashAuthToken, newToken } from "./auth-token-core";
import { decryptSecret } from "./crypto";
import { db } from "./db";
import { isTrustedDevice, revokeTrustedDevices } from "./devices";
import { AppError } from "./errors";
import { emailEnabled } from "./mail";
import { rateLimit } from "./rate-limit";
import { cookieSecure } from "./session-config";
import {
  EMAIL_CODE_TTL_MS, RECOVERY_CODE_COUNT, generateEmailCode, generateRecoveryCodes, hashEmailCode, hashRecoveryCode, normalizeRecoveryCode, verifyTotp,
} from "./two-factor-core";

// Verificación en dos pasos del acceso con contraseña. Estado pendiente: una fila LoginChallenge cuyo token
// (aleatorio, 10 min) viaja en la cookie pz_2fa y de la que en la BD solo queda el HMAC. Mientras exista,
// NO hay sesión: getCurrentUser() sigue devolviendo null hasta completeLogin().

export const CHALLENGE_COOKIE = "pz_2fa";
export const CHALLENGE_TTL_MS = 10 * 60_000;
/** Fallos permitidos por cada contraseña correcta, y por persona y hora. */
export const MAX_ATTEMPTS = 5;
export const MAX_ATTEMPTS_PER_USER_HOUR = 20;

const challengeInclude = {
  user: { select: { id: true, name: true, email: true, locale: true, role: true, active: true, mustChangePassword: true, twoFactorMethod: true, totpSecretEnc: true, totpLastStep: true } },
} satisfies Prisma.LoginChallengeInclude;
export type Challenge = Prisma.LoginChallengeGetPayload<{ include: typeof challengeInclude }>;

/** ¿Hay que pedir un segundo paso tras la contraseña? VERIFY: ya tiene método; SETUP: administrador sin método. */
export async function secondStepFor(user: { id: string; role: "ADMIN" | "MEMBER"; twoFactorMethod: "TOTP" | "EMAIL" | null }): Promise<"VERIFY" | "SETUP" | null> {
  if (user.twoFactorMethod) return (await isTrustedDevice(user.id)) ? null : "VERIFY";
  return user.role === "ADMIN" ? "SETUP" : null;
}

function setChallengeCookie(token: string, maxAgeMs: number) {
  return cookies().then((store) =>
    store.set(CHALLENGE_COOKIE, token, { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/", maxAge: Math.floor(maxAgeMs / 1000) }),
  );
}

export async function clearChallengeCookie(): Promise<void> {
  (await cookies()).delete(CHALLENGE_COOKIE);
}

/** Abre el estado pendiente de este navegador (sustituye a cualquier otro de la misma persona). */
export async function startChallenge(userId: string, kind: "LOGIN" | "SETUP", opts: { next?: string; remember?: boolean } = {}): Promise<Challenge> {
  const token = newToken();
  await db.loginChallenge.deleteMany({ where: { OR: [{ userId, kind: { in: ["LOGIN", "SETUP"] } }, { expiresAt: { lt: new Date() } }] } });
  const row = await db.loginChallenge.create({
    data: { userId, kind, tokenHash: hashAuthToken(token), next: opts.next?.slice(0, 500) || null, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    include: challengeInclude,
  });
  await setChallengeCookie(token, CHALLENGE_TTL_MS);
  return row;
}

/** El estado pendiente de esta petición, si la cookie es válida, no ha caducado y la cuenta sigue activa. */
export async function readChallenge(): Promise<Challenge | null> {
  const token = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const row = await db.loginChallenge.findUnique({ where: { tokenHash: hashAuthToken(token) }, include: challengeInclude });
  if (!row || row.kind === "ENROLL" || row.expiresAt.getTime() < Date.now() || !row.user.active) return null;
  return row;
}

export async function dropChallenge(id: string): Promise<void> {
  await db.loginChallenge.deleteMany({ where: { id } });
  await clearChallengeCookie();
}

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Envía un código de 6 dígitos al email de la cuenta y lo deja anotado (solo su HMAC) en el desafío. */
export async function sendEmailCode(ch: Pick<Challenge, "id">, user: { name: string; email: string; locale: string }): Promise<void> {
  if (!emailEnabled()) throw new AppError("El envío de emails no está configurado.");
  if (!rateLimit(`2fa:send:${ch.id}`, 5, EMAIL_CODE_TTL_MS)) throw new AppError("Demasiados envíos. Espera unos minutos.");
  const code = generateEmailCode();
  await db.loginChallenge.update({ where: { id: ch.id }, data: { codeHash: hashEmailCode(ch.id, code), codeExpiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS) } });
  try {
    await sendTwoFactorCodeMail(user, code);
  } catch (err) {
    console.error("[2fa] envío del código", err);
    throw new AppError("No se pudo enviar el código por email.");
  }
}

export async function verifyEmailCode(ch: Challenge, code: string): Promise<boolean> {
  if (!ch.codeHash || !ch.codeExpiresAt || ch.codeExpiresAt.getTime() < Date.now() || !/^\d{6}$/.test(code)) return false;
  if (!safeEq(ch.codeHash, hashEmailCode(ch.id, code))) return false;
  // Un solo uso: solo una petición consigue gastarlo.
  const { count } = await db.loginChallenge.updateMany({ where: { id: ch.id, codeHash: ch.codeHash }, data: { codeHash: null, codeExpiresAt: null } });
  return count === 1;
}

export async function verifyTotpFor(secretEnc: string | null, code: string, userId: string | null, lastStep: number | null): Promise<boolean> {
  if (!secretEnc) return false;
  const step = verifyTotp(decryptSecret(secretEnc), code, Date.now(), { lastStep });
  if (step === null) return false;
  if (userId === null) return true; // alta: el código aún no se «gasta»
  // Un paso de 30 s solo se acepta una vez.
  const { count } = await db.user.updateMany({ where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
  return count === 1;
}

async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const { count } = await db.recoveryCode.updateMany({ where: { userId, codeHash: hashRecoveryCode(code), usedAt: null }, data: { usedAt: new Date() } });
  return count === 1;
}

/**
 * Comprueba el código que escribe la persona contra el desafío. Cuenta el intento ANTES de mirar el código
 * (5 por contraseña correcta y 20 por persona y hora). «locked»: el desafío se ha destruido y hay que volver a empezar.
 */
export async function checkCode(ch: Challenge, input: string): Promise<"ok" | "wrong" | "locked"> {
  if (!rateLimit(`2fa:user:${ch.userId}`, MAX_ATTEMPTS_PER_USER_HOUR, 60 * 60_000)) {
    await dropChallenge(ch.id);
    return "locked";
  }
  const { count } = await db.loginChallenge.updateMany({ where: { id: ch.id, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
  if (count === 0) {
    await dropChallenge(ch.id);
    return "locked";
  }
  const code = input.trim().slice(0, 40);
  let ok = false;
  if (ch.kind === "LOGIN") {
    const recovery = normalizeRecoveryCode(code);
    if (recovery) ok = await consumeRecoveryCode(ch.userId, recovery);
    else if (ch.user.twoFactorMethod === "TOTP") ok = await verifyTotpFor(ch.user.totpSecretEnc, code, ch.userId, ch.user.totpLastStep);
    else if (ch.user.twoFactorMethod === "EMAIL") ok = await verifyEmailCode(ch, code.replace(/\s/g, ""));
  } else if (ch.method === "TOTP") {
    ok = await verifyTotpFor(ch.pendingSecretEnc, code, null, null);
  } else if (ch.method === "EMAIL") {
    ok = await verifyEmailCode(ch, code.replace(/\s/g, ""));
  }
  if (ok) return "ok";
  if (ch.attempts + 1 >= MAX_ATTEMPTS) {
    await dropChallenge(ch.id);
    return "locked";
  }
  return "wrong";
}

/**
 * Deja activado un método (alta o cambio): guarda el secreto, genera 10 códigos de recuperación nuevos
 * (solo su HMAC en la BD) y quita la confianza de los dispositivos recordados. Devuelve los códigos en claro: se muestran una vez.
 */
export async function commitEnrollment(userId: string, method: "TOTP" | "EMAIL", secretEnc: string | null): Promise<string[]> {
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { twoFactorMethod: method, totpSecretEnc: method === "TOTP" ? secretEnc : null, totpLastStep: null } }),
    db.recoveryCode.deleteMany({ where: { userId } }),
    db.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })) }),
    db.loginChallenge.deleteMany({ where: { userId, kind: "ENROLL" } }),
  ]);
  await revokeTrustedDevices(userId);
  return codes;
}

/** Cambia los códigos de recuperación por 10 nuevos. */
export async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  await db.$transaction([
    db.recoveryCode.deleteMany({ where: { userId } }),
    db.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })) }),
  ]);
  return codes;
}

/** Quita el método y todo lo que cuelga de él (desactivar por la persona o restablecer por un administrador). */
export async function clearTwoFactor(userId: string): Promise<void> {
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { twoFactorMethod: null, totpSecretEnc: null, totpLastStep: null } }),
    db.recoveryCode.deleteMany({ where: { userId } }),
    db.loginChallenge.deleteMany({ where: { userId } }),
  ]);
  await revokeTrustedDevices(userId);
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  return db.recoveryCode.count({ where: { userId, usedAt: null } });
}

/** Borra los desafíos caducados (mantenimiento horario). */
export async function purgeExpiredChallenges(now: Date = new Date()): Promise<number> {
  const { count } = await db.loginChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}
