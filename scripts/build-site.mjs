// Genera la web estática del producto (getpizarro.com) en site/dist, para GitHub Pages (.github/workflows/site.yml).
//   node scripts/build-site.mjs            (Node 22.18 o superior: importa los .ts de src/ directamente)
//
// No duplica textos a mano:
//   - los de la presentación salen de src/lib/landing-content.ts (los mismos que /presentacion de la app) y los propios
//     de la web, de src/lib/site-content.ts; su inglés, del diccionario de la app (src/i18n/en/*.ts);
//   - el precio, el enlace de compra (BUY_URL) y las direcciones, de src/lib/product.ts;
//   - la licencia, de LICENSE.md (español, «---» y traducción al inglés), igual que scripts/license-sync.mjs.
// Sin JavaScript ni recursos externos: HTML + una hoja de estilos, modo claro/oscuro con prefers-color-scheme.
// Plantilla: site/templates/layout.html. Ficheros tal cual: site/static/ (CNAME, robots.txt, style.css, og.png).
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site", "dist");
const imp = (p) => import(pathToFileURL(join(root, p)).href);

const product = await imp("src/lib/product.ts");
const { landingFaq, landingHero, landingIncludes, landingPillars, landingSteps, licenseFaq } = await imp("src/lib/landing-content.ts");
const { siteText } = await imp("src/lib/site-content.ts");

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

/** Markdown mínimo de LICENSE.md: encabezados, párrafos, listas con «-», **negrita** y *cursiva*. */
function markdown(md) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  const html = [];
  for (const block of md.trim().split(/\n{2,}/)) {
    const lines = block.split("\n");
    const h = /^(#{1,3}) (.*)$/.exec(block);
    if (h && lines.length === 1) {
      const level = h[1].length;
      const id = h[2].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      html.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
    } else if (lines.every((l) => l.startsWith("- "))) {
      html.push(`<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`);
    } else {
      html.push(`<p>${inline(lines.join(" "))}</p>`);
    }
  }
  return html.join("\n");
}

const license = readFileSync(join(root, "LICENSE.md"), "utf8").replace(/\r\n/g, "\n").trimEnd().split("\n\n---\n\n");
if (license.length !== 2) throw new Error("LICENSE.md debe tener exactamente un separador «---» entre el español y el inglés");

const SITE = product.SITE_URL.replace(/\/$/, "");
const BUY = product.BUY_URL.trim();
const GET_SH = "curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --domain pizarro.example.com";
const RAILWAY_URL = `${product.REPO_URL}/blob/main/docs/INSTALL.md#railway`;
const layout = readFileSync(join(root, "site/templates/layout.html"), "utf8");

const L = {
  es: { home: "/", license: "/licencia/", ids: { features: "funciones", install: "instalacion", pricing: "precios", faq: "preguntas" }, og: "es_ES", other: "en", otherLabel: "English", otherShort: "EN" },
  en: { home: "/en/", license: "/en/license/", ids: { features: "features", install: "install", pricing: "pricing", faq: "faq" }, og: "en_GB", other: "es", otherLabel: "Español", otherShort: "ES" },
};

const logo = (size) => `<svg class="logo" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#4f46e5"/><rect x="6" y="7" width="5.5" height="18" rx="1.5" fill="#fff"/><rect x="13.25" y="7" width="5.5" height="12" rx="1.5" fill="#c7d2fe"/><rect x="20.5" y="7" width="5.5" height="7" rx="1.5" fill="#a5b4fc"/></svg>`;
const icons = {
  simple: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  once: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 15h2"/>',
  data: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  small: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>',
};
const icon = (key) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key]}</svg>`;
const check = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ext = (href, text, cls = "") => `<a href="${esc(href)}"${cls ? ` class="${cls}"` : ""} rel="noopener">${text}</a>`;

function header(locale, t, s, { onHome }) {
  const l = L[locale];
  const a = (id, text) => `<a href="${onHome ? "" : l.home}#${l.ids[id]}">${esc(text)}</a>`;
  const otherHref = onHome ? L[l.other].home : L[l.other].license;
  return `<header class="top"><div class="wrap top-in">
<a class="brand" href="${l.home}">${logo(28)}<span>Pizarro</span></a>
<nav class="nav" aria-label="Pizarro">${a("features", s.navFeatures)}${a("install", s.navInstall)}${a("pricing", s.navPricing)}${a("faq", s.navFaq)}</nav>
<a class="lang" href="${otherHref}" hreflang="${l.other}" lang="${l.other}" title="${l.otherLabel}"><span aria-hidden="true">${l.otherShort}</span><span class="sr">${l.otherLabel}</span></a>
${ext(product.REPO_URL, "GitHub", "btn btn-ghost hide-sm")}
</div></header>`;
}

function footer(locale, t, s) {
  const l = L[locale];
  return `<footer class="foot"><div class="wrap foot-in">
