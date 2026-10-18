import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName, sessionCookieOptions } from "@/lib/session-config";

// Comprobación rápida (sin BD) de que existe la cookie; la validación real se hace
// en el servidor. También renueva la caducidad de la cookie al navegar.
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = req.cookies.get(sessionCookieName())?.value;

  if (!token) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  if (req.method === "GET" && !pathname.startsWith("/api/")) {
    res.cookies.set(sessionCookieName(), token, sessionCookieOptions());
  }
  return res;
}

export const config = {
  matcher: ["/((?!login|api/health|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
