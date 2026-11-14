// Genera la web estática del producto (getpizarro.com) en site/dist, para GitHub Pages (.github/workflows/site.yml).
//   node scripts/build-site.mjs            (Node 22.18 o superior: importa los .ts de src/ directamente)
//
// No duplica textos a mano:
//   - los de la web salen de src/lib/site-content.ts y algunos de la presentación de la app, de
//     src/lib/landing-content.ts (preguntas frecuentes); su inglés, del diccionario de la app (src/i18n/en/*.ts).
//     Si falta una traducción, falla;
//   - el precio, el enlace de compra (BUY_URL) y las direcciones, de src/lib/product.ts;
//   - la licencia, de LICENSE.md (español, «---» y traducción al inglés), igual que scripts/license-sync.mjs.
// Las capturas de la app están en site/static/img/ (WebP, claro y oscuro, español e inglés) y se regeneran con
// scripts/site-screenshots.mjs; si falta alguna, falla. Sin recursos externos: HTML + una hoja de estilos y un
// script mínimo en línea (el botón «Copiar» del comando de instalación). Modo claro/oscuro con prefers-color-scheme.
// Plantilla: site/templates/layout.html. Ficheros tal cual: site/static/ (CNAME, robots.txt, style.css, og*.png, img/).
// Guías de conexión (/guias/, /en/guides/): una página por cada docs/guias/*.md y su docs/guias/en/*.md, con el
// Markdown convertido por src/lib/site-markdown.ts (sin dependencias; el HTML que traiga el texto se escapa).
// Guía de instalación (/instalar/, /en/install/): docs/web/instalar.md y docs/web/en/install.md, con índice, avisos y
// botón «Copiar» en cada comando. Si falta una de las dos, falla. La referencia técnica sigue en docs/INSTALL.md.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site", "dist");
const imp = (p) => import(pathToFileURL(join(root, p)).href);

const product = await imp("src/lib/product.ts");
const { landingFaq, licenseFaq } = await imp("src/lib/landing-content.ts");
const { siteText } = await imp("src/lib/site-content.ts");
const { markdownToHtml, parseGuide, safeHref } = await imp("src/lib/site-markdown.ts");

// Diccionario de inglés: todos los ficheros de src/i18n/en (index.ts los reúne con imports que Node no resuelve).
const EN = {};
for (const f of readdirSync(join(root, "src/i18n/en")).sort()) {
  if (f === "index.ts" || !f.endsWith(".ts")) continue;
  for (const v of Object.values(await imp(`src/i18n/en/${f}`))) if (v && typeof v === "object") Object.assign(EN, v);
}
const interpolate = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);
const missing = new Set();
const makeT = (locale) => (s, vars) => {
  if (locale === "en" && !(s in EN)) missing.add(s);
  return interpolate(locale === "en" ? (EN[s] ?? s) : s, vars);
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
  if (!(k in vars)) throw new Error(`Falta {{${k}}} en la plantilla`);
  return vars[k];
});

const license = readFileSync(join(root, "LICENSE.md"), "utf8").replace(/\r\n/g, "\n").trimEnd().split("\n\n---\n\n");
if (license.length !== 2) throw new Error("LICENSE.md debe tener exactamente un separador «---» entre el español y el inglés");

const SITE = product.SITE_URL.replace(/\/$/, "");
const BUY = product.BUY_URL.trim();
const GET_SH = "curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --domain pizarro.example.com";
const BLOB = `${product.REPO_URL}/blob/main`;
const LINKS = {
  image: product.IMAGE_URL,
  manual: `${BLOB}/docs/MANUAL.md`,
  manualPdf: `${BLOB}/MANUAL.pdf`,
  changelog: `${BLOB}/CHANGELOG.md`,
};
// Autoría: una línea discreta en el pie de la web (solo aquí; ni en la app ni en el manual).
const AUTHOR_SITE = "pacolucena.com";
const AUTHOR_URL = `https://${AUTHOR_SITE}`;
const layout = readFileSync(join(root, "site/templates/layout.html"), "utf8");

// ---------------------------------------------------------------------------------------------------------------
// Guías de conexión: cada docs/guias/<nombre>.md (español) con su docs/guias/en/<nombre>.md (inglés) es una página,
// /guias/<nombre>/ y /en/guides/<nombre>/. Cabecera y orden: parseGuide (src/lib/site-markdown.ts). Si una guía no
// tiene su versión en el otro idioma, título o descripción, falla.
// ---------------------------------------------------------------------------------------------------------------
const GUIDE_DIR = { es: join(root, "docs/guias"), en: join(root, "docs/guias/en") };
const guideFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => basename(f, ".md")).sort() : []);
const guideSlugs = guideFiles(GUIDE_DIR.es);
{
  const en = guideFiles(GUIDE_DIR.en);
  const lack = [...guideSlugs.filter((g) => !en.includes(g)).map((g) => `docs/guias/en/${g}.md`), ...en.filter((g) => !guideSlugs.includes(g)).map((g) => `docs/guias/${g}.md`)];
  if (lack.length) throw new Error(`Cada guía necesita su versión en español y en inglés. Falta:\n  ${lack.join("\n  ")}`);
}
const GUIDES = { es: [], en: [] };
for (const locale of ["es", "en"]) {
  for (const slug of guideSlugs) {
    const file = `${locale === "es" ? "docs/guias" : "docs/guias/en"}/${slug}.md`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error(`${file}: el nombre solo puede tener minúsculas, números y guiones`);
    const g = parseGuide(readFileSync(join(root, file), "utf8"));
    if (!g.title || !g.description) throw new Error(`${file}: falta el título («# Título» o «titulo:») o la descripción («descripcion:»)`);
    GUIDES[locale].push({ ...g, slug, file });
  }
}
// El orden lo marca la versión en español, para que los dos índices coincidan.
const guideOrder = Object.fromEntries(GUIDES.es.map((g) => [g.slug, g.order]));
for (const locale of ["es", "en"]) GUIDES[locale].sort((a, b) => guideOrder[a.slug] - guideOrder[b.slug] || a.slug.localeCompare(b.slug));

