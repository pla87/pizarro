import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { connectGoogleAccount, GoogleConnectError, googleEnabled } from "@/lib/google";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

const STATE_COOKIE = "tablon_google_state";

function settings(req: Request, result: string, user?: { id: string; name: string }) {
  logEvent({
    level: result === "connected" || result === "cancelled" ? "info" : "warn", category: "google", action: result === "connected" ? "google.connected" : "google.connectFailed",
    message: result === "connected" ? "Cuenta de Google conectada" : `Conexión con Google no completada (${result})`,
    userId: user?.id ?? null, userName: user?.name ?? null, path: "/api/google/callback", ip: clientIp(req.headers), details: { result },
  });
  const res = NextResponse.redirect(new URL(`/settings?google=${encodeURIComponent(result)}#google`, process.env.APP_URL ?? req.url));
  res.cookies.set(STATE_COOKIE, "", { path: "/api/google", maxAge: 0 });
  return res;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", process.env.APP_URL ?? req.url));
  if (!googleEnabled()) return settings(req, "disabled", user);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const cookie = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1) ?? "";
  const expected = `${state}.${user.id}`;
  const [got, want] = [Buffer.from(cookie), Buffer.from(expected)];
  const valid = state.length > 0 && got.length === want.length && timingSafeEqual(got, want);
  if (!valid) return settings(req, "state", user);
  if (url.searchParams.get("error") || !code) return settings(req, "cancelled", user);

  try {
    await connectGoogleAccount(user.id, code);
    return settings(req, "connected", user);
  } catch (err) {
    console.error("[google] callback", err instanceof AppError ? err.message : err);
    logEvent({
      level: "error", category: "google", action: "google.callbackError", message: `Error en la conexión con Google: ${err instanceof Error ? err.message : String(err)}`,
      userId: user.id, userName: user.name, path: "/api/google/callback", ip: clientIp(req.headers),
    });

    // Solo códigos fijos en la URL: nunca texto arbitrario.
    return settings(req, err instanceof GoogleConnectError ? err.code : "error", user);
  }
}
