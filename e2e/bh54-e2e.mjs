// Caza de bugs 54: (1) en el histórico de releases la descripción de cada tarea va debajo de su punto (antes, en la
// misma línea que el título) y una release guardada con el texto antiguo se sigue viendo; el título es un <h2> con el
// botón dentro (antes, un <h2> dentro de un <button>) y «No se pudo copiar» sale como error; (2) en el móvil, «Archivadas»
// del menú lateral cierra el menú; (3) en el calendario, el nombre accesible de «Proyectos» y «Persona» incluye lo elegido
// (axe: label-content-name-mismatch) y al cerrar «+N más» con Escape o «Cerrar» el foco vuelve al botón que lo abrió;
// (4) «Aplicar plantilla» ya no pone un paréntesis dentro de otro («Siguiente release (Siguiente salto (genera
// releases))»); (5) un enlace «otro.md#apartado» llega al apartado del Markdown. Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh54-e2e.mjs      # PART=release,menu,cal,plantilla,md
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as L from "./qa/lib.mjs";
const { sleep, COL } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "release,menu,cal,plantilla,md").split(",");
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
  L.eq("CAL: «Persona» dice el valor elegido", await filters.getByRole("button", { name: "Persona: Cualquier persona" }).count(), 1);
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
  // Proyecto privado propio (como bh50a), con una columna.
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
  await dlg.getByRole("radio", { name: /^Equipo de software/ }).check();
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

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
