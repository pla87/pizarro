// Caza de bugs 48b: sin red o con el servidor caído la página no se cambia por la de error del navegador y lo escrito se
// conserva (aviso «Sin conexión» y «Conexión recuperada»); 8 pestañas por HTTP/1.1 (las ocultas cierran su canal en vivo);
// tarea abierta que otra persona borra o archiva (aviso con su nombre, «Copiar tu texto», no se reabre al deshacer);
// cerrar el detalle tras un guardado fallido del título pregunta; «Nueva tarea» con la columna borrada; ?task= se quita al
// cerrar y un enlace a una tarea que no está avisa; diálogos cargados aparte (Archivadas, Varias tareas, Generar release)
// y detalle, historial y archivadas abiertos sin red (esperan a la red, sin recargar la página); conflictos del texto
// campo a campo (título y descripción por separado); foco tras Escape en la descripción y nombre de los campos del
// detalle. Partes: PART=off,down,tabs,gone,title,col,url,lazy,detail,field,a11y. Misma base y servidor que
// board-e2e.mjs (por HTTP, sin TLS):
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh48b-e2e.mjs
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const only = (process.env.PART || "off,down,tabs,gone,title,col,url,lazy,detail,field,a11y").split(",");

await L.q(`DELETE FROM "Column" WHERE id='bh48b_col'`); // de una pasada anterior interrumpida
await L.prepareUsers();
await L.cleanBoard();
const p = await L.project();
const boardUrl = `${L.BASE}/p/${p.id}`;
const titleField = (page) => U.dialog(page).locator("textarea, input").first();
// Valor del título del detalle (null si no hay detalle: p. ej. la página se cambió por la de error del navegador).
const titleValue = (page) => titleField(page).inputValue({ timeout: 3000 }).catch(() => null);
const notices = (page) => page.locator("[role=alert], [data-connection]").allInnerTexts().catch(() => []);
const hasNotice = async (page, text) => (await notices(page)).some((x) => x.includes(text));
const inApp = (page) => !page.url().startsWith("chrome-error");

// --- Sin red: la página sigue, el título escrito se conserva (campo y borrador) y al volver se guarda ----------------
if (only.includes("off")) try {
  L.scenario("off: sin red");
  await L.cleanBoard();
  await L.seedTasks(L.COL.backlog, ["Sin red 1", "Sin red 2"]);
  const s = await L.session();
  const { page, ctx } = s;
  await U.openTask(page, "Sin red 1");
  await ctx.setOffline(true);
  await titleField(page).fill("Escrito sin red");
  await page.keyboard.press("Tab");
  await sleep(2000);
  L.check("OFF: la página no se cambia por la de error del navegador", inApp(page), page.url());
  L.eq("OFF: el título escrito sigue en el campo", await titleValue(page), "Escrito sin red");
  L.check("OFF: aviso «Sin conexión: no se ha guardado»", await hasNotice(page, "Sin conexión: no se ha guardado"));
  L.check("OFF: aviso fijo de sin conexión", await page.locator("[data-connection=offline]").isVisible().catch(() => false));
  // El borrador local guarda el título (se escribe al ocultar la página o cada 5 s).
  await sleep(5500);
  const draft = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("pz-draft-edit")).map(([, v]) => v).join("")).catch(() => "");
  L.check("OFF: el borrador local guarda el título", draft.includes("Escrito sin red"), draft.slice(0, 200));
  L.eq("OFF: en la base no ha cambiado", (await L.dbTask("Sin red 1"))?.title, "Sin red 1");
  // Mover una tarjeta sin red: vuelve a su sitio.
  await U.closeDialog(page).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(300);
  await ctx.setOffline(false);
  await L.waitFor(async () => (await page.locator("[data-connection=restored]").count()) > 0, { timeout: 15000 }).catch(() => {});
  L.check("OFF: «Conexión recuperada» al volver", await page.locator("[data-connection=restored]").isVisible().catch(() => false));
  L.check("OFF: el aviso fijo desaparece", !(await page.locator("[data-connection=offline]").count()));
  L.check("OFF: sigue en la app tras volver la red", inApp(page), page.url());
  L.assertNoErrors("OFF", [{ errors: s.errors.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/i.test(e)) }]);
  await ctx.close();
} catch (e) {
  L.check("OFF: el escenario termina sin excepción", false, String(e?.message ?? e).slice(0, 300));
}

