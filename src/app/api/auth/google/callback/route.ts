import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { googleEnabled } from "@/lib/google";
import { GOOGLE_LOGIN_COOKIE } from "@/lib/google-id-token";
import { exchangeAndVerify, findUserForGoogle } from "@/lib/google-login";
import { completeLogin } from "@/lib/login";
import { logEvent } from "@/lib/log";
import { appUrl } from "@/lib/mail";
import { rateLimit } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/redirect";
import { clientIp } from "@/lib/request";
import { cookieSecure } from "@/lib/session-config";

export const runtime = "nodejs";

// Se comparan bytes, no caracteres: con multibyte las longitudes difieren y timingSafeEqual lanzaría.
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Vuelta de Google: valida state, intercambia el código (PKCE), verifica el id_token y abre sesión con una cuenta EXISTENTE. */
export async function GET(req: Request) {
  const ip = clientIp(req.headers);
  const store = await cookies();
  const raw = store.get(GOOGLE_LOGIN_COOKIE)?.value ?? "";
  // Un solo uso, pase lo que pase (con su misma ruta: un delete en «/» no la borraría).
  store.set(GOOGLE_LOGIN_COOKIE, "", { path: "/api/auth/google", maxAge: 0, httpOnly: true, secure: cookieSecure() });
  const fail = (code: string, message: string, extra: Record<string, unknown> = {}): never => {
    logEvent({ level: "warn", category: "auth", action: "auth.googleLoginFailed", message: `Acceso con Google no completado: ${message}`, path: "/api/auth/google/callback", ip, details: { reason: code, ...extra } });
    redirect(`${appUrl()}/login?error=${code}`);
  };

  if (!googleEnabled()) return fail("google_disabled", "Google no está configurado");
  if (!rateLimit(`glogin:cb:${ip}`, 20, 15 * 60_000)) return fail("rate", "demasiados intentos");

  const url = new URL(req.url);
  const [state, nonce, verifier, nextB64] = raw.split(".");
  const given = url.searchParams.get("state") ?? "";
  if (!state || !nonce || !verifier || !given || !safeEqual(state, given)) return fail("google_state", "state no válido o caducado");
  if (url.searchParams.get("error")) return fail("google_cancelled", "cancelado en Google");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2000) return fail("google_failed", "sin código de autorización");

  let result;
  try {
    result = await exchangeAndVerify(code, verifier, nonce);
  } catch (err) {
    console.error("[google-login]", err);
    return fail("google_failed", "error al hablar con Google");
  }
  if (!result.ok) {
    return fail(result.reason === "domain" ? "google_domain" : result.reason === "email_unverified" ? "google_unverified" : "google_failed", `id_token rechazado (${result.reason})`);
  }
  const user = await findUserForGoogle(result.identity);
  // Mensaje neutro: no se distingue «no existe», «desactivada» o «enlazada a otra cuenta de Google».
  if (!user) return fail("google_noaccount", "sin cuenta asociada", { email: result.identity.email });

  await completeLogin(user, { method: "google", path: "/api/auth/google/callback" });
  const next = safeNextPath(Buffer.from(nextB64 ?? "", "base64url").toString("utf8"));
  redirect(`${appUrl()}${next}`);
}
