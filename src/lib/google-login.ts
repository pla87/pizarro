import "server-only";
import { db } from "./db";
import { idTokenKeyId, validateIdTokenClaims, verifyIdTokenSignature, type ClaimsFailure, type Jwk } from "./google-id-token";

// «Iniciar sesión con Google»: parte con red y base de datos. La lógica pura (URL, firma, claims) está en google-id-token.ts.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

export function googleLoginRedirectUri(): string {
  return `${process.env.APP_URL!.replace(/\/$/, "")}/api/auth/google/callback`;
}

let jwksCache: { keys: Jwk[]; expiresAt: number; fetchedAt: number } | null = null;

/** Claves públicas de Google, en caché según su Cache-Control. Si falta el `kid` pedido se refrescan (como mucho 1 vez por minuto). */
export async function googleKeys(kid: string | null): Promise<Jwk[]> {
  const now = Date.now();
  const fresh = jwksCache && jwksCache.expiresAt > now;
  const unknownKid = kid !== null && jwksCache && !jwksCache.keys.some((k) => k.kid === kid) && now - jwksCache.fetchedAt > 60_000;
  if (fresh && !unknownKid) return jwksCache!.keys;
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`JWKS de Google: HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  jwksCache = { keys: Array.isArray(body.keys) ? body.keys : [], expiresAt: now + Math.min(Math.max(maxAge, 60), 24 * 3600) * 1000, fetchedAt: now };
  return jwksCache.keys;
}

export type GoogleIdentity = { sub: string; email: string; name: string | null };
export type GoogleLoginFailure = ClaimsFailure | "exchange" | "signature";

/** Cambia el código por tokens (con el verificador PKCE) y valida el id_token: firma, iss, aud, exp, nonce, email_verified y dominio. */
export async function exchangeAndVerify(code: string, verifier: string, nonce: string): Promise<{ ok: true; identity: GoogleIdentity } | { ok: false; reason: GoogleLoginFailure }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: googleLoginRedirectUri(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: unknown };
  if (!res.ok || typeof json.id_token !== "string") return { ok: false, reason: "exchange" };
  const claims = verifyIdTokenSignature(json.id_token, await googleKeys(idTokenKeyId(json.id_token)));
  if (!claims) return { ok: false, reason: "signature" };
  const checked = validateIdTokenClaims(claims, { clientId: process.env.GOOGLE_CLIENT_ID!, nonce, domain: process.env.GOOGLE_WORKSPACE_DOMAIN });
  return checked.ok ? { ok: true, identity: checked } : { ok: false, reason: checked.reason };
}

const userSelect = { id: true, name: true, email: true, locale: true, active: true, mustChangePassword: true, googleSub: true } as const;

/**
 * Cuenta existente a la que corresponde esa identidad de Google: primero por `sub` (estable aunque cambie el email),
 * y si todavía no está enlazada, por email verificado sin distinguir mayúsculas. Nunca se crean cuentas.
 * Una cuenta ya enlazada a OTRO sub no se reasigna. Si un admin la desvinculó (googleRelinkBlocked) devuelve "relink_blocked".
 */
export async function findUserForGoogle(identity: GoogleIdentity) {
  const bySub = await db.user.findUnique({ where: { googleSub: identity.sub }, select: userSelect });
  if (bySub) return bySub.active ? bySub : null;
  const byEmail = await db.user.findFirst({ where: { email: { equals: identity.email, mode: "insensitive" } }, select: { ...userSelect, googleRelinkBlocked: true } });
  if (!byEmail || !byEmail.active || byEmail.googleSub) return null;
  // Un admin la desvinculó: no se vuelve a enlazar sola hasta que entre con su contraseña o un admin lo permita.
  if (byEmail.googleRelinkBlocked) return "relink_blocked" as const;
  // Primer acceso con Google: queda enlazada. La condición evita pisar un enlace hecho en paralelo.
  const { count } = await db.user.updateMany({ where: { id: byEmail.id, googleSub: null, googleRelinkBlocked: false }, data: { googleSub: identity.sub } });
  return count === 1 ? byEmail : null;
}
