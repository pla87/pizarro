// Caza de bugs 54: (1) en el histórico de releases la descripción de cada tarea va debajo de su punto (antes, en la
// misma línea que el título) y una release guardada con el texto antiguo se sigue viendo; el título es un <h2> con el
// botón dentro (antes, un <h2> dentro de un <button>) y «No se pudo copiar» sale como error; (2) en el móvil, «Archivadas»
// del menú lateral cierra el menú; (3) en el calendario, el nombre accesible de «Proyectos» y «Responsable» incluye lo elegido
// (axe: label-content-name-mismatch) y al cerrar «+N más» con Escape o «Cerrar» el foco vuelve al botón que lo abrió;
// (4) «Aplicar plantilla» ya no pone un paréntesis dentro de otro («Siguiente release (Siguiente salto (genera
// releases))»); (5) un enlace «otro.md#apartado» llega al apartado del Markdown; (6) borrar va en un menú «⋯»: «Borrar
// release» y «Borrar adjuntos» del histórico (este, solo con adjuntos) y la papelera de cada documento de la Documentación
// (con «Descargar»), con teclado y a 390 px; (7) lo buscado se resalta en el histórico de releases (título, datos,
// adjuntos y texto, sin tildes ni mayúsculas, sin romper el Markdown ni los enlaces). Misma base y servidor que tablero-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node accesibilidad-releases-e2e.mjs      # PART=release,menu,cal,plantilla,md,borrar,resaltar
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as L from "./qa/lib.mjs";
const { sleep, COL } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "release,menu,cal,plantilla,md,borrar,resaltar").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bh54-"));
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

await L.prepareUsers();
await L.cleanBoard();
const p = await L.project();
const [admin] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [admin.id]);
const appToday = (page) => page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: document.documentElement.dataset.tz || undefined }).format(new Date()));

// --- Histórico de releases --------------------------------------------------------------------------------------------
if (only.includes("release")) {
  L.scenario("release: descripción debajo de su punto, <h2> con el botón dentro y error al copiar");
  await L.q(`DELETE FROM "Release" WHERE "projectId"=$1`, [p.id]);
  // Como la genera ahora la app (buildReleaseMarkdown) y como la generaban las versiones anteriores.
  const nuevo = "### Funcionalidad\n- **R2F1** · Login bh54\n\n  Adjuntos: R2F1_captura.webp\n\n  Permite entrar con **Google**.\n- **R2F2** · Sin descripción bh54\n";
  const antiguo = "### Funcionalidad\n- **R1F1** · Antigua bh54\n  Descripción antigua bh54\n";
  await L.q(`INSERT INTO "Release"(id,"projectId",number,title,content,"deployedAt") VALUES ('bh54_r2',$1,2,'Release nueva bh54',$2,NOW()), ('bh54_r1',$1,1,'Release antigua bh54',$3,NOW() - interval '1 day')`, [p.id, nuevo, antiguo]);
  const s = await L.session();
  const { page } = s;
  await page.goto(`${L.BASE}/p/${p.id}/releases`);
  const entry = page.locator("article").filter({ hasText: "Release nueva bh54" });
  await entry.waitFor({ timeout: 15000 });
  L.eq("REL: el botón está dentro del <h2> (y no al revés)", [await page.locator("article h2 > button[aria-expanded]").count(), await page.locator("article button h2").count()], [2, 0]);
  const toggle = entry.getByRole("button", { name: "R2 Release nueva bh54" });
  L.eq("REL: el botón se llama como la release", await toggle.count(), 1);
  L.eq("REL: el título se encuentra como título", await page.getByRole("heading", { level: 2, name: "R2 Release nueva bh54" }).count(), 1);
  // Se sigue abriendo pulsando en cualquier parte de la cabecera (la línea de la fecha, la flecha).
  await entry.locator("p").first().click({ force: true }); // el ::after del botón la cubre (lo que se comprueba)
  L.eq("REL: pulsar en la línea de la fecha abre la release", await toggle.getAttribute("aria-expanded"), "true");
  const item = entry.locator(".prose-md li").filter({ hasText: "Login bh54" });
  // El Markdown llega aparte (LazyMarkdown) la primera vez que se abre una release.
  await item.waitFor({ timeout: 8000 });
  const paragraphs = await item.locator(":scope > p").allInnerTexts();
  L.eq("REL: título, adjuntos y descripción, cada uno en su párrafo dentro del punto", paragraphs, ["R2F1 · Login bh54", "Adjuntos: R2F1_captura.webp", "Permite entrar con Google."]);
  const [titleBox, descBox] = await Promise.all([item.locator(":scope > p").nth(0).boundingBox(), item.locator(":scope > p").nth(2).boundingBox()]);
  L.check("REL: la descripción va debajo del título", descBox.y > titleBox.y + titleBox.height - 1, JSON.stringify({ titleBox, descBox }));
  await page.screenshot({ path: `${SHOTS}/bh54-release.png` });
  await entry.locator("p").first().click({ force: true }); // el ::after del botón la cubre (lo que se comprueba)
  L.eq("REL: y la cabecera la vuelve a cerrar", await toggle.getAttribute("aria-expanded"), "false");

  // Una release guardada con el texto antiguo se sigue viendo entera (la descripción, en el punto, como antes).
  const old = page.locator("article").filter({ hasText: "Release antigua bh54" });
  await old.getByRole("button", { name: "R1 Release antigua bh54" }).click();
  L.check("REL: release antigua: se ve con su descripción", (await old.locator(".prose-md li").innerText()).includes("Descripción antigua bh54"));

  // Sin portapapeles: «No se pudo copiar» sale como error (antes, con el aviso verde de éxito).
  await entry.getByRole("button", { name: "R2 Release nueva bh54" }).click();
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error("sin permiso"));
    document.execCommand = () => false;
  });
  await entry.getByRole("button", { name: "Copiar", exact: true }).click();
  const toast = page.getByRole("alert").filter({ hasText: "No se pudo copiar" });
  await L.checkEventually("REL: «No se pudo copiar» es un aviso de error (role=alert)", async () => (await toast.count()) === 1);
  L.check("REL: en rojo", /bg-red-600/.test((await toast.first().getAttribute("class")) ?? ""));
  L.assertNoErrors("REL", [s]);
  await s.ctx.close();
}

