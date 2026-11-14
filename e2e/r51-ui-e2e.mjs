// Ronda 51 (interfaz): esqueletos de carga de las páginas de proyecto (tablero con cuatro columnas y su cabecera, en claro,
// oscuro y móvil; Releases, Documentación y Ajustes, cada uno con su forma; sin parpadeo en cargas rápidas), icono de la
// app en el color de la instalación (Administración → Ajustes → «Icono de la app»: manifiesto, favicon, apple-touch-icon
// y nombre bajo el icono), los <link> fuera del HTML de Documentación y la hora con segundos del aviso de reducción de
// las copias. Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r51-ui-e2e.mjs      # PART=skeleton,icon,html,backups
// La parte «backups» necesita el servidor con BACKUP_KEY (y mejor BACKUP_PAUSE=1, para que ninguna copia automática
// escriba a la vez el estado): si no la tiene, se salta con una nota. Escribe un status.json de prueba en la carpeta de
// copias (UPLOAD_DIR/backups; UPLOAD_DIR del entorno o del .env de APP_DIR, por defecto la raíz del repositorio) y deja el
// que hubiera como estaba.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "skeleton,icon,html,backups").split(",");
const ID = "r51ui_proj";
const APP_DIR = process.env.APP_DIR || path.resolve(L.HERE, "..", "..");

await L.q(`DELETE FROM "Project" WHERE id=$1`, [ID]); // de una pasada anterior interrumpida
await L.prepareUsers();
await L.cleanBoard();
const [me] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);

/** Proyecto privado propio con cuatro columnas (Backlog la primera, como el de ejemplo: así L.board lo reconoce). */
async function createProject() {
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [ID]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId","updatedAt",position) VALUES ($1,'R51 carga',true,$2,NOW(),-1)`, [ID, me.id]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [ID, me.id]);
  await L.q(`INSERT INTO "Column"(id,"projectId",name,position) VALUES ('r51ui_c1',$1,'Backlog',1),('r51ui_c2',$1,'En curso',2),('r51ui_c3',$1,'Revisión',3),('r51ui_c4',$1,'Hecho',4)`, [ID]);
}

/** Respuestas lentas (solo la navegación, no la precarga) para las páginas del proyecto de la prueba. */
const isProjectPage = (u) => u.pathname.startsWith(`/p/${ID}`);
const slowNav = (ms) => async (route) => {
  const h = route.request().headers();
  if (h.rsc && !h["next-router-prefetch"]) await sleep(ms);
  await route.continue().catch(() => {}); // ya resuelta al quitar la ruta
};
const prefetchOf = (page, pathname) =>
  page.waitForResponse((r) => new URL(r.url()).pathname === pathname && !!r.request().headers()["next-router-prefetch"], { timeout: 6000 }).catch(() => null);

/** Navegación lenta: el enlace ya precargado (trae el loading.tsx) y la respuesta de la navegación retrasada `ms`. */
async function slowClick(page, link, ms, { tap = false, prefetched = null } = {}) {
  if (!prefetched) {
    const href = await link.getAttribute("href");
    prefetched = prefetchOf(page, new URL(href, L.BASE).pathname);
    await link.hover().catch(() => {});
  }
  await prefetched;
  await sleep(300);
  await page.route(isProjectPage, slowNav(ms));
  if (tap) await link.tap();
  else await link.click();
}
const loader = (page) => page.locator("[data-project-loading]");

/** Estado del esqueleto que se ve. */
const skeletonState = (page) => page.evaluate(() => {
  const el = document.querySelector("[data-project-loading]");
  if (!el) return null;
  const cols = [...el.querySelectorAll("[data-skeleton-column]")].filter((c) => c.checkVisibility());
  const bone = el.querySelector(".sk");
  // Luminancia de un color CSS (los de Tailwind 4 van en oklch): se pinta en un lienzo y se lee el píxel.
  const lum = (c) => {
    const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    g.fillStyle = c;
    g.fillRect(0, 0, 1, 1);
    const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
    return (0.2126 * r + 0.7152 * gr + 0.0722 * b) / 255;
  };
  return {
    kind: el.getAttribute("data-project-loading"),
    opacity: Number(getComputedStyle(el).opacity),
    columns: cols.length,
    heads: cols.map((c) => c.firstElementChild.querySelectorAll(".sk").length),
    header: !!el.querySelector("[data-skeleton-header]")?.checkVisibility(),
    tabs: !!el.querySelector("[data-skeleton-tabs]")?.checkVisibility(),
    anim: bone ? getComputedStyle(bone).animationName : "",
    boneLum: bone ? lum(getComputedStyle(bone).backgroundColor) : null,
    status: el.querySelector("[role=status]")?.textContent ?? "",
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    colWidth: cols[0] ? Math.round(cols[0].getBoundingClientRect().width) : 0,
  };
});

