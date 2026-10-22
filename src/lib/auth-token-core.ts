import { createHmac, randomBytes } from "node:crypto";

// Parte pura de los enlaces de un solo uso (sin base de datos): generación, hash y caducidad.

export type TokenPurpose = "PASSWORD_RESET" | "PASSWORD_CHANGE" | "EMAIL_CHANGE" | "INVITE";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Vida de cada tipo de enlace. */
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  PASSWORD_RESET: 30 * MINUTE,
  PASSWORD_CHANGE: 30 * MINUTE,
  EMAIL_CHANGE: 30 * MINUTE,
  INVITE: 72 * HOUR,
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET debe tener al menos 32 caracteres");
  return s;
}

/** HMAC con etiqueta de dominio: un valor de un uso nunca coincide con el de otro (sesión, enlace, dispositivo). */
function labelledHmac(label: string, value: string): string {
  return createHmac("sha256", secret()).update(`${label}:${value}`).digest("hex");
}

export const newToken = (): string => randomBytes(32).toString("base64url");

/** Lo único que se guarda del token: el original solo viaja en el email. */
export const hashAuthToken = (token: string): string => labelledHmac("auth-token", token);

/** Idem para la cookie de dispositivo conocido. */
export const hashDeviceId = (deviceId: string): string => labelledHmac("device", deviceId);

export function tokenExpiry(purpose: TokenPurpose, now: number = Date.now()): Date {
  return new Date(now + TOKEN_TTL_MS[purpose]);
}

/** Un enlace sirve si no se ha usado y no ha caducado. */
export function isTokenUsable(t: { expiresAt: Date; usedAt: Date | null }, now: number = Date.now()): boolean {
  return t.usedAt === null && t.expiresAt.getTime() > now;
}
