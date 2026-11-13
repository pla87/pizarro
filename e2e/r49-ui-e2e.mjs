// Ronda 49 (interfaz): indicador de carga de las páginas de proyecto (el contorno del logo, solo si la carga pasa de
// ~200 ms, con «Cargando…» para el lector de pantalla y quieto con movimiento reducido) y la pestaña «Adjuntos y
// límites» de Ajustes del proyecto (botones de limpieza desactivados y tarjeta atenuada cuando no harían nada; notas «i»).
// Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r49-ui-e2e.mjs      # PART=load,storage
import os from "node:os";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "load,storage").split(",");
const ID = "r49ui_proj";

await L.q(`DELETE FROM "Project" WHERE id=$1`, [ID]); // de una pasada anterior interrumpida
await L.prepareUsers();
await L.cleanBoard();
const [admin] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);

/** Proyecto privado propio (lo gestiona su miembro sin ser administrador) con una columna Backlog. */
async function createProject() {
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId","updatedAt",position) VALUES ($1,'R49 carga',true,$2,NOW(),999)`, [ID, admin.id]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [ID, admin.id]);
  await L.q(`INSERT INTO "Column"(id,"projectId",name,position) VALUES ('r49ui_c1',$1,'Backlog',1),('r49ui_c2',$1,'Hecho',2)`, [ID]);
}

/** Respuestas lentas (solo la navegación, no la precarga) para las páginas del proyecto de la prueba. */
const isProjectPage = (u) => u.pathname.startsWith(`/p/${ID}`);
const slowNav = (ms) => async (route) => {
  const h = route.request().headers();
  if (h.rsc && !h["next-router-prefetch"]) await sleep(ms);
  await route.continue().catch(() => {}); // ya resuelta al quitar la ruta
};

/**
 * Navegación lenta a `link`: primero deja que el enlace se precargue (como al pasar el ratón o al verse en pantalla; la
 * precarga trae el loading.tsx) y después retrasa `ms` la respuesta de la navegación. Así se simula un servidor que
 * tarda en tener los datos: sin precarga, Next espera a la respuesta entera y no hay nada que enseñar mientras.
 */
async function slowClick(page, link, ms) {
  const prefetched = page.waitForResponse((r) => isProjectPage(new URL(r.url())) && !!r.request().headers()["next-router-prefetch"], { timeout: 4000 }).catch(() => null);
  await link.hover();
  await prefetched;
  await sleep(300);
  await page.evaluate(() => { window.__r49.seen = null; window.__r49.said = null; window.__r49.gone = null; });
  await page.route(isProjectPage, slowNav(ms));
  await link.click();
}

/**
 * Vigía en la página: cuándo aparece el indicador de carga y cuándo su región viva dice «Cargando…» (milisegundos
 * desde que aparece), y si el contenido o la barra lateral se mueven mientras está.
 */
const watcher = () => {
  const state = { seen: null, said: null, gone: null };
  window.__r49 = state;
  const look = () => {
    const el = document.querySelector("[data-project-loading]");
    if (el && state.seen === null) state.seen = performance.now();
    if (el && state.said === null && el.querySelector("[role=status]")?.textContent === "Cargando…") state.said = performance.now() - state.seen;
    if (!el && state.seen !== null && state.gone === null) state.gone = performance.now();
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true });
};

