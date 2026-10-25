// Lógica pura (sin base de datos) del asistente de primer arranque: cuándo está pendiente y el código de un solo uso.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Caducidad del código de un solo uso: 24 horas desde el arranque que lo generó. */
export const SETUP_CODE_TTL_MS = 24 * 60 * 60_000;
/** Sin 0/O/1/I/L: el código se teclea mirando un log. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export interface StoredSetupCode {
  salt: string;
  /** sha256(salt:código normalizado), en hexadecimal. */
  hash: string;
  /** Instante de caducidad (ms desde 1970). */
  expiresAt: number;
}

/** El asistente solo está activo sin usuarios y sin el administrador inicial por variables (SEED_ADMIN_*). */
export function setupPending(userCount: number, env: Record<string, string | undefined> = process.env): boolean {
  if (userCount > 0) return false;
  return !(env.SEED_ADMIN_EMAIL?.trim() && env.SEED_ADMIN_PASSWORD);
}

/** Código nuevo con el formato XXXX-XXXX (40 bits de aleatoriedad). */
export function generateSetupCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** Mayúsculas y sin separadores ni espacios: «abcd efgh» y «ABCD-EFGH» son el mismo código. */
export function normalizeSetupCode(input: string): string {
  return String(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function digest(salt: string, normalized: string): string {
  return createHash("sha256").update(`${salt}:${normalized}`).digest("hex");
}

export function hashSetupCode(code: string, now: number = Date.now(), ttlMs: number = SETUP_CODE_TTL_MS): StoredSetupCode {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: digest(salt, normalizeSetupCode(code)), expiresAt: now + ttlMs };
}

function sameString(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

/** ¿Coincide el código con el guardado y no ha caducado? `envToken` (SETUP_TOKEN) también vale, sin caducidad. */
export function verifySetupCode(input: string, stored: StoredSetupCode | null, now: number = Date.now(), envToken?: string | null): boolean {
  const normalized = normalizeSetupCode(input);
  if (!normalized) return false;
  let ok = false;
  const token = envToken?.trim();
  if (token && token.length >= 8 && sameString(String(input).trim(), token)) ok = true;
  if (stored && now <= stored.expiresAt && sameString(digest(stored.salt, normalized), stored.hash)) ok = true;
  return ok;
}

/** Interpreta el valor guardado en AppState; cualquier cosa rara cuenta como «sin código». */
export function parseStoredCode(raw: string | null | undefined): StoredSetupCode | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSetupCode>;
    if (typeof v.salt === "string" && typeof v.hash === "string" && typeof v.expiresAt === "number") return { salt: v.salt, hash: v.hash, expiresAt: v.expiresAt };
  } catch {
    // valor corrupto
  }
  return null;
}

/** Zona horaria IANA válida para Intl. */
export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("es", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
