import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { labelledHmac, labelledHmacCandidates } from "./auth-token-core";

// Parte pura de la verificación en dos pasos (sin base de datos): base32, TOTP (RFC 6238, SHA-1),
// URI otpauth://, códigos de recuperación y códigos por email.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Tolera minúsculas, espacios, guiones y relleno «=». Lanza si hay algún carácter que no es base32. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Base32 no válido");
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** Secreto nuevo de 160 bits en base32 (32 caracteres), el tamaño habitual de las apps. */
export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

/** HOTP (RFC 4226) con HMAC-SHA1. */
export function hotp(secret: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const offset = h[h.length - 1]! & 15;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** Paso de 30 s al que pertenece un instante (ms). */
export const totpStep = (nowMs: number): number => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

/** Código TOTP (RFC 6238) de un secreto base32 en un instante (ms). */
export function totpAt(secretB32: string, nowMs: number, digits: number = TOTP_DIGITS): string {
  return hotp(base32Decode(secretB32), totpStep(nowMs), digits);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Comprueba un código con tolerancia de ±1 paso. Devuelve el paso aceptado o null. Con `lastStep` rechaza
 * pasos ya usados (un código solo sirve una vez). Recorre siempre todos los pasos: tiempo constante.
 */
export function verifyTotp(secretB32: string, input: string, nowMs: number, opts: { window?: number; lastStep?: number | null } = {}): number | null {
  const code = input.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const window = opts.window ?? 1;
  const current = totpStep(nowMs);
  let found: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    if (safeEqual(hotp(secret, step), code) && found === null && (opts.lastStep == null || step > opts.lastStep)) found = step;
  }
  return found;
}

/** URI que leen las apps (Google Authenticator, Aegis, 1Password…). */
export function otpauthUri(opts: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const q = new URLSearchParams({ secret: opts.secret, issuer: opts.issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${q}`;
}

// --- Códigos de recuperación ---

// Sin caracteres que se confunden (0/o, 1/l/i): 10 caracteres de 31 son ~50 bits.
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const RECOVERY_CODE_COUNT = 10;

function randomRecovery(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export function generateRecoveryCodes(n: number = RECOVERY_CODE_COUNT): string[] {
  const set = new Set<string>();
  while (set.size < n) set.add(randomRecovery());
  return [...set];
}

/** Forma canónica de lo que escribe la persona (minúsculas, sin espacios ni guiones sueltos); null si no es un código. */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toLowerCase().replace(/[\s-]/g, "");
  if (s.length !== 10 || ![...s].every((c) => RECOVERY_ALPHABET.includes(c))) return null;
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/** Lo único que se guarda del código de recuperación. */
export const hashRecoveryCode = (code: string): string => labelledHmac("recovery", code);
/** Hashes posibles de un código de recuperación (clave actual y TOKEN_SECRET_PREVIOUS). */
export const recoveryCodeHashes = (code: string): string[] => labelledHmacCandidates("recovery", code);

// --- Código de 6 dígitos por email ---

export const EMAIL_CODE_TTL_MS = 10 * 60_000;

export const generateEmailCode = (): string => String(randomInt(1_000_000)).padStart(6, "0");

/** Ligado al desafío concreto: un código no vale para otro inicio de sesión. */
export const hashEmailCode = (challengeId: string, code: string): string => labelledHmac("2fa-email", `${challengeId}:${code}`);
export const emailCodeHashes = (challengeId: string, code: string): string[] => labelledHmacCandidates("2fa-email", `${challengeId}:${code}`);
