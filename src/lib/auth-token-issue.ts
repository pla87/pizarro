import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { hashAuthToken, newToken, tokenExpiry, type TokenPurpose } from "./auth-token-core";

// Sin «server-only»: lo comparten la app y el script de línea de órdenes reset-link.

/** Crea un enlace nuevo y devuelve el token en claro (para el email). Sustituye al anterior pendiente del mismo tipo. */
export async function issueAuthToken(userId: string, purpose: TokenPurpose, data?: Prisma.InputJsonValue): Promise<string> {
  const token = newToken();
  await db.$transaction([
    db.authToken.deleteMany({ where: { userId, purpose } }),
    db.authToken.create({ data: { userId, purpose, tokenHash: hashAuthToken(token), data, expiresAt: tokenExpiry(purpose) } }),
  ]);
  return token;
}
