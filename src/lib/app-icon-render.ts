import "server-only";
import sharp from "sharp";
import { APP_ICON_FILES, APP_ICON_REV, appIconSvg, type AppIconAccent } from "@/lib/app-icon-core";

type IconFile = keyof typeof APP_ICON_FILES;

// Cada combinación se genera una sola vez por proceso (son 6 temas × 6 ficheros, unos pocos KB cada uno).
const rendered = new Map<string, Promise<Buffer>>();

function render(svg: string, size: number): Promise<Buffer> {
  // El SVG mide 32 px a 72 ppp: con esta densidad sharp lo dibuja ya al tamaño pedido (nítido, sin reescalar un mapa de bits).
  return sharp(Buffer.from(svg), { density: (72 * size) / 32 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

/** Contenido de un icono del tema (SVG como texto, PNG como bytes). */
export async function renderAppIcon(accent: AppIconAccent, file: IconFile): Promise<{ body: Uint8Array | string; type: string }> {
  const { shape, size } = APP_ICON_FILES[file];
  const svg = appIconSvg(accent, shape);
  if (size === null) return { body: svg, type: "image/svg+xml; charset=utf-8" };
  const key = `${accent}/${file}`;
  let png = rendered.get(key);
  if (!png) {
    png = render(svg, size);
    rendered.set(key, png);
    png.catch(() => rendered.delete(key));
  }
  return { body: new Uint8Array(await png), type: "image/png" };
}

/** .ico con un solo icono de 32×32 que lleva dentro el PNG (formato que entienden todos los navegadores desde hace años). */
function pngToIco(png: Uint8Array, size = 32): Uint8Array {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); // reservado
  head.writeUInt16LE(1, 2); // tipo: icono
  head.writeUInt16LE(1, 4); // un solo icono
  head[6] = size; // ancho
  head[7] = size; // alto
  head.writeUInt16LE(1, 10); // planos
  head.writeUInt16LE(32, 12); // bits por píxel
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18); // dónde empieza el PNG
  return new Uint8Array(Buffer.concat([head, png]));
}

// El .ico de cada color (22 bytes de cabecera + el PNG de 32 px) también se arma una sola vez por proceso.
const icos = new Map<AppIconAccent, Promise<Uint8Array>>();

function renderIco(accent: AppIconAccent): Promise<Uint8Array> {
  let ico = icos.get(accent);
  if (!ico) {
    ico = renderAppIcon(accent, "icon-32.png").then(({ body }) => pngToIco(body as Uint8Array));
    icos.set(accent, ico);
    ico.catch(() => icos.delete(accent));
  }
  return ico;
}

/**
 * ETag de un icono de la raíz: color, revisión del dibujo y tamaño (más la forma, y «ico» en el .ico). Lo que se sirve solo
 * depende de eso, así que es un validador fuerte: cambia al elegir otro color o al subir APP_ICON_REV.
 */
export function rootIconEtag(accent: AppIconAccent, file: IconFile, ico = false): string {
  const { shape, size } = APP_ICON_FILES[file];
  return `"${accent}-r${APP_ICON_REV}-${shape}-${size ?? "svg"}${ico ? "-ico" : ""}"`;
}

/** ¿Vale la copia del navegador? `If-None-Match` con el mismo ETag (comparación débil: «W/» no cuenta) o «*». */
export function etagMatches(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((raw) => {
    const tag = raw.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
}

/**
 * Respuesta de un icono en una dirección fija de la raíz (/favicon.ico, /apple-touch-icon.png, /icon.svg, /icon.png). A
 * diferencia de /app-icon/<tema>/…, la dirección no cambia con el color, así que no se guarda como inmutable: caché corta
 * y revalidación, para que al cambiar el color en Administración → Ajustes se vea pronto. Lleva ETag: pasados los 5 minutos,
 * el navegador revalida con `If-None-Match` (pásale la petición en `req`) y, si el color no ha cambiado, recibe un 304 sin
 * cuerpo en vez del icono entero.
 */
export async function rootIconResponse(accent: AppIconAccent, file: IconFile, ico = false, req?: Pick<Request, "headers">): Promise<Response> {
  const etag = rootIconEtag(accent, file, ico);
  const headers = { "Cache-Control": "public, max-age=300, must-revalidate", ETag: etag, "X-Content-Type-Options": "nosniff" };
  if (etagMatches(req?.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  if (ico && APP_ICON_FILES[file].size !== null) return new Response((await renderIco(accent)) as BodyInit, { headers: { ...headers, "Content-Type": "image/x-icon" } });
  const { body, type } = await renderAppIcon(accent, file);
  return new Response(body as BodyInit, { headers: { ...headers, "Content-Type": type } });
}
