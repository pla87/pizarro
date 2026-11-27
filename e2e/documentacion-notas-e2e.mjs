// Notas de Documentación (v1.76, «Nueva nota»): (crear) «Nueva nota» abre una «Nota sin título» en modo edición, lo
// escrito se guarda solo al dejar de escribir («Guardado»), la nota toma como título su primera línea (v1.77) en el visor
// y en la lista sin recargar, y el título se cambia con el lápiz (y entonces ya no cambia solo); (mencion) mencionar con
// @ a la segunda persona le deja el aviso en la campana («… te ha mencionado en la nota «…»»), que abre la nota; (recargar) tras recargar
// la página la nota sigue con su texto (Markdown pintado) y lo escrito justo antes de cerrar el visor también llega;
// (fijar) «Fijar en «Notas generales»» del menú ⋯ la sube a la sección «Notas generales» y el botón del visor la quita;
// (buscar) el buscador encuentra la nota por una palabra de su texto sin tildes ni mayúsculas, y no por otra; (conflicto)
// dos pestañas editando a la vez: la segunda recibe «Esta nota ha cambiado en otra pestaña o por otra persona…», con el foco, y «Quedarme con la mía» guarda
// la suya sin perder nada; (visual) con el editor con barra (modo visual) también se guarda; (papelera) enviarla a la
// papelera desde el menú ⋯ la quita de la lista, en la papelera se ve su texto y se restaura. Misma base y servidor que
// tablero-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node documentacion-notas-e2e.mjs      # PART=mencion,recargar,fijar,buscar,conflicto,visual,papelera (crear va siempre)
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const only = (process.env.PART || "mencion,recargar,fijar,buscar,conflicto,visual,papelera").split(",");

await L.prepareUsers();
await L.cleanBoard();
const p = await L.project();
const [admin] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const [second] = await L.q(`SELECT id, name FROM "User" WHERE email=$1`, [L.USER2]);
await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p.id]);
await L.q(`UPDATE "User" SET locale='ES', "editorMode"='MARKDOWN' WHERE id=$1`, [admin.id]);

const s = await L.session();
const { page } = s;
const DOCS = `${L.BASE}/p/${p.id}/docs`;

const noteRow = async (name) => (await L.q(`SELECT id, name, "noteContent", "noteVersion", "pinnedAt", "deletedAt" FROM "ProjectDocument" WHERE "projectId"=$1 AND name=$2 AND "noteContent" IS NOT NULL`, [p.id, name]))[0];
const noteById = async (id) => (await L.q(`SELECT id, name, "noteContent", "noteVersion", "pinnedAt", "deletedAt" FROM "ProjectDocument" WHERE id=$1`, [id]))[0];
const editorBox = (pg) => U.dialog(pg).locator("[data-testid=note-editor] textarea, [data-testid=note-editor] [contenteditable=true]").first();
const status = (pg) => U.dialog(pg).locator("[data-testid=note-status]");
async function gotoDocs(pg) {
  await L.goto(pg, DOCS);
  await pg.getByRole("heading", { name: /Documentación/ }).first().waitFor({ timeout: 15000 });
  await sleep(800); // hidratación
}
async function openById(pg, id) {
  await gotoDocs(pg);
  await pg.locator(`[data-doc-open="${id}"]`).first().click();
  await U.dialog(pg).locator("[data-testid=note-editor]").waitFor({ timeout: 10000 });
}
const rowMenu = (pg, id) => pg.locator("li", { has: pg.locator(`[data-doc-open="${id}"]`) }).locator("[data-testid=doc-menu-btn]");
async function closeViewer(pg) {
  await U.dialog(pg).getByRole("button", { name: "Cerrar" }).first().click();
  await U.dialog(pg).waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}

let noteId = null;