<p class="foot-brand">${logo(22)}<span>Pizarro</span></p>
<p class="foot-note">${esc(s.footerSource)}</p>
<nav class="foot-links" aria-label="${esc(s.footerLicense)}">
<a href="${l.license}">${esc(s.footerLicense)}</a>
${ext(product.REPO_URL, esc(s.footerCode))}
${ext(product.INSTALL_URL, esc(s.installGuide))}
<a href="${L[l.other].home}" hreflang="${l.other}" lang="${l.other}">${l.otherLabel}</a>
</nav>
</div></footer>`;
}

function page(locale, { path, title, description, main, onHome }) {
  const t = makeT(locale);
  const s = siteText(t, product.LICENSE_PRICE_EUR);
  const l = L[locale];
  const alt = onHome ? L[l.other].home : L[l.other].license;
  const canonical = [
    `<link rel="canonical" href="${SITE}${path}">`,
    `<link rel="alternate" hreflang="${locale}" href="${SITE}${path}">`,
    `<link rel="alternate" hreflang="${l.other}" href="${SITE}${alt}">`,
    `<link rel="alternate" hreflang="x-default" href="${SITE}${onHome ? "/" : "/licencia/"}">`,
  ].join("\n");
  return fill(layout, {
    lang: locale, title: esc(title), description: esc(description), canonical, url: `${SITE}${path}`, site: SITE,
    ogLocale: l.og, ogLocaleAlt: L[l.other].og, ogImageAlt: esc(s.metaTitle), skip: esc(s.skip),
    header: header(locale, t, s, { onHome }), main, footer: footer(locale, t, s),
  });
}

function home(locale) {
  const t = makeT(locale);
  const s = siteText(t, product.LICENSE_PRICE_EUR);
  const l = L[locale];
  const hero = landingHero(t);
  const steps = landingSteps(t);
  const faq = [...landingFaq(t), ...licenseFaq(t, product.LICENSE_PRICE_EUR)];
  const features = landingIncludes(t).map((title, i) => ({ title, text: s.featureTexts[i] }));
  if (features.some((f) => !f.text)) throw new Error("site-content.ts: featureTexts debe tener un texto por cada función de landingIncludes");
  const price = t("{price} € + IVA", { price: product.LICENSE_PRICE_EUR });

  const board = `<figure class="board" role="img" aria-label="${esc(s.boardAlt)}">
${s.boardCols.map((c, i) => `<div class="col"><p class="col-h"><span>${esc(c)}</span><span class="n">${s.boardCards[i].length}</span></p>${s.boardCards[i].map((card, j) => `<div class="card-mini c${(i + j) % 3}"><span class="bar"></span>${esc(card)}</div>`).join("")}</div>`).join("\n")}
</figure>`;

  const buy = BUY
    ? `<a class="btn btn-primary" href="${esc(BUY)}" rel="noopener">${esc(s.buy)}</a><p class="small muted">${esc(product.buyNote(t, "", BUY))}</p>`
    : `<button class="btn btn-primary" type="button" disabled aria-describedby="soon-note">${esc(s.soon)}</button><p class="small muted" id="soon-note">${esc(s.soonNote)}</p>`;

  const main = `
<section class="hero wrap">
<div class="hero-text">
<p class="eyebrow">${esc(s.eyebrow)}</p>
<h1>${esc(hero.title)}</h1>
<p class="lead">${esc(hero.lead)}</p>
<p class="actions"><a class="btn btn-primary" href="#${l.ids.install}">${esc(t("Cómo se instala"))} <span aria-hidden="true">→</span></a><a class="btn btn-secondary" href="#${l.ids.pricing}">${esc(t("Precios"))}</a></p>
<p class="small muted">${esc(s.heroNote)}</p>
</div>
${board}
</section>

<section class="band" aria-label="${esc(t("Por qué Pizarro"))}">
<div class="wrap grid g2">
${landingPillars(t).map((p) => `<article class="panel"><span class="ico">${icon(p.key)}</span><h2 class="h3">${esc(p.title)}</h2><p class="muted">${esc(p.text)}</p></article>`).join("\n")}
</div>
</section>

<section class="wrap sec" aria-labelledby="${l.ids.features}">
<h2 id="${l.ids.features}">${esc(s.featuresTitle)}</h2>
<p class="sec-lead muted">${esc(s.featuresLead)}</p>
<ul class="grid g4 features">
${features.map((f) => `<li><p class="f-t"><span class="tick">${check}</span>${esc(f.title)}</p><p class="small muted">${esc(f.text)}</p></li>`).join("\n")}
</ul>
</section>

