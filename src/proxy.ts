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

  // El servidor no conoce la ruta de la petición: se la pasamos en una cabecera para los logs.
  // Solo GET (las acciones POST re-renderizan la página pero no son visitas) y sin precargas.
  const headers = new Headers(req.headers);
  headers.delete("x-pz-path");
  if (req.method === "GET" && !pathname.startsWith("/api/") && !req.headers.get("next-router-prefetch") && !req.headers.get("purpose")) {
    headers.set("x-pz-path", pathname + search);
  }
  const res = NextResponse.next({ request: { headers } });
  if (req.method === "GET" && !pathname.startsWith("/api/")) {
    res.cookies.set(sessionCookieName(), token, sessionCookieOptions());
  }
  return res;
}

export const config = {
  matcher: ["/((?!login|api/health|_next/static|_next/image|favicon.ico|icon.svg|icons/|apple-touch-icon.png|sw.js|manifest.webmanifest).*)"],
};
