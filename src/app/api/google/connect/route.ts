import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleAuthUrl, googleEnabled } from "@/lib/google";
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
  if (!googleEnabled()) return NextResponse.redirect(new URL("/settings?google=disabled", base));
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