// --- Servidor caído (la red sí está): acciones y refrescos no tiran la página ------------------------------------------
if (only.includes("down")) try {
  L.scenario("down: servidor caído");
  await L.cleanBoard();
  await L.seedTasks(L.COL.backlog, ["Caído 1", "Caído 2"]);
  const s = await L.session();
  const { page, ctx } = s;
  await U.openTask(page, "Caído 1");
  await ctx.route("**/*", (r) => r.abort("connectionrefused"));
  await titleField(page).fill("Escrito con el servidor caído");
  await page.keyboard.press("Tab");
  await sleep(1500);
  await page.keyboard.press("Alt+A"); // archivar: también falla
  await sleep(2500);
  L.check("DOWN: la página no se cambia por la de error del navegador", inApp(page), page.url());
  L.eq("DOWN: el título escrito sigue en el campo", await titleValue(page), "Escrito con el servidor caído");
  L.check("DOWN: aviso «Sin conexión: no se ha guardado» (no «Error inesperado»)", await hasNotice(page, "Sin conexión: no se ha guardado") && !(await hasNotice(page, "Error inesperado")));
  L.check("DOWN: aviso fijo de sin conexión", await page.locator("[data-connection=offline]").isVisible().catch(() => false));
  L.eq("DOWN: la tarea no se ha archivado", (await L.dbTask("Caído 1"))?.archivedAt ?? null, null);
  // Vuelve el servidor: el título se guarda al confirmar otra vez.
  await ctx.unroute("**/*");
  await L.waitFor(async () => (await page.locator("[data-connection=restored]").count()) > 0, { timeout: 40000 }).catch(() => {});
  L.check("DOWN: «Conexión recuperada»", await page.locator("[data-connection=restored]").count() > 0);
  await titleField(page).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Tab");
  await L.waitFor(async () => (await L.dbTask("Escrito con el servidor caído")) != null, { timeout: 8000 }).catch(() => {});
  L.check("DOWN: al volver se guarda", (await L.dbTask("Escrito con el servidor caído")) != null);
  L.check("DOWN: sigue en la app", inApp(page), page.url());
  await ctx.close();
} catch (e) {
  L.check("DOWN: el escenario termina sin excepción", false, String(e?.message ?? e).slice(0, 300));
}

// --- 8 pestañas por HTTP/1.1: las ocultas cierran su canal en vivo; todas cargan y guardan ------------------------------
// Chromium sin interfaz da todas las pestañas por visibles: se simula cuál está delante (document.visibilityState).
if (only.includes("tabs")) try {
  L.scenario("tabs: 8 pestañas por HTTP/1.1");
  await L.cleanBoard();
  await L.seedTasks(L.COL.backlog, ["Pestañas 1"]);
  const s = await L.session({
    init: () => {
      let hidden = false;
      Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
      Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => hidden });
      window.__pzSetHidden = (h) => {
        hidden = h;
        document.dispatchEvent(new Event("visibilitychange"));
      };
    },
  });
  const pages = [s.page];
  const front = async (pg) => {
    for (const other of pages) if (other !== pg) await other.evaluate(() => window.__pzSetHidden(true)).catch(() => {});
    await pg.evaluate(() => window.__pzSetHidden(false)).catch(() => {});
  };
  let allLoaded = true;
  for (let i = 1; i < 8; i++) {
    const pg = await s.ctx.newPage();
    // Al abrir otra pestaña, la anterior queda detrás (oculta).
    for (const other of pages) await other.evaluate(() => window.__pzSetHidden(true)).catch(() => {});
    pages.push(pg);
    const ok = await pg.goto(boardUrl, { timeout: 15000 }).then(() => pg.locator(`[aria-label="${L.COL.backlog}"]`).first().waitFor({ timeout: 15000 })).then(() => true, () => false);
    allLoaded &&= ok;
    L.check(`TABS: la pestaña ${i + 1} carga`, ok);
    if (!ok) break;
  }
  if (allLoaded) {
    const last = pages[7];
    await sleep(800);
    await U.openTask(last, "Pestañas 1");
    await titleField(last).fill("Pestañas guardada");
    await last.keyboard.press("Tab");
    await L.waitFor(async () => (await L.dbTask("Pestañas guardada")) != null, { timeout: 8000 }).catch(() => {});
    L.check("TABS: la octava guarda", (await L.dbTask("Pestañas guardada")) != null);
    await U.closeDialog(last);
    // La primera vuelve delante: reabre su canal y, como hubo cambios, se pone al día sola.
    await front(pages[0]);
    await L.waitFor(async () => (await L.cardLoc(pages[0], "Pestañas guardada").count()) > 0, { timeout: 10000 }).catch(() => {});
    L.check("TABS: la primera, al volver, muestra el cambio hecho en otra", (await L.cardLoc(pages[0], "Pestañas guardada").count()) > 0);
    // Con 7 ocultas, una pestaña nueva sigue cargando a la primera.
    const extra = await s.ctx.newPage();
    for (const other of pages) await other.evaluate(() => window.__pzSetHidden(true)).catch(() => {});
    const t0 = Date.now();
    const ok = await extra.goto(boardUrl, { timeout: 15000 }).then(() => extra.locator(`[aria-label="${L.COL.backlog}"]`).first().waitFor({ timeout: 15000 })).then(() => true, () => false);
    L.check("TABS: una novena pestaña también carga", ok, `${Date.now() - t0} ms`);
  }
  await s.ctx.close();
} catch (e) {
  L.check("TABS: el escenario termina sin excepción", false, String(e?.message ?? e).slice(0, 300));
}