// --- Esqueletos ----------------------------------------------------------------------------------------------------
if (only.includes("skeleton")) {
  L.scenario("skeleton: esqueleto del tablero y de las demás páginas del proyecto");
  await createProject();
  const s = await L.session({ viewport: { width: 1400, height: 900 } });
  const page = s.page;
  await page.goto(`${L.BASE}/p/${ID}/settings`);
  const toBoard = page.getByRole("link", { name: "Ir al tablero" });
  await toBoard.waitFor({ timeout: 15000 });

  // Escritorio, claro.
  await slowClick(page, toBoard, 2500);
  await loader(page).waitFor({ timeout: 3000 }).catch(() => {});
  await sleep(600);
  const light = await skeletonState(page);
  L.eq("SK: al ir al tablero sale su esqueleto", light?.kind, "board");
  L.eq("SK: cuatro columnas", light?.columns, 4);
  L.eq("SK: cada una con la forma de su cabecera (título, contador, «+» y menú)", light?.heads, [4, 4, 4, 4]);
  L.check("SK: con la cabecera del tablero en escritorio (no la barra del móvil)", light?.header && !light?.tabs, JSON.stringify(light));
  L.eq("SK: con brillo", light?.anim, "project-skeleton-shine");
  L.check("SK: en claro, huesos claros", light?.boneLum > 0.7, JSON.stringify(light));
  L.check("SK: las columnas miden como las del tablero (al menos 18 rem)", light?.colWidth >= 288, JSON.stringify(light));
  await page.screenshot({ path: `${SHOTS}/r51-esqueleto-claro.png` });
  await L.board(page);
  await page.unroute(isProjectPage);
  const real = await page.evaluate(() => [...document.querySelectorAll("section[aria-label]")].filter((c) => c.checkVisibility()).length);
  L.eq("SK: y luego el tablero real (cuatro columnas)", real, 4);
  L.eq("SK: el esqueleto ya no está", await loader(page).count(), 0);

  // Escritorio, oscuro.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${L.BASE}/p/${ID}/settings`);
  await toBoard.waitFor({ timeout: 15000 });
  await slowClick(page, toBoard, 2500);
  await loader(page).waitFor({ timeout: 3000 }).catch(() => {});
  await sleep(600);
  const dark = await skeletonState(page);
  L.check("SK: en oscuro, huesos oscuros", dark?.kind === "board" && dark.boneLum < 0.3, JSON.stringify(dark));
  await page.screenshot({ path: `${SHOTS}/r51-esqueleto-oscuro.png` });
  await L.board(page);
  await page.unroute(isProjectPage);
  await page.emulateMedia({ colorScheme: "light" });

  // Releases, Documentación y Ajustes: cada una con su esqueleto.
  for (const [kind, href, url] of [["releases", `/p/${ID}/releases`, /\/releases/], ["docs", `/p/${ID}/docs`, /\/docs/], ["settings", `/p/${ID}/settings`, /\/settings/]]) {
    if (kind === "settings") { await page.goto(`${L.BASE}/p/${ID}`); await L.board(page); }
    await slowClick(page, page.locator(`aside a[href="${href}"]`).filter({ visible: true }).first(), 2000);
    await loader(page).waitFor({ timeout: 3000 }).catch(() => {});
    await sleep(600);
    const st = await skeletonState(page);
    L.check(`SK: ${kind}: su propio esqueleto, visible y con brillo`, st?.kind === kind && st.opacity > 0.9 && st.anim === "project-skeleton-shine", JSON.stringify(st));
    await page.screenshot({ path: `${SHOTS}/r51-esqueleto-${kind}.png` });
    await page.waitForURL(url, { timeout: 10000 });
    await loader(page).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    await page.unroute(isProjectPage);
  }

  // Sin parpadeo: el esqueleto nunca se ve antes de los 200 ms (en una carga rápida, nada). Se mira cuándo entra en la
  // página y cuándo empieza a verse, en cada fotograma.
  const watch = () => page.evaluate(() => {
    const st = { seen: null, visible: null, gone: null };
    window.__r51 = st;
    const look = () => {
      const el = document.querySelector("[data-project-loading]");
      const now = performance.now();
      if (el && st.seen === null) st.seen = now;
      if (el && st.visible === null && Number(getComputedStyle(el).opacity) > 0.01) st.visible = now;
      if (!el && st.seen !== null && st.gone === null) st.gone = now;
      if (st.gone === null) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  const timing = async () => {
    const w = await page.evaluate(() => window.__r51);
    return { ...w, shownAfter: w.visible === null ? null : Math.round(w.visible - w.seen), present: w.gone === null || w.seen === null ? null : Math.round(w.gone - w.seen) };
  };
  // Respuesta rápida (sin retrasos), de Ajustes al tablero y del tablero a Releases.
  await page.goto(`${L.BASE}/p/${ID}/settings`);
  await toBoard.waitFor({ timeout: 15000 });
  await watch();
  const pre = prefetchOf(page, `/p/${ID}`);
  await toBoard.hover();
  await pre;
  await sleep(300);
  await toBoard.click();
  await L.board(page);
  const t1 = await timing();
  const relLink = page.locator(`aside a[href="/p/${ID}/releases"]`).filter({ visible: true }).first();
  const pre3 = prefetchOf(page, `/p/${ID}/releases`);
  await relLink.hover();
  await pre3;
  await sleep(300);
  await watch();
  await relLink.click();
  await page.getByRole("heading", { name: "Releases" }).first().waitFor({ timeout: 10000 });
  await sleep(300);
  const t2 = await timing();
  L.check("SK: nunca se ve antes de los 200 ms (al tablero)", t1.shownAfter === null || t1.shownAfter >= 180, JSON.stringify(t1));
  L.check("SK: nunca se ve antes de los 200 ms (a Releases)", t2.shownAfter === null || t2.shownAfter >= 180, JSON.stringify(t2));
  L.note("SK: cargas rápidas (ms con el esqueleto montado y cuándo empezó a verse)", JSON.stringify({ tablero: t1, releases: t2 }));
  L.assertNoErrors("SK escritorio", [s]);
  await s.ctx.close();

  // Móvil: una columna, la barra de pestañas y nada se sale de la pantalla.
  const m = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const mp = m.page;
  const pre2 = prefetchOf(mp, `/p/${ID}`);
  await mp.goto(`${L.BASE}/p/${ID}/settings`);
  const mToBoard = mp.getByRole("link", { name: "Ir al tablero" });
  await mToBoard.waitFor({ timeout: 15000 });
  await slowClick(mp, mToBoard, 2500, { tap: true, prefetched: pre2 });
  await loader(mp).waitFor({ timeout: 3000 }).catch(() => {});
  await sleep(600);
  const mob = await skeletonState(mp);
  L.eq("SK móvil: una sola columna, como el tablero", mob?.columns, 1);
  L.check("SK móvil: con la barra de pestañas (no la cabecera de escritorio)", mob?.tabs && !mob?.header, JSON.stringify(mob));
  L.check("SK móvil: la columna ocupa el ancho y nada se sale de la pantalla", mob?.colWidth > 340 && mob?.overflow <= 0, JSON.stringify(mob));
  L.eq("SK móvil: «Cargando…» para el lector de pantalla", mob?.status, "Cargando…");
  await mp.screenshot({ path: `${SHOTS}/r51-esqueleto-movil.png` });
  await mp.emulateMedia({ colorScheme: "dark" });
  await mp.screenshot({ path: `${SHOTS}/r51-esqueleto-movil-oscuro.png` });
  await L.board(mp);
  await mp.unroute(isProjectPage);
  L.assertNoErrors("SK móvil", [m]);
  await m.ctx.close();
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [ID]);
}

// --- Icono de la app ------------------------------------------------------------------------------------------------
if (only.includes("icon")) {
  L.scenario("icon: icono de la app en el color de la instalación");
  const [orgBefore] = await L.q(`SELECT value FROM "AppState" WHERE key='instance.orgName'`);
  const manifest = async () => (await fetch(`${L.BASE}/manifest.webmanifest`)).json(); // sin cookies, como el navegador
  /** Color del píxel (12 % desde la izquierda, a media altura) de un icono, leído en el navegador. */
  const iconPixel = (page, url) => page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(Math.round(c.width * 0.12), Math.round(c.height / 2), 1, 1).data;
    return { size: `${c.width}x${c.height}`, color: "#" + [...d].slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("") };
  }, url);
  const head = (page) => page.evaluate(() => ({
    icons: [...document.querySelectorAll('link[rel="icon"]')].map((l) => l.getAttribute("href")),
    apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ?? null,
    appleTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content") ?? null,
    manifest: !!document.querySelector('link[rel="manifest"]'),
  }));

  await L.q(`DELETE FROM "AppState" WHERE key='instance.appIcon'`);
  const s = await L.session();
  const page = s.page;
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id=$1`, [me.id]);
  try {
    const before = await manifest();
    L.eq("ICON: sin elegir, el azul de siempre", [before.theme_color, before.icons?.[0]?.src?.replace(/\?.*/, "")], ["#4f46e5", "/app-icon/blue/icon-192.png"]);
    await page.goto(`${L.BASE}/admin/settings`);
    const section = page.locator("[data-app-icon-settings]");
    await section.waitFor({ timeout: 15000 });
    // El nombre bajo el icono es el de la organización: se cambia en «Instalación».
    await page.locator("#instance-org").fill("Casa r51");
    await page.locator("#instalacion").getByRole("button", { name: "Guardar" }).click();
    await page.getByText("Ajustes de la instalación guardados.").first().waitFor({ timeout: 8000 });
    L.eq("ICON: el azul aparece elegido", await section.locator("[role=radio][aria-checked=true]").getAttribute("data-app-icon"), "blue");
    await section.getByRole("radio", { name: "Verde bosque" }).click();
    await page.getByText("Color del icono guardado.").first().waitFor({ timeout: 8000 });
    L.eq("ICON: guardado al elegirlo", (await L.q(`SELECT value FROM "AppState" WHERE key='instance.appIcon'`))[0]?.value, "forest");
    await page.reload();
    await section.waitFor({ timeout: 15000 });
    L.eq("ICON: tras recargar sigue elegido", await section.locator("[role=radio][aria-checked=true]").getAttribute("data-app-icon"), "forest");
    L.check("ICON: dice el nombre que lleva debajo", (await section.innerText()).includes("«Casa r51»"));
    await section.screenshot({ path: `${SHOTS}/r51-icono-admin.png` });

    const m = await manifest();
    L.eq("ICON: el manifiesto (pedido sin sesión), con los iconos verdes", m.icons?.map((i) => [i.src.replace(/\?v=\w+$/, ""), i.purpose ?? "any"]), [
      ["/app-icon/forest/icon-192.png", "any"], ["/app-icon/forest/icon-512.png", "any"], ["/app-icon/forest/icon-maskable-512.png", "maskable"],
    ]);
    L.eq("ICON: color de la barra, nombre corto y nombre", [m.theme_color, m.short_name, m.name, m.id], ["#1f6b42", "Casa r51", "Casa r51 · Pizarro", "/"]);
    const h = await head(page);
    L.check("ICON: la pestaña usa el icono verde (SVG y PNG de 32)", h.icons.length === 2 && h.icons.every((u) => u.startsWith("/app-icon/forest/icon")), JSON.stringify(h));
    L.check("ICON: el apple-touch-icon (iPhone), también", /^\/app-icon\/forest\/apple-touch-icon\.png\?v=\w+$/.test(h.apple ?? ""), h.apple);
    L.eq("ICON: nombre en la pantalla de inicio del iPhone", h.appleTitle, "Casa r51");
    L.check("ICON: enlaza el manifiesto", h.manifest);
    for (const [file, size] of [["icon-192.png", "192x192"], ["icon-512.png", "512x512"], ["icon-maskable-512.png", "512x512"], ["apple-touch-icon.png", "180x180"], ["icon-32.png", "32x32"]]) {
      L.eq(`ICON: ${file} es verde y mide ${size}`, await iconPixel(page, `/app-icon/forest/${file}?v=1`), { size, color: "#1f6b42" });
    }
    const res = await fetch(`${L.BASE}${h.apple}`);
    L.check("ICON: se sirve sin sesión, como imagen y para siempre en caché", res.status === 200 && res.headers.get("content-type") === "image/png" && /immutable/.test(res.headers.get("cache-control") ?? "") && !res.headers.get("set-cookie"),
      JSON.stringify([res.status, res.headers.get("content-type"), res.headers.get("cache-control")]));
    L.eq("ICON: un tema que no existe, 404", (await fetch(`${L.BASE}/app-icon/rojo/icon-192.png`)).status, 404);
    // Sin sesión (pantalla de acceso): el mismo icono, porque es el de la instalación y no el de cada persona.
    const anon = await (await L.getBrowser()).newContext();
    const ap = await anon.newPage();
    await ap.goto(`${L.BASE}/login`);
    L.check("ICON: la pantalla de acceso, sin sesión, también con el icono verde", (await head(ap)).icons.every((u) => u.startsWith("/app-icon/forest/")));
    await anon.close();
    // Los seis temas, para revisarlos a ojo (redondeado, iPhone y maskable).
    const sheet = await s.ctx.newPage();
    await sheet.setContent(`<body style="margin:0;padding:12px;background:#e5e7eb;display:grid;grid-template-columns:repeat(9,96px);align-content:start;gap:12px">${
      ["blue", "forest", "sienna", "mustard", "mono", "eva"].flatMap((a) => ["icon-192.png", "apple-touch-icon.png", "icon-maskable-512.png"].map((f) => `<img src="${L.BASE}/app-icon/${a}/${f}?v=1" width="96" height="96">`)).join("")}</body>`);
    await sheet.waitForLoadState("networkidle");
    await sheet.screenshot({ path: `${SHOTS}/r51-iconos.png`, fullPage: true });
    await sheet.close();

    // Vuelta al azul: el manifiesto lo sigue al momento.
    await section.getByRole("radio", { name: "Azul" }).click();
    await page.getByText("Color del icono guardado.").first().waitFor({ timeout: 8000 });
    await L.eqEventually("ICON: de vuelta al azul", async () => (await manifest()).theme_color, "#4f46e5");
    L.assertNoErrors("ICON", [s]);
  } finally {
    await s.ctx.close();
    await L.q(`UPDATE "User" SET role='MEMBER' WHERE id=$1`, [me.id]);
    await L.q(`DELETE FROM "AppState" WHERE key='instance.appIcon'`);
    // El nombre de la organización vuelve a ser el de antes (las páginas lo ven en 30 s como mucho: caché de instance.ts).
    if (orgBefore) await L.q(`UPDATE "AppState" SET value=$1 WHERE key='instance.orgName'`, [orgBefore.value]);
    else await L.q(`DELETE FROM "AppState" WHERE key='instance.orgName'`);
  }
}

// --- HTML de Documentación sin <link> --------------------------------------------------------------------------------
if (only.includes("html")) {
  L.scenario("html: el HTML de Documentación pierde todos sus <link>");
  await createProject();
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "r51-html-"));
  const HTML = `<!doctype html><html><head><title>r51</title>
<link rel="dns-prefetch" href="//r51-dns.example.com">
<link rel="preconnect" href="https://r51-preconnect.example.com">
<link rel="prefetch" href="https://r51-prefetch.example.com/a.js">
<link rel="prerender" href="https://r51-prerender.example.com/">
<link rel="modulepreload" href="https://r51-module.example.com/m.js">
<link rel="preload" as="image" href="https://r51-preload.example.com/i.png">
<link rel="stylesheet" href="https://r51-css.example.com/s.css">
<link rel="icon" href="https://r51-icon.example.com/f.ico">
<LINK REL="DNS-PREFETCH" HREF="//r51-upper.example.com">
<style>h1{color:rgb(10,120,40)}</style></head>
<body><h1>Documento r51</h1><p>Texto con <a id="fuera" href="https://example.com/">un enlace</a>.</p>
<link rel="prefetch" href="https://r51-body.example.com/b.js">
<svg width="10" height="10"><link href="https://r51-svg.example.com/"/></svg></body></html>`;
  fs.writeFileSync(path.join(TMP, "enlaces.html"), HTML);
  const s = await L.session();
  const { page } = s;
  const outside = [];
  s.ctx.on("request", (r) => { if (/r51-[a-z]+\.example\.com/.test(r.url())) outside.push(r.url()); });
  await page.goto(`${L.BASE}/p/${ID}/docs`);
  await page.getByRole("heading", { name: /Documentación/ }).first().waitFor({ timeout: 15000 });
  await page.locator("input[type=file][aria-label='Subir archivos']").setInputFiles(path.join(TMP, "enlaces.html"));
  await L.waitFor(async () => (await L.q(`SELECT 1 FROM "ProjectDocument" WHERE "projectId"=$1`, [ID])).length === 1, { timeout: 15000 });
  const [doc] = await L.q(`SELECT id FROM "ProjectDocument" WHERE "projectId"=$1`, [ID]);
  await page.reload();
  await page.locator(`[data-doc-open="${doc.id}"]`).first().click();
  const viewer = U.dialog(page);
  const frameEl = viewer.locator("iframe[data-testid=doc-html]");
  await frameEl.waitFor({ timeout: 10000 });
  const frame = page.frameLocator("iframe[data-testid=doc-html]");
  L.check("HTML: el documento se ve (título y estilos propios)", await frame.getByRole("heading", { name: "Documento r51" }).waitFor({ timeout: 10000 }).then(() => true, () => false));
  L.eq("HTML: con su color", await frame.getByRole("heading", { name: "Documento r51" }).evaluate((h) => getComputedStyle(h).color), "rgb(10, 120, 40)");
  const srcdoc = await frameEl.getAttribute("srcdoc");
  L.check("HTML: ningún <link> en lo que se pinta (dns-prefetch, preconnect, prefetch, prerender, modulepreload, preload, hojas de estilo, icono; en mayúsculas, en el cuerpo y en un SVG)", !/<link\b/i.test(srcdoc), srcdoc);
  L.check("HTML: con la resolución anticipada de nombres desactivada", srcdoc.includes(`http-equiv="x-dns-prefetch-control" content="off"`));
  const child = await (await frameEl.elementHandle()).contentFrame();
  L.eq("HTML: dentro del marco no queda ningún <link>", child ? await child.evaluate(() => document.getElementsByTagName("link").length + document.getElementsByTagNameNS("http://www.w3.org/2000/svg", "link").length) : null, 0);
  L.eq("HTML: los enlaces normales siguen (aparte y sin acceso a la app)", [await frame.locator("#fuera").getAttribute("href"), await frame.locator("#fuera").getAttribute("rel")], ["https://example.com/", "noopener noreferrer"]);
  await sleep(1500);
  L.eq("HTML: ninguna petición a las direcciones de los <link>", outside, []);
  await page.screenshot({ path: `${SHOTS}/r51-html.png` });
  L.assertNoErrors("HTML", [{ ...s, errors: s.errors.filter((e) => !/Content Security Policy|Refused to/i.test(e)) }]);
  await s.ctx.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [ID]);
}

// --- Copias: hora con segundos en el aviso de reducción --------------------------------------------------------------
if (only.includes("backups")) {
  L.scenario("backups: el aviso de reducción dice la hora de cada copia con segundos");
  const envFile = path.join(APP_DIR, ".env");
  const fromEnvFile = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").match(/^UPLOAD_DIR=["']?([^"'\n]+)/m)?.[1] : null;
  const DIR = path.join(path.resolve(APP_DIR, process.env.UPLOAD_DIR || fromEnvFile || "uploads"), "backups");
  const STATUS = path.join(DIR, "status.json");
  const original = fs.existsSync(STATUS) ? fs.readFileSync(STATUS) : null;
  const GOOD = "pizarro-backup-20261113T093047Z";
  const A = "pizarro-backup-20261113T101502Z";
  const B = "pizarro-backup-20261113T101531Z"; // del mismo minuto que A: solo los segundos los distinguen
  const writeStatus = (stem) => {
    fs.mkdirSync(DIR, { recursive: true });
    const status = original ? JSON.parse(original.toString()) : {};
    status.lastBackup = { at: new Date().toISOString(), ok: true, file: `${stem}.sql.gz.enc`, bytes: 2048 };
    status.shrink = { what: "core", local: 3, remote: 400, stem, goodStem: GOOD, at: new Date().toISOString() };
    delete status.shrinkAccepted;
    fs.writeFileSync(STATUS, JSON.stringify(status, null, 2));
  };
  const s = await L.session();
  const { page } = s;
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id=$1`, [me.id]);
  try {
    await page.goto(`${L.BASE}/admin/backups`);
    await page.getByRole("heading", { name: "Copias de seguridad" }).first().waitFor({ timeout: 15000 });
    if (await page.getByText("Las copias de seguridad están desactivadas").first().isVisible().catch(() => false)) {
      L.note("BK: el servidor no tiene BACKUP_KEY: parte saltada (arráncalo con BACKUP_KEY y BACKUP_PAUSE=1)");
    } else {
      writeStatus(A);
      const notice = page.locator("[role=alert]").filter({ hasText: "La última copia es mucho menor" });
      // El aviso se guarda un minuto en memoria del servidor (lib/memo.ts): si se calculó antes, se espera a que caduque.
      const shown = !!(await L.waitFor(async () => { await page.reload(); return notice.isVisible().catch(() => false); }, { timeout: 70000, step: 3000 }));
      L.check("BK: sale el aviso de reducción", shown);
      const text = await notice.locator("[data-shrink-text]").innerText().catch(() => "");
      L.check("BK: la hora de la copia nueva y la de la última buena, con segundos", /:15:02\b/.test(text) && /:30:47\b/.test(text), text);
      L.eq("BK: y sus nombres", await notice.locator("[data-shrink-stems]").innerText().catch(() => ""), `Copia nueva: ${A} · Última copia buena: ${GOOD}`);
      // Llega otra copia (del mismo minuto) mientras se revisa: el servidor no confirma y el aviso dice cuál era y cuál es.
      await notice.getByRole("button", { name: "La reducción es correcta" }).click();
      writeStatus(B);
      await notice.getByRole("button", { name: "Sí, la reducción es correcta" }).click();
      L.check("BK: «Ha llegado una copia nueva: revisa el aviso otra vez.»", await page.getByText("Ha llegado una copia nueva: revisa el aviso otra vez.").first().waitFor({ timeout: 8000 }).then(() => true, () => false));
      const replaced = notice.locator("[data-shrink-replaced]");
      L.check("BK: el aviso dice que ahora es de otra copia", await replaced.waitFor({ timeout: 8000 }).then(() => true, () => false));
      const r = await replaced.innerText().catch(() => "");
      L.check("BK: con la hora de las dos, con segundos (la nueva y la que se veía)", /del .*:15:31\b.*del .*:15:02\b/.test(r), r);
      L.check("BK: el párrafo del aviso ya es el de la copia nueva", /:15:31\b/.test(await notice.locator("[data-shrink-text]").innerText()));
      L.check("BK: y su nombre", (await notice.locator("[data-shrink-stems]").innerText()).includes(B));
      await notice.screenshot({ path: `${SHOTS}/r51-copias-aviso.png` });
      // Ahora sí: se confirma la copia que se ve.
      await notice.getByRole("button", { name: "La reducción es correcta" }).click();
      await notice.getByRole("button", { name: "Sí, la reducción es correcta" }).click();
      L.check("BK: confirmada la copia nueva, el aviso desaparece", await notice.waitFor({ state: "detached", timeout: 8000 }).then(() => true, () => false));
      L.eq("BK: queda confirmada la copia que se veía", JSON.parse(fs.readFileSync(STATUS, "utf8")).shrinkAccepted, B);
    }
    L.assertNoErrors("BK", [s]);
  } finally {
    if (original) fs.writeFileSync(STATUS, original);
    else fs.rmSync(STATUS, { force: true });
    await s.ctx.close();
    await L.q(`UPDATE "User" SET role='MEMBER' WHERE id=$1`, [me.id]);
  }
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
