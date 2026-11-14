import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { googleEnabled } from "@/lib/google";
import { googleConfig, googleWorkspaceDomain } from "@/lib/google-config";
import { GOOGLE_LOGIN_COOKIE, buildLoginAuthUrl, newPkce, randomToken } from "@/lib/google-id-token";
import { googleLoginRedirectUri } from "@/lib/google-login";
import { logEvent } from "@/lib/log";
import { appUrl } from "@/lib/mail";
import { rateIp, rateLimit } from "@/lib/rate-limit";
import { ACCOUNT_DELETE_PURPOSE, accountDeleteReturn } from "@/lib/google-reauth";
import { safeNextPath } from "@/lib/redirect";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { cookieSecure } from "@/lib/session-config";

export const runtime = "nodejs";

/**
 * Inicia «Iniciar sesión con Google»: OpenID Connect con código de autorización + PKCE + state + nonce.
 * Con `?purpose=account-delete`, quien ya tiene sesión vuelve a entrar con Google para confirmar que borra su cuenta
 * (la vuelta no abre sesión: marca la confirmación y regresa a «Mi perfil → Cuenta»). En ese caso Google debe volver a
 * pedir la contraseña (`prompt=login`, `max_age=0`) y la cookie guarda cuándo empezó, para comprobar `auth_time` a la vuelta.
 */
export async function GET(req: Request) {
  const ip = clientIp(req.headers);
  const params = new URL(req.url).searchParams;
  const reauth = params.get("purpose") === ACCOUNT_DELETE_PURPOSE;
  if (reauth) {
    if (!(await getCurrentUser())) redirect(`${appUrl()}/login`);
    if (!googleEnabled()) redirect(`${appUrl()}${accountDeleteReturn("google_failed")}`);
  }
  if (!googleEnabled()) redirect(`${appUrl()}/login?error=google_disabled`);
  if (!rateLimit(`glogin:start:${rateIp(ip)}`, 30, 15 * 60_000)) redirect(reauth ? `${appUrl()}${accountDeleteReturn("google_failed")}` : `${appUrl()}/login?error=rate`);
  const state = randomToken();
  const nonce = randomToken();
  const pkce = newPkce();
  const next = safeNextPath(params.get("next") ?? "");
  const parts = [state, nonce, pkce.verifier, Buffer.from(next).toString("base64url")];
  // Baja: «….<inicio en segundos>.account-delete» (la marca, siempre al final).
  if (reauth) parts.push(String(Math.floor(Date.now() / 1000)), ACCOUNT_DELETE_PURPOSE);
  (await cookies()).set(GOOGLE_LOGIN_COOKIE, parts.join("."), {
    httpOnly: true,
    secure: cookieSecure(),
    // Lax: Google vuelve con una navegación de primer nivel (GET) y la cookie debe viajar.
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  logEvent({ category: "auth", action: reauth ? "auth.googleReauthStart" : "auth.googleLoginStart", message: reauth ? "Vuelve a entrar con Google para borrar su cuenta" : "Inicio de «Iniciar sesión con Google»", path: "/api/auth/google/start", ip });
  redirect(buildLoginAuthUrl({
    clientId: googleConfig().clientId,
    redirectUri: googleLoginRedirectUri(),
    state,
    nonce,
    challenge: pkce.challenge,
    domain: googleWorkspaceDomain(),
    reauth,
  }));
}
