import bcrypt from "bcryptjs";

const COST = 11;
export const MIN_PASSWORD = 10;

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
