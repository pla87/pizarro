import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { connectGoogleAccount, GoogleConnectError, googleEnabled } from "@/lib/google";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

const STATE_COOKIE = "tablon_google_state";

function settings(req: Request, result: string) {
  const res = NextResponse.redirect(new URL(`/settings?google=${encodeURIComponent(result)}#google`, process.env.APP_URL ?? req.url));
  res.cookies.set(STATE_COOKIE, "", { path: "/api/google", maxAge: 0 });
  return res;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", process.env.APP_URL ?? req.url));
  if (!googleEnabled()) return settings(req, "disabled");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const cookie = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1) ?? "";
  const expected = `${state}.${user.id}`;
  const valid = state.length > 0 && cookie.length === expected.length && timingSafeEqual(Buffer.from(cookie), Buffer.from(expected));
  if (!valid) return settings(req, "state");
  if (url.searchParams.get("error") || !code) return settings(req, "cancelled");

  try {
    await connectGoogleAccount(user.id, code);
    return settings(req, "connected");
  } catch (err) {
    console.error("[google] callback", err instanceof AppError ? err.message : err);

    // Solo códigos fijos en la URL: nunca texto arbitrario.
    return settings(req, err instanceof GoogleConnectError ? err.code : "error");
  }
}