// --- La tarea abierta la borra o archiva otra persona -----------------------------------------------------------------
if (only.includes("gone")) try {
  for (const [kind, button, verb] of [["borra", "Borrar", "borrado"], ["archiva", "Archivar", "archivado"]]) {
    L.scenario(`gone: otra persona ${kind} la tarea abierta`);
    await L.cleanBoard();
    await L.seedTasks(L.COL.backlog, ["Desaparece", "Otra"]);
    const a = await L.session();
    await a.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
    const b = await L.session({ email: L.USER2 });
    await U.openTask(a.page, "Desaparece");
    // A escribe un comentario y un título sin guardarlos (el título, con el foco aún en su campo).
    const comment = U.dialog(a.page).getByRole("textbox", { name: "Nuevo comentario" }).first();
    await comment.waitFor({ timeout: 5000 });
    await comment.fill("Comentario a medio escribir");
    await titleField(a.page).fill("Título a medio escribir");
    await sleep(300);
    await U.openTask(b.page, "Desaparece");
    await U.dialog(b.page).getByRole("button", { name: button, exact: true }).click();
    if (button === "Borrar") {
      await sleep(400);
      await b.page.getByRole("button", { name: "Borrar", exact: true }).last().click();
    }
    await L.waitFor(async () => (await a.page.locator("[role=dialog]").count()) === 0, { timeout: 10000 }).catch(() => {});
    L.eq(`GONE(${kind}): el detalle se cierra`, await a.page.locator("[role=dialog]").count(), 0);
    L.check(`GONE(${kind}): avisa de quién lo hizo`, await hasNotice(a.page, `Segunda Persona ha ${verb} esta tarea`), JSON.stringify(await notices(a.page)));
    const copy = a.page.getByRole("button", { name: "Copiar tu texto" });
    L.check(`GONE(${kind}): ofrece «Copiar tu texto»`, (await copy.count()) > 0);
    if (await copy.count()) {
      await copy.first().click();
      const clip = await a.page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
      L.check(`GONE(${kind}): copia el título sin guardar`, clip.includes("Título a medio escribir"), clip);
      L.check(`GONE(${kind}): y el comentario a medio escribir`, clip.includes("Comentario a medio escribir"), clip);
    }
    // B lo deshace: la tarea vuelve, pero el detalle de A no se abre solo.
    await b.page.keyboard.press("Escape").catch(() => {});
    await sleep(400);
    await b.page.keyboard.press("Alt+Z");
    await L.waitFor(async () => (await L.cardLoc(a.page, "Desaparece").count()) > 0, { timeout: 10000 }).catch(() => {});
    L.check(`GONE(${kind}): tras deshacer, la tarjeta vuelve`, (await L.cardLoc(a.page, "Desaparece").count()) > 0);
    await sleep(800);
    L.eq(`GONE(${kind}): y el detalle no se vuelve a abrir solo`, await a.page.locator("[role=dialog]").count(), 0);
    L.assertNoErrors(`GONE(${kind})`, [a, b]);
    await a.ctx.close();
    await b.ctx.close();
  }
} catch (e) {
  L.check("GONE: el escenario termina sin excepción", false, String(e?.message ?? e).slice(0, 300));
}

