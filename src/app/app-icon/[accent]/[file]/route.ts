import { isAppIconFile, parseAppIcon } from "@/lib/app-icon-core";
import { renderAppIcon } from "@/lib/app-icon-render";

/**
 * Icono de la app en el color de un tema: /app-icon/<tema>/<fichero> (icon.svg, icon-32/192/512.png,
 * icon-maskable-512.png y apple-touch-icon.png). Sin sesión (fuera del proxy): lo piden el navegador sin cookies al leer el
 * manifiesto y, en Android, el servidor que crea la app instalada. La respuesta solo depende de la dirección (el tema en
 * la ruta y la revisión del dibujo en `?v=`): se guarda en caché como inmutable. El manifiesto y el layout apuntan al
 * tema elegido en Administración → Ajustes (lib/app-icon.ts). Las direcciones fijas de la raíz (/favicon.ico…) sirven el
 * mismo icono con caché corta (lib/app-icon-render.ts).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ accent: string; file: string }> }) {
  const { accent: rawAccent, file } = await params;
  const accent = parseAppIcon(rawAccent);
  if (!accent || accent !== rawAccent || !isAppIconFile(file)) return new Response("Not found", { status: 404 });
  const { body, type } = await renderAppIcon(accent, file);
  return new Response(body as BodyInit, { headers: { "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Type": type } });
}
