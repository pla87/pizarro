import { clearAuthCookieHeaders } from "@/lib/reset-cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Volver a iniciar sesión» de las pantallas de error: borra las cookies de acceso de ESTE navegador (sesión, cambio de
 * contraseña pendiente, verificación en dos pasos y dispositivo conocido) y manda a /login. Funciona sin sesión válida,
 * que es justo cuando hace falta. Es un GET que solo borra cookies propias (no toca la base de datos), así que no
 * hay nada grave que falsificar, pero se rechaza igualmente si el navegador dice que viene de otro sitio.
 */
export function GET(req: Request) {
  // Un enlace desde otro sitio no debe poder cerrarle la sesión a nadie; los de las pantallas de error son del mismo origen.
  if (req.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  // Ruta relativa: detrás de un proxy la URL interna del servidor no es la que ve el navegador.
  const headers = new Headers({ Location: "/login", "Cache-Control": "no-store" });
  for (const c of clearAuthCookieHeaders()) headers.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers });
}