// --- Guardar el título falla (sesión caducada): cerrar pregunta ----------------------------------------------------------
if (only.includes("title")) try {
  L.scenario("title: cerrar tras un guardado fallido del título");
  await L.cleanBoard();
  await L.seedTasks(L.COL.backlog, ["Título guardado"]);
  const s = await L.session();
  const { page } = s;
  await U.openTask(page, "Título guardado");
  await L.q(`DELETE FROM "Session" WHERE "userId"=(SELECT id FROM "User" WHERE email=$1)`, [L.ADMIN]);
  await titleField(page).fill("Título que no se pudo guardar");
  await page.keyboard.press("Tab");
  await sleep(1500);
  await page.keyboard.press("Escape");
  const ask = page.getByRole("button", { name: "Seguir editando" });
  await ask.waitFor({ timeout: 5000 }).catch(() => {});
  L.check("TITLE: al cerrar pregunta antes de descartar", await ask.isVisible().catch(() => false));
  if (await ask.isVisible().catch(() => false)) {
    await ask.click();
    await sleep(500);
    L.eq("TITLE: «Seguir editando» deja el detalle abierto", await page.locator("[role=dialog]").count(), 1);
    L.eq("TITLE: con lo escrito", await titleField(page).inputValue(), "Título que no se pudo guardar");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Descartar cambios" }).click({ timeout: 5000 }).catch(() => {});
    await sleep(600);
    L.eq("TITLE: «Descartar cambios» lo cierra", await page.locator("[role=dialog]").count(), 0);
  }
  await s.ctx.close();
  // Con el guardado bueno, cerrar no pregunta (Escape guarda el título y cierra).
  const s2 = await L.session();
  await U.openTask(s2.page, "Título guardado");
  await titleField(s2.page).fill("Título guardado bien");
  await s2.page.keyboard.press("Escape");
  await sleep(1200);
  L.eq("TITLE: sin fallo, Escape guarda y cierra sin preguntar", await s2.page.locator("[role=dialog]").count(), 0);
  L.check("TITLE: y queda guardado", (await L.dbTask("Título guardado bien")) != null);
  L.assertNoErrors("TITLE", [s2]);
  await s2.ctx.close();
} catch (e) {
  L.check("TITLE: el escenario termina sin excepción", false, String(e?.message ?? e).slice(0, 300));
}

// --- «Nueva tarea» con una columna que otra persona borra ---------------------------------------------------------------
if (only.includes("col")) try {
  L.scenario("col: nueva tarea en una columna borrada");
  await L.cleanBoard();
  await L.q(`INSERT INTO "Column"(id,"projectId",name,position) VALUES ('bh48b_col',$1,'Temporal',99999)`, [p.id]);
  await L.seedTasks(L.COL.backlog, ["Columna 1"]);
  const a = await L.session();
  const b = await L.session({ email: L.USER2 });
  await a.page.keyboard.press("Alt+N");
  await U.dialog(a.page).waitFor();
  await U.dialog(a.page).locator("select").filter({ has: a.page.locator("option", { hasText: "Temporal" }) }).first().selectOption({ label: "Temporal" });
  await titleField(a.page).fill("Creada tras borrar la columna");
  await L.q(`DELETE FROM "Column" WHERE id='bh48b_col'`);
  // Un cambio de B avisa a A por el canal en vivo y su tablero se pone al día (ya sin la columna).
  await U.openTask(b.page, "Columna 1");
  await titleField(b.page).fill("Columna 1 bis");
  await b.page.keyboard.press("Tab");
  await L.waitFor(async () => hasNotice(a.page, "La columna elegida ya no existe"), { timeout: 10000 }).catch(() => {});
  L.check("COL: avisa de que la columna ya no existe", await hasNotice(a.page, "La columna elegida ya no existe. La tarea se creará en «Backlog»."), JSON.stringify(await notices(a.page)));
  await U.dialog(a.page).getByRole("button", { name: /^Crear/ }).last().click();
  await L.waitFor(async () => (await L.dbTask("Creada tras borrar la columna")) != null, { timeout: 8000 }).catch(() => {});
  const made = await L.dbTask("Creada tras borrar la columna");
  L.check("COL: la tarea se crea", made != null);
  L.eq("COL: en una columna que existe", made?.columnName, L.COL.backlog);
  L.assertNoErrors("COL", [a, b]);
  await a.ctx.close();
  await b.ctx.close();
} catch (e) {
  L.check("COL: el escenario termina sin excepción", false, String(e?.message ?? e).slice(0, 300));
}

