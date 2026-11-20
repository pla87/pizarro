// Icono de la app en el color de la instalación (Administración → Ajustes → «Icono de la app»): el dibujo, la ruta que lo
// sirve (PNG generados con sharp, caché inmutable), el manifiesto y el nombre bajo el icono.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import sharp from "sharp";
import { APP_ICON_ACCENTS, APP_ICON_FILES, APP_ICON_REV, appIconColor, appIconSvg, appIconUrl, appNames, parseAppIcon, shortAppName } from "../src/lib/app-icon-core";
import { webManifest } from "../src/lib/web-manifest";
import { rootIconEtag, rootIconResponse } from "../src/lib/app-icon-render";
import { ifNoneMatchHas } from "../src/lib/etag";
import { GET } from "../src/app/app-icon/[accent]/[file]/route";

const get = (accent: string, file: string) => GET(new Request(`http://localhost/app-icon/${accent}/${file}`), { params: Promise.resolve({ accent, file }) });
const hex = (rgb: ArrayLike<number>) => `#${Array.from(rgb).slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("")}`;

/** Color del píxel (x, y) de un PNG. */
async function pixel(png: Buffer, x: number, y: number): Promise<{ color: string; alpha: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return { color: hex(data.subarray(i, i + 3)), alpha: data[i + 3] ?? -1 };
}

test("tema guardado: solo los seis temas de «Mi perfil»", () => {
  assert.deepEqual([...APP_ICON_ACCENTS], ["blue", "forest", "sienna", "mustard", "mono", "eva"]);
  assert.equal(parseAppIcon("forest"), "forest");
  assert.equal(parseAppIcon(" EVA "), "eva");
  for (const bad of [null, undefined, "", "red", "../blue", "blue/"]) assert.equal(parseAppIcon(bad), null, String(bad));
});

/**
 * Huella del dibujo de la revisión APP_ICON_REV: sha256 del SVG de cada tema y forma. Los iconos se sirven como inmutables
 * con `?v=APP_ICON_REV`, así que un dibujo nuevo con la misma revisión no llegaría a quien ya tiene el viejo en caché.
 * Si cambias el dibujo o los colores, sube APP_ICON_REV y pon aquí la revisión nueva y la huella que muestre el fallo.
 */
const APP_ICON_FINGERPRINT = { rev: "1", sha256: "083d4bf535da9cfbc1abe247908dfa6ed19a64f55dfe1be4afa5d0dc6beceda4" };

test("dibujo: la huella va atada a APP_ICON_REV", () => {
  const h = createHash("sha256");
  for (const accent of APP_ICON_ACCENTS) for (const shape of ["rounded", "square", "maskable"] as const) h.update(`${accent}/${shape}\n${appIconSvg(accent, shape)}\n`);
  const sha256 = h.digest("hex");
  assert.equal(
    APP_ICON_REV,
    APP_ICON_FINGERPRINT.rev,
    `has subido APP_ICON_REV: actualiza la huella en este fichero (APP_ICON_FINGERPRINT = { rev: "${APP_ICON_REV}", sha256: "${sha256}" })`,
  );
  assert.equal(
    sha256,
    APP_ICON_FINGERPRINT.sha256,
    `has cambiado el dibujo del icono: sube APP_ICON_REV y actualiza la huella en este fichero (sha256 nueva: ${sha256})`,
  );
});

test("dibujo: el azul es el icono de siempre; las formas a sangre no tienen esquinas", () => {
  const blue = appIconSvg("blue");
  assert.match(blue, /<rect width="32" height="32" rx="7" fill="#4f46e5"\/>/);
  assert.match(blue, /fill="#c7d2fe"/);
  assert.match(blue, /fill="#a5b4fc"/);
  assert.doesNotMatch(appIconSvg("blue", "square"), /rx="7"/);
  assert.match(appIconSvg("blue", "maskable"), /scale\(0\.75\)/);
  // Cada tema, con su color principal de fondo (el de globals.css en claro), y Eva con su barra naranja.
  assert.equal(appIconColor("forest"), "#1f6b42");
  assert.match(appIconSvg("eva"), /fill="#f8a030"/);
  assert.equal(new Set(APP_ICON_ACCENTS.map(appIconColor)).size, APP_ICON_ACCENTS.length);
});

test("dirección: el tema en la ruta y la revisión del dibujo en ?v=", () => {
  assert.equal(appIconUrl("sienna", "icon-192.png"), `/app-icon/sienna/icon-192.png?v=${APP_ICON_REV}`);
});

