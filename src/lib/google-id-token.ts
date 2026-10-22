import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";

// Parte pura del «Iniciar sesión con Google» (OpenID Connect): URL de autorización con PKCE, comprobación
// de la firma del id_token con las claves públicas de Google y validación de sus campos. Sin red ni BD.

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
/** Cookie temporal del flujo (state, nonce, verificador PKCE y ruta de destino); solo la leen las rutas /api/auth/google. */
export const GOOGLE_LOGIN_COOKIE = "pz_glogin";
const CLOCK_SKEW_SECONDS = 60;

const b64 = (buf: Buffer) => buf.toString("base64url");

/** PKCE (RFC 7636): el verificador se queda en la cookie; a Google solo viaja su SHA-256. */
export function newPkce(): { verifier: string; challenge: string } {
  const verifier = b64(randomBytes(32));
  return { verifier, challenge: b64(createHash("sha256").update(verifier).digest()) };
}

export const randomToken = (): string => b64(randomBytes(24));

/** Solo `openid email profile`: Drive es una conexión aparte y opcional. */
export function buildLoginAuthUrl(opts: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string; domain?: string | null }): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  // Solo orienta al selector de cuentas; la validación real es la del campo `hd` del id_token.
  if (opts.domain) params.set("hd", opts.domain);
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export interface Jwk {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

/** Verifica la firma RS256 y devuelve las claims; null si el token es ilegible, usa otro algoritmo o la firma no cuadra. */
export function verifyIdTokenSignature(idToken: string, keys: Jwk[]): Record<string, unknown> | null {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg?: string; kid?: string };
    if (header.alg !== "RS256") return null;
    const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
    if (!jwk) return null;
    const key = createPublicKey({ key: jwk as never, format: "jwk" });
    if (!verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"))) return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    return claims && typeof claims === "object" && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `kid` de la cabecera, para saber si hay que refrescar las claves de Google. */
export function idTokenKeyId(idToken: string): string | null {
  try {
    const header = JSON.parse(Buffer.from(idToken.split(".")[0]!, "base64url").toString("utf8")) as { kid?: unknown };
    return typeof header.kid === "string" ? header.kid : null;
  } catch {
    return null;
  }
}

export type ClaimsFailure = "format" | "issuer" | "audience" | "expired" | "nonce" | "email_unverified" | "domain";

export type ClaimsResult =
  | { ok: true; sub: string; email: string; name: string | null }
  | { ok: false; reason: ClaimsFailure };

/** Valida iss, aud, exp, nonce, email_verified y, si se configura, el dominio de Workspace (`hd` y email). */
export function validateIdTokenClaims(
  claims: Record<string, unknown>,
  opts: { clientId: string; nonce: string; domain?: string | null; now?: number },
): ClaimsResult {
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const { iss, aud, azp, exp, iat, sub, email, name, nonce, hd } = claims;
  if (typeof sub !== "string" || !sub || sub.length > 255 || typeof email !== "string" || !email.includes("@")) return { ok: false, reason: "format" };
  if (typeof iss !== "string" || !GOOGLE_ISSUERS.includes(iss)) return { ok: false, reason: "issuer" };
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(opts.clientId)) return { ok: false, reason: "audience" };
  // Con varias audiencias, el token debe haberse emitido para este cliente.
  if (audiences.length > 1 && azp !== opts.clientId) return { ok: false, reason: "audience" };
  if (typeof exp !== "number" || exp + CLOCK_SKEW_SECONDS < nowSec) return { ok: false, reason: "expired" };
  if (typeof iat === "number" && iat - CLOCK_SKEW_SECONDS > nowSec) return { ok: false, reason: "expired" };
  if (typeof nonce !== "string" || !opts.nonce || nonce !== opts.nonce) return { ok: false, reason: "nonce" };
  if (claims.email_verified !== true && claims.email_verified !== "true") return { ok: false, reason: "email_unverified" };
  const domain = opts.domain?.trim().toLowerCase();
  if (domain) {
    const emailDomain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
    if (typeof hd !== "string" || hd.toLowerCase() !== domain || emailDomain !== domain) return { ok: false, reason: "domain" };
  }
  return { ok: true, sub, email: email.trim().toLowerCase(), name: typeof name === "string" && name ? name : null };
}