// --- ?task=: se quita al cerrar; enlace a una tarea que no está ---------------------------------------------------------
if (only.includes("url")) try {
  L.scenario("url: enlaces ?task=");
  await L.cleanBoard();
  const [id] = await L.seedTasks(L.COL.backlog, ["Por enlace"]);
  const s = await L.session();
  const { page } = s;
  await page.goto(`${boardUrl}?task=${id}`);
  await U.dialog(page).waitFor();
  await sleep(500);
  await U.closeDialog(page);
  await sleep(600);
  L.check("URL: al cerrar se quita ?task=", !page.url().includes("task="), page.url());
  await page.reload();
  await L.board(page);
  await sleep(600);
  L.eq("URL: al recargar no se reabre", await page.locator("[role=dialog]").count(), 0);
  // Atrás tras cerrar: no vuelve a la dirección con ?task=.
  await page.goto(`${boardUrl}?task=${id}`);
  await U.dialog(page).waitFor();
  await sleep(500);
  await page.goBack();
  await sleep(800);
  L.eq("URL: cerrar con «atrás» también cierra", await page.locator("[role=dialog]").count(), 0);
  L.check("URL: y deja la dirección sin ?task=", !page.url().includes("task="), page.url());
  for (const [label, target] of [["inexistente", "noexiste0000000000000000"], ["archivada", id]]) {
    if (label === "archivada") await L.q(`UPDATE "Task" SET "archivedAt"=NOW() WHERE id=$1`, [id]);
    await page.goto(`${boardUrl}?task=${target}`);
    await L.board(page);
    await sleep(500);
    L.check(`URL: enlace a una tarea ${label}: avisa`, await hasNotice(page, "La tarea no existe, está archivada o no tienes acceso"), JSON.stringify(await notices(page)));
    L.check(`URL: enlace a una tarea ${label}: limpia la dirección`, !page.url().includes("task="), page.url());
    L.eq(`URL: enlace a una tarea ${label}: no abre nada`, await page.locator("[role=dialog]").count(), 0);
  }
  L.assertNoErrors("URL", [s]);
  await s.ctx.close();
} catch (e) {
  L.check("URL: el escenario termina sin excepción", false, String(e?.message ?? e).slice(0, 300));
}

// --- Diálogos cargados aparte sin red (Archivadas, Varias tareas, Generar release) -----------------------------------
// Su código llega en un fragmento aparte. Sin red, el fallo al pedirlo (ChunkLoadError) llegaba a la pantalla de error,
// que lo tomaba por una versión nueva y recargaba la página sin red: la de error del navegador. Ahora espera a la red y
// se abre al volver; y en reposo se precargan, así que con el tablero ya abierto se abren también sin red.
const openers = [
  ["Archivadas", (pg) => pg.getByRole("button", { name: "Archivadas" }).first().click()],
  ["Varias tareas", (pg) => pg.getByRole("button", { name: "Varias tareas" }).first().click()],
  ["Generar Release", (pg) => pg.getByRole("button", { name: "Generar Release" }).first().click()],
];
const dialogs = (pg) => pg.locator("[role=dialog]").count().catch(() => 0);
// Errores de red esperables con la red cortada (los de la consola); un rechazo sin atender (pageerror) sí cuenta.
const realErrors = (s) => ({ errors: s.errors.filter((e) => !(e.startsWith("console.error") && /ERR_INTERNET_DISCONNECTED|net::|Failed to load resource/i.test(e))) });
// Cuenta las peticiones de código (/_next/static) en curso y marca cuándo ha corrido la precarga en reposo del tablero.
const watchPreload = (page) => {
  const state = { inflight: 0 };
  const code = (r) => r.url().includes("/_next/static/");
  page.on("request", (r) => code(r) && state.inflight++);
  page.on("requestfinished", (r) => code(r) && state.inflight--);
  page.on("requestfailed", (r) => code(r) && state.inflight--);
  return state;
};
const idleSpy = () => {
  const ric = window.requestIdleCallback?.bind(window);
  if (ric) window.requestIdleCallback = (cb, o) => ric((d) => { try { cb(d); } finally { window.__pzIdle = (window.__pzIdle || 0) + 1; } }, o);
};
const preloaded = async (page, state) => {
  await L.waitFor(() => page.evaluate(() => (window.__pzIdle || 0) > 0), { timeout: 15000 });
  return L.waitFor(() => state.inflight === 0, { timeout: 15000 });
};

