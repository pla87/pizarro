// Caza de bugs 53 (copiar y pegar una tarea como JSON, deshacer y Documentación): (1) con el foco en una casilla de
// subtarea o en la fecha (que también son <input>, pero no admiten texto), Ctrl+V pega la tarea del portapapeles (antes no
// hacía nada); en un campo de texto sigue pegando el texto; (2) con solo una imagen de la descripción seleccionada (al
// leerla o al editarla), Ctrl+C copia la imagen, no la tarea; (3) el título de un JSON con saltos de línea o tabuladores se
// guarda en una línea; (4) borrar dos tareas en las que una bloquea a la otra, deshacer, rehacer y deshacer otra vez
// conserva el bloqueo (la segunda vez se perdía); (5) un HTML de Documentación abierto con «?doc=…#apartado» baja al
// apartado también mientras algo lee el marco al cargarse (antes, a veces se quedaba arriba o muy por debajo). Misma base
// y servidor que tablero-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node importar-pegar-foco-e2e.mjs      # PART=casilla,imagen,titulo,bloqueo,apartado
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { COL, sleep } = L;
const only = (process.env.PART || "casilla,imagen,titulo,bloqueo,apartado").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bh53-"));

await L.prepareUsers();
const p0 = await L.project();
const [me] = await L.q(`SELECT id, "editorMode" FROM "User" WHERE email=$1`, [L.ADMIN]);
await L.q(`UPDATE "User" SET locale='ES', "editorMode"='WYSIWYG' WHERE id=$1`, [me.id]);

