import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { hashAuthToken, isTokenUsable, newToken, tokenExpiry, type TokenPurpose } from "./auth-token-core";

// Enlaces de un solo uso por email. En la base de datos solo queda el hash del token.

/** Crea un enlace nuevo y devuelve el token en claro (para el email). Sustituye al anterior pendiente del mismo tipo. */
export async function issueAuthToken(userId: string, purpose: TokenPurpose, data?: Prisma.InputJsonValue): Promise<string> {
  const token = newToken();
  await db.$transaction([
    db.authToken.deleteMany({ where: { userId, purpose } }),
    db.authToken.create({ data: { userId, purpose, tokenHash: hashAuthToken(token), data, expiresAt: tokenExpiry(purpose) } }),
  ]);
  return token;
}

/** Busca un enlace válido (sin usar ni caducado, de uno de los tipos indicados, de un usuario activo) sin gastarlo. */
export async function findUsableToken(token: string, purposes: TokenPurpose[]) {
  if (!token || token.length > 100) return null;
  const row = await db.authToken.findUnique({
    where: { tokenHash: hashAuthToken(token) },
    select: {
      id: true, userId: true, purpose: true, data: true, expiresAt: true, usedAt: true,
      user: { select: { id: true, name: true, email: true, locale: true, active: true } },
    },
  });
  if (!row || !purposes.includes(row.purpose) || !isTokenUsable(row) || !row.user.active) return null;
  return row;
}

/** Gasta el enlace de forma atómica: solo una petición puede conseguirlo. */
export async function consumeToken(id: string): Promise<boolean> {
  const { count } = await db.authToken.updateMany({ where: { id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  return count === 1;
}

/** Borra los enlaces caducados (mantenimiento horario). */
export async function purgeExpiredTokens(now: Date = new Date()): Promise<number> {
  const { count } = await db.authToken.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}
