import bcrypt from "bcryptjs";
import { z } from "zod";

const COST = 11;
export const MIN_PASSWORD = 10;
/** bcrypt solo usa los primeros 72 BYTES: más allá se ignoraría sin avisar (y las tildes ocupan 2). */
export const MAX_PASSWORD_BYTES = 72;

export function passwordByteLength(plain: string): number {
  return new TextEncoder().encode(plain).length;
}

/** Contraseña nueva: mínimo 10 caracteres y máximo 72 bytes en UTF-8. */
export function passwordSchema(minMessage = "La contraseña debe tener al menos 10 caracteres.") {
  return z
    .string()
    .min(MIN_PASSWORD, minMessage)
    .refine((p) => passwordByteLength(p) <= MAX_PASSWORD_BYTES, "La contraseña es demasiado larga (máximo 72 bytes; las tildes y los emojis ocupan más de uno).");
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Hash fijo para igualar el tiempo de respuesta cuando el usuario no existe.
let dummyHash: Promise<string> | null = null;
export function dummyVerify(plain: string): Promise<boolean> {
  dummyHash ??= bcrypt.hash("tablon-dummy-password", COST);
  return dummyHash.then((h) => bcrypt.compare(plain, h));
}
