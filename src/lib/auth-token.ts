import "server-only";
import { db } from "./db";
import { authTokenHashes, isTokenUsable } from "./auth-token-core";
import type { TokenPurpose } from "./auth-token-core";

export { issueAuthToken } from "./auth-token-issue";

// Enlaces de un solo uso por email. En la base de datos solo queda el hash del token.

/** Busca un enlace válido (sin usar ni caducado, de uno de los tipos indicados, de un usuario activo) sin gastarlo. */
export async function findUsableToken(token: string, purposes: TokenPurpose[]) {
  if (!token || token.length > 100) return null;
  // Con TOKEN_SECRET_PREVIOUS, un enlace emitido antes de rotar la clave sigue sirviendo hasta que caduca.
  const row = await db.authToken.findFirst({
    where: { tokenHash: { in: authTokenHashes(token) } },
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