if (only.includes("lazy")) try {
  L.scenario("lazy: diálogos cargados aparte, sin red");
  await L.cleanBoard();
  await L.seedTasks(L.COL.next, ["Para la release"]);
  // 1) El tablero aún no ha precargado nada (el navegador nunca queda libre): sin red, abrir espera a la red.
  const s = await L.session({ init: () => { window.requestIdleCallback = () => 0; window.cancelIdleCallback = () => {}; } });
  const { page, ctx } = s;
  // Recargas de la página (la pantalla de error recargaba): no debe haber ninguna. Solo cuentan los documentos nuevos (los
  // cambios de dirección sin recargar, como ?archivadas, no).
  const navs = [];
  page.on("domcontentloaded", () => navs.push(page.url()));
  page.on("framenavigated", (f) => f === page.mainFrame() && !inApp(page) && navs.push(f.url()));
  let chunkFailed = 0;
  page.on("requestfailed", (r) => r.url().includes("/_next/static/") && chunkFailed++);
  for (const [name, open] of openers) {
    if (navs.length) break;
    await ctx.setOffline(true);
    const failedBefore = chunkFailed;
    await open(page);
    // Se espera a que falle la petición del fragmento (sin red), no un tiempo fijo.
    await L.waitFor(() => chunkFailed > failedBefore, { timeout: 8000 });
    L.check(`LAZY(${name}): sin red, el fragmento no llega`, chunkFailed > failedBefore);
    await L.waitFor(() => page.locator("[data-connection=offline]").isVisible(), { timeout: 8000 });
    L.check(`LAZY(${name}): aviso fijo de sin conexión`, await page.locator("[data-connection=offline]").isVisible().catch(() => false));
    await ctx.setOffline(false);
    await L.waitFor(async () => (await dialogs(page)) > 0, { timeout: 20000 });
    L.check(`LAZY(${name}): al volver la red se abre`, (await dialogs(page)) > 0);
    L.eq(`LAZY(${name}): la página no se ha recargado (ni cambiado por la de error del navegador)`, navs, []);
    L.check(`LAZY(${name}): ni ha salido «Algo ha fallado»`, !(await page.getByText("Algo ha fallado").count().catch(() => 1)));
    await page.keyboard.press("Escape").catch(() => {});
    await L.waitFor(async () => (await dialogs(page)) === 0, { timeout: 5000 });
  }
  L.assertNoErrors("LAZY", [realErrors(s)]);
  await ctx.close();
  // 2) Con el tablero ya abierto (precarga en reposo hecha), se abren sin red.
  const s2 = await L.session({ init: idleSpy });
  const state = watchPreload(s2.page);
  await L.reload(s2.page);
  L.check("LAZY: la precarga en reposo termina", await preloaded(s2.page, state));
  await s2.ctx.setOffline(true);
  for (const [name, open] of openers) {
    await open(s2.page);
    await L.waitFor(async () => (await dialogs(s2.page)) > 0, { timeout: 8000 });
    L.check(`LAZY(${name}): precargado, se abre sin red`, inApp(s2.page) && (await dialogs(s2.page)) > 0, s2.page.url());
    await s2.page.keyboard.press("Escape").catch(() => {});
    await L.waitFor(async () => (await dialogs(s2.page)) === 0, { timeout: 5000 });
  }
  await s2.ctx.setOffline(false);
  L.check("LAZY: sigue en la app", inApp(s2.page), s2.page.url());
  L.assertNoErrors("LAZY (precargado)", [realErrors(s2)]);
  await s2.ctx.close();
} catch (e) {
  L.check("LAZY: el escenario termina sin excepción", false, String(e?.message ?? e).slice(0, 300));
}

// --- Tarea abierta sin red: el detalle y el historial se cargan al volver; Archivadas también --------------------------
if (only.includes("detail")) try {
  L.scenario("detail: detalle abierto sin red");
  await L.cleanBoard();
  const [id] = await L.seedTasks(L.COL.backlog, ["Detalle sin red", "Otra tarea"]);
  await L.q(`UPDATE "Task" SET description='Descripción que llega al volver' WHERE id=$1`, [id]);
  const [arch] = await L.seedTasks(L.COL.backlog, ["Archivada sin red"]);
  await L.q(`UPDATE "Task" SET "archivedAt"=NOW(), "archivedFromColumnId"="columnId" WHERE id=$1`, [arch]);
  const s = await L.session({ init: idleSpy });
  const { page, ctx } = s;
  const state = watchPreload(page);
  await L.reload(page);
  await preloaded(page, state);
  await ctx.setOffline(true);
  await L.cardLoc(page, "Detalle sin red").click();
  await U.dialog(page).waitFor();
  await L.waitFor(() => page.locator("[data-connection=offline]").isVisible(), { timeout: 8000 });
  L.check("DETAIL: sin red, aviso fijo de sin conexión", await page.locator("[data-connection=offline]").isVisible().catch(() => false));
  await U.dialog(page).getByRole("button", { name: "Historial" }).click();
  await ctx.setOffline(false);
  await L.waitFor(async () => (await U.dialog(page).getByText("Descripción que llega al volver").count()) > 0, { timeout: 20000 });
  L.check("DETAIL: al volver la red se carga el detalle", (await U.dialog(page).getByText("Descripción que llega al volver").count()) > 0);
  await L.waitFor(async () => (await U.dialog(page).getByText("Aún no hay cambios registrados.").count()) > 0, { timeout: 10000 });
  L.check("DETAIL: y el historial (no se queda en «Cargando…»)", (await U.dialog(page).getByText("Aún no hay cambios registrados.").count()) > 0);
  await U.closeDialog(page);
  // Archivadas sin red: la lista llega al volver.
  await ctx.setOffline(true);
  await page.getByRole("button", { name: "Archivadas" }).first().click();
  await U.dialog(page).waitFor({ timeout: 8000 });
  await ctx.setOffline(false);
  await L.waitFor(async () => (await U.dialog(page).getByText("Archivada sin red").count()) > 0, { timeout: 20000 });
  L.check("DETAIL: Archivadas abierta sin red carga su lista al volver", (await U.dialog(page).getByText("Archivada sin red").count()) > 0);
  L.check("DETAIL: sigue en la app", inApp(page), page.url());
  L.assertNoErrors("DETAIL", [realErrors(s)]);
  await ctx.close();
} catch (e) {
  L.check("DETAIL: el escenario termina sin excepción", false, String(e?.message ?? e).slice(0, 300));
}

