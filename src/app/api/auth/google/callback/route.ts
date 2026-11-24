import { timingSafeEqual } from "node:crypto";
import { maskEmail } from "@/lib/mask-email";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { googleEnabled } from "@/lib/google";
import { GOOGLE_LOGIN_COOKIE } from "@/lib/google-id-token";
import { exchangeAndVerify, findUserForGoogle } from "@/lib/google-login";
import { completeLogin } from "@/lib/login";
import { logEvent, logText } from "@/lib/log";
import { appUrl } from "@/lib/mail";
import { rateIp, rateLimit } from "@/lib/rate-limit";
import { ACCOUNT_DELETE_PURPOSE, accountDeleteReturn, reauthFreshness } from "@/lib/google-reauth";
import { safeNextPath } from "@/lib/redirect";
import { currentSessionId, getCurrentUser } from "@/lib/session";
import { confirmAccountDeleteWithGoogle, secondStepFor, sendEmailCode, startChallenge } from "@/lib/two-factor";
import { clientIp } from "@/lib/request";
import type { Label } from "@/lib/undo-label";
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
  const [state, nonce, verifier, nextB64, ...rest] = raw.split(".");
  // Volver a entrar con Google para borrar la cuenta («….<inicio>.account-delete»): los fallos regresan a «Borrar mi
  // cuenta», no al acceso.
  const reauth = rest.at(-1) === ACCOUNT_DELETE_PURPOSE;
  const reauthStartedAt = reauth && rest.length === 2 ? Number(rest[0]) : Number.NaN;
  const fail = (code: string, message: string | Label, extra: Record<string, unknown> = {}): never => {
    logEvent({ level: "warn", category: "auth", action: reauth ? "auth.googleReauthFailed" : "auth.googleLoginFailed", label: { k: reauth ? "Confirmación con Google para borrar la cuenta no completada: {why}" : "Acceso con Google no completado: {why}", p: { why: typeof message === "string" ? logText(message) : message } }, path: "/api/auth/google/callback", ip, details: { reason: code, ...extra } });
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
    return fail(result.reason === "domain" ? "google_domain" : result.reason === "email_unverified" ? "google_unverified" : "google_failed", { k: "id_token rechazado ({reason})", p: { reason: result.reason } });
  }
  if (reauth) {
    // Sin abrir sesión ni enlazar nada: tiene que ser la misma cuenta de Google enlazada a la sesión abierta.
    const me = await getCurrentUser();
    const sessionId = await currentSessionId();
    if (!me || !sessionId) redirect(`${appUrl()}/login`);
    const row = await db.user.findUnique({ where: { id: me.id }, select: { googleSub: true } });
    if (!row?.googleSub || row.googleSub !== result.identity.sub) {
      logEvent({ level: "warn", category: "auth", action: "auth.googleReauthFailed", label: { k: "{name}: para borrar su cuenta ha vuelto a entrar con otra cuenta de Google", p: { name: me.name } }, userId: me.id, userName: me.name, path: "/api/auth/google/callback", ip });
      redirect(`${appUrl()}${accountDeleteReturn("google_mismatch")}`);
    }
    // Tiene que haber escrito la contraseña de Google ahora: elegir la cuenta con la sesión de Google abierta no basta.
    const fresh = reauthFreshness(result.identity.authTime, reauthStartedAt, Math.floor(Date.now() / 1000));
    if (fresh !== "ok") {
      logEvent({
        level: "warn", category: "auth", action: "auth.googleReauthFailed",
        label: { k: "{name}: para borrar su cuenta ha vuelto a entrar con Google sin escribir la contraseña ({why})", p: { name: me.name, why: { k: fresh === "missing" ? "Google no dice cuándo se autenticó" : "autenticación antigua" } } },
        userId: me.id, userName: me.name, path: "/api/auth/google/callback", ip,
        details: { reason: fresh, authTime: result.identity.authTime ?? null, startedAt: Number.isFinite(reauthStartedAt) ? reauthStartedAt : null },
      });
      redirect(`${appUrl()}${accountDeleteReturn("google_stale")}`);
    }
    await confirmAccountDeleteWithGoogle(me.id, sessionId);
    logEvent({ category: "auth", action: "auth.googleReauth", label: { k: "{name} ha vuelto a entrar con Google para borrar su cuenta", p: { name: me.name } }, userId: me.id, userName: me.name, path: "/api/auth/google/callback", ip });
    redirect(`${appUrl()}${accountDeleteReturn("google")}`);
  }

  const user = await findUserForGoogle(result.identity);
  if (user === "relink_blocked") return fail("google_unlinked", "cuenta desvinculada por un administrador", { email: result.identity.email });
  // Mensaje neutro: no se distingue «no existe», «desactivada» o «enlazada a otra cuenta de Google».
  // Sin cuenta: el email es de alguien que quizá no es usuario, enmascarado (como el acceso con contraseña).
  if (!user) return fail("google_noaccount", "sin cuenta asociada", { email: maskEmail(result.identity.email) });

  const next = safeNextPath(Buffer.from(nextB64 ?? "", "base64url").toString("utf8"));
  // Los administradores pasan también por la verificación en dos pasos de Pizarro (la de Google no basta para administrar):
  // misma pantalla y mismo estado pendiente que tras la contraseña; hasta superarla no hay sesión.
  if (user.role === "ADMIN") {
    const step = await secondStepFor(user);
    if (step) {
      const challenge = await startChallenge(user.id, step === "VERIFY" ? "LOGIN" : "SETUP", { next, via: "google" });
      if (step === "VERIFY" && user.twoFactorMethod === "EMAIL") await sendEmailCode(challenge, user).catch(() => {});
      logEvent({ category: "auth", action: "auth.secondStepRequested", label: { k: "{name}: acceso con Google correcto, falta la verificación en dos pasos", p: { name: user.name } }, userId: user.id, userName: user.name, path: "/api/auth/google/callback", ip });
      redirect(`${appUrl()}/login/verify`);
    }
  }
  await completeLogin(user, { method: "google", path: "/api/auth/google/callback" });
  if (user.mustChangePassword) redirect(`${appUrl()}/change-password`);
  redirect(`${appUrl()}${next}`);
}
