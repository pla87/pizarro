// Tablero en vivo, filtros, móvil y capas (ronda 56): el canal en vivo manda un evento `ping` con nombre (la recarga de respaldo se espacia con el canal
// sano: reglas probadas en tests/focus-refresh.test.ts) y la presencia («quién está aquí» y «quién tiene abierta la tarea»)
// llega por él, sin sondeos, con dos personas a la vez; el panel de filtros no se mueve al marcar un tipo (el segundo clic
// sigue dentro); con un filtro o una búsqueda sin resultados las columnas dicen «Ninguna tarjeta coincide», el tablero
// avisa con «Limpiar filtros» y «Generar release» dice que incluye las tareas ocultas; en el móvil la lupa da el foco al
// campo al primer toque, la búsqueda salta a la columna con resultados, la columna nueva se muestra al crearla, se recuerda
// la última columna vista y las pestañas avisan de que hay más; los botones flotantes no tapan el diálogo de una tarea ni
// la vista previa de un documento; el asa táctil no mueve nada al hidratar (CLS), y una columna larga llega del servidor con
// solo sus 50 primeras tarjetas y las demás se pintan después sin salto; Alt+P abre el selector de proyectos
// con el foco en el buscador; la rueda sobre el detalle de una tarea no desplaza la columna de detrás; y axe no encuentra
// controles anidados ni nombres que no contienen el texto visible en las tarjetas y el panel de fijas, y el recuento de
// tarjetas se anuncia en un solo sitio. Además: con red lenta, abrir y cerrar una tarea deprisa no deja la burbuja
// fantasma (y reabrirla deprisa sigue mostrando la burbuja); una columna cuya única coincidencia es una fija del panel no dice «Ninguna tarjeta coincide»; y en el móvil un
// cambio de otra pestaña no saca de la columna elegida a mano con la búsqueda activa. Y las tarjetas sueltas: mover,
// editar o archivar una tarjeta desde otra sesión pide solo esa tarjeta (/board-tasks), sin recargar el tablero, y deja
// la selección y la búsqueda como estaban; renombrar una columna sí recarga el tablero entero.
// Misma base y servidor que tablero-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node tablero-vivo-e2e.mjs
//   # PART=ping,presencia,filtros,vacio,lupa,parche,movil,capas,cls,altp,rueda,axe
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep, COL } = L;
const only = (process.env.PART || "ping,presencia,filtros,vacio,lupa,parche,movil,capas,cls,altp,rueda,axe").split(",");
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const MOBILE = { viewport: { width: 390, height: 844 }, mobile: true };

await L.prepareUsers();
const p = await L.project();
const [admin] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const boardSearch = (page) => page.locator("input[aria-label='Filtrar tarjetas']:visible").first();
const activeTab = (page) => page.locator("[data-mobile-tabs] [data-active]").evaluate((e) => e.textContent.replace(/[\d/\s]+$/g, "").trim());

// --- Canal en vivo: `ping` con nombre, saludo con el id del canal y presencia completa al conectar ----------------------
if (only.includes("ping")) {
  L.scenario("ping: evento `ping` con nombre y presencia por el canal en vivo");
  await L.cleanBoard();
  const s = await L.session();
  const { page } = s;
  await L.liveOpen(page);
  const polls = [];
  page.on("request", (r) => { if (/\/presence\b|\/viewers\b/.test(r.url())) polls.push(r.url()); });
  const got = await page.evaluate((pid) => new Promise((resolve) => {
    const out = { hello: null, presence: null, ping: null };
    const es = new EventSource(`/api/projects/${pid}/events`);
    const done = () => { es.close(); resolve(out); };
    es.addEventListener("hello", (e) => { out.hello = JSON.parse(e.data); });
    es.addEventListener("presence", (e) => { out.presence ??= JSON.parse(e.data); });
    es.addEventListener("ping", (e) => { out.ping = e.data; done(); });
    setTimeout(done, 35000);
  }), p.id);
  L.check("PING: llega un evento `ping` (antes un comentario que el navegador no ve) en menos de 30 s", !!got.ping, JSON.stringify(got.ping));
  L.check("PING: el saludo lleva el id del canal", typeof got.hello?.stream === "string" && got.hello.stream.length === 36, JSON.stringify(got.hello));
  L.check("PING: estado completo de la presencia al conectar (con la propia persona)", got.presence?.users?.some((u) => u.id === admin.id), JSON.stringify(got.presence));
  L.eq("PING: con el canal abierto el tablero no sondea la presencia", polls, []);
  L.assertNoErrors("ping", [s]);
  await s.ctx.close();
}

