import "server-only";

// Cifrado simétrico (AES-256-GCM) para secretos guardados en BD: tokens de Google y secretos TOTP.
// La clave es ENCRYPTION_KEY (o, sin ella, la derivada de SESSION_SECRET, como siempre); ver lib/keyring.ts.
export { decryptSecret, decryptSecretInfo, encryptSecret, reencryptIfStale } from "./keyring";
