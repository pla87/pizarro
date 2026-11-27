// Notas de Documentación (v1.76, «Nueva nota»): (crear) «Nueva nota» abre una «Nota sin título» en modo edición, lo
// escrito se guarda solo al dejar de escribir («Guardado») y el título se cambia con el lápiz; (recargar) tras recargar
// la página la nota sigue con su texto (Markdown pintado) y lo escrito justo antes de cerrar el visor también llega;
// (fijar) «Fijar en «Notas generales»» del menú ⋯ la sube a la sección «Notas generales» y el botón del visor la quita;
// (buscar) el buscador encuentra la nota por una palabra de su texto sin tildes ni mayúsculas, y no por otra; (conflicto)
// dos pestañas editando a la vez: la segunda recibe «Otra persona ha cambiado esta nota…» y «Quedarme con la mía» guarda
// la suya sin perder nada; (visual) con el editor con barra (modo visual) también se guarda; (papelera) enviarla a la
// papelera desde el menú ⋯ la quita de la lista, en la papelera se ve su texto y se restaura. Misma base y servidor que
// tablero-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node documentacion-notas-e2e.mjs      # PART=recargar,fijar,buscar,conflicto,visual,papelera (crear va siempre)
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const only = (process.env.PART || "recargar,fijar,buscar,conflicto,visual,papelera").split(",");

await L.prepareUsers();
await L.cleanBoard();
const p = await L.project();
const [admin] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
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
  const row = await noteRow("Nota sin título");
  noteId = row?.id ?? null;
  L.eq("CREAR: el texto está en la base (sin fichero) y la versión subió", [row?.noteContent, row?.noteVersion > 0], ["# Acta semanal\n\nRepasamos la **Canción** del equipo.", true]);
  // Título: el lápiz del visor, como cualquier documento.
  await viewer.getByRole("button", { name: "Renombrar" }).click();
  await viewer.getByLabel("Nombre del documento").fill("Acta semanal");
  await viewer.getByRole("button", { name: "Guardar", exact: true }).click();
  await L.eqEventually("CREAR: el título se guarda como nombre del documento", async () => (await noteById(noteId))?.name, "Acta semanal");
  await closeViewer(page);
  await L.checkEventually("CREAR: la nota sale en la lista, con el icono de nota", async () => (await page.locator(`[data-doc-open="${noteId}"]`).textContent())?.includes("Acta semanal") && (await page.locator(`[data-doc-open="${noteId}"] [title="Nota"]`).count()) === 1);
  L.assertNoErrors("CREAR", [s]);
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
  L.eq("FIJAR: el botón del visor dice que está fijada", await pinBtn.getAttribute("aria-pressed"), "true");
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
  L.check("CONFLICTO: aviso «Otra persona ha cambiado esta nota…»", (await notice.textContent())?.includes("Otra persona ha cambiado esta nota"));
  L.eq("CONFLICTO: no se ha pisado el texto de A", (await noteById(noteId)).noteContent, afterA);
  await notice.getByText("Ver su versión").click();
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