// --- Presencia en vivo con dos personas ---------------------------------------------------------------------------------
if (only.includes("presencia")) {
  L.scenario("presencia: quién está y quién tiene abierta la tarea, al momento y sin sondeos");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Alfa r56", "Beta r56"]);
  const a = await L.session();
  await L.liveOpen(a.page);
  const polls = [];
  a.page.on("request", (r) => { if (/\/presence\b/.test(r.url()) || (/\/viewers\b/.test(r.url()) && !/stream=/.test(r.url()))) polls.push(r.url()); });
  const b = await L.session({ email: L.USER2 });
  await L.liveOpen(b.page);
  const heads = (page) => page.locator("[aria-label^='Activos en los últimos 5 minutos']:visible").first().getAttribute("aria-label").catch(() => "");
  await L.checkEventually("PRES: A ve a B en la cabecera en unos segundos (antes, hasta 20 s)", async () => { const h = await heads(a.page); return [/Segunda Persona/.test(h), h]; }, { timeout: 5000 });
  await U.openTask(b.page, "Alfa r56");
  // Los círculos van junto a la tarjeta (en su envoltorio), no dentro.
  const bubble = L.cardLoc(a.page, "Alfa r56").locator("xpath=..").locator("[title='Segunda Persona tiene abierta esta tarea']");
  await L.checkEventually("PRES: la tarjeta de A muestra que B tiene abierta la tarea", async () => (await bubble.count()) > 0, { timeout: 5000 });
  await U.openTask(a.page, "Alfa r56");
  await L.checkEventually("PRES: el detalle de A dice que B también la tiene abierta", () => U.dialog(a.page).getByText("Segunda Persona también tiene abierta esta tarea").isVisible(), { timeout: 5000 });
  await L.checkEventually("PRES: y el de B, que A también", () => U.dialog(b.page).getByText("Administrador también tiene abierta esta tarea").isVisible(), { timeout: 5000 });
  await b.page.keyboard.press("Escape");
  await L.checkEventually("PRES: B cierra la tarea y el aviso de A desaparece al momento (antes, hasta 45 s)", async () => !(await U.dialog(a.page).getByText("Segunda Persona también tiene abierta esta tarea").isVisible()), { timeout: 5000 });
  await a.page.keyboard.press("Escape");
  L.eq("PRES: A no ha sondeado la presencia ni repetido el aviso de la tarea", polls, []);
  // Red lenta: B abre y cierra la tarea antes de que llegue su anuncio. El cierre sale tras el anuncio (y en el servidor,
  // si llegara antes, gana): la tarjeta de A no se queda con la burbuja de B (antes, mientras durase el canal).
  await b.page.route(/\/viewers\?stream=/, async (r) => {
    if (r.request().method() === "GET") await sleep(1500);
    await r.continue().catch(() => {});
  });
  const beta = L.cardLoc(a.page, "Beta r56").locator("xpath=..").locator("[title='Segunda Persona tiene abierta esta tarea']");
  await U.openTask(b.page, "Beta r56");
  await b.page.keyboard.press("Escape");
  await sleep(3500);
  L.eq("PRES: con red lenta, abrir y cerrar deprisa no deja la burbuja fantasma en la tarjeta", await beta.count(), 0);
  // Cerrar y reabrir la misma tarea con el primer anuncio aún en vuelo: el cierre del primer diálogo no quita el
  // segundo (antes llegaban GET1, GET2 y DELETE1, y la tarea quedaba sin anunciar mientras durase el canal).
  await U.openTask(b.page, "Beta r56");
  await b.page.keyboard.press("Escape");
  await U.openTask(b.page, "Beta r56");
  await sleep(3500);
  L.eq("PRES: reabrir deprisa la misma tarea sigue mostrando la burbuja a la otra persona", await beta.count(), 1);
  await b.page.keyboard.press("Escape");
  await L.checkEventually("PRES: y al cerrarla de nuevo, la burbuja se va", async () => (await beta.count()) === 0, { timeout: 5000 });
  await b.page.unroute(/\/viewers\?stream=/);
  // Quien no es miembro del proyecto no recibe nada: el canal responde 404.
  await L.q(`DELETE FROM "ProjectMember" WHERE "projectId"=$1 AND "userId"='qa_user_2'`, [p.id]);
  const status = await b.page.evaluate((pid) => fetch(`/api/projects/${pid}/events`).then((r) => { const s = r.status; r.body?.cancel(); return s; }), p.id);
  L.eq("PRES: sin acceso al proyecto, el canal (y su presencia) no se abre", status, 404);
  b.errors.splice(0, b.errors.length, ...b.errors.filter((e) => !/status of 404/.test(e)));
  await L.prepareUsers();
  L.assertNoErrors("presencia", [a, b]);
  await a.ctx.close();
  await b.ctx.close();
}

// --- Panel de filtros: no se mueve al marcar un tipo -------------------------------------------------------------------
if (only.includes("filtros")) {
  L.scenario("filtros: el panel no se desplaza al activar un filtro");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Fallo r56"], { kindId: "kind_correccion" });
  await L.seedTasks(COL.backlog, ["Pregunta r56"], { kindId: "kind_respuesta" });
  await L.seedTasks(COL.backlog, ["Mejora r56"]);
  for (const width of [1500, 1100]) {
    const s = await L.session({ viewport: { width, height: 900 } });
    const { page } = s;
    await page.locator("button[aria-label^='Filtros']:visible").first().click();
    const chip = (name) => page.locator("button[aria-pressed]:visible", { hasText: new RegExp(`^${name}$`) }).first();
    await chip("Corrección").waitFor();
    const before = await chip("Corrección").boundingBox();
    await chip("Corrección").click();
    await sleep(300);
    const after = await chip("Corrección").boundingBox().catch(() => null);
    L.check(`FILT ${width}: el panel sigue en su sitio tras marcar un tipo`, after && Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1, JSON.stringify({ before, after }));
    await chip("Respuesta").click();
    await sleep(300);
    L.eq(`FILT ${width}: el segundo clic cae dentro del panel (marca el otro tipo)`, await chip("Respuesta").getAttribute("aria-pressed"), "true");
    L.check(`FILT ${width}: «Limpiar filtros» a la vista en la cabecera`, await page.getByRole("button", { name: "Limpiar filtros" }).first().isVisible());
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Limpiar filtros" }).first().click();
    L.assertNoErrors(`filtros ${width}`, [s]);
    await s.ctx.close();
  }
}