// --- Menú lateral en el móvil -----------------------------------------------------------------------------------------
if (only.includes("menu")) {
  L.scenario("menu: «Archivadas» del menú lateral lo cierra");
  const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = s;
  await page.goto(`${L.BASE}/p/${p.id}`);
  await L.colLoc(page, COL.backlog).waitFor({ state: "attached", timeout: 20000 });
  const drawer = page.getByRole("dialog", { name: "Menú" });
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await drawer.waitFor();
  await drawer.getByRole("link", { name: "Archivadas" }).click();
  await page.getByRole("dialog", { name: "Tareas archivadas" }).waitFor({ timeout: 15000 });
  await L.checkEventually("MENU: al abrir «Archivadas» el menú se cierra", async () => (await drawer.count()) === 0);
  await page.screenshot({ path: `${SHOTS}/bh54-archivadas-movil.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Tareas archivadas" }).waitFor({ state: "detached" });
  // Un enlace a otra página también lo cierra (como antes).
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await drawer.waitFor();
  await drawer.getByRole("link", { name: "Calendario" }).click();
  await page.waitForURL(/\/calendar/);
  await L.checkEventually("MENU: «Calendario» también lo cierra", async () => (await drawer.count()) === 0);
  L.assertNoErrors("MENU", [s]);
  await s.ctx.close();
}

// --- Calendario ---------------------------------------------------------------------------------------------------------
if (only.includes("cal")) {
  L.scenario("cal: nombre accesible de los filtros y foco al cerrar «+N más»");
  await L.cleanBoard();
  const s = await L.session();
  const { page } = s;
  const today = await appToday(page);
  const ids = await L.seedTasks(COL.backlog, ["Cal bh54 1", "Cal bh54 2", "Cal bh54 3", "Cal bh54 4", "Cal bh54 5"]);
  for (const id of ids) await L.q(`UPDATE "Task" SET "dueDate"=$2 WHERE id=$1`, [id, today]);
  await page.goto(`${L.BASE}/calendar`);
  const toggle = page.locator(`[data-day-toggle="${today}"]`);
  await toggle.waitFor({ timeout: 15000 });

  const filters = page.getByRole("group", { name: "Filtros del calendario" });
  L.eq("CAL: «Proyectos» dice el valor elegido", await filters.getByRole("button", { name: "Proyectos: Todos los proyectos" }).count(), 1);
  L.eq("CAL: «Responsable» dice el valor elegido", await filters.getByRole("button", { name: "Responsable: Cualquier persona" }).count(), 1);
  await page.evaluate(AXE);
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document.querySelector("[role=group]"), { runOnly: { type: "rule", values: ["label-content-name-mismatch", "button-name"] } });
    return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  });
  L.eq("CAL: axe sin label-content-name-mismatch en los filtros", axe, []);
  // Con un proyecto elegido, el nombre cambia con él.
  await filters.getByRole("button", { name: /^Proyectos:/ }).click();
  const panel = page.getByRole("dialog", { name: "Proyectos" });
  await panel.getByRole("checkbox", { name: p.name }).click();
  await page.keyboard.press("Escape");
  await L.checkEventually("CAL: con un proyecto elegido, «Proyectos: <nombre>»", async () => (await filters.getByRole("button", { name: `Proyectos: ${p.name}` }).count()) === 1);

  // «+N más»: Escape y «Cerrar» devuelven el foco al botón que lo abrió.
  await toggle.waitFor({ timeout: 15000 });
  await toggle.click();
  const popover = page.locator("[data-day-popover]");
  await popover.waitFor();
  L.eq("CAL: al abrir, el foco va a «Cerrar»", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Cerrar");
  await page.keyboard.press("Escape");
  await popover.waitFor({ state: "detached" });
  L.eq("CAL: Escape: el foco vuelve a «+N más»", await page.evaluate(() => document.activeElement?.getAttribute("data-day-toggle")), today);
  await page.keyboard.press("Enter");
  await popover.waitFor();
  await popover.getByRole("button", { name: "Cerrar" }).click();
  await popover.waitFor({ state: "detached" });
  L.eq("CAL: «Cerrar»: el foco vuelve a «+N más»", await page.evaluate(() => document.activeElement?.getAttribute("data-day-toggle")), today);
  // Clic fuera: el foco se queda donde se ha pulsado (no se lo lleva al botón).
  await toggle.click();
  await popover.waitFor();
  await page.getByRole("heading", { level: 1 }).first().click();
  await popover.waitFor({ state: "detached" });
  L.check("CAL: clic fuera: no se lleva el foco al botón", (await page.evaluate(() => document.activeElement?.getAttribute("data-day-toggle") ?? null)) === null);
  L.assertNoErrors("CAL", [s]);
  await s.ctx.close();
}

// --- Aplicar plantilla ----------------------------------------------------------------------------------------------------
if (only.includes("plantilla")) {
  L.scenario("plantilla: el rol de la columna de destino sin paréntesis dentro de paréntesis");
  // Proyecto privado propio (como plantillas-aplicar-e2e), con una columna.
  const PID = "bh54_plantilla";
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [PID]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,'Plantilla bh54',true,$2,999996,NOW())`, [PID, admin.id]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [PID, admin.id]);
  await L.q(`INSERT INTO "Column"(id,"projectId",name,position) VALUES ('bh54_col',$1,'Pendiente',1000)`, [PID]);
  const s = await L.session();
  const { page } = s;
  await page.goto(`${L.BASE}/p/${PID}/settings?tab=tablero`);
  await page.locator("[data-apply-template]").waitFor({ timeout: 15000 });
  await sleep(300);
  await page.getByRole("button", { name: "Aplicar plantilla…" }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Aplicar plantilla" }).first();
  await dlg.getByRole("radio", { name: /^Vibecoding/ }).check();
  await dlg.getByRole("radio", { name: /^Cambiar a esta plantilla/ }).check();
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  await dlg.locator("[data-step='2']").waitFor({ timeout: 10000 });
  const options = await dlg.locator("[data-match-column] select").first().locator("option").allInnerTexts();
  L.check("PLANT: el destino con rol sale con « · »", options.includes("Siguiente release · Siguiente salto (genera releases)"), JSON.stringify(options));
  L.check("PLANT: ninguna opción con un paréntesis dentro de otro", options.every((o) => !/\([^)]*\(/.test(o)), JSON.stringify(options));
  await page.keyboard.press("Escape");
  L.assertNoErrors("PLANT", [s]);
  await s.ctx.close();
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [PID]);
}

// --- Markdown de la Documentación: #apartado ------------------------------------------------------------------------------
if (only.includes("md")) {
  L.scenario("md: un enlace «otro.md#apartado» llega al apartado");
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p.id]);
  const s = await L.session();
  const { page } = s;
  const upload = async (name, body) => {
    const file = path.join(TMP, name);
    fs.writeFileSync(file, body);
    await page.goto(`${L.BASE}/p/${p.id}/docs`);
    await page.getByRole("heading", { name: /Documentación/ }).first().waitFor({ timeout: 15000 });
    await page.locator("input[type=file][aria-label='Subir archivos']").setInputFiles(file);
    await L.waitFor(async () => (await L.q(`SELECT 1 FROM "ProjectDocument" WHERE "projectId"=$1 AND name=$2`, [p.id, name])).length === 1, { timeout: 15000 });
  };
  const filler = Array.from({ length: 80 }, (_, i) => `Relleno ${i}.\n`).join("\n");
  await upload("guia-bh54.md", `# Guía\n\n${filler}\n## Instalación rápida\n\nTexto del apartado bh54.\n\n${filler}`);
  await upload("indice-bh54.html", `<!doctype html><html><body><a id="ir" href="guia-bh54.md#instalacion-rapida">Ir</a></body></html>`);
  const [md] = await L.q(`SELECT id FROM "ProjectDocument" WHERE "projectId"=$1 AND name='guia-bh54.md'`, [p.id]);
  const [html] = await L.q(`SELECT id FROM "ProjectDocument" WHERE "projectId"=$1 AND name='indice-bh54.html'`, [p.id]);
  // El enlace del HTML apunta al visor del Markdown con el apartado (como entre HTML, ronda 52).
  await page.goto(`${L.BASE}/p/${p.id}/docs?doc=${html.id}`);
  const frame = page.frameLocator("[data-testid=doc-html]");
  L.eq("MD: el enlace del HTML lleva al visor del Markdown con el apartado", await frame.locator("#ir").getAttribute("href"), `/p/${p.id}/docs?doc=${md.id}#instalacion-rapida`);
  // Abrirlo (lo que hace la pestaña nueva).
  await page.goto(`${L.BASE}/p/${p.id}/docs?doc=${md.id}#instalacion-rapida`);
  const heading = page.getByTestId("doc-markdown").getByRole("heading", { name: "Instalación rápida" });
  await heading.waitFor({ timeout: 15000 });
  L.eq("MD: el título tiene su id", await heading.getAttribute("id"), "md-instalacion-rapida");
  await L.checkEventually("MD: el visor se desplaza hasta el apartado", () => heading.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.top >= 0 && box.top < window.innerHeight / 2;
  }));
  await page.screenshot({ path: `${SHOTS}/bh54-md-apartado.png` });
  // Con tildes en el enlace (como lo escribiría GitHub), también.
  await page.goto("about:blank"); // si no, cambiar solo el apartado no vuelve a cargar la página
  await page.goto(`${L.BASE}/p/${p.id}/docs?doc=${md.id}#instalaci%C3%B3n-r%C3%A1pida`);
  await heading.waitFor({ timeout: 15000 });
  await L.checkEventually("MD: con tildes en el apartado, también", () => heading.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.top >= 0 && box.top < window.innerHeight / 2;
  }));
  // Sin apartado se queda arriba.
  await page.goto("about:blank");
  await page.goto(`${L.BASE}/p/${p.id}/docs?doc=${md.id}`);
  await heading.waitFor({ timeout: 15000 });
  await sleep(500);
  L.check("MD: sin apartado, arriba", await page.getByTestId("doc-markdown").getByRole("heading", { name: "Guía" }).evaluate((el) => el.getBoundingClientRect().top < window.innerHeight));
  L.assertNoErrors("MD", [{ errors: s.errors.filter((e) => !/Content Security Policy|Refused to/i.test(e)) }]);
  await s.ctx.close();
}

