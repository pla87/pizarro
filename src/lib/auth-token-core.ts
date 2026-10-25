import { randomBytes } from "node:crypto";
import { labelledHmac, labelledHmacCandidates } from "./keyring";

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

/** HMAC con etiqueta de dominio: un valor de un uso nunca coincide con el de otro (sesión, enlace, dispositivo).
 * La clave es TOKEN_SECRET (o SESSION_SECRET si no se ha definido); ver lib/keyring.ts. */
export { labelledHmac, labelledHmacCandidates } from "./keyring";

export const newToken = (): string => randomBytes(32).toString("base64url");

/** Lo único que se guarda del token: el original solo viaja en el email. */
export const hashAuthToken = (token: string): string => labelledHmac("auth-token", token);

/** Idem para la cookie de dispositivo conocido. */
export const hashDeviceId = (deviceId: string): string => labelledHmac("device", deviceId);

/** Hashes con los que buscar un token o un dispositivo: el de la clave actual y, durante la rotación, el de TOKEN_SECRET_PREVIOUS. */
export const authTokenHashes = (token: string): string[] => labelledHmacCandidates("auth-token", token);
export const deviceIdHashes = (deviceId: string): string[] => labelledHmacCandidates("device", deviceId);

export function tokenExpiry(purpose: TokenPurpose, now: number = Date.now()): Date {
  return new Date(now + TOKEN_TTL_MS[purpose]);
}

/** Un enlace sirve si no se ha usado y no ha caducado. */
export function isTokenUsable(t: { expiresAt: Date; usedAt: Date | null }, now: number = Date.now()): boolean {
  return t.usedAt === null && t.expiresAt.getTime() > now;
}
