import { NextResponse, type NextRequest } from "next/server";
import { PASSWORD_CHANGE_COOKIE, sessionCookieName, sessionCookieOptions } from "@/lib/session-config";

const isDev = process.env.NODE_ENV !== "production";

/**
 * CSP estricta con nonce por petición: los scripts solo se ejecutan si llevan el nonce
 * (Next.js lo lee de esta misma cabecera y lo pone en sus scripts) o los carga uno con nonce
 * ('strict-dynamic'). Los estilos en línea siguen permitidos (React/Tailwind los usan).
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Comprobación rápida (sin BD) de que existe la cookie; la validación real se hace
// en el servidor. También renueva la caducidad de la cookie al navegar y fija la CSP con nonce.
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  // Páginas públicas (sin sesión): acceso, contraseña olvidada y enlaces de email.
  const isLogin =
    pathname === "/login" || pathname.startsWith("/login/") || pathname === "/forgot-password" || pathname.startsWith("/reset/") || pathname.startsWith("/confirm/");
  const token = req.cookies.get(sessionCookieName())?.value;

  // Nonce nuevo en cada petición de página (las API devuelven JSON/ficheros: sin CSP de documento).
  const nonce = isApi ? null : Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = nonce ? buildCsp(nonce) : null;

  // Las páginas públicas solo necesitan la CSP (la ruta de /api/health queda fuera del matcher).
  if (isLogin) {
    const headers = new Headers(req.headers);
    headers.delete("x-pz-path");
    if (nonce && csp) {
      headers.set("x-nonce", nonce);
      headers.set("Content-Security-Policy", csp);
    }
    const res = NextResponse.next({ request: { headers } });
    if (csp) res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  if (!token) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Con el cambio de contraseña pendiente solo se puede ver esa pantalla (y usar sus acciones); el servidor lo
  // vuelve a comprobar en cada página, acción y ruta API.
  if (req.cookies.get(PASSWORD_CHANGE_COOKIE)?.value && pathname !== "/change-password") {
    if (pathname.startsWith("/api/") || req.method !== "GET") return NextResponse.json({ error: "Debes elegir una contraseña nueva" }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = "/change-password";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // El servidor no conoce la ruta de la petición: se la pasamos en una cabecera para los logs.
  // Solo GET (las acciones POST re-renderizan la página pero no son visitas) y sin precargas.
  const headers = new Headers(req.headers);
  headers.delete("x-pz-path");
  if (nonce && csp) {
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
  }
  if (req.method === "GET" && !pathname.startsWith("/api/") && !req.headers.get("next-router-prefetch") && !req.headers.get("purpose")) {
    headers.set("x-pz-path", pathname + search);
  }
  const res = NextResponse.next({ request: { headers } });
  if (csp) res.headers.set("Content-Security-Policy", csp);
  if (req.method === "GET" && !pathname.startsWith("/api/")) {
    res.cookies.set(sessionCookieName(), token, sessionCookieOptions());
  }
  return res;
}

export const config = {
  matcher: ["/((?!api/auth/google/|api/health|_next/static|_next/image|favicon.ico|icon.svg|icons/|apple-touch-icon.png|sw.js|manifest.webmanifest).*)"],
};