// --- Estado vacío al filtrar o buscar, y «Generar release» con un filtro --------------------------------------------------
if (only.includes("vacio")) {
  L.scenario("vacio: «Ninguna tarjeta coincide», aviso con «Limpiar filtros» y la release con filtro");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Alfa r56"]);
  await L.seedTasks(COL.next, ["Salto uno", "Salto dos", "Salto tres"]);
  const s = await L.session();
  const { page } = s;
  const backlog = L.colLoc(page, COL.backlog);
  L.check("VACIO: sin filtro, la columna vacía dice «Arrastra tarjetas aquí»", await L.colLoc(page, COL.doing).getByText("Arrastra tarjetas aquí").isVisible());
  await boardSearch(page).fill("zzz-nada");
  await L.checkEventually("VACIO: con la búsqueda sin resultados, «Ninguna tarjeta coincide»", () => backlog.getByText("Ninguna tarjeta coincide").isVisible());
  L.check("VACIO: y no «Arrastra tarjetas aquí»", !(await backlog.getByText("Arrastra tarjetas aquí").isVisible()));
  const notice = page.locator("[data-no-matches]");
  L.check("VACIO: aviso en el tablero sin ningún resultado", await notice.isVisible());
  await notice.getByRole("button", { name: "Limpiar filtros" }).click();
  await L.checkEventually("VACIO: «Limpiar filtros» del aviso quita la búsqueda", async () => (await boardSearch(page).inputValue()) === "" && (await notice.count()) === 0);
  L.check("VACIO: las tarjetas vuelven", await L.cardLoc(page, "Alfa r56").isVisible());
  await boardSearch(page).fill("Salto uno");
  await sleep(300);
  await L.colLoc(page, COL.next).getByRole("button", { name: "Generar release" }).click();
  const note = U.dialog(page).locator("[data-release-filter-note]");
  await L.checkEventually("RELEASE: con un filtro, el diálogo avisa de que incluye las ocultas", () => note.isVisible());
  L.check("RELEASE: dice cuántas", /2 tareas que el filtro oculta/.test(await note.textContent()), await note.textContent());
  await page.keyboard.press("Escape");
  await U.dialog(page).waitFor({ state: "detached" }).catch(() => {});
  await boardSearch(page).fill("");
  await sleep(300);
  await L.colLoc(page, COL.next).getByRole("button", { name: "Generar release" }).click();
  await U.dialog(page).waitFor();
  await sleep(400);
  L.eq("RELEASE: sin filtro, sin aviso", await note.count(), 0);
  await page.keyboard.press("Escape");
  // La única coincidencia de una columna es una tarea fija de su panel: no dice «Ninguna tarjeta coincide».
  const [fixed] = await L.seedTasks(COL.next, ["Fija r56"]);
  await L.q(`UPDATE "Task" SET evergreen=true WHERE id=$1`, [fixed]);
  await L.reload(page);
  await boardSearch(page).fill("Fija r56");
  await L.checkEventually("VACIO: la búsqueda se aplica (el backlog no tiene resultados)", () => backlog.getByText("Ninguna tarjeta coincide").isVisible());
  L.check("VACIO: la columna cuya única coincidencia es una fija del panel no dice «Ninguna tarjeta coincide»", !(await L.colLoc(page, COL.next).getByText("Ninguna tarjeta coincide").isVisible()));
  await boardSearch(page).fill("");
  L.assertNoErrors("vacio", [s]);
  await s.ctx.close();
}