// --- Título y descripción, cada uno con su conflicto ----------------------------------------------------------------
// Otra persona cambia solo la descripción: guardar el título no es un conflicto (antes se rechazaba y se perdía), y el
// detalle abierto muestra la descripción nueva. Si cambió el mismo campo que se está editando, sí lo es.
if (only.includes("field")) try {
  L.scenario("field: conflictos por campo");
  await L.cleanBoard();
  const [fieldId] = await L.seedTasks(L.COL.backlog, ["Campo a campo"]);
  await L.q(`UPDATE "Task" SET description='Descripción inicial' WHERE id=$1`, [fieldId]);
  await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN' WHERE email IN ($1,$2)`, [L.ADMIN, L.USER2]);
  const a = await L.session();
  const b = await L.session({ email: L.USER2 });
  for (const x of [a, b]) {
    await L.liveOpen(x.page);
    await U.openTask(x.page, "Campo a campo");
    await U.dialog(x.page).getByText("Descripción inicial").first().waitFor({ timeout: 10000 });
  }
  const descBox = (pg) => U.dialog(pg).getByPlaceholder("Markdown · @persona · @docs / @sheets / @slides");
  const openDesc = async (pg, text) => {
    await U.dialog(pg).getByRole("button", { name: "Editar", exact: true }).click();
    await descBox(pg).waitFor();
    await descBox(pg).fill(text);
  };
  const saveDesc = (pg) => descBox(pg).press("Control+Enter");
  const row = async () => (await L.q(`SELECT title, description FROM "Task" WHERE id=$1`, [fieldId]))[0];
  const conflicts = (pg) => pg.getByText(/ha cambiado el texto de esta tarea/).count();
  // 1) B cambia la descripción; A, que no la estaba editando, la ve y guarda su título sin conflicto.
  await openDesc(b.page, "Descripción de B");
  await saveDesc(b.page);
  await L.eqEventually("FIELD: B guarda la descripción", async () => (await row()).description, "Descripción de B");
  await L.waitFor(async () => (await U.dialog(a.page).getByText("Descripción de B").count()) > 0, { timeout: 10000 });
  L.check("FIELD: A ve la descripción nueva de B sin recargar", (await U.dialog(a.page).getByText("Descripción de B").count()) > 0);
  await titleField(a.page).fill("Campo a campo (A)");
  await a.page.keyboard.press("Tab");
  await L.eqEventually("FIELD: el título de A se guarda (no es un conflicto)", row, { title: "Campo a campo (A)", description: "Descripción de B" });
  L.eq("FIELD: A no recibe aviso de conflicto", await conflicts(a.page), 0);
  // 2) A está escribiendo la descripción; B la cambia y guarda. A guarda antes su título: pasa (es otro campo)…
  await openDesc(a.page, "Borrador de A");
  await openDesc(b.page, "Descripción de B (2)");
  await saveDesc(b.page);
  await L.eqEventually("FIELD: B guarda otra vez la descripción", async () => (await row()).description, "Descripción de B (2)");
  await titleField(a.page).fill("Campo a campo (A2)");
  await titleField(a.page).evaluate((el) => el.blur());
  await L.eqEventually("FIELD: A guarda el título con la descripción en edición", async () => (await row()).title, "Campo a campo (A2)");
  L.eq("FIELD: sin aviso de conflicto", await conflicts(a.page), 0);
  // …pero su descripción sí choca con la de B: aviso y no la pisa.
  await saveDesc(a.page);
  await L.waitFor(async () => (await conflicts(a.page)) > 0, { timeout: 10000 });
  L.check("FIELD: guardar la descripción que cambió B avisa del conflicto", (await conflicts(a.page)) > 0);
  // El último en cambiar el texto fue A (su título), pero la descripción la cambió B: el aviso nombra a B.
  L.check("FIELD: el aviso dice quién cambió la descripción", (await a.page.getByText(/Segunda Persona ha cambiado el texto de esta tarea/).count()) > 0);
  L.eq("FIELD: y la descripción de B no se pierde", (await row()).description, "Descripción de B (2)");
  // 3) A escribe un título y B guarda otro a la vez: conflicto (el mismo campo).
  // Los dos parten del mismo título (B ya ve el de A).
  for (const x of [a, b]) await L.waitFor(async () => (await titleField(x.page).inputValue()) === "Campo a campo (A2)", { timeout: 10000 });
  await titleField(a.page).fill("Título de A");
  await titleField(b.page).fill("Título de B");
  await b.page.keyboard.press("Tab");
  await L.eqEventually("FIELD: B guarda su título", async () => (await row()).title, "Título de B");
  await L.waitFor(async () => (await L.cardLoc(a.page, "Título de B").count()) > 0, { timeout: 10000 });
  const before = await conflicts(a.page);
  await titleField(a.page).evaluate((el) => el.blur());
  await L.waitFor(async () => (await conflicts(a.page)) > before, { timeout: 10000 });
  L.check("FIELD: el mismo campo cambiado por otra persona sigue siendo un conflicto", (await conflicts(a.page)) > before);
  L.eq("FIELD: y el título de B no se pisa", (await row()).title, "Título de B");
  L.assertNoErrors("FIELD", [a, b]);
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG' WHERE email IN ($1,$2)`, [L.ADMIN, L.USER2]);
  await a.ctx.close();
  await b.ctx.close();
} catch (e) {
  L.check("FIELD: el escenario termina sin excepción", false, String(e?.message ?? e).slice(0, 300));
}

