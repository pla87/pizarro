import { NextResponse, type NextRequest } from "next/server";
import { AUTH_LINK_HEADER } from "@/lib/auth-link-path";
import { canonicalRedirect } from "@/lib/canonical-url";
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
  // Un NUL en la ruta (/p/%00) no es ningún recurso, y como id llegaba a PostgreSQL, que no lo admite en un texto:
  // error 22021 y página de error. Se responde 404 sin pasar por la página (los filtros de la URL lo quitan ellos).
  if (/%00|\u0000/i.test(pathname)) return new NextResponse("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  // Opcional (CANONICAL_REDIRECT=1): las direcciones distintas de APP_URL redirigen (308) a ella.
  const canonical = canonicalRedirect({ enabled: process.env.CANONICAL_REDIRECT, appUrl: process.env.APP_URL, host: req.headers.get("host"), forwardedHost: req.headers.get("x-forwarded-host"), method: req.method, pathname, search });
  if (canonical) return NextResponse.redirect(canonical, 308);
  const isApi = pathname.startsWith("/api/");
  // Páginas públicas (sin sesión): presentación del producto, acceso, política de privacidad, condiciones, licencia, contraseña olvidada, enlaces de email y el asistente de primer
  // arranque (/setup se protege con el código del log y da 404 cuando ya hay usuarios).
  // Sin usuarios, el proxy no consulta la base de datos: manda a /login y esa página redirige a /setup.
  const isLogin =
    pathname === "/setup" || pathname.startsWith("/setup/") || pathname === "/login" || pathname.startsWith("/login/") || pathname === "/forgot-password" || pathname === "/presentacion" || pathname === "/privacy" || pathname === "/terms" || pathname === "/licencia" || pathname.startsWith("/reset/") || pathname.startsWith("/confirm/") ||
    // Públicas también: informe de errores del navegador (la pantalla de acceso no tiene sesión), versión en curso y salida limpia.
    pathname === "/api/client-errors" || pathname === "/api/version" || pathname === "/api/auth/reset" ||
    // Suscripción al calendario (.ics vivo): la dirección con su token larga es la credencial (la ruta limita el ritmo y lo comprueba).
    (req.method === "GET" && /^\/api\/calendar\/[A-Za-z0-9_-]+\.ics$/.test(pathname));
  const token = req.cookies.get(sessionCookieName())?.value;
  // Opcional (LANDING_AT_ROOT=1): quien no tiene sesión ve la presentación en «/» en vez de ir al acceso (sin redirigir; la dirección no cambia).
  const landingAtRoot = process.env.LANDING_AT_ROOT === "1" && pathname === "/" && !token && req.method === "GET";

  // Nonce nuevo en cada petición de página (las API devuelven JSON/ficheros: sin CSP de documento).
  const nonce = isApi ? null : Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = nonce ? buildCsp(nonce) : null;

  // Las páginas públicas solo necesitan la CSP (la ruta de /api/health queda fuera del matcher).
  if (isLogin || landingAtRoot) {
    const headers = new Headers(req.headers);
    headers.delete("x-pz-path");
    // Enlaces de email (elegir o confirmar contraseña, confirmar email): el servidor no conoce la ruta y la necesita para
    // pintar la pantalla en el idioma de la persona del enlace (ver getLocale). La que traiga el navegador no vale.
    headers.delete(AUTH_LINK_HEADER);
    if (pathname.startsWith("/reset/") || pathname.startsWith("/confirm/")) headers.set(AUTH_LINK_HEADER, pathname);
    if (nonce && csp) {
      headers.set("x-nonce", nonce);
      headers.set("Content-Security-Policy", csp);
    }
    const res = landingAtRoot ? NextResponse.rewrite(new URL(`/presentacion${search}`, req.url), { request: { headers } }) : NextResponse.next({ request: { headers } });
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
  headers.delete(AUTH_LINK_HEADER);
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
  // Next guarda en memoria el cuerpo de toda petición (no GET) que pasa por aquí, hasta proxyClientMaxBodySize (2 MB, ver
  // next.config.ts), antes de que llegue a su ruta. Por eso las rutas que reciben archivos quedan fuera: la importación de
  // proyectos (cientos de MB, en flujo), los adjuntos de tareas y los documentos del proyecto (hasta 100 MB). Cada una
  // comprueba por sí misma el origen, la sesión (también la contraseña pendiente de cambiar) y los permisos antes de leer
  // el cuerpo, y lo lee con su propio tope; de este proxy no necesitan nada (son API: sin CSP ni renovación de cookie,
  // y la redirección canónica no toca /api). Solo admiten POST; con otro método, Next responde 405.
  // El webhook del bot de Telegram tampoco pasa: lo llama Telegram, sin sesión; se protege con su secreto y lee con tope.
  matcher: ["/((?!api/auth/google/|api/telegram/webhook$|api/projects/import$|api/tasks/[^/]+/attachments$|api/projects/[^/]+/documents$|api/health|_next/static|_next/image|favicon.ico|icon.svg|icon.png|icons/|app-icon/|apple-touch-icon.png|pizarro-logo-120.png|sw.js|manifest.webmanifest).*)"],
};
