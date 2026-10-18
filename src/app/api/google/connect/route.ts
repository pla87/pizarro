import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleAuthUrl, googleEnabled } from "@/lib/google";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";
import { cookieSecure } from "@/lib/session-config";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

const STATE_COOKIE = "tablon_google_state";

/** Inicia el flujo OAuth de Google. El parámetro state protege frente a CSRF. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  // Las redirecciones internas usan APP_URL: tras el proxy, req.url puede llevar el host interno.
  const base = process.env.APP_URL ?? req.url;
  if (!user) return NextResponse.redirect(new URL("/login", base));
  const ip = clientIp(req.headers);
  if (!googleEnabled()) {
    logEvent({ level: "warn", category: "google", action: "google.connectDisabled", message: "Intento de conectar Google con la integración desactivada", userId: user.id, userName: user.name, path: "/api/google/connect", ip });
    return NextResponse.redirect(new URL("/settings?google=disabled", base));
  }
  logEvent({ category: "google", action: "google.connectStart", message: "Inicio de la conexión con Google", userId: user.id, userName: user.name, path: "/api/google/connect", ip });
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(googleAuthUrl(state));
  res.cookies.set(STATE_COOKIE, `${state}.${user.id}`, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return res;
}