// --- Crear: guardado automático y título (siempre: las demás partes usan esta nota) ---------------------------------
{
  L.scenario("crear: «Nueva nota», escribir, guardado automático y título");
  await gotoDocs(page);
  await page.getByTestId("docs-new-note").click();
  const viewer = U.dialog(page);
  await viewer.getByText("Nota sin título").first().waitFor({ timeout: 10000 });
  const box = editorBox(page);
  await box.waitFor({ timeout: 10000 });
  L.check("CREAR: se abre en modo edición, con el foco en el texto", await box.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)));
  await box.pressSequentially("# Acta semanal\n\nRepasamos la **Canción** del equipo.", { delay: 5 });
  await L.waitFor(async () => /^Guardado$/.test((await status(page).textContent()) ?? ""), { timeout: 10000 });
  L.eq("CREAR: el indicador dice «Guardado»", (await status(page).textContent())?.trim(), "Guardado");
  // Título automático (v1.77): la «Nota sin título» se llama como su primera línea, sin las marcas de Markdown.
  const row = await noteRow("Acta semanal");
  noteId = row?.id ?? null;
  L.eq("CREAR: el texto está en la base (sin fichero) y la versión subió", [row?.noteContent, row?.noteVersion > 0], ["# Acta semanal\n\nRepasamos la **Canción** del equipo.", true]);
  await L.checkEventually("CREAR: el título del visor pasa a ser la primera línea, sin recargar", async () => (await viewer.getByText("Acta semanal", { exact: true }).count()) > 0 && (await viewer.getByText("Nota sin título").count()) === 0);
  await L.checkEventually("CREAR: y la lista de detrás también", async () => (await page.locator(`[data-doc-open="${noteId}"]`).textContent())?.includes("Acta semanal"));
  // Título a mano: el lápiz del visor, como cualquier documento. Desde entonces no cambia solo.
  await viewer.getByRole("button", { name: "Renombrar" }).click();
  await viewer.getByLabel("Nombre del documento").fill("Acta semanal (revisada)");
  await viewer.getByRole("button", { name: "Guardar", exact: true }).click();
  await L.eqEventually("CREAR: el título se guarda como nombre del documento", async () => (await noteById(noteId))?.name, "Acta semanal (revisada)");
  await box.press("Control+Home");
  await box.press("End");
  await box.pressSequentially(" del lunes", { delay: 5 });
  await L.waitFor(async () => (await noteById(noteId))?.noteContent?.startsWith("# Acta semanal del lunes"), { timeout: 10000 });
  L.eq("CREAR: renombrada a mano, cambiar la primera línea ya no le cambia el nombre", (await noteById(noteId))?.name, "Acta semanal (revisada)");
  await closeViewer(page);
  await L.checkEventually("CREAR: la nota sale en la lista, con el icono de nota", async () => (await page.locator(`[data-doc-open="${noteId}"]`).textContent())?.includes("Acta semanal (revisada)") && (await page.locator(`[data-doc-open="${noteId}"] [title="Nota"]`).count()) === 1);
  L.assertNoErrors("CREAR", [s]);
}

// --- Mención: la segunda persona recibe el aviso en la campana y abre la nota ---------------------------------------------
if (only.includes("mencion") && noteId) {
  L.scenario("mencion: mencionar con @ en la nota avisa a la segunda persona en la campana");
  await L.q(`DELETE FROM "Notification" WHERE "userId"=$1`, [second.id]);
  await openById(page, noteId);
  await U.dialog(page).getByTestId("note-edit").click();
  const box = editorBox(page);
  await box.waitFor();
  await box.press("Control+End");
  await box.pressSequentially("\n\nPara @Segu", { delay: 5 });
  await page.keyboard.press("Enter");
  await box.pressSequentially("revisa los acuerdos.", { delay: 5 });
  await L.waitFor(async () => (await status(page).textContent())?.trim() === "Guardado", { timeout: 10000 });
  L.check("MENCION: la mención queda en el texto", (await noteById(noteId))?.noteContent?.includes(`@[${second.name}](user:${second.id})`));
  await L.eqEventually("MENCION: un aviso para la segunda persona, de la nota", async () => (await L.q(`SELECT count(*)::int n FROM "Notification" WHERE "userId"=$1 AND type='MENTION' AND "documentId"=$2`, [second.id, noteId]))[0].n, 1);
  // Más texto después (otro guardado automático): no repite el aviso.
  await box.pressSequentially(" Gracias.", { delay: 5 });
  await L.waitFor(async () => (await noteById(noteId))?.noteContent?.endsWith("Gracias."), { timeout: 10000 });
  L.eq("MENCION: seguir escribiendo no repite el aviso", (await L.q(`SELECT count(*)::int n FROM "Notification" WHERE "userId"=$1 AND "documentId"=$2`, [second.id, noteId]))[0].n, 1);
  await closeViewer(page);
  const s2 = await L.session({ email: L.USER2 });
  await L.goto(s2.page, `${L.BASE}/notifications`);
  const notice = s2.page.locator("[data-notice-open]").filter({ hasText: "te ha mencionado en la nota «Acta semanal (revisada)»" });
  await notice.first().waitFor({ timeout: 10000 });
  L.check("MENCION: la campana lo dice con el nombre de la nota y el texto de la mención", (await notice.first().textContent())?.includes("revisa los acuerdos."));
  await notice.first().click();
  await s2.page.waitForURL((u) => u.pathname.endsWith("/docs") && u.searchParams.get("doc") === noteId, { timeout: 10000 });
  await U.dialog(s2.page).locator("[data-testid=note-editor]").waitFor({ timeout: 10000 });
  L.check("MENCION: al pulsarlo se abre la nota en Documentación", true);
  L.assertNoErrors("MENCION", [s, s2]);
  await s2.ctx.close();
}

