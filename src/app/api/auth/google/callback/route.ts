import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { googleEnabled } from "@/lib/google";
import { GOOGLE_LOGIN_COOKIE } from "@/lib/google-id-token";
import { exchangeAndVerify, findUserForGoogle } from "@/lib/google-login";
import { completeLogin } from "@/lib/login";
import { logEvent } from "@/lib/log";
import { appUrl } from "@/lib/mail";
import { rateIp, rateLimit } from "@/lib/rate-limit";
import { ACCOUNT_DELETE_PURPOSE, accountDeleteReturn } from "@/lib/google-reauth";
import { safeNextPath } from "@/lib/redirect";
import { currentSessionId, getCurrentUser } from "@/lib/session";
import { confirmAccountDeleteWithGoogle, secondStepFor, sendEmailCode, startChallenge } from "@/lib/two-factor";
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
  const [state, nonce, verifier, nextB64, purpose] = raw.split(".");
  // Volver a entrar con Google para borrar la cuenta: los fallos regresan a «Borrar mi cuenta», no al acceso.
  const reauth = purpose === ACCOUNT_DELETE_PURPOSE;
  const fail = (code: string, message: string, extra: Record<string, unknown> = {}): never => {
    logEvent({ level: "warn", category: "auth", action: reauth ? "auth.googleReauthFailed" : "auth.googleLoginFailed", message: `${reauth ? "Confirmación con Google para borrar la cuenta" : "Acceso con Google"} no completado: ${message}`, path: "/api/auth/google/callback", ip, details: { reason: code, ...extra } });
    redirect(reauth ? `${appUrl()}${accountDeleteReturn("google_failed")}` : `${appUrl()}/login?error=${code}`);
  };

  if (!googleEnabled()) return fail("google_disabled", "Google no está configurado");
  if (!rateLimit(`glogin:cb:${rateIp(ip)}`, 20, 15 * 60_000)) return fail("rate", "demasiados intentos");

  const url = new URL(req.url);
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
  if (reauth) {
    // Sin abrir sesión ni enlazar nada: tiene que ser la misma cuenta de Google enlazada a la sesión abierta.
    const me = await getCurrentUser();
    const sessionId = await currentSessionId();
    if (!me || !sessionId) redirect(`${appUrl()}/login`);
    const row = await db.user.findUnique({ where: { id: me.id }, select: { googleSub: true } });
    if (!row?.googleSub || row.googleSub !== result.identity.sub) {
      logEvent({ level: "warn", category: "auth", action: "auth.googleReauthFailed", message: `${me.name}: para borrar su cuenta ha vuelto a entrar con otra cuenta de Google`, userId: me.id, userName: me.name, path: "/api/auth/google/callback", ip });
      redirect(`${appUrl()}${accountDeleteReturn("google_mismatch")}`);
    }
    await confirmAccountDeleteWithGoogle(me.id, sessionId);
    logEvent({ category: "auth", action: "auth.googleReauth", message: `${me.name} ha vuelto a entrar con Google para borrar su cuenta`, userId: me.id, userName: me.name, path: "/api/auth/google/callback", ip });
    redirect(`${appUrl()}${accountDeleteReturn("google")}`);
  }

  const user = await findUserForGoogle(result.identity);
  if (user === "relink_blocked") return fail("google_unlinked", "cuenta desvinculada por un administrador", { email: result.identity.email });
  // Mensaje neutro: no se distingue «no existe», «desactivada» o «enlazada a otra cuenta de Google».
  if (!user) return fail("google_noaccount", "sin cuenta asociada", { email: result.identity.email });

  const next = safeNextPath(Buffer.from(nextB64 ?? "", "base64url").toString("utf8"));
  // Los administradores pasan también por la verificación en dos pasos de Pizarro (la de Google no basta para administrar):
  // misma pantalla y mismo estado pendiente que tras la contraseña; hasta superarla no hay sesión.
  if (user.role === "ADMIN") {
    const step = await secondStepFor(user);
    if (step) {
      const challenge = await startChallenge(user.id, step === "VERIFY" ? "LOGIN" : "SETUP", { next, via: "google" });
      if (step === "VERIFY" && user.twoFactorMethod === "EMAIL") await sendEmailCode(challenge, user).catch(() => {});
      logEvent({ category: "auth", action: "auth.secondStepRequested", message: `${user.name}: acceso con Google correcto, falta la verificación en dos pasos`, userId: user.id, userName: user.name, path: "/api/auth/google/callback", ip });
      redirect(`${appUrl()}/login/verify`);
    }
  }
  await completeLogin(user, { method: "google", path: "/api/auth/google/callback" });
  if (user.mustChangePassword) redirect(`${appUrl()}/change-password`);
  redirect(`${appUrl()}${next}`);
}
