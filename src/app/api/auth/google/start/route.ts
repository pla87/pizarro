import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { googleEnabled } from "@/lib/google";
import { GOOGLE_LOGIN_COOKIE, buildLoginAuthUrl, newPkce, randomToken } from "@/lib/google-id-token";
import { googleLoginRedirectUri } from "@/lib/google-login";
import { logEvent } from "@/lib/log";
import { appUrl } from "@/lib/mail";
import { rateLimit } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/redirect";
import { clientIp } from "@/lib/request";
import { cookieSecure } from "@/lib/session-config";

export const runtime = "nodejs";

/** Inicia «Iniciar sesión con Google»: OpenID Connect con código de autorización + PKCE + state + nonce. */
export async function GET(req: Request) {
  const ip = clientIp(req.headers);
  if (!googleEnabled()) redirect(`${appUrl()}/login?error=google_disabled`);
  if (!rateLimit(`glogin:start:${ip}`, 30, 15 * 60_000)) redirect(`${appUrl()}/login?error=rate`);
  const state = randomToken();
  const nonce = randomToken();
  const pkce = newPkce();
  const next = safeNextPath(new URL(req.url).searchParams.get("next") ?? "");
  (await cookies()).set(GOOGLE_LOGIN_COOKIE, [state, nonce, pkce.verifier, Buffer.from(next).toString("base64url")].join("."), {
    httpOnly: true,
    secure: cookieSecure(),
    // Lax: Google vuelve con una navegación de primer nivel (GET) y la cookie debe viajar.
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  logEvent({ category: "auth", action: "auth.googleLoginStart", message: "Inicio de «Iniciar sesión con Google»", path: "/api/auth/google/start", ip });
  redirect(buildLoginAuthUrl({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    redirectUri: googleLoginRedirectUri(),
    state,
    nonce,
    challenge: pkce.challenge,
    domain: process.env.GOOGLE_WORKSPACE_DOMAIN,
  }));
}