// --- Indicador de carga ---------------------------------------------------------------------------------------------
if (only.includes("load")) {
  L.scenario("load: indicador de carga al cambiar de proyecto");
  const s = await L.session({ viewport: { width: 1400, height: 900 }, init: watcher });
  const page = s.page;
  await createProject();
  await L.reload(page); // el nuevo proyecto en el selector
  const sidebar = page.locator("aside").first();
  const sideBox = await sidebar.boundingBox();
  await sidebar.locator("button[aria-haspopup=menu]").first().click(); // selector de proyecto
  await slowClick(page, page.getByRole("menuitem", { name: /R49 carga/ }), 3000);
  const loader = page.locator("[data-project-loading]");
  L.check("LOAD: al cambiar de proyecto con la respuesta lenta sale el indicador", await loader.waitFor({ timeout: 3000 }).then(() => true, () => false));
  await sleep(700);
  const r = await page.evaluate(() => {
    const el = document.querySelector("[data-project-loading]");
    const svg = el?.querySelector("svg");
    const main = document.querySelector("main");
    const box = el?.getBoundingClientRect();
    const mb = main.getBoundingClientRect();
    return {
      paths: svg?.querySelectorAll("path").length ?? 0,
      opacity: svg ? Number(getComputedStyle(svg).opacity) : 0,
      anim: svg ? getComputedStyle(svg.querySelector("path")).animationName : "",
      status: el?.querySelector("[role=status]")?.textContent ?? "",
      columns: document.querySelectorAll(".animate-pulse").length,
      // Ocupa el hueco de la página (sin saltos): centrado en <main> y de su mismo ancho.
      fills: !!box && Math.abs(box.width - mb.width) < 2 && box.top >= mb.top - 1 && box.bottom <= mb.bottom + 1,
      centered: !!box && !!svg && Math.abs((svg.getBoundingClientRect().left + svg.getBoundingClientRect().width / 2) - (mb.left + mb.width / 2)) < 2,
    };
  });
  L.eq("LOAD: es el contorno del logo (marco y tres columnas)", r.paths, 4);
  L.check("LOAD: visible pasados los 200 ms", r.opacity > 0.9, r.opacity);
  L.eq("LOAD: el trazo se anima", r.anim, "project-loader-draw");
  L.eq("LOAD: el lector de pantalla tiene «Cargando…»", r.status, "Cargando…");
  L.eq("LOAD: ya no hay columnas grises de esqueleto", r.columns, 0);
  L.check("LOAD: ocupa el hueco de la página, centrado", r.fills && r.centered, JSON.stringify(r));
  const sideNow = await sidebar.boundingBox();
  L.check("LOAD: la barra lateral sigue en su sitio", !!sideNow && Math.abs(sideNow.x - sideBox.x) < 1 && Math.abs(sideNow.width - sideBox.width) < 1, JSON.stringify([sideBox, sideNow]));
  L.check("LOAD: la barra lateral muestra ya el proyecto nuevo", (await sidebar.innerText()).includes("R49 carga"));
  await page.screenshot({ path: `${SHOTS}/r49-carga.png` });
  await L.board(page);
  const w = await page.evaluate(() => window.__r49);
  L.check("LOAD: «Cargando…» llega a la región viva después de los 200 ms (no en cargas rápidas)", w.said !== null && w.said >= 180, JSON.stringify(w));
  L.check("LOAD: al llegar el tablero, el indicador desaparece", w.gone !== null && (await loader.count()) === 0);
  await page.unroute(isProjectPage);

  // Releases del mismo proyecto: también con el indicador (la barra lateral no cambia).
  await slowClick(page, page.locator(`a[href="/p/${ID}/releases"]`).filter({ visible: true }).first(), 2000);
  L.check("LOAD: Releases con respuesta lenta también lo muestra", await loader.waitFor({ timeout: 3000 }).then(() => true, () => false));
  await page.waitForURL(/\/releases/, { timeout: 10000 });
  await loader.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  await page.unroute(isProjectPage);

  // Movimiento reducido: el logo quieto y tenue (en Documentación, aún sin visitar: sin caché del enrutador).
  await page.emulateMedia({ reducedMotion: "reduce" });
  await slowClick(page, page.locator(`a[href="/p/${ID}/docs"]`).filter({ visible: true }).first(), 2000);
  await loader.waitFor({ timeout: 3000 }).catch(() => {});
  await sleep(500);
  const still = await page.evaluate(() => {
    const svg = document.querySelector("[data-project-loading] svg");
    const path = svg?.querySelector("path");
    return svg ? { opacity: Number(getComputedStyle(svg).opacity), anim: getComputedStyle(path).animationName, offset: getComputedStyle(path).strokeDashoffset } : null;
  });
  L.check("LOAD: con movimiento reducido, quieto (sin animación del trazo) y entero", !!still && still.anim === "none" && parseFloat(still.offset) === 0, JSON.stringify(still));
  L.check("LOAD: con movimiento reducido, tenue", !!still && still.opacity > 0.3 && still.opacity < 0.7, JSON.stringify(still));
  await page.waitForURL(/\/docs/, { timeout: 10000 });
  await loader.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  await page.unroute(isProjectPage);
  L.assertNoErrors("LOAD", [s]);
  await s.ctx.close();
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [ID]);
}