// --- Recargar: el texto sigue, y lo escrito justo antes de cerrar llega ----------------------------------------------------
if (only.includes("recargar") && noteId) {
  L.scenario("recargar: la nota se ve tras recargar y lo último escrito antes de cerrar se guarda");
  await openById(page, noteId);
  const md = U.dialog(page).locator("[data-testid=doc-markdown]");
  await md.getByRole("heading", { name: "Acta semanal" }).waitFor({ timeout: 10000 });
  L.check("RECARGAR: se ve pintada (título y negrita)", (await md.locator("strong").textContent()) === "Canción");
  await U.dialog(page).getByTestId("note-edit").click();
  const box = editorBox(page);
  await box.waitFor();
  await box.press("Control+End");
  await box.pressSequentially("\n\nÚltima línea antes de cerrar.", { delay: 5 });
  // Se cierra enseguida, sin esperar al guardado automático.
  await closeViewer(page);
  await L.checkEventually("RECARGAR: lo escrito justo antes de cerrar llega a la base", async () => (await noteById(noteId))?.noteContent?.endsWith("Última línea antes de cerrar."), { timeout: 10000 });
  await gotoDocs(page);
  await openById(page, noteId);
  await L.checkEventually("RECARGAR: tras recargar, la nota tiene todo", async () => (await U.dialog(page).locator("[data-testid=doc-markdown]").textContent())?.includes("Última línea antes de cerrar."));
  await closeViewer(page);
  L.assertNoErrors("RECARGAR", [s]);
}

// --- Fijar: «Notas generales» ------------------------------------------------------------------------------------------
if (only.includes("fijar") && noteId) {
  L.scenario("fijar: menú ⋯ → «Notas generales»; el visor la quita");
  await L.q(`INSERT INTO "ProjectDocument"(id,"projectId",name,"mimeType",size,kind,"createdById","updatedAt","noteContent") VALUES ('e2enotaotra',$1,'Otra nota','text/markdown',4,'MARKDOWN',$2,NOW(),'otra')`, [p.id, admin.id]);
  await gotoDocs(page);
  await rowMenu(page, noteId).click();
  await page.getByTestId("doc-pin-btn").click();
  const pinned = page.getByTestId("docs-pinned-list");
  await L.checkEventually("FIJAR: sale en «Notas generales»", async () => (await pinned.locator(`[data-doc-open="${noteId}"]`).count()) === 1);
  L.check("FIJAR: la sección tiene su título", await page.getByRole("heading", { name: "Notas generales" }).isVisible());
  L.eq("FIJAR: la otra nota sigue en la lista de abajo", await page.getByTestId("docs-list").locator(`[data-doc-open="e2enotaotra"]`).count(), 1);
  L.check("FIJAR: queda en la base", !!(await noteById(noteId))?.pinnedAt);
  await openById(page, noteId);
  const pinBtn = U.dialog(page).getByTestId("doc-viewer-pin");
  L.eq("FIJAR: el botón del visor dice que la quita (sin aria-pressed)", [await pinBtn.getAttribute("aria-label"), await pinBtn.getAttribute("aria-pressed")], ["Quitar de «Notas generales»", null]);
  await pinBtn.click();
  await L.checkEventually("FIJAR: desde el visor se quita", async () => !(await noteById(noteId))?.pinnedAt);
  await closeViewer(page);
  await L.checkEventually("FIJAR: sin fijadas no hay sección", async () => (await page.getByTestId("docs-pinned-list").count()) === 0);
  L.assertNoErrors("FIJAR", [s]);
}

// --- Buscar en el texto -------------------------------------------------------------------------------------------------
if (only.includes("buscar") && noteId) {
  L.scenario("buscar: por una palabra del texto, sin tildes ni mayúsculas");
  await gotoDocs(page);
  const search = page.getByLabel("Buscar documentos");
  L.eq("BUSCAR: el buscador avisa de que mira también las notas", await search.getAttribute("placeholder"), "Buscar por nombre o en las notas…");
  await search.fill("CANCION");
  await L.checkEventually("BUSCAR: «CANCION» encuentra la nota que dice «Canción»", async () => (await page.locator(`[data-doc-open="${noteId}"]`).count()) === 1 && (await page.locator(`[data-doc-open="e2enotaotra"]`).count()) === 0);
  await search.fill("palabra que no está");
  await L.checkEventually("BUSCAR: otra palabra no la encuentra", async () => (await page.locator(`[data-doc-open="${noteId}"]`).count()) === 0);
  await search.fill("otra");
  await L.checkEventually("BUSCAR: por el nombre, como siempre", async () => (await page.locator(`[data-doc-open="e2enotaotra"]`).count()) === 1);
  L.assertNoErrors("BUSCAR", [s]);
}