const F = "pizarro.task";
const clip = (page) => page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
const setClip = (page, text) => page.evaluate((v) => navigator.clipboard.writeText(v), text);
const status = (page) => U.dialog(page).locator("[data-save-status]");
const statusShows = (page, text) => L.waitFor(async () => (await status(page).innerText().catch(() => "")).trim() === text && Number(await status(page).evaluate((el) => getComputedStyle(el).opacity)) > 0.5, { timeout: 6000 });
const copiedShown = async (page) => (await status(page).innerText().catch(() => "")).trim() === "Tarea copiada" && Number(await status(page).evaluate((el) => getComputedStyle(el).opacity)) > 0.5;
const titleOf = async (id) => (await L.q(`SELECT title FROM "Task" WHERE id=$1`, [id]))[0]?.title;
const withClipboard = async () => {
  const s = await L.session();
  await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  return s;
};
/** PNG liso de w×h (sin dependencias). */
function makePng(w, h) {
  const crc = (buf) => { let c, n = 0xffffffff; for (const b of buf) { c = (n ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; n = (n >>> 8) ^ c; } return (n ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h, 120);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// --- Ctrl+V con el foco en una casilla o en la fecha ---------------------------------------------------------------------
if (only.includes("casilla")) {
  L.scenario("casilla: Ctrl+V con el foco en una casilla de subtarea o en la fecha pega la tarea");
  await L.cleanBoard();
  const [dst] = await L.seedTasks(COL.backlog, ["Destino bh53"]);
  await L.q(`INSERT INTO "Subtask"(id,"taskId",title,done,position) VALUES ('bh53s1',$1,'Sub',false,1024)`, [dst]);
  const s = await withClipboard();
  const { page } = s;
  await U.openTask(page, "Destino bh53");
  // Marcar una subtarea deja el foco en su casilla: es lo que tiene delante quien pega justo después.
  const box = U.dialog(page).locator("input[type=checkbox]").first();
  await box.click();
  await L.waitFor(async () => (await L.q(`SELECT done FROM "Subtask" WHERE id='bh53s1'`))[0].done === true);
  L.eq("CASILLA: el foco está en la casilla de la subtarea", await page.evaluate(() => document.activeElement?.getAttribute("type")), "checkbox");
  await setClip(page, JSON.stringify({ format: F, title: "Pegada desde la casilla" }));
  await page.keyboard.press("Control+v");
  await L.eqEventually("CASILLA: Ctrl+V con el foco en la casilla pega la tarea", () => titleOf(dst), "Pegada desde la casilla");
  L.check("CASILLA: … y sale «Tarea pegada»", await statusShows(page, "Tarea pegada"));
  // La fecha límite: otro <input> que no admite texto pegado.
  const date = U.dialog(page).locator("input[type=date]").first();
  await date.focus();
  await setClip(page, JSON.stringify({ format: F, title: "Pegada desde la fecha" }));
  await page.keyboard.press("Control+v");
  await L.eqEventually("CASILLA: con el foco en la fecha, también", () => titleOf(dst), "Pegada desde la fecha");
  // En un campo de texto sigue siendo texto (el título; «Añadir subtarea…»).
  const sub = U.dialog(page).getByPlaceholder("Añadir subtarea…");
  await sub.click();
  const json = JSON.stringify({ format: F, title: "No debe aplicarse" });
  await setClip(page, json);
  await page.keyboard.press("Control+v");
  await sleep(800);
  L.eq("CASILLA: en «Añadir subtarea…» el JSON se pega como texto y la tarea no cambia", [await sub.inputValue(), await titleOf(dst)], [json, "Pegada desde la fecha"]);
  await sub.fill("");
  L.assertNoErrors("casilla", [s]);
  await s.ctx.close();
}

// --- Ctrl+C con solo una imagen seleccionada -----------------------------------------------------------------------------
if (only.includes("imagen")) {
  L.scenario("imagen: Ctrl+C con solo una imagen de la descripción seleccionada copia la imagen, no la tarea");
  await L.cleanBoard();
  const [t] = await L.seedTasks(COL.backlog, ["Con imagen bh53"]);
  const PNG = path.join(TMP, "plano.png");
  fs.writeFileSync(PNG, makePng(320, 200));
  const s = await withClipboard();
  const { page } = s;
  await U.openTask(page, "Con imagen bh53");
  await U.dialog(page).locator("input[type=file]:not([capture])").first().setInputFiles(PNG);
  await L.waitFor(async () => (await L.q(`SELECT 1 FROM "TaskAttachment" WHERE "taskId"=$1`, [t])).length === 1, { timeout: 15000 });
  await U.closeDialog(page);
  const [img] = await L.q(`SELECT id FROM "TaskAttachment" WHERE "taskId"=$1`, [t]);
  await L.q(`UPDATE "Task" SET description=$2 WHERE id=$1`, [t, `Antes\n\n![plano](/api/attachments/${img.id})\n\nDespués`]);
  await L.reload(page);
  await U.openTask(page, "Con imagen bh53");
  await U.dialog(page).locator(`img[alt="plano"]`).first().waitFor({ timeout: 8000 });
  // Al leerla: la selección abarca solo la imagen (no hay texto seleccionado).
  await setClip(page, "nada");
  await page.evaluate(() => {
    const el = document.querySelector('[role=dialog] img[alt="plano"]');
    const r = document.createRange();
    r.selectNode(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  L.eq("IMAGEN: la selección no tiene texto", await page.evaluate(() => [getSelection().isCollapsed, getSelection().toString()]), [false, ""]);
  await page.keyboard.press("Control+c");
  await sleep(1200);
  L.check("IMAGEN: al leer, Ctrl+C no copia la tarea", !(await clip(page)).includes(F), (await clip(page)).slice(0, 80));
  L.check("IMAGEN: … ni sale «Tarea copiada»", !(await copiedShown(page)));
  L.check("IMAGEN: … y el portapapeles lleva la imagen (HTML)", await page.evaluate(async () => (await navigator.clipboard.read()).some((i) => i.types.includes("text/html"))).catch(() => false));
  // Al editarla: un clic en la imagen la selecciona como nodo.
  await page.evaluate(() => getSelection().removeAllRanges());
  await U.dialog(page).getByRole("button", { name: "Editar", exact: true }).first().click();
  const editor = U.dialog(page).locator("[role=textbox][contenteditable]").first();
  await editor.locator('img[alt="plano"]').first().click();
  await L.waitFor(async () => (await editor.locator(".ProseMirror-selectednode").count()) === 1, { timeout: 4000 });
  await setClip(page, "nada");
  await page.keyboard.press("Control+c");
  await sleep(1200);
  L.check("IMAGEN: al editar, Ctrl+C con la imagen seleccionada no copia la tarea", !(await clip(page)).includes(F) && !(await copiedShown(page)), (await clip(page)).slice(0, 80));
  L.check("IMAGEN: … y copia la imagen", await page.evaluate(async () => (await navigator.clipboard.read()).some((i) => i.types.includes("text/html"))).catch(() => false));
  // Sin nada seleccionado sigue copiando la tarea (el cursor en el editor, sin selección).
  await editor.getByText("Antes").first().click();
  await page.keyboard.press("Control+c");
  L.check("IMAGEN: con el cursor en el texto y nada seleccionado, la tarea", await statusShows(page, "Tarea copiada") && (await clip(page)).includes(F));
  L.assertNoErrors("imagen", [s]);
  await s.ctx.close();
}

// --- Título en una línea -------------------------------------------------------------------------------------------------
if (only.includes("titulo")) {
  L.scenario("titulo: el título pegado queda en una línea");
  await L.cleanBoard();
  const [dst] = await L.seedTasks(COL.backlog, ["Destino bh53"]);
  const s = await withClipboard();
  const { page } = s;
  await U.openTask(page, "Destino bh53");
  await setClip(page, JSON.stringify({ format: F, title: "Primera línea\n  segunda\tcon tabulador\r\n\r\ntercera" }));
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press("Control+v");
  await L.eqEventually("TITULO: saltos de línea y tabuladores pasan a ser un espacio", () => titleOf(dst), "Primera línea segunda con tabulador tercera");
  await L.eqEventually("TITULO: el detalle lo muestra igual", () => U.dialog(page).locator("textarea, input").first().inputValue(), "Primera línea segunda con tabulador tercera");
  L.assertNoErrors("titulo", [s]);
  await s.ctx.close();
}

// --- Bloqueo entre dos tareas borradas a la vez: deshacer, rehacer, deshacer ---------------------------------------------
if (only.includes("bloqueo")) {
  L.scenario("bloqueo: borrar dos tareas (una bloquea a la otra), deshacer, rehacer y deshacer conserva el bloqueo");
  await L.cleanBoard();
  const [a, b, fuera] = await L.seedTasks(COL.backlog, ["Bloquea bh53", "Bloqueada bh53", "Fuera bh53"]);
  await L.q(`UPDATE "Task" SET "blockedById"=$2 WHERE id IN ($1,$3)`, [b, a, fuera]);
  const blockers = async () => (await L.q(`SELECT title, "blockedById" FROM "Task" WHERE id IN ($1,$2) ORDER BY title`, [b, fuera])).map((r) => `${r.title}:${r.blockedById === a ? "bloqueada" : r.blockedById ?? "libre"}`);
  const BLOCKED = ["Bloqueada bh53:bloqueada", "Fuera bh53:bloqueada"];
  const s = await L.session();
  const { page } = s;
  for (const title of ["Bloquea bh53", "Bloqueada bh53"]) {
    await L.cardLoc(page, title).hover();
    await L.cardLoc(page, title).locator('[aria-label="Seleccionar"]').click();
    await L.waitFor(() => L.cardLoc(page, title).getAttribute("aria-pressed").then((v) => v === "true"), { timeout: 3000 });
  }
  const bar = page.locator("[data-selection-bar]");
  await bar.getByRole("button", { name: "Borrar" }).click();
  await page.getByRole("button", { name: "Borrar", exact: true }).last().click();
  await L.eqEventually("BLOQUEO: las dos se borran y la de fuera queda libre", blockers, ["Fuera bh53:libre"]);
  await U.undoKey(page, "Control+z");
  await L.eqEventually("BLOQUEO: deshacer las devuelve con sus bloqueos", blockers, BLOCKED);
  await U.undoKey(page, "Control+Shift+z", "REDO");
  await L.eqEventually("BLOQUEO: rehacer las vuelve a borrar", blockers, ["Fuera bh53:libre"]);
  await U.undoKey(page, "Control+z");
  await L.eqEventually("BLOQUEO: el segundo deshacer también conserva los bloqueos (antes «Bloqueada» volvía libre)", blockers, BLOCKED);
  await L.checkEventually("BLOQUEO: el tablero vuelve a mostrar las dos tarjetas", async () => (await L.cardLoc(page, "Bloquea bh53").count()) === 1 && (await L.cardLoc(page, "Bloqueada bh53").count()) === 1);
  L.assertNoErrors("bloqueo", [s]);
  await s.ctx.close();
}

// --- ?doc=…#apartado mientras algo lee el marco --------------------------------------------------------------------------
if (only.includes("apartado")) {
  L.scenario("apartado: «?doc=…#apartado» baja al apartado aunque se lea el marco mientras carga");
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p0.id]);
  const s = await L.session();
  const { page } = s;
  const filler = Array.from({ length: 80 }, (_, i) => `<p>Relleno ${i}</p>`).join("");
  const html = `<!doctype html><html><head><title>Largo</title></head><body><h1>Documento largo del curso</h1>${filler}<h2 id="apartado-b">Apartado B</h2><p>Texto del apartado B.</p>${filler}</body></html>`;
  await page.goto(`${L.BASE}/p/${p0.id}/docs`);
  await page.getByRole("heading", { name: /Documentación/ }).first().waitFor({ timeout: 15000 });
  await sleep(1000); // hidratación: el cambio del selector lo atiende React
  await page.locator("input[type=file][aria-label='Subir archivos']").setInputFiles({ name: "largo-bh53.html", mimeType: "text/html", buffer: Buffer.from(html) });
  L.check("APARTADO: subida del documento", await L.waitFor(async () => (await L.q(`SELECT 1 FROM "ProjectDocument" WHERE "projectId"=$1 AND name='largo-bh53.html'`, [p0.id])).length === 1, { timeout: 15000 }));
  const [d] = await L.q(`SELECT id FROM "ProjectDocument" WHERE "projectId"=$1 AND name='largo-bh53.html'`, [p0.id]);
  // Cada pasada abre el documento en una pestaña nueva y lee el marco sin parar desde que aparece (lo que hace una prueba
  // que espera a su contenido, un lector de pantalla o una extensión): si el marco va al apartado antes de tener su tamaño,
  // busca el apartado con 0 px de ancho y se queda arriba (scroll 0) o muy por debajo. Antes fallaba 1 de cada 10-20.
  const RUNS = Number(process.env.BH53_RUNS || 40);
  const wrong = [];
  for (let i = 0; i < RUNS; i++) {
    const tab = await s.ctx.newPage();
    let stop = false;
    const hammer = async (f) => { while (!stop) { try { await f.evaluate(() => { document.body?.getBoundingClientRect(); return window.innerWidth; }); } catch { await sleep(1); } } };
    tab.on("frameattached", (f) => void hammer(f));
    await tab.goto(`${L.BASE}/p/${p0.id}/docs?doc=${d.id}#apartado-b`);
    const frame = tab.frameLocator("iframe[data-testid=doc-html]");
    let top = null;
    const ok = await L.waitFor(async () => {
      top = await frame.locator("#apartado-b").evaluate((el) => Math.round(el.getBoundingClientRect().top)).catch(() => null);
      return top !== null && top > -20 && top < 400;
    }, { timeout: 5000 });
    stop = true;
    if (!ok) wrong.push(`#${i}: ${top}`);
    await tab.close();
  }
  L.check(`APARTADO: las ${RUNS} veces el marco queda en el apartado`, wrong.length === 0, wrong.join(", "));
  await s.ctx.close();
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p0.id]);
}

await L.q(`UPDATE "User" SET "editorMode"=$2 WHERE id=$1`, [me.id, me.editorMode]);
await L.cleanBoard();
await L.closeBrowser(); await L.closeDb();
fs.rmSync(TMP, { recursive: true, force: true });
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