// --- Borrar, en un menú «⋯» (releases y documentos) --------------------------------------------------------------------
if (only.includes("borrar")) {
  L.scenario("borrar: «Borrar release», «Borrar adjuntos» y la papelera de un documento van en «⋯»");
  await L.q(`DELETE FROM "Release" WHERE "projectId"=$1`, [p.id]);
  await L.q(`INSERT INTO "Release"(id,"projectId",number,title,content,"deployedAt") VALUES ('bh54_rm2',$1,2,'Con adjunto menú',$2,NOW()), ('bh54_rm1',$1,1,'Sin adjuntos menú',$2,NOW() - interval '1 day')`, [p.id, "# Notas"]);
  await L.q(`INSERT INTO "ReleaseAttachment"(id,"releaseId","fileName",size,position) VALUES ('bh54_rma','bh54_rm2','copia-menu.webp',4096,0)`);
  const s = await L.session();
  const { page } = s;
  await page.goto(`${L.BASE}/p/${p.id}/releases`);
  const withAtt = page.locator("article").filter({ hasText: "Con adjunto menú" });
  await withAtt.waitFor({ timeout: 15000 });
  await withAtt.getByRole("button", { name: "R2 Con adjunto menú" }).click();
  const more = withAtt.getByRole("button", { name: "Más acciones de la release R2" });
  await more.waitFor();
  L.eq("BORRAR: en la fila ya no hay botones de borrar", await withAtt.getByRole("button", { name: /^Borrar/ }).count(), 0);
  const [copyBox, moreBox] = await Promise.all([withAtt.getByRole("button", { name: "Copiar", exact: true }).boundingBox(), more.boundingBox()]);
  L.check("BORRAR: «⋯» va al final de la fila de Copiar/.md/.txt", Math.abs(moreBox.y + moreBox.height / 2 - (copyBox.y + copyBox.height / 2)) < 4 && moreBox.x > copyBox.x, JSON.stringify({ copyBox, moreBox }));
  // Teclado: Intro abre el menú con el foco en la primera opción; ↓ pasa a la siguiente; Escape cierra y vuelve al botón.
  await more.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Más acciones de la release R2" });
  await menu.waitFor();
  L.eq("BORRAR: con adjuntos, el menú tiene «Borrar adjuntos» y «Borrar release»", (await menu.getByRole("menuitem").allInnerTexts()).map((x) => x.trim()), ["Borrar adjuntos", "Borrar release"]);
  L.eq("BORRAR: al abrir con Intro, el foco va a la primera opción", await page.evaluate(() => document.activeElement?.textContent?.trim()), "Borrar adjuntos");
  await page.keyboard.press("ArrowDown");
  L.eq("BORRAR: ↓ pasa a «Borrar release»", await page.evaluate(() => document.activeElement?.textContent?.trim()), "Borrar release");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  L.eq("BORRAR: Escape cierra y devuelve el foco a «⋯»", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Más acciones de la release R2");
  // «Borrar adjuntos» pide confirmación (como antes) y, cancelada, no borra nada.
  await page.keyboard.press("Enter");
  await menu.getByRole("menuitem", { name: "Borrar adjuntos" }).click();
  const confirmDlg = page.getByRole("dialog").filter({ hasText: "¿Borrar el adjunto de esta release?" });
  await confirmDlg.waitFor();
  await confirmDlg.getByRole("button", { name: "Cancelar" }).click();
  await confirmDlg.waitFor({ state: "detached" });
  L.eq("BORRAR: cancelar la confirmación no borra el adjunto", (await L.q(`SELECT count(*)::int n FROM "ReleaseAttachment" WHERE "releaseId"='bh54_rm2'`))[0].n, 1);
  await more.click();
  await menu.getByRole("menuitem", { name: "Borrar adjuntos" }).click();
  await confirmDlg.waitFor();
  await confirmDlg.getByRole("button", { name: "Borrar", exact: true }).click();
  await L.eqEventually("BORRAR: confirmado, se borran los adjuntos", async () => (await L.q(`SELECT count(*)::int n FROM "ReleaseAttachment" WHERE "releaseId"='bh54_rm2'`))[0].n, 0, { timeout: 10000 });
  await more.click();
  L.eq("BORRAR: sin adjuntos, el menú solo tiene «Borrar release»", (await menu.getByRole("menuitem").allInnerTexts()).map((x) => x.trim()), ["Borrar release"]);
  await menu.getByRole("menuitem", { name: "Borrar release" }).click();
  const confirmRel = page.getByRole("dialog").filter({ hasText: "¿Borrar la release «Con adjunto menú»" });
  await confirmRel.waitFor();
  await confirmRel.getByRole("button", { name: "Borrar", exact: true }).click();
  await L.eqEventually("BORRAR: «Borrar release» confirmado la borra", async () => (await L.q(`SELECT count(*)::int n FROM "Release" WHERE id='bh54_rm2'`))[0].n, 0, { timeout: 10000 });
  // La release sin adjuntos: el menú no ofrece «Borrar adjuntos».
  const noAtt = page.locator("article").filter({ hasText: "Sin adjuntos menú" });
  await noAtt.getByRole("button", { name: "R1 Sin adjuntos menú" }).click();
  await noAtt.getByRole("button", { name: "Más acciones de la release R1" }).click();
  L.eq("BORRAR: release sin adjuntos: solo «Borrar release»", (await page.getByRole("menu", { name: "Más acciones de la release R1" }).getByRole("menuitem").allInnerTexts()).map((x) => x.trim()), ["Borrar release"]);
  await page.keyboard.press("Escape");
  // El adjunto es solo la fila (sin fichero en disco): el plan del ZIP, que se pide al abrir la release, responde 404.
  L.assertNoErrors("BORRAR releases", [{ errors: s.errors.filter((e) => !/Failed to load resource: .*404/.test(e)) }]);
  await s.ctx.close();
  await L.q(`DELETE FROM "Release" WHERE "projectId"=$1`, [p.id]);

  // Documentación en el móvil (390 px): «⋯» por documento con «Descargar» y «Enviar a la papelera».
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p.id]);
  const m = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const mp = m.page;
  await mp.goto(`${L.BASE}/p/${p.id}/docs`);
  await mp.getByRole("heading", { name: /Documentación/ }).first().waitFor({ timeout: 15000 });
  await mp.waitForLoadState("networkidle").catch(() => {});
  for (const name of ["menu-uno-bh54.txt", "menu-dos-bh54-con-un-nombre-bastante-largo-para-el-movil.txt"]) {
    const file = path.join(TMP, name);
    fs.writeFileSync(file, `hola ${name}`);
    await mp.locator("input[type=file][aria-label='Subir archivos']").setInputFiles(file);
    await L.waitFor(async () => (await L.q(`SELECT 1 FROM "ProjectDocument" WHERE "projectId"=$1 AND name=$2`, [p.id, name])).length === 1, { timeout: 15000 });
  }
  await mp.reload();
  const longName = "menu-dos-bh54-con-un-nombre-bastante-largo-para-el-movil.txt";
  const docMore = mp.getByRole("button", { name: `Más acciones de «${longName}»` });
  await docMore.waitFor({ timeout: 15000 });
  L.eq("DOCS: la fila ya no tiene la papelera a la vista", await mp.getByTestId("docs-list").getByRole("button", { name: /papelera/ }).count(), 0);
  const box = await docMore.boundingBox();
  L.check("DOCS 390 px: «⋯» se ve entero, aunque el nombre sea largo", box && box.x >= 0 && box.x + box.width <= 390 && box.width >= 32, JSON.stringify(box));
  L.check("DOCS 390 px: sin scroll horizontal", await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await docMore.tap();
  const docMenu = mp.getByRole("menu", { name: `Más acciones de «${longName}»` });
  await docMenu.waitFor();
  L.eq("DOCS: el menú tiene «Descargar» y «Enviar a la papelera»", (await docMenu.getByRole("menuitem").allInnerTexts()).map((x) => x.trim()), ["Descargar", "Enviar a la papelera"]);
  const menuBox = await docMenu.boundingBox();
  L.check("DOCS 390 px: el menú cabe en la pantalla", menuBox.x >= 0 && menuBox.x + menuBox.width <= 390, JSON.stringify(menuBox));
  const [dl] = await Promise.all([mp.waitForEvent("download", { timeout: 15000 }), docMenu.getByRole("menuitem", { name: "Descargar" }).tap()]);
  L.eq("DOCS: «Descargar» del menú descarga el documento", dl.suggestedFilename(), longName);
  // Teclado: Intro abre, ↓ hasta la papelera, Intro la envía; el foco pasa al documento siguiente (o al anterior).
  await docMenu.waitFor({ state: "detached" });
  await docMore.focus();
  await mp.keyboard.press("Enter");
  await docMenu.waitFor();
  await mp.keyboard.press("ArrowDown");
  L.eq("DOCS: ↓ llega a «Enviar a la papelera»", await mp.evaluate(() => document.activeElement?.textContent?.trim()), "Enviar a la papelera");
  await mp.keyboard.press("Enter");
  await L.eqEventually("DOCS: va a la papelera", async () => (await L.q(`SELECT count(*)::int n FROM "ProjectDocument" WHERE "projectId"=$1 AND name=$2 AND "deletedAt" IS NOT NULL`, [p.id, longName]))[0].n, 1, { timeout: 10000 });
  await mp.getByRole("button", { name: "Deshacer" }).last().waitFor({ timeout: 10000 });
  await L.checkEventually("DOCS: el foco pasa al otro documento", async () => (await mp.evaluate(() => document.activeElement?.textContent ?? "")).includes("menu-uno-bh54.txt"));
  L.assertNoErrors("BORRAR docs", [m]);
  await m.ctx.close();
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p.id]);
}