/**
 * Enlaces de una guía o de la guía de instalación: http(s) y anclas tal cual; otra guía («telegram.md#paso»,
 * «../guias/telegram.md») a su página en el idioma de la que enlaza; la guía de instalación (docs/web/…) a /instalar/
 * o /en/install/; otro fichero del repositorio («../INSTALL.md#6-restaurar») a GitHub. Nada más.
 */
const WEB_DOCS = ["docs/web/instalar.md", "docs/web/en/install.md"];
const docLink = (locale, file) => (href) => {
  const ok = safeHref(href);
  if (ok) return ok;
  const [path, hash = ""] = href.split("#");
  // El ancla admite letras con tilde: GitHub las conserva («#8-resolución-de-problemas»).
  if (!/^[\w./-]+$/.test(path) || /^[a-z]+:/i.test(path) || (hash && !/^[\p{L}\p{N}_-]+$/u.test(hash))) return null;
  const target = posix.normalize(posix.join(posix.dirname(file), path));
  if (target.startsWith("..") || target.startsWith("/") || !existsSync(join(root, target))) return null;
  const h = hash ? `#${hash}` : "";
  const g = /^docs\/guias\/(?:en\/)?([a-z0-9-]+)\.md$/.exec(target);
  if (g && guideSlugs.includes(g[1])) return `${L[locale].guides}${g[1]}/${h}`;
  if (WEB_DOCS.includes(target)) return `${L[locale].install}${h}`;
  return `${BLOB}/${target}${h}`;
};
const guide = (locale, slug) => {
  const g = GUIDES[locale].find((x) => x.slug === slug);
  if (!g) throw new Error(`Falta la guía docs/guias/${slug}.md (la enlaza la portada)`);
  return g;
};

