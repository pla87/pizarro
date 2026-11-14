// Icono de la app en el color de la instalación (Administración → Ajustes → «Icono de la app»): el dibujo, la ruta que lo
// sirve (PNG generados con sharp, caché inmutable), el manifiesto y el nombre bajo el icono.
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { APP_ICON_ACCENTS, APP_ICON_FILES, APP_ICON_REV, appIconColor, appIconSvg, appIconUrl, appNames, parseAppIcon } from "../src/lib/app-icon-core";
import { webManifest } from "../src/lib/web-manifest";
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
