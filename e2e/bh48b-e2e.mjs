// Caza de bugs 48b: sin red o con el servidor caído la página no se cambia por la de error del navegador y lo escrito se
// conserva (aviso «Sin conexión» y «Conexión recuperada»); 8 pestañas por HTTP/1.1 (las ocultas cierran su canal en vivo);
// tarea abierta que otra persona borra o archiva (aviso con su nombre, «Copiar tu texto», no se reabre al deshacer);
// cerrar el detalle tras un guardado fallido del título pregunta; «Nueva tarea» con la columna borrada; ?task= se quita al
// cerrar y un enlace a una tarea que no está avisa. Misma base y servidor que board-e2e.mjs (por HTTP, sin TLS):
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh48b-e2e.mjs
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const only = (process.env.PART || "off,down,tabs,gone,title,col,url").split(",");

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

await L.closeBrowser();
await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