// --- Adjuntos y límites: limpiezas que no harían nada ---------------------------------------------------------------
if (only.includes("storage")) {
  L.scenario("storage: botones de limpieza desactivados sin nada que borrar");
  const s = await L.session({ viewport: { width: 1400, height: 900 } });
  const page = s.page;
  await createProject();
  const url = `${L.BASE}/p/${ID}/settings?tab=adjuntos`;
  const card = (kind) => page.locator(`[data-cleanup="${kind}"]`);
  const btn = (name) => page.getByRole("button", { name, exact: true });
  const TRASH = "Vaciar la papelera de documentación";
  const RELEASES = "Borrar adjuntos de releases antiguas";
  const ARCHIVED = "Borrar adjuntos de tareas archivadas";
  const state = async () => ({
    trash: await btn(TRASH).isEnabled(), releases: await btn(RELEASES).isEnabled(), archived: await btn(ARCHIVED).isEnabled(),
  });
  const dim = async (kind) => card(kind).evaluate((el) => el.dataset.empty === "true" && Number(getComputedStyle(el).opacity) < 0.8);

  await page.goto(url);
  await btn(TRASH).waitFor({ timeout: 20000 });
  await sleep(500);
  L.eq("STORAGE: proyecto sin ficheros: los tres botones desactivados", await state(), { trash: false, releases: false, archived: false });
  for (const kind of ["documentsTrash", "oldReleases", "archivedTasks"]) L.check(`STORAGE: sin ficheros, la tarjeta «${kind}» se ve atenuada`, await dim(kind));
  await page.screenshot({ path: `${SHOTS}/r49-adjuntos-vacio.png`, fullPage: true });

  // Nota «i»: se abre al pulsar y se cierra con Escape.
  const tip = page.getByRole("button", { name: "Más información: Almacenamiento" });
  await tip.click();
  const note = page.getByRole("dialog", { name: "Más información: Almacenamiento" });
  L.check("STORAGE: la nota «i» de Almacenamiento se abre", (await note.innerText().catch(() => "")).includes("Las miniaturas no"));
  await page.screenshot({ path: `${SHOTS}/r49-nota-i.png` });
  await page.keyboard.press("Escape");
  L.check("STORAGE: la nota se cierra con Escape", await note.waitFor({ state: "detached", timeout: 3000 }).then(() => true, () => false));

  // Contenido: una tarea archivada con un adjunto, una release de hace 100 días con una copia y un documento en la papelera.
  await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"createdById","updatedAt","archivedAt") VALUES ('r49ui_t1',$1,'r49ui_c1','R49 archivada','kind_funcionalidad',1024,$2,NOW(),NOW())`, [ID, admin.id]);
  await L.q(`INSERT INTO "TaskAttachment"(id,"taskId","originalName",size) VALUES ('r49uia1','r49ui_t1','foto.webp',2048)`);
  await L.q(`INSERT INTO "Release"(id,"projectId",number,title,content,"deployedAt") VALUES ('r49ui_r1',$1,1,'R49 release','texto',NOW()-interval '100 days')`, [ID]);
  await L.q(`INSERT INTO "ReleaseAttachment"(id,"releaseId","fileName",size,position) VALUES ('r49uira1','r49ui_r1','copia.webp',4096,0)`);
  await L.q(`INSERT INTO "ProjectDocument"(id,"projectId",name,"mimeType",size,kind,"updatedAt","deletedAt") VALUES ('r49uid1',$1,'Borrado.pdf','application/pdf',1024,'PDF',NOW(),NOW())`, [ID]);
  await page.reload();
  await btn(TRASH).waitFor({ timeout: 20000 });
  await L.eqEventually("STORAGE: con ficheros, los tres botones activos", state, { trash: true, releases: true, archived: true });
  for (const kind of ["documentsTrash", "oldReleases", "archivedTasks"]) L.check(`STORAGE: con ficheros, la tarjeta «${kind}» no está atenuada`, !(await dim(kind)));
  await page.screenshot({ path: `${SHOTS}/r49-adjuntos-con-ficheros.png`, fullPage: true });

  // El filtro manda: la release es de hace 100 días y la tarea se archivó hoy.
  await page.getByRole("combobox", { name: "Antigüedad de las releases" }).selectOption("180");
  await L.eqEventually("STORAGE: releases «de más de 180 días»: ninguna cumple, botón desactivado", () => btn(RELEASES).isEnabled(), false);
  L.check("STORAGE: y su tarjeta atenuada (el filtro sigue activo)", (await dim("oldReleases")) && (await page.getByRole("combobox", { name: "Antigüedad de las releases" }).isEnabled()));
  await page.getByRole("combobox", { name: "Antigüedad de las releases" }).selectOption("90");
  await L.eqEventually("STORAGE: releases «de más de 90 días»: vuelve a activarse", () => btn(RELEASES).isEnabled(), true);
  await page.getByRole("combobox", { name: "Antigüedad de las tareas archivadas" }).selectOption("7");
  await L.eqEventually("STORAGE: archivadas «de más de 7 días» (archivada hoy): desactivado", () => btn(ARCHIVED).isEnabled(), false);
  await page.getByRole("combobox", { name: "Antigüedad de las tareas archivadas" }).selectOption("0");
  await L.eqEventually("STORAGE: archivadas «todas»: activo", () => btn(ARCHIVED).isEnabled(), true);

  // Vaciar la papelera: tras confirmar, el botón queda desactivado.
  await btn(TRASH).click();
  const confirm = U.dialog(page);
  await confirm.waitFor({ timeout: 5000 });
  await confirm.getByRole("button", { name: "Vaciar papelera" }).click();
  await page.getByText(/Borrados 1 fichero/).waitFor({ timeout: 10000 }).catch(() => {});
  L.eq("STORAGE: el documento se ha borrado", (await L.q(`SELECT count(*)::int n FROM "ProjectDocument" WHERE id='r49uid1'`))[0].n, 0);
  await L.eqEventually("STORAGE: tras vaciar la papelera, su botón queda desactivado", async () => [await btn(TRASH).isEnabled(), await dim("documentsTrash")], [false, true], { timeout: 10000 });

  // Móvil (390 px): nada se sale de la pantalla.
  const m = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  await m.page.goto(url);
  await m.page.getByRole("button", { name: TRASH, exact: true }).waitFor({ timeout: 20000 });
  const overflow = await m.page.evaluate(() => [...document.querySelectorAll("main button, main select, main input")].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).length);
  L.eq("STORAGE: a 390 px ningún control se sale de la pantalla", overflow, 0);
  L.assertNoErrors("STORAGE", [s, m]);
  await m.ctx.close();
  await s.ctx.close();
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [ID]);
}
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