// --- Lo buscado, resaltado en el histórico de releases ----------------------------------------------------------------
if (only.includes("resaltar")) {
  L.scenario("resaltar: lo buscado se resalta en el título, los datos, los adjuntos y el texto (sin tildes ni mayúsculas)");
  await L.q(`DELETE FROM "Release" WHERE "projectId"=$1`, [p.id]);
  // Una release como la de 300 tareas, con el término en negrita, en un enlace y en un código, y con tilde y mayúsculas.
  const lines = Array.from({ length: 300 }, (_, i) => `- **R2F${i + 2}** · Tarea ${i + 2} con un desplegable`);
  const content = [
    "### Funcionalidad",
    "- **R2F1** · El despleGáble del menú",
    "",
    "  Ver [el desplegable](https://example.com/desplegable) y `codigo desplegable`. Resumen de las tareas.",
    ...lines,
  ].join("\n");
  await L.q(`INSERT INTO "Release"(id,"projectId",number,title,content,"deployedAt") VALUES ('hl_r2',$1,2,'Menú Desplegable nuevo',$2,NOW()), ('hl_r1',$1,1,'Sin coincidencia hl',$3,NOW() - interval '1 day')`, [p.id, content, "Nada que ver"]);
  await L.q(`INSERT INTO "ReleaseAttachment"(id,"releaseId","fileName",size,position) VALUES ('hl_a1','hl_r2','R2F1_captura-desplegable.webp',4096,0)`);
  const s = await L.session();
  const { page } = s;
  const hits = (loc) => loc.locator("mark.search-hit").allInnerTexts();
  await page.goto(`${L.BASE}/p/${p.id}/releases?q=${encodeURIComponent("despleGáble")}`);
  const entry = page.locator("article").filter({ hasText: "Menú Desplegable nuevo" });
  await entry.waitFor({ timeout: 15000 });
  L.eq("RESALTAR: solo la release que coincide", await page.locator("article").count(), 1);
  const toggle = entry.getByRole("button", { name: "R2 Menú Desplegable nuevo" });
  L.eq("RESALTAR: el botón conserva su nombre (con el número y el título enteros)", await toggle.count(), 1);
  L.eq("RESALTAR: en el título, «Desplegable» aunque se busque «despleGáble»", await hits(entry.locator("h2")), ["Desplegable"]);
  L.eq("RESALTAR: la línea de datos sin coincidencias, sin marcas", await hits(entry.locator(":scope > div:first-child > div > p")), []);
  // Con búsqueda la coincidencia se abre sola (sin pulsar la cabecera).
  L.eq("RESALTAR: la release que coincide sale desplegada", await toggle.getAttribute("aria-expanded"), "true");
  const t0 = Date.now();
  const prose = entry.locator(".prose-md");
  await L.checkEventually("RESALTAR: desplegada, el texto que llega se resalta (303 coincidencias)", async () => (await prose.locator("mark.search-hit").count()) === 303, { timeout: 15000 });
  const ms = Date.now() - t0;
  L.check("RESALTAR: 300 tareas con 303 coincidencias se pintan enseguida (< 3 s)", ms < 3000, `${ms} ms`);
  const marks = await hits(prose);
  L.eq("RESALTAR: cada coincidencia con su texto original (tilde y mayúsculas incluidas)", [marks[0], marks[1], marks[2], new Set(marks.slice(3)).size], ["despleGáble", "desplegable", "desplegable", 1]);
  const link = prose.locator('a[href="https://example.com/desplegable"]');
  L.eq("RESALTAR: el enlace sigue siendo un enlace, con su destino, y la marca va dentro", [await link.count(), await link.locator("mark.search-hit").innerText(), await link.innerText()], [1, "desplegable", "el desplegable"]);
  L.eq("RESALTAR: dentro de un código también", await prose.locator("code mark.search-hit").count(), 1);
  L.eq("RESALTAR: el Markdown sigue pintado (negritas y puntos, sin asteriscos)", [await prose.locator("li strong").count(), (await prose.innerText()).includes("**")], [301, false]);
  L.eq("RESALTAR: en los nombres de los adjuntos", await hits(entry.locator("p.break-words")), ["desplegable"]);
  // Contraste de la marca en claro y en oscuro (texto sobre su fondo).
  const contrast = () => prose.locator("mark.search-hit").first().evaluate((el) => {
    // Tailwind da los colores en oklch(): se pasan a RGB pintándolos en un canvas.
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const rgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
    const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const st = getComputedStyle(el);
    const [a, b] = [lum(st.color), lum(st.backgroundColor)].sort((x, y) => y - x);
    return Math.round(((a + 0.05) / (b + 0.05)) * 10) / 10;
  });
  const light = await contrast();
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await sleep(100);
  const dark = await contrast();
  L.check("RESALTAR: contraste de la marca ≥ 7:1 en claro y en oscuro", light >= 7 && dark >= 7, JSON.stringify({ light, dark }));
  await page.screenshot({ path: `${SHOTS}/resaltar-releases-oscuro.png` });
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
  // «Copiar» copia el texto tal cual, sin marcas.
  await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  await entry.getByRole("button", { name: "Copiar", exact: true }).click();
  await L.eqEventually("RESALTAR: «Copiar» copia el Markdown sin las marcas", () => page.evaluate(() => navigator.clipboard.readText()), content, { timeout: 5000 });

  // Lo buscado al principio del título: el botón se sigue llamando «R2 Menú…» (el espacio queda solo, antes de la marca).
  await page.goto(`${L.BASE}/p/${p.id}/releases?q=MENU`);
  await entry.waitFor({ timeout: 15000 });
  L.eq("RESALTAR: con «MENU», «Menú» resaltado al principio del título", await hits(entry.locator("h2")), ["Menú"]);
  L.eq("RESALTAR: …y el botón conserva su nombre «R2 Menú Desplegable nuevo»", await entry.getByRole("button", { name: "R2 Menú Desplegable nuevo", exact: true }).count(), 1);
  // La línea de datos también: «TAREAS» resalta «tareas» (0 tareas en la release) y el texto.
  await page.goto(`${L.BASE}/p/${p.id}/releases?q=TAREAS`);
  await entry.waitFor({ timeout: 15000 });
  L.eq("RESALTAR: en la línea de datos («0 tareas · 1 adjunto»)", await hits(entry.locator(":scope > div:first-child > div > p")), ["tareas"]);
  // Sin búsqueda, ninguna marca (y plegada: se abre al pulsarla).
  await page.goto(`${L.BASE}/p/${p.id}/releases`);
  await entry.waitFor({ timeout: 15000 });
  L.eq("RESALTAR: sin búsqueda sale plegada", await entry.getByRole("button", { name: "R2 Menú Desplegable nuevo" }).getAttribute("aria-expanded"), "false");
  await entry.getByRole("button", { name: "R2 Menú Desplegable nuevo" }).click();
  await prose.locator("li").first().waitFor({ timeout: 8000 });
  L.eq("RESALTAR: sin búsqueda no hay marcas", await page.locator("mark.search-hit").count(), 0);
  await page.screenshot({ path: `${SHOTS}/resaltar-releases.png` });
  // El adjunto es solo la fila (sin fichero en disco): el plan del ZIP, que se pide al abrir la release, responde 404.
  L.assertNoErrors("RESALTAR", [{ errors: s.errors.filter((e) => !/Failed to load resource: .*404/.test(e)) }]);
  await s.ctx.close();
  await L.q(`DELETE FROM "Release" WHERE "projectId"=$1`, [p.id]);
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