// --- Móvil: la lupa da el foco al campo, y la búsqueda salta a la columna con resultados ---------------------------------
if (only.includes("lupa")) {
  L.scenario("lupa: foco al primer toque y salto a la columna con resultados (390 px)");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Alfa r56", "Beta r56"]);
  await L.seedTasks(COL.doing, ["Delta r56"]);
  const s = await L.session({ ...MOBILE, init: "try { localStorage.clear(); } catch {}" });
  const { page } = s;
  await L.liveOpen(page);
  L.eq("LUPA: se abre la primera columna con tarjetas", await activeTab(page), COL.backlog);
  await page.getByRole("button", { name: "Buscar" }).tap();
  L.eq("LUPA: el campo tiene el foco al primer toque", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Filtrar tarjetas");
  await page.keyboard.type("Delta");
  L.eq("LUPA: lo escrito queda en el campo", await boardSearch(page).inputValue(), "Delta");
  await L.eqEventually("LUPA: la columna a la vista sin resultados salta a la que los tiene", () => activeTab(page), COL.doing);
  L.check("LUPA: se ve la tarjeta encontrada", await L.cardLoc(page, "Delta r56").isVisible());
  await page.locator("[data-mobile-tabs] button", { hasText: /^Backlog/ }).tap();
  await sleep(300);
  L.check("LUPA: elegida a mano una columna sin resultados, se queda y dice «Ninguna tarjeta coincide»", (await activeTab(page)) === COL.backlog && (await L.colLoc(page, COL.backlog).getByText("Ninguna tarjeta coincide").isVisible()));
  // Un cambio de otra pestaña (o una recarga) no la saca de la columna elegida a mano: el salto es solo al cambiar la
  // búsqueda o los filtros (antes, matchingIds era un Set nuevo con cada cambio de las tareas).
  const other = await L.session();
  await L.liveOpen(other.page);
  // Un movimiento es un cambio de una tarjeta: el móvil pide solo esa (refresco en vivo de tarjetas sueltas).
  const refreshed = page.waitForResponse((r) => r.url().includes("/board-tasks?"), { timeout: 10000 }).then(() => true, () => false);
  await U.drag(other.page, "Beta r56", { column: COL.doing }, COL.backlog);
  await L.eqEventually("LUPA: la otra pestaña mueve una tarjeta", async () => (await L.dbTask("Beta r56"))?.columnName, COL.doing);
  L.check("LUPA: el móvil recibe el cambio (pide la tarjeta movida)", await refreshed);
  await sleep(1000);
  L.eq("LUPA: tras un cambio de otra pestaña sigue en la columna elegida a mano", await activeTab(page), COL.backlog);
  await other.ctx.close();
  await page.getByRole("button", { name: "Quitar el filtro" }).last().tap();
  L.assertNoErrors("lupa", [s]);
  await s.ctx.close();
}

// --- Tarjetas sueltas: lo de otra persona pide solo esas tarjetas; un cambio de estructura recarga el tablero -----------
if (only.includes("parche")) {
  L.scenario("parche: mover, editar y archivar desde otra sesión pide solo esas tarjetas; renombrar una columna recarga");
  await L.cleanBoard();
  const [idA, idB, idC] = await L.seedTasks(COL.backlog, ["Parche A", "Parche B", "Parche C"]);
  const s = await L.session({ viewport: { width: 1600, height: 950 } });
  const other = await L.session({ email: L.USER2, viewport: { width: 1600, height: 950 } });
  const { page } = s;
  await Promise.all([L.liveOpen(page), L.liveOpen(other.page)]);
  const full = [];
  const patches = [];
  page.on("request", (r) => {
    const h = r.headers();
    if (h.rsc === "1" && !h["next-router-prefetch"]) full.push(r.url());
    if (r.url().includes("/board-tasks?")) patches.push(new URL(r.url()).searchParams.get("ids"));
  });
  // Selección y búsqueda de esta pestaña: deben seguir igual tras los cambios de la otra.
  await L.cardLoc(page, "Parche A").locator('[aria-label="Seleccionar"]').click();
  await L.waitFor(() => L.cardLoc(page, "Parche A").getAttribute("aria-pressed").then((v) => v === "true"), { timeout: 3000 });
  await boardSearch(page).fill("Parche");
  await U.drag(other.page, "Parche B", { column: COL.doing }, COL.backlog);
  await L.eqEventually("PARCHE: la tarjeta que mueve la otra persona llega a «En progreso»", () => U.uiOrder(page, COL.doing), ["Parche B"], { timeout: 10000 });
  L.eq("PARCHE: sin recargar el tablero entero", full.length, 0);
  L.eq("PARCHE: pide solo la tarjeta movida", patches, [idB]);
  L.eq("PARCHE: la selección sigue", await L.cardLoc(page, "Parche A").getAttribute("aria-pressed"), "true");
  L.eq("PARCHE: y la búsqueda también", await boardSearch(page).inputValue(), "Parche");
  // Editar el título (detalle de la otra sesión) y archivar desde su barra de selección.
  await L.cardLoc(other.page, "Parche B").click();
  const title = U.dialog(other.page).getByRole("textbox", { name: "Título", exact: true });
  await title.fill("Parche B2");
  await title.press("Enter");
  await L.eqEventually("PARCHE: el título nuevo se guarda", async () => (await L.q(`SELECT title FROM "Task" WHERE id=$1`, [idB]))[0]?.title, "Parche B2");
  await U.closeDialog(other.page);
  await L.checkEventually("PARCHE: el título nuevo llega a esta pestaña", () => L.cardLoc(page, "Parche B2").isVisible(), { timeout: 10000 });
  await L.cardLoc(other.page, "Parche C").locator('[aria-label="Seleccionar"]').click();
  await other.page.locator("[data-selection-bar]").getByRole("button", { name: "Archivar" }).click();
  await L.eqEventually("PARCHE: la archivada desaparece de esta pestaña", () => U.uiOrder(page, COL.backlog), ["Parche A"], { timeout: 10000 });
  L.eq("PARCHE: todo sin recargar el tablero entero", full.length, 0);
  L.check("PARCHE: cada petición lleva solo las tarjetas cambiadas", patches.length >= 3 && patches.every((ids) => ids === idB || ids === idC), JSON.stringify(patches));
  L.eq("PARCHE: la seleccionada (no tocada) sigue seleccionada", await L.cardLoc(page, "Parche A").getAttribute("aria-pressed"), "true");
  // Un cambio de estructura (renombrar una columna) sí recarga el tablero entero.
  await L.colLoc(other.page, COL.closed).getByRole("button", { name: "Opciones de columna" }).click();
  await other.page.getByRole("menuitem", { name: "Renombrar" }).click();
  const rename = other.page.getByRole("dialog", { name: "Renombrar columna" });
  await rename.waitFor();
  await sleep(300);
  await rename.locator("input").fill("Cerrado parche");
  await rename.locator("input").press("Enter");
  await L.checkEventually("PARCHE: renombrar una columna recarga el tablero entero", () => full.length > 0, { timeout: 10000 });
  await L.checkEventually("PARCHE: y se ve el nombre nuevo", () => page.locator("section[aria-label='Cerrado parche']").first().isVisible());
  L.check("PARCHE: el id de A no se ha pedido nunca (no ha cambiado)", !patches.some((ids) => ids?.split(",").includes(idA)));
  await L.q(`UPDATE "Column" SET name=$1 WHERE name='Cerrado parche'`, [COL.closed]);
  await boardSearch(page).fill("");
  L.assertNoErrors("parche", [s, other]);
  await other.ctx.close();
  await s.ctx.close();
}

// --- Móvil: columna nueva a la vista, última columna recordada, pestañas con degradado ----------------------------------
if (only.includes("movil")) {
  L.scenario("movil: columna nueva, última columna vista y degradado en las pestañas (390 px)");
  await L.cleanBoard();
  await L.q(`DELETE FROM "Column" WHERE name='Nueva erre'`);
  await L.seedTasks(COL.doing, ["Delta r56"]);
  const s = await L.session({ ...MOBILE, init: "try { if (!sessionStorage.getItem('r56')) { localStorage.clear(); sessionStorage.setItem('r56', '1'); } } catch {}" });
  const { page } = s;
  await L.liveOpen(page);
  L.eq("MOVIL: sin columna recordada se abre la primera con tarjetas (no Backlog, vacía)", await activeTab(page), COL.doing);
  const wrap = page.locator("[data-mobile-tabs]").locator("xpath=..");
  L.check("MOVIL: degradado a la derecha (quedan pestañas)", await wrap.evaluate((e) => e.hasAttribute("data-more-right")));
  await page.locator("[data-mobile-tabs]").evaluate((e) => { e.scrollLeft = e.scrollWidth; });
  await L.checkEventually("MOVIL: al final, degradado a la izquierda y no a la derecha", () => wrap.evaluate((e) => e.hasAttribute("data-more-left") && !e.hasAttribute("data-more-right")));
  await page.getByRole("button", { name: "Añadir columna" }).last().tap();
  await U.dialog(page).locator("input").fill("Nueva erre");
  await U.dialog(page).getByRole("button", { name: "Añadir" }).tap();
  await L.eqEventually("MOVIL: la columna nueva se muestra al crearla", () => activeTab(page), "Nueva erre");
  await page.locator("[data-mobile-tabs] button", { hasText: /^Cerrado/ }).tap();
  await sleep(300);
  await L.reload(page);
  await L.eqEventually("MOVIL: al volver al tablero se abre la última columna vista", () => activeTab(page), COL.closed);
  L.assertNoErrors("movil", [s]);
  await s.ctx.close();
  await L.q(`DELETE FROM "Column" WHERE name='Nueva erre'`);
}

// --- Capas: los flotantes no tapan el diálogo de la tarea ni la vista previa de un documento -----------------------------
if (only.includes("capas")) {
  L.scenario("capas: botones flotantes y diálogos");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Alfa r56"]);
  const covered = (page) => page.evaluate(() => [...document.querySelectorAll("[role=dialog] button")].filter((b) => b.getClientRects().length).flatMap((b) => {
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top && !b.contains(top) && !top.closest("[role=dialog]") ? [`${b.textContent.trim() || b.getAttribute("aria-label")} <- ${(top.closest("button") || top).getAttribute("aria-label")}`] : [];
  }));
  for (const [label, opts] of [["390", MOBILE], ["900", { viewport: { width: 900, height: 800 }, mobile: true }]]) {
    const s = await L.session(opts);
    const { page } = s;
    await L.liveOpen(page);
    await L.cardLoc(page, "Alfa r56").tap();
    await U.dialog(page).waitFor();
    await sleep(500);
    L.eq(`CAPAS ${label}: con la tarea abierta no hay botones flotantes del tablero`, await page.locator("button[aria-label='Nueva tarea o captura']:visible").count(), 0);
    L.eq(`CAPAS ${label}: nada tapa los botones del diálogo`, await covered(page), []);
    // Ronda 65: la copia del botón de informar es solo de escritorio (con el menú cerrado no aparece flotando).
    L.eq(`CAPAS ${label}: sin copia flotante del botón de informar`, await page.locator("body > button[data-feedback-copy]").count(), 0);
    // Sin cambios, «Deshacer todo» cierra sin preguntar.
    await U.dialog(page).getByRole("button", { name: "Deshacer todo" }).tap();
    await U.dialog(page).waitFor({ state: "detached" });
    L.eq(`CAPAS ${label}: al cerrarla vuelven`, await page.locator("button[aria-label='Nueva tarea o captura']:visible").count(), 1);
    await s.ctx.close();
  }
  // Escritorio: deshacer y «Nueva tarea» siguen a mano por encima del fondo (motivo de setBoardModalOpen), sin tapar el diálogo.
  // Alta (ronda 65): con 900 px el panel de «Nueva tarea» de la pareja llega arriba y tapa el botón de la cabecera, y entonces
  // la copia no se pinta (useFloatingRect); con más alto queda libre, como en la pantalla del propietario.
  const d = await L.session({ viewport: { width: 1440, height: 1300 } });
  await U.openTask(d.page, "Alfa r56");
  await sleep(600);
  L.check("CAPAS escritorio: copia de «Nueva tarea» encima del fondo (abre otra al lado)", (await d.page.locator("button[aria-label='Abrir otra tarea nueva al lado']:visible").count()) >= 1);
  L.eq("CAPAS escritorio: nada tapa los botones del diálogo", await covered(d.page), []);
  // Las copias flotantes van fuera del `inert` del modal (data-pz-layer): se pueden pulsar sin cerrar la tarea.
  const floating = (name) => d.page.locator(`body > button[data-pz-layer][aria-label='${name}']`);
  const sel = U.dialog(d.page).locator("select").first();
  await sel.selectOption({ label: COL.doing });
  await L.eqEventually("CAPAS escritorio: la tarea cambia de columna desde el detalle", async () => (await L.dbTask("Alfa r56")).columnName, COL.doing);
  await floating("Deshacer la última acción en la tarea").click();
  await L.eqEventually("CAPAS escritorio: «Deshacer» flotante deshace con la tarea abierta", async () => (await L.dbTask("Alfa r56")).columnName, COL.backlog);
  L.eq("CAPAS escritorio: y el detalle sigue abierto", await d.page.locator("[role=dialog]").count(), 1);
  // Ronda 65: la copia lleva el mismo texto que el botón de la cabecera (antes, «Nueva» por su ancho).
  const headerNew = await d.page.locator("button[aria-label='Nueva tarea']:not([data-pz-layer])").first().innerText();
  L.eq("CAPAS escritorio: la copia dice lo mismo que el botón de la cabecera («Nueva tarea»)", [(await floating("Abrir otra tarea nueva al lado").innerText()).trim(), headerNew.trim()], ["Nueva tarea", "Nueva tarea"]);
  // Entera y encima de todo: opaca y es lo que hay en su centro (no la tapa ningún fondo).
  const onTop = (loc) => loc.evaluate((b) => {
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    let o = 1;
    for (let e = b; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return [o, !!top && b.contains(top), getComputedStyle(b).display !== "none"];
  });
  // Ronda 65: el botón de informar (pie del menú lateral) también se copia encima del fondo, como Deshacer.
  const bug = d.page.locator("body > button[data-feedback-copy]");
  if ((await d.page.locator("[data-feedback-button]").count()) === 0) L.note("CAPAS escritorio: build no oficial, sin botón de informar (compila con OFFICIAL_BUILD=1, ver interfaz-auditoria-e2e.mjs)");
  else {
    await L.eqEventually("CAPAS escritorio: copia del botón de informar encima del fondo, opaca y sin nada encima", () => bug.count().then((n) => (n === 1 ? onTop(bug) : n)), [1, true, true]);
    const orig = await d.page.locator("aside [data-feedback-button]").first().boundingBox();
    const copy = await bug.boundingBox();
    L.eq("CAPAS escritorio: en el mismo sitio que el del menú", [Math.round(copy.x), Math.round(copy.y)], [Math.round(orig.x), Math.round(orig.y)]);
    await bug.click();
    const fb = d.page.getByRole("dialog", { name: "Informar de un error o enviar una sugerencia" });
    await fb.waitFor({ timeout: 10000 });
    L.eq("CAPAS escritorio: pulsarla abre el informe sin cerrar la tarea", await d.page.locator("[role=dialog]").count(), 2);
    L.eq("CAPAS escritorio: con el informe abierto, sin copias flotantes visibles", await d.page.locator("body > button[data-pz-layer]:visible").count(), 0);
    await d.page.keyboard.press("Escape");
    await fb.waitFor({ state: "detached" });
    L.eq("CAPAS escritorio: al cerrar el informe sigue la tarea", await d.page.locator("[role=dialog]").count(), 1);
  }
  // Ronda 72: «Varias tareas» también tiene su copia encima del fondo, en su sitio y con el mismo texto; abre «Varias tareas» al lado.
  const bulkCopy = floating("Abrir «Varias tareas» al lado");
  await L.eqEventually("CAPAS escritorio: copia de «Varias tareas» encima del fondo, opaca y sin nada encima", () => bulkCopy.count().then((n) => (n === 1 ? onTop(bulkCopy) : n)), [1, true, true]);
  const bulkOrig = d.page.locator("button[aria-label='Varias tareas']:not([data-pz-layer])").first();
  L.eq("CAPAS escritorio: la copia de «Varias tareas» dice lo mismo que el botón de la cabecera", [(await bulkCopy.innerText()).trim(), (await bulkOrig.innerText()).trim()], ["Varias tareas", "Varias tareas"]);
  const [bo, bc] = [await bulkOrig.boundingBox(), await bulkCopy.boundingBox()];
  L.eq("CAPAS escritorio: y en el mismo sitio", [Math.round(bc.x), Math.round(bc.y)], [Math.round(bo.x), Math.round(bo.y)]);
  await bulkCopy.click();
  const bulkDlg = d.page.getByRole("dialog").filter({ hasText: "Crear varias tareas" });
  await bulkDlg.waitFor({ timeout: 10000 });
  L.eq("CAPAS escritorio: la copia de «Varias tareas» la abre al lado, con la tarea aún abierta", await d.page.locator("[role=dialog]").count(), 2);
  await bulkDlg.getByRole("button", { name: "Cancelar" }).click();
  await bulkDlg.waitFor({ state: "detached" });
  L.eq("CAPAS escritorio: al cancelarla sigue la tarea", await d.page.locator("[role=dialog]").count(), 1);
  await floating("Abrir otra tarea nueva al lado").click();
  await L.eqEventually("CAPAS escritorio: la copia de «Nueva tarea» abre la segunda al lado", () => d.page.locator("[role=dialog]").count(), 2);
  L.check("CAPAS escritorio: con la tarea aún abierta", await d.page.locator("[role=dialog]", { hasText: "Nueva tarea" }).count() === 1);
  await sleep(400);
  L.eq("CAPAS escritorio: con la pareja abierta, la copia de «Nueva tarea» sigue diciendo «Nueva tarea»", (await floating("Abrir otra tarea nueva al lado").innerText()).trim(), "Nueva tarea");
  L.eq("CAPAS escritorio: y se ve entera (opaca y sin nada encima)", await onTop(floating("Abrir otra tarea nueva al lado")), [1, true, true]);
  L.eq("CAPAS escritorio: con la pareja abierta, la copia de «Varias tareas» no abre una tercera y dice por qué", [await bulkCopy.getAttribute("aria-disabled"), await bulkCopy.getAttribute("title")], ["true", "Ya hay dos tareas abiertas"]);
  // force: Playwright no pulsa lo que lleva aria-disabled; aquí se comprueba justo que no hace nada.
  await bulkCopy.click({ force: true });
  await sleep(300);
  L.eq("CAPAS escritorio: pulsarla no abre nada", await d.page.locator("[role=dialog]").count(), 2);
  // Una confirmación centrada encima (ronda 64) sí las oculta; al volver, otra vez enteras.
  const second = d.page.locator("[role=dialog]", { hasText: "Nueva tarea" });
  await second.locator("input").first().fill("Borrador r65");
  await second.getByRole("button", { name: /^Cerrar$/ }).first().click();
  const ask = d.page.getByRole("dialog").filter({ hasText: "Descartar la nueva tarea" });
  await ask.waitFor({ timeout: 5000 });
  L.eq("CAPAS escritorio: con la confirmación de descartar encima, sin copias flotantes visibles", await d.page.locator("body > button[data-pz-layer]:visible").count(), 0);
  await ask.getByRole("button", { name: "Cancelar" }).click();
  await ask.waitFor({ state: "detached" });
  L.eq("CAPAS escritorio: al cancelar, la copia vuelve entera", await onTop(floating("Abrir otra tarea nueva al lado")), [1, true, true]);
  L.assertNoErrors("capas escritorio", [d]);
  await d.ctx.close();
  // Documentación en el móvil: «Nueva tarea» y «Varias tareas» van en el pie de la hoja, no flotando sobre la vista previa.
  const file = path.join(os.tmpdir(), "nota-r56.md");
  fs.writeFileSync(file, Array.from({ length: 80 }, (_, i) => `Línea ${i + 1} de la nota.`).join("\n\n"));
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1 AND name='nota-r56.md'`, [p.id]);
  const m = await L.session(MOBILE);
  await m.page.goto(`${L.BASE}/p/${p.id}/docs`);
  await m.page.getByRole("heading", { name: /Documentación/ }).first().waitFor({ timeout: 15000 });
  await m.page.locator("input[type=file][aria-label='Subir archivos']").setInputFiles(file);
  await L.waitFor(async () => (await L.q(`SELECT 1 FROM "ProjectDocument" WHERE "projectId"=$1 AND name='nota-r56.md'`, [p.id])).length === 1, { timeout: 15000 });
  await m.page.reload();
  const [doc] = await L.q(`SELECT id FROM "ProjectDocument" WHERE "projectId"=$1 AND name='nota-r56.md'`, [p.id]);
  await m.page.locator(`[data-doc-open="${doc.id}"]`).first().tap();
  await U.dialog(m.page).waitFor();
  await sleep(800);
  const docBtns = await U.dialog(m.page).locator("button[aria-label='Nueva tarea o captura'], button[aria-label='Crear varias tareas']").evaluateAll((bs) => bs.filter((b) => b.getClientRects().length).map((b) => getComputedStyle(b).position));
  L.check("CAPAS docs: «Nueva tarea» y «Varias tareas» en la hoja, sin flotar sobre la vista previa", docBtns.length === 2 && docBtns.every((x) => x !== "fixed"), JSON.stringify(docBtns));
  await U.dialog(m.page).locator("button[aria-label='Nueva tarea o captura']").tap();
  await L.checkEventually("CAPAS docs: y siguen abriendo «Nueva tarea»", () => m.page.getByText("Crear tarea").first().isVisible());
  L.assertNoErrors("capas", [m]);
  await m.ctx.close();
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1 AND name='nota-r56.md'`, [p.id]);
}

// --- CLS en el móvil: el asa táctil tiene su hueco desde el primer pintado ------------------------------------------------
if (only.includes("cls")) {
  L.scenario("cls: el asa de arrastre no mueve las tarjetas al hidratar (390 px, táctil)");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, Array.from({ length: 8 }, (_, i) => `Tarjeta con un título bastante largo para ocupar dos líneas ${i + 1}`));
  const s = await L.session({ ...MOBILE, init: "window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}" });
  const { page } = s;
  await L.goto(page, `${L.BASE}/p/${p.id}`);
  await L.liveOpen(page);
  await sleep(2500);
  const cls = await page.evaluate(() => window.__cls);
  L.note("CLS medido al cargar el tablero", String(cls));
  L.check("CLS: menos de 0,02 al cargar el tablero (antes ~0,1)", cls < 0.02, String(cls));
  const handles = await page.locator("[data-task-card] [aria-label='Arrastrar para reordenar']:visible").count();
  L.check("CLS: el asa sigue a la vista en táctil", handles > 0, String(handles));
  await s.ctx.close();
  const d = await L.session();
  L.eq("CLS: en escritorio (ratón) el asa no se ve", await d.page.locator("[data-task-card] [aria-label='Arrastrar para reordenar']:visible").count(), 0);
  await d.ctx.close();

  // Columna larga: el servidor pinta solo las primeras 50 tarjetas; el resto llega después de hidratar, sin salto, y la
  // búsqueda, el recuento y «Seleccionar todas» cuentan con todas.
  await L.cleanBoard();
  const LONG = 180;
  await L.seedTasks(COL.backlog, Array.from({ length: LONG }, (_, i) => `Larga ${i + 1} con un título que ocupa dos líneas en el móvil`));
  const m = await L.session({ ...MOBILE, init: "window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}" });
  const html = await (await m.page.request.get(`${L.BASE}/p/${p.id}`)).text();
  const served = (html.match(/data-task-card="/g) ?? []).length;
  L.check("CLS: el HTML del servidor lleva como mucho 50 tarjetas de la columna larga", served > 0 && served <= 50, String(served));
  L.check("CLS: con el hueco reservado para las demás", html.includes("data-cards-pending"));
  await L.goto(m.page, `${L.BASE}/p/${p.id}`);
  await L.liveOpen(m.page);
  await L.eqEventually("CLS: después de hidratar se pintan todas", () => L.colLoc(m.page, COL.backlog).locator("[data-task-card]").count(), LONG, { timeout: 10000 });
  L.eq("CLS: ya sin hueco", await m.page.locator("[data-cards-pending]").count(), 0);
  await sleep(500);
  const clsLong = await m.page.evaluate(() => window.__cls);
  L.note("CLS medido con una columna de 180 tarjetas", String(clsLong));
  L.check("CLS: menos de 0,02 también con la columna larga", clsLong < 0.02, String(clsLong));
  L.check("CLS: el recuento de la columna cuenta todas", (await L.colLoc(m.page, COL.backlog).locator("header").innerText()).includes(String(LONG)));
  await m.ctx.close();
  const w = await L.session();
  await boardSearch(w.page).fill(`Larga ${LONG} `);
  await L.checkEventually("CLS: la búsqueda encuentra una tarjeta del final de la columna", () => L.cardLoc(w.page, `Larga ${LONG} con un título que ocupa dos líneas en el móvil`).isVisible());
  await boardSearch(w.page).fill("");
  L.assertNoErrors("cls larga", [w]);
  await w.ctx.close();
  await L.cleanBoard();
}

// --- Alt+P con el foco en el buscador ------------------------------------------------------------------------------------
if (only.includes("altp")) {
  L.scenario("altp: Alt+P abre el selector de proyectos desde el buscador");
  const s = await L.session();
  const { page } = s;
  await boardSearch(page).click();
  await page.keyboard.press("Alt+KeyP");
  await L.checkEventually("ALTP: se abre el selector de proyectos", () => page.locator("[role=menu]:visible").first().isVisible().catch(() => false), { timeout: 3000 });
  L.eq("ALTP: el buscador no recibe la letra", await boardSearch(page).inputValue(), "");
  // Ronda 57: en escritorio la cabecera del tablero ya no tiene selector; abre el de la barra lateral (uno solo).
  L.eq("ALTP: abre el selector de la barra lateral", [await page.locator("[role=menu]:visible").count(), await page.locator("[role=menu]:visible").first().getAttribute("aria-label")], [1, "Selecciona proyecto"]);
  await page.keyboard.press("Escape");
  L.assertNoErrors("altp", [s]);
  await s.ctx.close();
}

// --- La rueda sobre el detalle de una tarea no desplaza la columna de detrás ------------------------------------------------
if (only.includes("rueda")) {
  L.scenario("rueda: el scroll del detalle no se escapa a la columna");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, Array.from({ length: 40 }, (_, i) => `Rueda ${i + 1}`));
  const s = await L.session({ viewport: { width: 1280, height: 720 } });
  const { page } = s;
  await U.openTask(page, "Rueda 2");
  const list = L.colLoc(page, COL.backlog).locator("[data-card-list]");
  const box = await U.dialog(page).boundingBox();
  for (const [x, y] of [[box.x + 30, box.y + 20], [box.x + box.width * 0.3, box.y + box.height * 0.6], [box.x + box.width * 0.8, box.y + box.height * 0.5], [box.x + box.width * 0.8, box.y + box.height - 20]]) {
    await page.mouse.move(x, y);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 500); await sleep(120); }
  }
  await sleep(300);
  L.eq("RUEDA: la columna de detrás sigue arriba", await list.evaluate((e) => e.scrollTop), 0);
  await page.keyboard.press("Escape");
  L.assertNoErrors("rueda", [s]);
  await s.ctx.close();
}

