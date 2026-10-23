import "server-only";
import { randomBytes } from "node:crypto";
import { labelledHmac } from "./auth-token-core";

// Permisos de descarga de la copia de seguridad: tras confirmar la contraseña se emite un token de un solo uso
// y 60 s de vida, ligado a la persona. En memoria (un único contenedor) y guardado solo como HMAC.
// Se cuelga de globalThis para que la acción y la ruta compartan el mismo mapa aunque Next las empaquete aparte.

const TTL_MS = 60_000;
const g = globalThis as unknown as { __pzBackupTokens?: Map<string, { userId: string; expiresAt: number }> };
const tokens = (g.__pzBackupTokens ??= new Map());

const key = (token: string) => labelledHmac("backup-download", token);

export function issueBackupDownloadToken(userId: string): string {
  const now = Date.now();
  for (const [k, v] of tokens) if (v.expiresAt < now) tokens.delete(k);
  const token = randomBytes(32).toString("base64url");
  tokens.set(key(token), { userId, expiresAt: now + TTL_MS });
  return token;
}

/** Gasta el token: válido solo una vez, antes de caducar y para la misma persona. */
export function consumeBackupDownloadToken(token: string, userId: string): boolean {
  const k = key(token.slice(0, 100));
  const row = tokens.get(k);
  if (!row) return false;
  tokens.delete(k);
  return row.userId === userId && row.expiresAt >= Date.now();
}