const L = {
  es: {
    home: "/", license: "/licencia/", guides: "/guias/", install: "/instalar/", og: "es_ES", ogImage: "og.png", other: "en", otherLabel: "English", otherShort: "EN",
    ids: { why: "por-que", how: "como-funciona", privacy: "privacidad", features: "funciones", connect: "integraciones", who: "para-quien", pricing: "precio", faq: "preguntas", install: "instalacion" },
  },
  en: {
    home: "/en/", license: "/en/license/", guides: "/en/guides/", install: "/en/install/", og: "en_GB", ogImage: "og-en.png", other: "es", otherLabel: "Español", otherShort: "ES",
    ids: { why: "why", how: "how-it-works", privacy: "privacy", features: "features", connect: "integrations", who: "who", pricing: "pricing", faq: "faq", install: "install" },
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Guía de instalación: docs/web/instalar.md (español) y docs/web/en/install.md (inglés), las dos obligatorias. Sus
// anclas fijas ({#…}) las enlazan la portada, la app (src/lib/product.ts, src/lib/update-check-core.ts) y las notas de
// cada versión (scripts/release-notes.mjs): si falta una, falla.
// ---------------------------------------------------------------------------------------------------------------
const INSTALL_DOC = { es: WEB_DOCS[0], en: WEB_DOCS[1] };
const INSTALL_ANCHORS = { es: ["railway", "email", "actualizar"], en: ["railway", "email", "update"] };
const INSTALL = {};
for (const locale of ["es", "en"]) {
  const file = INSTALL_DOC[locale];
  if (!existsSync(join(root, file))) throw new Error(`Falta ${file}: la guía de instalación necesita su versión en español (${INSTALL_DOC.es}) y en inglés (${INSTALL_DOC.en})`);
  const g = parseGuide(readFileSync(join(root, file), "utf8"));
  if (!g.title || !g.description) throw new Error(`${file}: falta el título («# Título» o «titulo:») o la descripción («descripcion:»)`);
  INSTALL[locale] = { ...g, file };
}
if (product.INSTALL_URL !== `${SITE}${L.es.install}` || product.INSTALL_URL_EN !== `${SITE}${L.en.install}`) {
  throw new Error(`INSTALL_URL e INSTALL_URL_EN (src/lib/product.ts) deben ser ${SITE}${L.es.install} y ${SITE}${L.en.install}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Imágenes: capturas reales de site/static/img (nombre-idioma-tema-ancho.webp). Se lee su tamaño de la cabecera WebP.
// ---------------------------------------------------------------------------------------------------------------
const IMG_DIR = join(root, "site/static/img");

/** Ancho y alto de un WebP (VP8, VP8L o VP8X) sin dependencias. */
function webpSize(file) {
  const b = readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") throw new Error(`${file} no es un WebP`);
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  throw new Error(`${file}: formato WebP desconocido`);
}

/**
 * <picture> con la versión clara y la oscura (según prefers-color-scheme) en dos anchos.
 * `widths` son los anchos guardados ([pequeño, grande]); `sizes`, el ancho con que se muestra.
 */
function picture(name, locale, { alt, widths, sizes, eager = false, cls = "", small = null }) {
  const src = (n, scheme, w) => `/img/${n}-${locale}-${scheme}-${w}.webp`;
  const check = (n, ws) => {
    for (const scheme of ["light", "dark"]) for (const w of ws) {
      if (!existsSync(join(IMG_DIR, src(n, scheme, w).slice(5)))) throw new Error(`Falta la captura site/static${src(n, scheme, w)}: genérala con scripts/site-screenshots.mjs`);
    }
    return webpSize(join(IMG_DIR, src(n, "light", ws[1]).slice(5)));
  };
  const big = check(name, widths);
  const set = (n, ws, scheme) => ws.map((w) => `${src(n, scheme, w)} ${w}w`).join(", ");
  const load = eager ? `fetchpriority="high" decoding="async"` : `loading="lazy" decoding="async"`;
  // `small`: otra captura (la del móvil) para pantallas estrechas, donde la de escritorio no se leería.
  let smallSources = "";
  if (small) {
    const sz = check(small.name, small.widths);
    const dims = `width="${sz.width}" height="${sz.height}"`;
    smallSources = `<source media="(max-width: ${small.below}px) and (prefers-color-scheme: dark)" srcset="${set(small.name, small.widths, "dark")}" sizes="${small.sizes}" ${dims}>
<source media="(max-width: ${small.below}px)" srcset="${set(small.name, small.widths, "light")}" sizes="${small.sizes}" ${dims}>
`;
  }
  return `<picture${cls ? ` class="${cls}"` : ""}>
${smallSources}<source media="(prefers-color-scheme: dark)" srcset="${set(name, widths, "dark")}" sizes="${sizes}">
<img src="${src(name, "light", widths[0])}" srcset="${set(name, widths, "light")}" sizes="${sizes}" width="${big.width}" height="${big.height}" alt="${esc(alt)}" ${load}>
</picture>`;
}

/** Marco de navegador (solo CSS) alrededor de una captura de escritorio. */
const browserFrame = (inner, cls = "") => `<div class="frame${cls ? ` ${cls}` : ""}"><div class="frame-bar" aria-hidden="true"><i></i><i></i><i></i><span>pizarro.example.com</span></div>${inner}</div>`;

// ---------------------------------------------------------------------------------------------------------------
// Iconos (trazos de 24 px, estilo Lucide como los de la app)
// ---------------------------------------------------------------------------------------------------------------
const logo = (size) => `<svg class="logo" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#4f46e5"/><rect x="6" y="7" width="5.5" height="18" rx="1.5" fill="#fff"/><rect x="13.25" y="7" width="5.5" height="12" rx="1.5" fill="#c7d2fe"/><rect x="20.5" y="7" width="5.5" height="7" rx="1.5" fill="#a5b4fc"/></svg>`;
const ICONS = {
  simple: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  once: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 15h2"/>',
  server: '<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  docs: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 18v-3M12 18v-6M16 18v-4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  google: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  eye: '<path d="M9.9 9.9a3 3 0 1 0 4.2 4.2"/><path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7"/><path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M2 2l20 20"/>',
  export: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  train: '<path d="M4 15.5V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9.5a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 15.5z"/><path d="M4 11h16M8 15h.01M16 15h.01M8 19l-2 3M16 19l2 3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
};
const icon = (key, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key]}</svg>`;
const check = '<svg class="ck" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const arrow = '<span class="arr" aria-hidden="true">→</span>';
const github = '<svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
const ext = (href, html, cls = "") => `<a href="${esc(href)}"${cls ? ` class="${cls}"` : ""} rel="noopener">${html}</a>`;
const checks = (items) => `<ul class="checks">${items.map((x) => `<li>${check}<span>${esc(x)}</span></li>`).join("")}</ul>`;
/** El único JavaScript de la web: los botones «Copiar» (ocultos hasta que el script los muestra). */
const COPY_SCRIPT = `<script>document.querySelectorAll("[data-copy]").forEach(function(b){b.hidden=false;b.addEventListener("click",function(){var c=document.getElementById(b.dataset.copy),o=b.textContent;if(!navigator.clipboard)return;navigator.clipboard.writeText(c.textContent).then(function(){b.textContent=b.dataset.done;setTimeout(function(){b.textContent=o},1800)})})})</script>`;
/** Rótulos de los avisos «> [!NOTE]»… en el idioma de la página. */
const calloutLabels = (s) => ({ note: s.calloutNote, tip: s.calloutTip, important: s.calloutImportant, warning: s.calloutWarning, caution: s.calloutCaution });

// ---------------------------------------------------------------------------------------------------------------
// Cabecera y pie
// ---------------------------------------------------------------------------------------------------------------
function header(locale, s, { onHome, altPath }) {
  const l = L[locale];
  const a = (id, text) => `<a href="${onHome ? "" : l.home}#${l.ids[id]}">${esc(text)}</a>`;
  const links = `${a("how", s.navFeatures)}${a("who", s.navWho)}${a("pricing", s.navPricing)}${a("faq", s.navFaq)}${a("install", s.navInstall)}`;
  const otherHref = altPath;
  return `<header class="top"><div class="wrap top-in">
<a class="brand" href="${l.home}">${logo(28)}<span>Pizarro</span></a>
<nav class="nav" aria-label="${esc(s.menu)}">${links}</nav>
<div class="top-act">
<a class="lang" href="${otherHref}" hreflang="${l.other}" lang="${l.other}" title="${l.otherLabel}"><span aria-hidden="true">${l.otherShort}</span><span class="sr">${l.otherLabel}</span></a>
${ext(product.REPO_URL, `${github}<span class="sr">GitHub</span>`, "icon-link hide-sm")}
<a class="btn btn-primary btn-sm" href="${onHome ? `#${l.ids.install}` : l.install}">${esc(s.navCta)}</a>
<details class="menu"><summary aria-label="${esc(s.menu)}">${icon("menu", 22)}</summary><nav class="menu-list" aria-label="${esc(s.menu)}">${links}${ext(product.REPO_URL, "GitHub")}</nav></details>
</div>
</div></header>`;
}

function footer(locale, s, { onHome }) {
  const l = L[locale];
  const a = (id, text) => `<li><a href="${onHome ? "" : l.home}#${l.ids[id]}">${esc(text)}</a></li>`;
  const x = (href, text) => `<li>${ext(href, esc(text))}</li>`;
  return `<footer class="foot"><div class="wrap foot-in">
<div class="foot-about">
<p class="foot-brand">${logo(24)}<span>Pizarro</span></p>
<p class="foot-tag">${esc(s.footerTagline)}</p>
<p class="foot-note">${esc(s.footerSource)}</p>
</div>
<nav class="foot-col" aria-label="${esc(s.footerProduct)}"><h2>${esc(s.footerProduct)}</h2><ul>${a("how", s.navFeatures)}${a("who", s.navWho)}${a("pricing", s.navPricing)}${a("faq", s.navFaq)}${a("install", s.navInstall)}</ul></nav>
<nav class="foot-col" aria-label="${esc(s.footerDocs)}"><h2>${esc(s.footerDocs)}</h2><ul><li><a href="${l.install}">${esc(s.installGuide)}</a></li><li><a href="${l.guides}">${esc(s.footerGuides)}</a></li>${x(LINKS.manual, s.footerManual)}${x(LINKS.manualPdf, s.footerManualPdf)}${x(LINKS.changelog, s.footerChangelog)}</ul></nav>
<nav class="foot-col" aria-label="${esc(s.footerProject)}"><h2>${esc(s.footerProject)}</h2><ul>${x(product.REPO_URL, s.footerCode)}<li><a href="${l.license}">${esc(s.footerLicense)}</a></li><li><a href="${L[l.other].home}" hreflang="${l.other}" lang="${l.other}">${l.otherLabel}</a></li></ul></nav>
</div>
<div class="wrap foot-by"><p>${esc(s.footerBy).replace("{site}", ext(AUTHOR_URL, esc(AUTHOR_SITE)))}</p></div>
</footer>`;
}

/** Página completa. `alt`: la misma página en el otro idioma (la española es la de x-default). */
function page(locale, { path, alt, title, description, main, onHome }) {
  const t = makeT(locale);
  const s = siteText(t, product.LICENSE_PRICE_EUR);
  const l = L[locale];
  const canonical = [
    `<link rel="canonical" href="${SITE}${path}">`,
    `<link rel="alternate" hreflang="${locale}" href="${SITE}${path}">`,
    `<link rel="alternate" hreflang="${l.other}" href="${SITE}${alt}">`,
    `<link rel="alternate" hreflang="x-default" href="${SITE}${locale === "es" ? path : alt}">`,
  ].join("\n");
  return fill(layout, {
    lang: locale, title: esc(title), description: esc(description), canonical, url: `${SITE}${path}`, site: SITE,
    ogLocale: l.og, ogLocaleAlt: L[l.other].og, ogImage: `${SITE}/${l.ogImage}`, ogImageAlt: esc(s.ogAlt), skip: esc(s.skip),
    header: header(locale, s, { onHome, altPath: alt }), main, footer: footer(locale, s, { onHome }),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Integraciones de la portada («Se conecta con…»): icono y enlaces de cada una (a su guía; el email, a la de instalación)
// ---------------------------------------------------------------------------------------------------------------
const guideA = (locale, slug, text) => `<a class="link" href="${L[locale].guides}${guide(locale, slug).slug}/">${esc(text)} ${arrow}</a>`;
const CONNECT = {
  email: { icon: "mail", links: (locale, s) => [`<a class="link" href="${L[locale].install}#email">${esc(s.installGuide)} ${arrow}</a>`] },
  messaging: { icon: "send", links: (locale) => [guideA(locale, "telegram", "Telegram"), guideA(locale, "whatsapp", "WhatsApp")] },
  "google-login": { icon: "login", links: (locale, s) => [guideA(locale, "google-login", s.guideRead)] },
  "google-docs": { icon: "google", links: (locale, s) => [guideA(locale, "google-docs", s.guideRead)] },
};

// ---------------------------------------------------------------------------------------------------------------
// Portada
// ---------------------------------------------------------------------------------------------------------------
function home(locale) {
  const t = makeT(locale);
  const s = siteText(t, product.LICENSE_PRICE_EUR);
  const l = L[locale];
  const ids = l.ids;
  const [faqPerUser, faqServer, faqUpdate] = landingFaq(t);
  const [faqPersonal, faqNoPay, , faqBlocked, faqEducation] = licenseFaq(t, product.LICENSE_PRICE_EUR);
  const faq = [faqPerUser, faqPersonal, faqEducation, faqNoPay, faqBlocked, faqServer, faqUpdate];
  const price = t("{price} € + IVA", { price: product.LICENSE_PRICE_EUR });
  const wide = "(min-width: 1240px) 1160px, calc(100vw - 32px)";
  const half = "(min-width: 1240px) 680px, (min-width: 960px) 56vw, calc(100vw - 32px)";

  const buy = BUY
    ? `<a class="btn btn-primary btn-block" href="${esc(BUY)}" rel="noopener">${esc(s.buy)}</a><p class="fine">${esc(product.buyNote(t, "", BUY))}</p>`
    : `<button class="btn btn-primary btn-block" type="button" disabled aria-describedby="soon-note">${esc(s.soon)}</button><p class="fine" id="soon-note">${esc(s.soonNote)}</p>`;

  const blockImages = {
    task: browserFrame(picture("task", locale, { alt: s.blocks[0].alt, widths: [1100, 2000], sizes: half })),
    release: browserFrame(picture("release", locale, { alt: s.blocks[1].alt, widths: [1100, 2000], sizes: half })),
    comments: `<div class="card-shot">${picture("comments", locale, { alt: s.blocks[2].alt, widths: [760, 1400], sizes: "(min-width: 960px) 560px, calc(100vw - 32px)" })}</div>`,
  };
  const blocks = s.blocks.map((b, i) => `<div class="feature${i % 2 ? " flip" : ""}">
<div class="feature-text">
<p class="kicker">${esc(b.kicker)}</p>
<h3>${esc(b.title)}</h3>
<p class="muted">${esc(b.text)}</p>
${checks(b.points)}
</div>
<div class="feature-media">${blockImages[b.key]}</div>
</div>`).join("\n");

  const phone = (name, alt) => `<div class="phone">${picture(name, locale, { alt, widths: [390, 780], sizes: "(min-width: 960px) 280px, 44vw" })}</div>`;
  const whoIcons = ["team", "briefcase", "home"];

  const main = `
<section class="hero">
<div class="wrap hero-in">
<h1>${esc(s.heroTitle)}</h1>
<p class="lead">${esc(s.heroLead)}</p>
<p class="actions"><a class="btn btn-primary btn-lg" href="#${ids.install}">${esc(s.heroCta)} ${arrow}</a><a class="btn btn-secondary btn-lg" href="#${ids.how}">${esc(s.heroSecondary)}</a></p>
<ul class="points">${s.heroPoints.map((p) => `<li>${check}${esc(p)}</li>`).join("")}</ul>
</div>
<div class="wrap hero-shot">
${browserFrame(picture("board", locale, { alt: s.heroAlt, widths: [1280, 2400], sizes: wide, eager: true, small: { name: "mobile-board", widths: [390, 780], sizes: "300px", below: 640 } }), "frame-hero")}
</div>
</section>

<section class="sec why" id="${ids.why}" aria-labelledby="${ids.why}-t">
<div class="wrap why-in">
<div class="why-text">
<p class="kicker">${esc(s.whyKicker)}</p>
<h2 id="${ids.why}-t">${esc(s.whyTitle)}</h2>
<p class="muted big">${esc(s.whyText)}</p>
</div>
<ul class="why-list">
${s.whyPoints.map((p, i) => `<li><span class="ico">${icon(["simple", "once", "server"][i])}</span><div><h3>${esc(p.title)}</h3><p class="muted">${esc(p.text)}</p></div></li>`).join("\n")}
</ul>
</div>
</section>

<section class="sec how" id="${ids.how}" aria-labelledby="${ids.how}-t">
<div class="wrap">
<header class="sec-head">
<p class="kicker">${esc(s.howKicker)}</p>
<h2 id="${ids.how}-t">${esc(s.howTitle)}</h2>
<p class="muted big">${esc(s.howLead)}</p>
</header>
${blocks}
<div class="feature mobile">
<div class="feature-text">
<p class="kicker">${esc(s.mobileKicker)}</p>
<h3>${esc(s.mobileTitle)}</h3>
<p class="muted">${esc(s.mobileText)}</p>
${checks(s.mobilePoints)}
</div>
<div class="feature-media phones">${phone("mobile-board", s.mobileAltBoard)}${phone("mobile-task", s.mobileAltTask)}</div>
</div>
</div>
</section>

<section class="privacy" id="${ids.privacy}" aria-labelledby="${ids.privacy}-t">
<div class="wrap">
<header class="sec-head">
<p class="kicker">${esc(s.privacyKicker)}</p>
<h2 id="${ids.privacy}-t">${esc(s.privacyTitle)}</h2>
<p class="big">${esc(s.privacyText)}</p>
</header>
<ul class="grid g4 privacy-list">
${s.privacyItems.map((p) => `<li><span class="ico">${icon(p.icon)}</span><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></li>`).join("\n")}
</ul>
</div>
</section>

<section class="sec" id="${ids.features}" aria-labelledby="${ids.features}-t">
<div class="wrap">
<header class="sec-head">
<h2 id="${ids.features}-t">${esc(s.featuresTitle)}</h2>
<p class="muted big">${esc(s.featuresLead)}</p>
</header>
<div class="calendar-shot">${browserFrame(picture("calendar", locale, { alt: s.calendarAlt, widths: [1280, 2400], sizes: wide }))}</div>
<ul class="grid g4 features">
${s.features.map((f) => `<li><span class="ico ico-sm">${icon(f.icon, 20)}</span><div><h3>${esc(f.title)}</h3><p class="muted">${esc(f.text)}</p></div></li>`).join("\n")}
</ul>
<div class="connect" id="${ids.connect}">
<header class="connect-head">
<h3>${esc(s.connectTitle)}</h3>
<p class="muted">${esc(s.connectLead)}</p>
</header>
<ul class="grid g4 connect-list">
${s.connect.map((c) => `<li class="card"><span class="ico ico-sm">${icon(CONNECT[c.key].icon, 20)}</span><h4>${esc(c.title)}</h4><p class="muted">${esc(c.text)}</p><p class="connect-links">${CONNECT[c.key].links(locale, s).join("")}</p></li>`).join("\n")}
</ul>
<p class="center connect-all"><a class="link" href="${l.guides}">${esc(s.connectAll)} ${arrow}</a></p>
</div>
</div>
</section>

<section class="sec soft" id="${ids.who}" aria-labelledby="${ids.who}-t">
<div class="wrap">
<header class="sec-head">
<h2 id="${ids.who}-t">${esc(s.whoTitle)}</h2>
<p class="muted big">${esc(s.whoLead)}</p>
</header>
<ul class="grid g3 who">
${s.who.map((w, i) => `<li class="card"><span class="ico">${icon(whoIcons[i])}</span><h3>${esc(w.title)}</h3><p class="muted">${esc(w.text)}</p><p class="example">${esc(w.example)}</p></li>`).join("\n")}
</ul>
<p class="center muted">${esc(s.whoNote)}</p>
</div>
</section>

<section class="sec" id="${ids.pricing}" aria-labelledby="${ids.pricing}-t">
<div class="wrap">
<header class="sec-head">
<h2 id="${ids.pricing}-t">${esc(s.pricingTitle)}</h2>
<p class="muted big">${esc(s.pricingLead)}</p>
</header>
<div class="grid g2 pricing">
<article class="card price-card">
<h3>${esc(s.freeTitle)}</h3>
<p class="muted">${esc(s.freeText)}</p>
<p class="price">${esc(s.freePrice)}<span class="per">${esc(s.freePer)}</span></p>
${checks(s.freeItems)}
<div class="buy"><a class="btn btn-secondary btn-block" href="#${ids.install}">${esc(s.freeCta)}</a></div>
</article>
<article class="card price-card featured">
<h3>${esc(s.paidTitle)}</h3>
<p class="muted">${esc(s.paidText)}</p>
<p class="price">${esc(price)}<span class="per">${esc(t("pago único por servidor"))}</span></p>
${checks(s.paidItems)}
<div class="buy">${buy}</div>
</article>
</div>
<p class="center after"><a class="link" href="${l.license}">${esc(s.readLicense)} ${arrow}</a></p>
</div>
</section>

<section class="sec soft" id="${ids.faq}" aria-labelledby="${ids.faq}-t">
<div class="wrap narrow">
<h2 class="center" id="${ids.faq}-t">${esc(s.faqTitle)}</h2>
<div class="faq">
${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p class="muted">${esc(f.a)}</p></details>`).join("\n")}
</div>
</div>
</section>

<section class="sec install" id="${ids.install}" aria-labelledby="${ids.install}-t">
<div class="wrap">
<div class="install-box">
<p class="kicker">${esc(s.installKicker)}</p>
<h2 id="${ids.install}-t">${esc(s.installTitle)}</h2>
<p class="big">${esc(s.installLead)}</p>
<div class="cmd"><pre tabindex="0"><code id="get-sh">${esc(GET_SH)}</code></pre><button class="copy" type="button" data-copy="get-sh" data-done="${esc(s.copied)}" hidden>${esc(s.copy)}</button></div>
<ul class="grid g3 install-links">
${s.installLinks.map((x) => {
  const inner = `<span class="ico ico-sm">${icon({ guide: "book", image: "box", railway: "train" }[x.key], 20)}</span><span><strong>${esc(x.title)} ${arrow}</strong><span>${esc(x.text)}</span></span>`;
  return `<li>${x.key === "image" ? ext(LINKS.image, inner) : `<a href="${l.install}${x.key === "railway" ? "#railway" : ""}">${inner}</a>`}</li>`;
}).join("\n")}
</ul>
</div>
</div>
</section>
${COPY_SCRIPT}
`;
  return page(locale, { path: l.home, alt: L[l.other].home, title: s.metaTitle, description: s.metaDescription, main, onHome: true });
}

function licensePage(locale) {
  const t = makeT(locale);
  const s = siteText(t, product.LICENSE_PRICE_EUR);
  const l = L[locale];
  const md = (locale === "en" ? license[1] : license[0]).replace(/^# (.*)\n+/, "");
  const heading = (locale === "en" ? license[1] : license[0]).match(/^# (.*)/)?.[1] ?? s.licenseTitle;
  const other = locale === "es" ? "Read it in English" : "Léela en español";
  const main = `
<article class="wrap narrow sec prose">
<p class="crumbs"><a href="${l.home}">Pizarro</a> <span aria-hidden="true">/</span> ${esc(s.footerLicense)}</p>
<h1>${esc(heading)}</h1>
<p class="small"><a class="link" href="${L[l.other].license}" hreflang="${l.other}" lang="${l.other}">${other}</a></p>
${markdownToHtml(md)}
<p class="after"><a class="link" href="${l.home}#${l.ids.pricing}"><span aria-hidden="true">←</span> ${esc(s.navPricing)}</a></p>
</article>
`;
  return page(locale, { path: l.license, alt: L[l.other].license, title: `${s.licenseTitle} · Pizarro`, description: s.licenseDescription, main, onHome: false });
}

/** Índice de las guías de conexión: una tarjeta por guía. */
function guidesIndex(locale) {
  const t = makeT(locale);
  const s = siteText(t, product.LICENSE_PRICE_EUR);
  const l = L[locale];
  const main = `
<section class="sec guides">
<div class="wrap">
<p class="crumbs"><a href="${l.home}">Pizarro</a> <span aria-hidden="true">/</span> ${esc(s.guidesNav)}</p>
<header class="sec-head">
<h1>${esc(s.guidesTitle)}</h1>
<p class="muted big">${esc(s.guidesLead)}</p>
</header>
<ul class="grid g2 guide-cards">
${GUIDES[locale].map((g) => `<li><a class="card guide-card" href="${l.guides}${g.slug}/"><span class="ico">${icon(guideIcon(g), 22)}</span><span><strong>${esc(g.title)}</strong><span class="muted">${esc(g.description)}</span><span class="link">${esc(s.guideRead)} ${arrow}</span></span></a></li>`).join("\n")}
</ul>
<p class="center muted after">${esc(s.guidesInstall)} <a class="link" href="${l.install}">${esc(s.installGuide)} ${arrow}</a></p>
</div>
</section>
`;
  return page(locale, { path: l.guides, alt: L[l.other].guides, title: `${s.guidesTitle} · Pizarro`, description: s.guidesDescription, main, onHome: false });
}

function guideIcon(g) {
  if (!g.icon) return "book";
  if (!ICONS[g.icon]) throw new Error(`${g.file}: icono «${g.icon}» desconocido (usa uno de: ${Object.keys(ICONS).join(", ")})`);
  return g.icon;
}

/** Una guía: su Markdown convertido, con migas, el enlace al otro idioma y las demás guías al final. */
function guidePage(locale, g) {
  const t = makeT(locale);
  const s = siteText(t, product.LICENSE_PRICE_EUR);
  const l = L[locale];
  const other = locale === "es" ? "Read it in English" : "Léela en español";
  const rest = GUIDES[locale].filter((x) => x.slug !== g.slug);
  const path = `${l.guides}${g.slug}/`;
  const alt = `${L[l.other].guides}${g.slug}/`;
  const main = `
<article class="wrap narrow sec prose guide">
<p class="crumbs"><a href="${l.home}">Pizarro</a> <span aria-hidden="true">/</span> <a href="${l.guides}">${esc(s.guidesNav)}</a> <span aria-hidden="true">/</span> ${esc(g.title)}</p>
<h1>${esc(g.title)}</h1>
<p class="guide-lead">${esc(g.description)}</p>
<p class="small"><a class="link" href="${alt}" hreflang="${l.other}" lang="${l.other}">${other}</a></p>
${markdownToHtml(g.body, { link: docLink(locale, g.file), callouts: calloutLabels(s) })}
${rest.length ? `<nav class="guide-more" aria-labelledby="mas-guias"><h2 id="mas-guias">${esc(s.guideOther)}</h2><ul>${rest.map((x) => `<li><a href="${l.guides}${x.slug}/"><span class="ico ico-sm">${icon(guideIcon(x), 18)}</span><span>${esc(x.title)}</span></a></li>`).join("")}</ul></nav>` : ""}
<p class="after"><a class="link" href="${l.guides}"><span aria-hidden="true">←</span> ${esc(s.guideAll)}</a></p>
</article>
`;
  return page(locale, { path, alt, title: `${g.title} · Pizarro`, description: g.description, main, onHome: false });
}

/**
 * Bloque de código de la guía de instalación: una barra con su rótulo y, en los comandos y variables, el botón
 * «Copiar». «text» es lo que muestra la pantalla: se ve igual, pero sin botón.
 */
function codeBlock(s) {
  let n = 0;
  return (text, lang) => {
    const copyable = ["bash", "sh", "shell", "env"].includes(lang);
    const label = lang === "env" ? s.codeVariables : copyable ? s.codeTerminal : s.codeOutput;
    const id = `codigo-${++n}`;
    const button = copyable ? `<button class="copy" type="button" data-copy="${id}" data-done="${esc(s.copied)}" hidden>${esc(s.copy)}</button>` : "";
    return `<div class="code${copyable ? "" : " code-out"}"><div class="code-bar"><span>${esc(label)}</span>${button}</div><pre tabindex="0"><code id="${id}">${esc(text)}</code></pre></div>`;
  };
}

/** Guía de instalación: índice (lateral en escritorio, desplegable en el móvil) y el Markdown de docs/web. */
function installPage(locale) {
  const t = makeT(locale);
  const s = siteText(t, product.LICENSE_PRICE_EUR);
  const l = L[locale];
  const doc = INSTALL[locale];
  const other = locale === "es" ? "Read it in English" : "Léela en español";
  const headings = [];
  const body = markdownToHtml(doc.body, { link: docLink(locale, doc.file), headings, callouts: calloutLabels(s), code: codeBlock(s) });
  const ids = new Set(headings.map((h) => h.id));
  const lack = INSTALL_ANCHORS[locale].filter((id) => !ids.has(id));
  if (lack.length) throw new Error(`${doc.file}: faltan las secciones con identificador fijo ${lack.map((id) => `{#${id}}`).join(", ")} (las enlazan la portada y la app)`);
  const sections = headings.filter((h) => h.level === 2);
  if (sections.length < 3) throw new Error(`${doc.file}: la guía de instalación necesita sus secciones («## …»)`);
  const list = `<ol>${sections.map((h) => `<li><a href="#${h.id}">${h.html}</a></li>`).join("")}</ol>`;
  const main = `
<div class="wrap doc">
<p class="crumbs"><a href="${l.home}">Pizarro</a> <span aria-hidden="true">/</span> ${esc(s.navInstall)}</p>
<div class="doc-grid">
<aside class="doc-side"><nav class="toc" aria-labelledby="indice-t"><p class="toc-title" id="indice-t">${esc(s.tocTitle)}</p>${list}</nav></aside>
<article class="prose doc-body">
<h1>${esc(doc.title)}</h1>
<p class="guide-lead">${esc(doc.description)}</p>
<p class="small"><a class="link" href="${L[l.other].install}" hreflang="${l.other}" lang="${l.other}">${other}</a></p>
<details class="toc-m"><summary>${esc(s.tocTitle)}</summary><nav aria-label="${esc(s.tocTitle)}">${list}</nav></details>
${body}
<p class="after"><a class="link" href="${l.guides}">${esc(s.footerGuides)} ${arrow}</a></p>
</article>
</div>
</div>
${COPY_SCRIPT}
`;
  return page(locale, { path: l.install, alt: L[l.other].install, title: `${doc.title} · Pizarro`, description: doc.description, main, onHome: false });
}

function notFound() {
  const es = siteText(makeT("es"), product.LICENSE_PRICE_EUR);
  const en = siteText(makeT("en"), product.LICENSE_PRICE_EUR);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(es.notFoundTitle)} · Pizarro</title>
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main class="wrap narrow notfound">
<a class="brand" href="/">${logo(40)}<span>Pizarro</span></a>
<p class="big-404" aria-hidden="true">404</p>
<h1>${esc(es.notFoundTitle)}</h1>
<p class="muted">${esc(es.notFoundText)}</p>
<p><a class="btn btn-primary" href="/">${esc(es.notFoundHome)}</a></p>
<div lang="en" class="nf-en">
<h2>${esc(en.notFoundTitle)}</h2>
<p class="muted">${esc(en.notFoundText)} <a class="link" href="/en/">${esc(en.notFoundHome)}</a></p>
</div>
</main>
</body>
</html>
`;
}

function sitemap() {
  const pairs = [["/", "/en/"], [L.es.install, L.en.install], ["/licencia/", "/en/license/"], [L.es.guides, L.en.guides], ...guideSlugs.map((g) => [`${L.es.guides}${g}/`, `${L.en.guides}${g}/`])];
  const urls = pairs.flatMap(([es, en]) => [es, en].map((loc) => `  <url>
    <loc>${SITE}${loc}</loc>
    <xhtml:link rel="alternate" hreflang="es" href="${SITE}${es}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE}${en}"/>
  </url>`));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
}

// Salida
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "site/static"), out, { recursive: true });
copyFileSync(join(root, "public/icon.svg"), join(out, "icon.svg"));
copyFileSync(join(root, "public/favicon.ico"), join(out, "favicon.ico"));
copyFileSync(join(root, "public/apple-touch-icon.png"), join(out, "apple-touch-icon.png"));
const write = (p, content) => {
  mkdirSync(dirname(join(out, p)), { recursive: true });
  writeFileSync(join(out, p), content);
};
write("index.html", home("es"));
write("en/index.html", home("en"));
write("licencia/index.html", licensePage("es"));
write("en/license/index.html", licensePage("en"));
write(`${L.es.install.slice(1)}index.html`, installPage("es"));
write(`${L.en.install.slice(1)}index.html`, installPage("en"));
for (const locale of ["es", "en"]) {
  write(`${L[locale].guides.slice(1)}index.html`, guidesIndex(locale));
  for (const g of GUIDES[locale]) write(`${L[locale].guides.slice(1)}${g.slug}/index.html`, guidePage(locale, g));
}
write("404.html", notFound());
write("sitemap.xml", sitemap());
write(".nojekyll", "");

if (missing.size) {
  console.error(`Faltan traducciones al inglés (añádelas en src/i18n/en/):\n${[...missing].map((k) => `  ${JSON.stringify(k)}`).join("\n")}`);
  process.exit(1);
}
console.log(`Web generada en ${out}${BUY ? "" : " (sin BUY_URL: botón «Próximamente»)"}`);
