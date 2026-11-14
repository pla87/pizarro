import sharp from "sharp";
import { APP_ICON_FILES, appIconSvg, isAppIconFile, parseAppIcon } from "@/lib/app-icon-core";

/**
 * Icono de la app en el color de un tema: /app-icon/<tema>/<fichero> (icon.svg, icon-32/192/512.png,
 * icon-maskable-512.png y apple-touch-icon.png). Sin sesión (fuera del proxy): lo piden el navegador sin cookies al leer el
 * manifiesto y, en Android, el servidor que crea la app instalada. La respuesta solo depende de la dirección (el tema en
 * la ruta y la revisión del dibujo en `?v=`): se guarda en caché como inmutable. El manifiesto y el layout apuntan al
 * tema elegido en Administración → Ajustes (lib/app-icon.ts).
 */

// Cada combinación se genera una sola vez por proceso (son 6 temas × 6 ficheros, unos pocos KB cada uno).
const rendered = new Map<string, Promise<Buffer>>();

function render(svg: string, size: number): Promise<Buffer> {
  // El SVG mide 32 px a 72 ppp: con esta densidad sharp lo dibuja ya al tamaño pedido (nítido, sin reescalar un mapa de bits).
  return sharp(Buffer.from(svg), { density: (72 * size) / 32 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

export async function GET(_req: Request, { params }: { params: Promise<{ accent: string; file: string }> }) {
  const { accent: rawAccent, file } = await params;
  const accent = parseAppIcon(rawAccent);
  if (!accent || accent !== rawAccent || !isAppIconFile(file)) return new Response("Not found", { status: 404 });
  const { shape, size } = APP_ICON_FILES[file];
  const svg = appIconSvg(accent, shape);
  const headers = { "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" };
  if (size === null) return new Response(svg, { headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" } });
  const key = `${accent}/${file}`;
  let png = rendered.get(key);
  if (!png) {
    png = render(svg, size);
    rendered.set(key, png);
    png.catch(() => rendered.delete(key));
  }
  return new Response(new Uint8Array(await png), { headers: { ...headers, "Content-Type": "image/png" } });
}
