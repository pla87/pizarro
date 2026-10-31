import { clearAuthCookieHeaders } from "@/lib/reset-cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Volver a iniciar sesión» de las pantallas de error: borra las cookies de acceso de ESTE navegador (sesión, cambio de
 * contraseña pendiente, verificación en dos pasos y dispositivo conocido) y manda a /login. Funciona sin sesión válida,
 * que es justo cuando hace falta. Es un GET que solo borra cookies propias (no toca la base de datos), así que no
 * hay nada que falsificar entre sitios.
 */
export function GET() {
  // Ruta relativa: detrás de un proxy la URL interna del servidor no es la que ve el navegador.
  const headers = new Headers({ Location: "/login", "Cache-Control": "no-store" });
  for (const c of clearAuthCookieHeaders()) headers.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers });
}
