import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";

// Claves de la aplicación, separadas por uso (sin «server-only»: también lo usan los scripts de dist/).
//
//   SESSION_SECRET   firma las sesiones. Rotarla solo cierra todas las sesiones.
//   TOKEN_SECRET     HMAC de enlaces de email, códigos de recuperación, códigos 2FA por email y dispositivos.
//                    Sin definir = SESSION_SECRET (como hasta ahora). TOKEN_SECRET_PREVIOUS: la anterior, solo para comprobar.
//   ENCRYPTION_KEY   cifra los secretos TOTP y los tokens de Google. Sin definir = SESSION_SECRET (misma derivación
//                    que siempre: lo ya cifrado se sigue leyendo). ENCRYPTION_KEY_PREVIOUS: la anterior, solo para descifrar.
//
// Formato cifrado: «v2.<id>.<iv>.<tag>.<datos>», donde <id> es una huella corta de la clave (no la revela) que dice con
// cuál se cifró. Lo antiguo, «v1.<iv>.<tag>.<datos>», no lleva id: se prueba con la actual y luego con la anterior.

type Env = Record<string, string | undefined>;

const MIN_LENGTH = 32;

function required(name: string, value: string | undefined): string {
  if (!value || value.length < MIN_LENGTH) throw new Error(`${name} debe tener al menos ${MIN_LENGTH} caracteres`);
  return value;
}

/** Variable opcional: vacía = no definida; definida pero corta = error (mejor fallar que usar una clave débil). */
function optional(name: string, value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  return required(name, value);
}

export function sessionSecret(env: Env = process.env): string {
  return required("SESSION_SECRET", env.SESSION_SECRET);
}

/** Clave de los HMAC de tokens, códigos y dispositivos (TOKEN_SECRET o, si no hay, SESSION_SECRET). */
export function tokenSecret(env: Env = process.env): string {
  return optional("TOKEN_SECRET", env.TOKEN_SECRET) ?? sessionSecret(env);
}

/** Claves con las que se COMPRUEBA un hash: la actual y, si existe y es distinta, la anterior. */
export function tokenSecrets(env: Env = process.env): string[] {
  const current = tokenSecret(env);
  const previous = optional("TOKEN_SECRET_PREVIOUS", env.TOKEN_SECRET_PREVIOUS);
  return previous && previous !== current ? [current, previous] : [current];
}

/** HMAC con etiqueta de dominio (un valor de un uso nunca coincide con el de otro) y la clave actual. */
export function labelledHmac(label: string, value: string, env: Env = process.env): string {
  return createHmac("sha256", tokenSecret(env)).update(`${label}:${value}`).digest("hex");
}

/** Hashes posibles de un valor (clave actual primero): para buscar lo que se guardó antes de rotar TOKEN_SECRET. */
export function labelledHmacCandidates(label: string, value: string, env: Env = process.env): string[] {
  return tokenSecrets(env).map((s) => createHmac("sha256", s).update(`${label}:${value}`).digest("hex"));
}

// --- Cifrado de secretos (AES-256-GCM) ---

export interface EncryptionKey {
  /** Huella corta (8 caracteres base64url) que viaja en el valor cifrado. */
  id: string;
  key: Buffer;
}

const derived = new Map<string, EncryptionKey>();

/** Deriva la clave AES de un secreto. Es la derivación de siempre: con SESSION_SECRET da la misma clave que antes. */
export function deriveEncryptionKey(secret: string): EncryptionKey {
  let k = derived.get(secret);
  if (!k) {
    const key = Buffer.from(hkdfSync("sha256", secret, "tablon", "tablon-token-encryption-v1", 32));
    const id = createHash("sha256").update("pizarro-key-id:").update(key).digest("base64url").slice(0, 8);
    k = { id, key };
    if (derived.size > 20) derived.clear();
    derived.set(secret, k);
  }
  return k;
}

/** Clave actual de cifrado y, si la hay, la anterior (solo para descifrar). */
export function encryptionKeys(env: Env = process.env): { current: EncryptionKey; previous: EncryptionKey | null } {
  const current = deriveEncryptionKey(optional("ENCRYPTION_KEY", env.ENCRYPTION_KEY) ?? sessionSecret(env));
  const prevSecret = optional("ENCRYPTION_KEY_PREVIOUS", env.ENCRYPTION_KEY_PREVIOUS);
  const previous = prevSecret ? deriveEncryptionKey(prevSecret) : null;
  return { current, previous: previous && previous.id !== current.id ? previous : null };
}

export function encryptSecret(plain: string, env: Env = process.env): string {
  const { current } = encryptionKeys(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", current.key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v2", current.id, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

function open(key: Buffer, iv: string, tag: string, data: string): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export interface Decrypted {
  plain: string;
  /** true si no está cifrado con la clave actual en el formato actual: conviene volver a cifrarlo. */
  stale: boolean;
}

/** Descifra con la clave que corresponda. Lanza si el valor no es válido o ninguna clave disponible lo abre. */
export function decryptSecretInfo(token: string, env: Env = process.env): Decrypted {
  const { current, previous } = encryptionKeys(env);
  const parts = token.split(".");
  if (parts[0] === "v2" && parts.length === 5 && parts.every(Boolean)) {
    const [, id, iv, tag, data] = parts as [string, string, string, string, string];
    if (id === current.id) return { plain: open(current.key, iv, tag, data), stale: false };
    if (previous && id === previous.id) return { plain: open(previous.key, iv, tag, data), stale: true };
    throw new Error("Secreto cifrado con una clave que ya no está configurada");
  }
  if (parts[0] === "v1" && parts.length === 4 && parts.every(Boolean)) {
    const [, iv, tag, data] = parts as [string, string, string, string];
    // Sin id: la etiqueta GCM dice si la clave es la buena.
    for (const k of previous ? [current, previous] : [current]) {
      try {
        return { plain: open(k.key, iv, tag, data), stale: true };
      } catch {
        // Probar con la siguiente.
      }
    }
    throw new Error("Secreto cifrado con una clave que ya no está configurada");
  }
  throw new Error("Secreto cifrado no válido");
}

export function decryptSecret(token: string, env: Env = process.env): string {
  return decryptSecretInfo(token, env).plain;
}

/** Valor re-cifrado con la clave actual si el guardado es antiguo; null si ya está al día. Lanza si no se puede leer. */
export function reencryptIfStale(token: string, env: Env = process.env): string | null {
  const { plain, stale } = decryptSecretInfo(token, env);
  return stale ? encryptSecret(plain, env) : null;
}