test("ruta: PNG del tamaño pedido, del color del tema, inmutables en caché", async () => {
  for (const [file, { size }] of Object.entries(APP_ICON_FILES)) {
    const res = await get("forest", file);
    assert.equal(res.status, 200, file);
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
    if (size === null) {
      assert.equal(res.headers.get("content-type"), "image/svg+xml; charset=utf-8");
      assert.match(await res.text(), /fill="#1f6b42"/);
      continue;
    }
    assert.equal(res.headers.get("content-type"), "image/png");
    const png = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(png).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["png", size, size], file);
    // Cerca de la esquina (dentro del redondeo en «rounded»), el fondo; en el centro de la primera barra, blanco.
    const edge = Math.round(size * 0.12);
    assert.equal((await pixel(png, edge, Math.round(size / 2))).color, "#1f6b42", file);
    const bar = await pixel(png, Math.round(size * (file.includes("maskable") ? 0.3 : file.startsWith("apple") ? 0.29 : 0.27)), Math.round(size * 0.6));
    assert.equal(bar.color, "#ffffff", file);
  }
  // Las formas a sangre (iPhone y maskable) son opacas hasta la esquina; la redondeada, transparente en ella.
  const corner = async (file: string) => (await pixel(Buffer.from(await (await get("mono", file)).arrayBuffer()), 0, 0)).alpha;
  assert.equal(await corner("apple-touch-icon.png"), 255);
  assert.equal(await corner("icon-maskable-512.png"), 255);
  assert.equal(await corner("icon-512.png"), 0);
});

test("ruta: tema o fichero desconocidos, 404 (nada de rutas arbitrarias)", async () => {
  for (const [a, f] of [["red", "icon-192.png"], ["Blue", "icon-192.png"], ["blue", "icon-64.png"], ["blue", "..%2Ficon.svg"], ["blue", "toString"]] as const) {
    assert.equal((await get(a, f)).status, 404, `${a}/${f}`);
  }
});

test("nombre bajo el icono: el de la organización; sin ella, Pizarro", () => {
  assert.deepEqual(appNames("  Acme  "), { name: "Acme · Pizarro", shortName: "Acme" });
  assert.deepEqual(appNames(""), { name: "Pizarro", shortName: "Pizarro" });
});

test("nombre corto bajo el icono: cabe en 12 caracteres (entero, primera palabra o recorte con «…»)", () => {
  assert.equal(shortAppName("Casa"), "Casa");
  assert.equal(shortAppName("Doce letras!"), "Doce letras!");
  assert.equal(shortAppName("Acme Corporation Internacional"), "Acme");
  assert.equal(shortAppName("Construcciones Hermanos García"), "Construccio…");
  assert.equal(Array.from(shortAppName("Construcciones Hermanos García")).length, 12);
  assert.equal(shortAppName("La Casa de Todos los Vecinos"), "La Casa de…");
  assert.equal(shortAppName("🏠 Casa de Todos los Vecinos"), "🏠 Casa de T…");
  assert.equal(shortAppName("Casa de Todos los Vecinos"), "Casa");
  assert.equal(shortAppName("  Mi   Casa  "), "Mi Casa");
  assert.deepEqual(appNames("Fundación Ejemplo de Ayuda"), { name: "Fundación Ejemplo de Ayuda · Pizarro", shortName: "Fundación" });
  assert.equal(webManifest("es", { orgName: "Acme Corporation Internacional" }).short_name, "Acme");
});

test("iconos de la raíz: del color elegido, con caché corta (no inmutables) y .ico válido", async () => {
  const svg = await rootIconResponse("forest", "icon.svg");
  assert.match(await svg.text(), /fill="#1f6b42"/);
  for (const res of [svg, await rootIconResponse("mustard", "apple-touch-icon.png"), await rootIconResponse("eva", "icon-32.png", true)]) {
    const cc = res.headers.get("cache-control") ?? "";
    assert.doesNotMatch(cc, /immutable/);
    assert.match(cc, /max-age=300/);
  }
  const apple = await rootIconResponse("mono", "apple-touch-icon.png");
  assert.equal((await pixel(Buffer.from(await apple.arrayBuffer()), 0, 0)).color, "#111111");
  const ico = await rootIconResponse("eva", "icon-32.png", true);
  assert.equal(ico.headers.get("content-type"), "image/x-icon");
  const bytes = Buffer.from(await ico.arrayBuffer());
  assert.deepEqual([bytes.readUInt16LE(0), bytes.readUInt16LE(2), bytes.readUInt16LE(4), bytes[6], bytes[7]], [0, 1, 1, 32, 32]);
  const png = bytes.subarray(bytes.readUInt32LE(18));
  assert.equal(png.length, bytes.readUInt32LE(14));
  assert.equal((await pixel(Buffer.from(png), 16, 16 + 4)).color.length, 7);
  assert.equal((await pixel(Buffer.from(png), 3, 16)).color, "#6848a0");
});