// --- Conflicto: dos pestañas a la vez ---------------------------------------------------------------------------------
if (only.includes("conflicto") && noteId) {
  L.scenario("conflicto: dos pestañas editan la misma nota");
  const s2 = await L.session();
  const p2 = s2.page;
  for (const pg of [page, p2]) {
    await openById(pg, noteId);
    await U.dialog(pg).getByTestId("note-edit").click();
    await editorBox(pg).waitFor();
  }
  // La primera escribe y guarda.
  const a = editorBox(page);
  await a.press("Control+End");
  await a.pressSequentially(" Cambio de A.", { delay: 5 });
  await L.waitFor(async () => (await status(page).textContent())?.trim() === "Guardado", { timeout: 10000 });
  const afterA = (await noteById(noteId)).noteContent;
  // La segunda, que abrió antes de ese guardado, escribe: aviso en vez de pisar.
  const b = editorBox(p2);
  await b.press("Control+End");
  await b.pressSequentially(" Cambio de B.", { delay: 5 });
  const notice = U.dialog(p2).getByTestId("note-conflict");
  await notice.waitFor({ timeout: 10000 });
  L.check("CONFLICTO: aviso «Esta nota ha cambiado en otra pestaña o por otra persona…»", (await notice.textContent())?.includes("Esta nota ha cambiado en otra pestaña o por otra persona"));
  L.check("CONFLICTO: el aviso se lleva el foco", await notice.evaluate((el) => el === document.activeElement));
  L.eq("CONFLICTO: no se ha pisado el texto de A", (await noteById(noteId)).noteContent, afterA);
  await notice.getByText("Ver la otra versión").click();
  L.check("CONFLICTO: se ve la versión de A", (await notice.locator("pre").textContent())?.includes("Cambio de A."));
  await notice.getByRole("button", { name: "Quedarme con la mía" }).click();
  await L.checkEventually("CONFLICTO: «Quedarme con la mía» guarda lo de B", async () => (await noteById(noteId)).noteContent?.endsWith("Cambio de B."), { timeout: 10000 });
  L.eq("CONFLICTO: el aviso desaparece", await U.dialog(p2).getByTestId("note-conflict").count(), 0);
  await closeViewer(p2);
  await closeViewer(page);
  L.assertNoErrors("CONFLICTO", [s, s2]);
  await s2.ctx.close();
}

// --- Editor con barra (modo visual) -------------------------------------------------------------------------------------
if (only.includes("visual")) {
  L.scenario("visual: con el editor con barra también se guarda");
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG' WHERE id=$1`, [admin.id]);
  const s3 = await L.session();
  const p3 = s3.page;
  await gotoDocs(p3);
  await p3.getByTestId("docs-new-note").click();
  const box = U.dialog(p3).locator("[data-testid=note-editor] [contenteditable=true]").first();
  await box.waitFor({ timeout: 15000 });
  await box.click();
  await p3.keyboard.type("Nota escrita con la barra", { delay: 5 });
  await L.waitFor(async () => (await status(p3).textContent())?.trim() === "Guardado", { timeout: 10000 });
  const rows = await L.q(`SELECT "noteContent" FROM "ProjectDocument" WHERE "projectId"=$1 AND "noteContent" LIKE '%escrita con la barra%'`, [p.id]);
  L.eq("VISUAL: el texto llega a la base", rows.length, 1);
  await closeViewer(p3);
  L.assertNoErrors("VISUAL", [s3]);
  await s3.ctx.close();
  await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN' WHERE id=$1`, [admin.id]);
}

// --- Papelera ----------------------------------------------------------------------------------------------------------
if (only.includes("papelera") && noteId) {
  L.scenario("papelera: enviar, ver y restaurar una nota");
  await gotoDocs(page);
  await rowMenu(page, noteId).click();
  await page.getByTestId("doc-trash-btn").click();
  await L.checkEventually("PAPELERA: en la base, en la papelera", async () => !!(await noteById(noteId))?.deletedAt);
  await L.checkEventually("PAPELERA: ya no sale en la lista", async () => (await page.locator(`[data-doc-open="${noteId}"]`).count()) === 0);
  await page.getByTestId("docs-trash-toggle").click();
  const item = page.getByTestId("docs-trash-item").filter({ hasText: "Acta semanal" });
  await item.waitFor({ timeout: 10000 });
  await item.getByRole("button", { name: /^Ver / }).click();
  await L.checkEventually("PAPELERA: se ve su texto", async () => (await U.dialog(page).locator("[data-testid=doc-markdown]").textContent())?.includes("Cambio de B."));
  await U.dialog(page).getByRole("button", { name: "Restaurar" }).click();
  await L.checkEventually("PAPELERA: restaurada", async () => !(await noteById(noteId))?.deletedAt);
  L.assertNoErrors("PAPELERA", [s]);
}

await s.ctx.close();
await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p.id]);
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