<section class="band" aria-labelledby="${l.ids.install}">
<div class="wrap sec">
<h2 id="${l.ids.install}">${esc(s.installTitle)}</h2>
<p class="sec-lead muted">${esc(s.installLead)}</p>
<ol class="grid g3 steps">
${steps.map((st, i) => `<li class="panel step"><span class="num" aria-hidden="true">${i + 1}</span><div><h3>${esc(st.title)}</h3><p class="small muted">${esc(st.text)}</p></div></li>`).join("\n")}
</ol>
<div class="grid g-install">
<article class="panel">
<h3>${esc(s.installServerTitle)}</h3>
<pre class="code" tabindex="0"><code>${esc(GET_SH)}</code></pre>
<p class="small muted">${esc(s.installServerText)}</p>
<p>${ext(product.INSTALL_URL, `${esc(s.installGuide)} <span aria-hidden="true">→</span>`, "link")}</p>
</article>
<div class="stack">
<article class="panel">
<h3>${esc(s.installImageTitle)}</h3>
<pre class="code" tabindex="0"><code>docker pull ${esc(product.IMAGE)}</code></pre>
<p class="small muted">${esc(s.installImageText)}</p>
<p>${ext(product.IMAGE_URL, `${esc(s.installImageLink)} <span aria-hidden="true">→</span>`, "link")}</p>
</article>
<article class="panel">
<h3>${esc(s.installRailwayTitle)}</h3>
<p class="small muted">${esc(s.installRailwayText)}</p>
<p>${ext(RAILWAY_URL, `${esc(s.installGuide)} <span aria-hidden="true">→</span>`, "link")}</p>
</article>
</div>
</div>
</div>
</section>

<section class="wrap sec" aria-labelledby="${l.ids.pricing}">
<h2 id="${l.ids.pricing}">${esc(s.pricingTitle)}</h2>
<p class="sec-lead muted">${esc(s.pricingLead)}</p>
<div class="grid g2 pricing">
<article class="panel price-card">
<h3>${esc(s.freeTitle)}</h3>
<p class="muted">${esc(s.freeText)}</p>
<p class="price">${esc(s.freePrice)}</p>
<ul class="checks">${s.freeItems.map((x) => `<li>${check}${esc(x)}</li>`).join("")}</ul>
</article>
<article class="panel price-card featured">
<h3>${esc(s.paidTitle)}</h3>
<p class="muted">${esc(s.paidText)}</p>
<p class="price">${esc(price)}<span class="per">${esc(t("pago único por servidor"))}</span></p>
<ul class="checks">${s.paidItems.map((x) => `<li>${check}${esc(x)}</li>`).join("")}</ul>
<div class="buy">${buy}</div>
</article>
</div>
<p class="after"><a class="link" href="${l.license}">${esc(s.readLicense)} <span aria-hidden="true">→</span></a></p>
</section>

<section class="band" aria-labelledby="${l.ids.faq}">
<div class="wrap narrow sec">
<h2 id="${l.ids.faq}">${esc(s.faqTitle)}</h2>
<div class="faq">
${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p class="muted">${esc(f.a)}</p></details>`).join("\n")}
</div>
<p class="after">${ext(product.REPO_URL, `${esc(s.ctaCode)} <span aria-hidden="true">→</span>`, "link")}</p>
</div>
</section>
`;
  return page(locale, { path: l.home, title: s.metaTitle, description: s.metaDescription, main, onHome: true });
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
${markdown(md)}
<p class="after"><a class="link" href="${l.home}#${l.ids.pricing}"><span aria-hidden="true">←</span> ${esc(s.pricingTitle)}</a></p>
</article>
`;
  return page(locale, { path: l.license, title: `${s.licenseTitle} · Pizarro`, description: s.licenseDescription, main, onHome: false });
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
<p class="big" aria-hidden="true">404</p>
<h1>${esc(es.notFoundTitle)}</h1>
<p class="muted">${esc(es.notFoundText)}</p>
<p><a class="btn btn-primary" href="/">${esc(es.notFoundHome)}</a></p>
<div lang="en" class="nf-en">
<h2 class="h3">${esc(en.notFoundTitle)}</h2>
<p class="muted">${esc(en.notFoundText)} <a class="link" href="/en/">${esc(en.notFoundHome)}</a></p>
</div>
</main>
</body>
</html>
`;
}

function sitemap() {
  const pairs = [["/", "/en/"], ["/licencia/", "/en/license/"]];
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
copyFileSync(join(root, "src/app/icon.svg"), join(out, "icon.svg"));
copyFileSync(join(root, "src/app/favicon.ico"), join(out, "favicon.ico"));
copyFileSync(join(root, "public/apple-touch-icon.png"), join(out, "apple-touch-icon.png"));
const write = (p, content) => {
  mkdirSync(dirname(join(out, p)), { recursive: true });
  writeFileSync(join(out, p), content);
};
write("index.html", home("es"));
write("en/index.html", home("en"));
write("licencia/index.html", licensePage("es"));
write("en/license/index.html", licensePage("en"));
write("404.html", notFound());
write("sitemap.xml", sitemap());
write(".nojekyll", "");

if (missing.size) {
  console.error(`Faltan traducciones al inglés (añádelas en src/i18n/en/):\n${[...missing].map((k) => `  ${JSON.stringify(k)}`).join("\n")}`);
  process.exit(1);
}
console.log(`Web generada en ${out}${BUY ? "" : " (sin BUY_URL: botón «Próximamente»)"}`);