test("iconos de la raíz: ETag (color + revisión + tamaño), 304 con If-None-Match y .ico en caché", async () => {
  const req = (inm?: string) => ({ headers: new Headers(inm ? { "If-None-Match": inm } : {}) });
  // Un ETag distinto por color, fichero (tamaño y forma) y formato; con la revisión del dibujo dentro.
  const tags = new Set<string>();
  for (const accent of APP_ICON_ACCENTS) {
    for (const file of Object.keys(APP_ICON_FILES) as (keyof typeof APP_ICON_FILES)[]) tags.add(rootIconEtag(accent, file));
    tags.add(rootIconEtag(accent, "icon-32.png", true));
  }
  assert.equal(tags.size, APP_ICON_ACCENTS.length * (Object.keys(APP_ICON_FILES).length + 1));
  assert.equal(rootIconEtag("forest", "icon-192.png"), `"forest-r${APP_ICON_REV}-rounded-192"`);
  assert.equal(rootIconEtag("eva", "icon-32.png", true), `"eva-r${APP_ICON_REV}-rounded-32-ico"`);
  assert.equal(rootIconEtag("mono", "icon.svg"), `"mono-r${APP_ICON_REV}-rounded-svg"`);
  for (const tag of tags) assert.match(tag, /^"[a-z0-9-]+"$/);

  for (const [file, ico] of [["icon.svg", false], ["icon-192.png", false], ["apple-touch-icon.png", false], ["icon-32.png", true]] as const) {
    const full = await rootIconResponse("forest", file, ico, req());
    const etag = full.headers.get("etag")!;
    assert.equal(etag, rootIconEtag("forest", file, ico));
    assert.equal(full.status, 200);
    assert.ok((await full.arrayBuffer()).byteLength > 0);
    // Misma etiqueta: 304 sin cuerpo, con el ETag y la misma caché (el navegador renueva su copia).
    const same = await rootIconResponse("forest", file, ico, req(etag));
    assert.equal(same.status, 304);
    assert.equal((await same.arrayBuffer()).byteLength, 0);
    assert.equal(same.headers.get("etag"), etag);
    assert.match(same.headers.get("cache-control") ?? "", /max-age=300, must-revalidate/);
    assert.equal(same.headers.get("content-type"), null);
    // Débil, en una lista o «*»: también vale.
    for (const inm of [`W/${etag}`, `"otra", ${etag}`, "*"]) assert.equal((await rootIconResponse("forest", file, ico, req(inm))).status, 304, inm);
    // Otro color (se cambió en Administración) u otra etiqueta: el icono entero, con su ETag nuevo.
    const changed = await rootIconResponse("sienna", file, ico, req(etag));
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.get("etag"), etag);
    assert.equal((await rootIconResponse("forest", file, ico, req('"forest"'))).status, 200);
  }
  // Sin petición (llamadas antiguas): respuesta completa.
  assert.equal((await rootIconResponse("forest", "icon.svg")).status, 200);
  assert.equal(ifNoneMatchHas(null, '"a"'), false);
  assert.equal(ifNoneMatchHas("", '"a"'), false);
  assert.equal(ifNoneMatchHas('"a"', '"a"'), true);
  assert.equal(ifNoneMatchHas('"ab"', '"a"'), false);

  // El .ico se arma una vez por color: dos respuestas, los mismos bytes, y válidos.
  const a = Buffer.from(await (await rootIconResponse("mustard", "icon-32.png", true)).arrayBuffer());
  const b = Buffer.from(await (await rootIconResponse("mustard", "icon-32.png", true, req('"x"'))).arrayBuffer());
  assert.equal(Buffer.compare(a, b), 0);
  assert.deepEqual([a.readUInt16LE(2), a[6], a[7], a.readUInt32LE(14)], [1, 32, 32, a.length - 22]);
  assert.equal((await pixel(a.subarray(22), 3, 16)).color, "#9a7209");
});

test("manifiesto: iconos, color y nombre de la instalación", () => {
  const m = webManifest("es", { orgName: "Casa", appIcon: "eva" });
  assert.equal(m.id, "/");
  assert.deepEqual([m.name, m.short_name, m.theme_color], ["Casa · Pizarro", "Casa", "#6848a0"]);
  assert.deepEqual(m.icons?.map((i) => [i.src, i.sizes, i.purpose ?? "any"]), [
    [`/app-icon/eva/icon-192.png?v=${APP_ICON_REV}`, "192x192", "any"],
    [`/app-icon/eva/icon-512.png?v=${APP_ICON_REV}`, "512x512", "any"],
    [`/app-icon/eva/icon-maskable-512.png?v=${APP_ICON_REV}`, "512x512", "maskable"],
  ]);
  assert.ok(m.shortcuts?.every((s) => s.icons?.[0]?.src === `/app-icon/eva/icon-192.png?v=${APP_ICON_REV}`));
  // Sin ajustes: el azul y «Pizarro», como antes.
  const plain = webManifest("en");
  assert.deepEqual([plain.name, plain.short_name, plain.theme_color, plain.icons?.[0]?.src], ["Pizarro", "Pizarro", "#4f46e5", `/app-icon/blue/icon-192.png?v=${APP_ICON_REV}`]);
});