// --- Accesibilidad del detalle: foco tras Escape en la descripción y nombre de los campos laterales ---------------------
if (only.includes("a11y")) try {
  L.scenario("a11y: foco y nombres del detalle");
  await L.cleanBoard();
  await L.seedTasks(L.COL.backlog, ["Sin descripción", "Con descripción"]);
  await L.q(`UPDATE "Task" SET description='Texto de la descripción' WHERE title='Con descripción'`);
  const s = await L.session();
  const { page } = s;
  const focused = () => page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName ?? null, text: (el?.textContent ?? "").trim().slice(0, 40), inDialog: !!el?.closest("[role=dialog]") };
  });
  for (const [title, enter] of [["Sin descripción", "Añade una descripción…"], ["Con descripción", "Editar"]]) {
    await U.openTask(page, title);
    await U.dialog(page).getByRole("button", { name: enter, exact: true }).click();
    // El editor tiene el foco (no un botón).
    await L.waitFor(async () => { const f = await focused(); return f.inDialog && f.tag !== "BUTTON"; }, { timeout: 8000 });
    await page.keyboard.press("Escape");
    await L.waitFor(async () => (await focused()).tag === "BUTTON", { timeout: 3000 });
    const f = await focused();
    L.check(`A11Y(${title}): Escape sin cambios deja el foco en la descripción`, f.inDialog && f.tag === "BUTTON" && ["Editar", "Añade una descripción…"].includes(f.text), JSON.stringify(f));
    L.eq(`A11Y(${title}): y el detalle sigue abierto`, await page.locator("[role=dialog]").count(), 1);
    await U.closeDialog(page);
  }
  await U.openTask(page, "Con descripción");
  const snap = await U.dialog(page).ariaSnapshot();
  const comboLines = snap.split("\n").filter((l) => l.includes("combobox")).join(" | ");
  for (const name of ["Columna", "Asignada a (opcional)", "Repetir", "Entregable"]) {
    L.eq(`A11Y: el desplegable «${name}» tiene nombre`, await U.dialog(page).getByRole("combobox", { name, exact: true }).count(), 1);
  }
  L.eq("A11Y: la fecha límite tiene nombre", await U.dialog(page).getByLabel("Fecha límite", { exact: true }).count(), 1);
  L.check("A11Y: «Columna» no se anuncia con el nombre de la columna", !snap.includes(`combobox "${L.COL.backlog}"`), comboLines);
  // Árbol de accesibilidad de Chromium: ningún desplegable ni campo de texto del detalle sin nombre.
  const ax = await page.accessibility.snapshot({ root: await U.dialog(page).elementHandle(), interestingOnly: true });
  const flat = [];
  const walk = (n) => { if (!n) return; flat.push(n); (n.children ?? []).forEach(walk); };
  walk(ax);
  const unnamed = flat.filter((n) => ["combobox", "textbox", "Date"].includes(n.role) && !n.name);
  L.eq("A11Y: árbol de accesibilidad: ningún desplegable ni campo sin nombre", unnamed.map((n) => `${n.role}:${n.value ?? ""}`), []);
  L.assertNoErrors("A11Y", [s]);
  await s.ctx.close();
} catch (e) {
  L.check("A11Y: el escenario termina sin excepción", false, String(e?.message ?? e).slice(0, 300));
}

await L.closeBrowser();
await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