// --- axe: tarjetas (seleccionada), panel de fijas con su cadencia y recuento anunciado una sola vez ------------------------
if (only.includes("axe")) {
  L.scenario("axe: tarjetas y panel de fijas sin controles anidados; recuento en un solo aviso");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Alfa r56", "Beta r56"]);
  const ids = await L.seedTasks(COL.next, ["Fija r56", "Otra fija r56"]);
  await L.q(`UPDATE "Task" SET evergreen=true, "evergreenEvery"=2 WHERE id=$1`, [ids[0]]);
  await L.q(`UPDATE "Task" SET evergreen=true WHERE id=$1`, [ids[1]]);
  const rules = ["nested-interactive", "label-content-name-mismatch", "aria-hidden-focus", "button-name"];
  for (const [label, opts] of [["escritorio", {}], ["390", MOBILE]]) {
    const s = await L.session({ ...opts, init: `try { localStorage.setItem("pizarro:evergreen-open:${p.id}", "1"); } catch {}` });
    const { page } = s;
    if (label === "390") await page.locator("[data-mobile-tabs] button", { hasText: /^Siguiente/ }).tap();
    await L.colLoc(page, COL.next).locator("[data-testid=evergreen-every]").first().waitFor();
    if (label === "390") await page.locator("[data-mobile-tabs] button", { hasText: /^Backlog/ }).tap();
    await L.cardLoc(page, "Alfa r56").locator("[aria-label='Seleccionar']").click();
    if (label === "390") await page.locator("[data-mobile-tabs] button", { hasText: /^Siguiente/ }).tap();
    await page.addScriptTag({ content: AXE });
    // label-content-name-mismatch solo en el panel de fijas: la tarjeta se llama como su título a propósito (tipo, fecha,
    // etiquetas… van en su descripción), y esa regla de axe (experimental) pide todo el texto visible en el nombre.
    const found = await page.evaluate(async ([values, colName]) => {
      const main = document.querySelector("main") ?? document;
      const panel = document.querySelector(`[aria-label="${colName}"] [id^=evergreen-]`);
      const a = await window.axe.run(main, { runOnly: { type: "rule", values: values.filter((v) => v !== "label-content-name-mismatch") } });
      const b = panel ? await window.axe.run(panel, { runOnly: { type: "rule", values: ["label-content-name-mismatch"] } }) : { violations: [{ id: "sin panel", nodes: [] }] };
      return [...a.violations, ...b.violations].map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
    }, [rules, COL.next]);
    L.eq(`AXE ${label}: sin ${rules.join(", ")} (esta, en el panel de fijas)`, found, []);
    const chip = L.colLoc(page, COL.next).locator("[data-testid=evergreen-every]").first();
    L.check(`AXE ${label}: el nombre de la cadencia empieza por lo que se ve`, /^Cada dos: incluir cada dos releases$/.test(await chip.getAttribute("aria-label")), await chip.getAttribute("aria-label"));
    const live = await page.locator("[aria-live]").evaluateAll((els) => els.filter((e) => /tarjetas|\bde\b/.test(e.textContent)).length);
    L.eq(`AXE ${label}: el recuento de tarjetas se anuncia en un solo sitio`, live, 1);
    await page.locator("[data-selected]").first().click().catch(() => {});
    L.assertNoErrors(`axe ${label}`, [s]);
    await s.ctx.close();
  }
}

await L.closeBrowser();
await L.closeDb();
const failedChecks = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failedChecks.length}/${L.results.length} OK`);
for (const f of failedChecks) console.log("FAIL", f.name, f.detail);
process.exitCode = failedChecks.length ? 1 : 0;
