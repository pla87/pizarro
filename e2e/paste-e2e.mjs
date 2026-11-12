// Pegar en las tareas (R43C2 y tablas): una imagen pegada se adjunta una sola vez y sin avisos, esté el foco en el título,
// la descripción, una subtarea o fuera de cualquier caja (nueva tarea y detalle); una imagen que el evento da vacía se
// recupera del portapapeles; el texto de Office no adjunta su «foto»; y las tablas HTML (Word, Google Docs, una web)
// entran como tabla Markdown sin cambiar el resto del pegado ni el pegado de Markdown en texto plano.
//
// Con la base pz_qa preparada por la suite y un servidor arrancado:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node paste-e2e.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { COL, sleep } = L;
const APP = process.env.APP_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const fixture = (name) => fs.readFileSync(path.join(APP, "tests", "fixtures", "paste", name), "utf8");
// PNG de 1×1.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

await L.prepareUsers();
await L.cleanBoard();
await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG'`);

const s = await L.session({ viewport: { width: 1400, height: 900 } });
await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
const p = s.page;
// Avisos rojos (los de error llevan role=alert; next-route-announcer también, por eso se filtra por clase).
const errorToasts = () => p.locator("div[role=alert].pointer-events-auto").count();
const thumbs = () => p.locator("[role=dialog] img[src^='blob:']").count();
const attachments = async (title) => Number((await L.q(`SELECT count(*) n FROM "TaskAttachment" a JOIN "Task" t ON t.id=a."taskId" WHERE t.title=$1`, [title]))[0].n);
const desc = async (title) => (await L.q(`SELECT description FROM "Task" WHERE title=$1`, [title]))[0]?.description;

/** Imagen en el portapapeles real del navegador (`text`/`html`: lo que la acompaña, como al copiar de Word). */
const clipImage = (extra = {}) =>
  p.evaluate(async ([b64, extra]) => {
    const parts = { "image/png": new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" }) };
    if (extra.text) parts["text/plain"] = new Blob([extra.text], { type: "text/plain" });
    if (extra.html) parts["text/html"] = new Blob([extra.html], { type: "text/html" });
    await navigator.clipboard.write([new ClipboardItem(parts)]);
  }, [PNG, extra]);
/** Pegado con un DataTransfer propio sobre el elemento con el foco: `files` y `items` traen la misma imagen. */
const pasteSynthetic = ({ bytes = true, html = "", text = "" } = {}) =>
  p.evaluate(([b64, bytes, html, text]) => {
    const dt = new DataTransfer();
    if (text) dt.setData("text/plain", text);
    if (html) dt.setData("text/html", html);
    if (bytes !== null) dt.items.add(new File(bytes ? [Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))] : [], "image.png", { type: "image/png" }));
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [PNG, bytes, html, text]);

async function openNew() {
  await p.keyboard.press("Alt+n");
  await p.locator('input[id$="-title"]').first().waitFor();
  await sleep(500);
}
async function discardNew() {
  for (let i = 0; i < 3 && (await p.locator("[role=dialog]").count()); i++) {
    await U.dialog(p).getByRole("button", { name: "Cancelar", exact: true }).last().click();
    await sleep(300);
    const discard = p.getByRole("button", { name: "Descartar", exact: true });
    if (await discard.count()) await discard.click();
    await sleep(400);
  }
  L.check("(el diálogo se cierra)", (await p.locator("[role=dialog]").count()) === 0);
}
const focusNew = {
  "título": () => p.locator('input[id$="-title"]').first().focus(),
  "descripción": () => U.dialog(p).locator("[contenteditable=true]").first().click(),
  subtarea: () => U.dialog(p).locator("input[placeholder='Añadir subtarea…']").first().focus(),
  "un botón": () => U.dialog(p).getByRole("button", { name: "Cancelar", exact: true }).focus(),
  "fuera de las cajas": () => p.evaluate(() => (document.activeElement)?.blur()),
};

try {
  // ------------------------------------------------------------ Nueva tarea
  L.scenario("R43C2: pegar una imagen en «Nueva tarea»");
  for (const how of ["evento", "Ctrl+V"]) {
    for (const [where, focus] of Object.entries(focusNew)) {
      await openNew();
      await focus();
      const t0 = await errorToasts();
      if (how === "evento") await pasteSynthetic();
      else {
        await clipImage();
        await p.keyboard.press("Control+v");
      }
      await sleep(700);
      L.eq(`NUEVA (${how}, foco en ${where}): una sola imagen adjunta`, await thumbs(), 1);
      L.eq(`NUEVA (${how}, foco en ${where}): ningún aviso rojo`, (await errorToasts()) - t0, 0);
      if (where === "descripción") L.eq(`NUEVA (${how}): la descripción no recibe nada`, (await U.dialog(p).locator("[contenteditable=true]").first().innerText()).trim(), "");
      if (how === "Ctrl+V" && where === "fuera de las cajas") await p.screenshot({ path: path.join(SHOTS, "paste-new-outside.png") });
      await discardNew();
    }
  }

  // Imagen que el evento da vacía (como en Windows): se recupera del portapapeles; si no hay imagen, un solo aviso.
  await openNew();
  await clipImage();
  await p.locator('input[id$="-title"]').first().focus();
  await pasteSynthetic({ bytes: false });
  await sleep(900);
  L.eq("NUEVA: imagen vacía en el evento → se recupera del portapapeles (1 adjunta)", await thumbs(), 1);
  L.eq("NUEVA: imagen vacía recuperada → sin aviso", await errorToasts(), 0);
  await p.evaluate(() => navigator.clipboard.writeText("solo texto"));
  await pasteSynthetic({ bytes: false });
  await sleep(900);
  L.eq("NUEVA: imagen vacía sin recuperación → no se adjunta", await thumbs(), 1);
  L.eq("NUEVA: imagen vacía sin recuperación → un solo aviso", await p.getByText("La imagen pegada ha llegado vacía desde el portapapeles", { exact: false }).count(), 1);
  await p.screenshot({ path: path.join(SHOTS, "paste-new-empty.png") });
  await discardNew();
  // Que se vaya el aviso (dura unos segundos) para que no cuente en las comprobaciones siguientes.
  await p.getByText("La imagen pegada ha llegado vacía desde el portapapeles", { exact: false }).first().waitFor({ state: "hidden", timeout: 15000 });

  // Texto copiado de Word con su «foto»: en la descripción entra el texto (la tabla), sin adjunto.
  await openNew();
  await U.dialog(p).locator("[contenteditable=true]").first().click();
  await pasteSynthetic({ html: fixture("word.html"), text: "Resumen de la reunión:\nTarea\tResponsable\tEstado\n" });
  await sleep(700);
  L.eq("OFFICE: el texto de Word no adjunta su imagen", await thumbs(), 0);
  L.eq("OFFICE: la tabla de Word entra en la descripción", await U.dialog(p).locator("table[data-md-table] th").allTextContents(), ["Tarea", "Responsable", "Estado"]);
  // Fuera de las cajas, la imagen sí se adjunta (no hay dónde pegar el texto).
  await p.evaluate(() => (document.activeElement)?.blur());
  await pasteSynthetic({ html: "<p>hola</p>", text: "hola" });
  await sleep(700);
  L.eq("OFFICE: fuera de las cajas, la imagen se adjunta", await thumbs(), 1);
  await discardNew();

  // Crear con dos imágenes pegadas: se guardan exactamente dos.
  await openNew();
  await p.locator('input[id$="-title"]').first().fill("Con capturas");
  await clipImage();
  await p.keyboard.press("Control+v");
  await sleep(400);
  await U.dialog(p).locator("[contenteditable=true]").first().click();
  await p.keyboard.press("Control+v");
  await sleep(600);
  L.eq("NUEVA: dos pegados → dos miniaturas", await thumbs(), 2);
  await p.keyboard.press("Alt+s");
  await L.eqEventually("NUEVA: la tarea se crea con 2 adjuntos", () => attachments("Con capturas"), 2, { timeout: 15000 });
  await sleep(600);

  // ------------------------------------------------------------ Detalle de una tarea
  L.scenario("R43C2: pegar una imagen en el detalle de una tarea");
  await L.seedTasks(COL.backlog, ["Detalle pegado"]);
  await L.reload(p);
  await U.openTask(p, "Detalle pegado");
  const d = U.dialog(p);
  const focusDetail = {
    "título": () => d.locator("textarea[aria-label='Título']").first().focus(),
    "descripción": async () => {
      await d.getByRole("button", { name: "Añade una descripción…" }).click();
      await sleep(500);
      await d.locator("[contenteditable=true]").first().click();
    },
    subtarea: () => d.locator("input[placeholder='Añadir subtarea…']").first().focus(),
    "fuera de las cajas": () => p.evaluate(() => (document.activeElement)?.blur()),
  };
  let expected = 0;
  for (const [where, focus] of Object.entries(focusDetail)) {
    await focus();
    const t0 = await errorToasts();
    await clipImage();
    await p.keyboard.press("Control+v");
    expected++;
    await L.eqEventually(`DETALLE (foco en ${where}): un adjunto más (${expected})`, () => attachments("Detalle pegado"), expected, { timeout: 10000 });
    L.eq(`DETALLE (foco en ${where}): ningún aviso rojo`, (await errorToasts()) - t0, 0);
  }
  await sleep(800);
  L.eq("DETALLE: la descripción no recibió nada", (await d.locator("[contenteditable=true]").first().innerText()).trim(), "");
  await p.screenshot({ path: path.join(SHOTS, "paste-detail.png") });
  await U.closeDialog(p);
  await sleep(400);

  // ------------------------------------------------------------ Tablero
  L.scenario("Atajo de captura del tablero");
  await clipImage();
  await p.evaluate(() => (document.activeElement)?.blur());
  await p.keyboard.press("Control+v");
  await U.dialog(p).waitFor();
  await sleep(600);
  L.eq("TABLERO: pegar abre «Nueva tarea» con una sola captura", await thumbs(), 1);
  L.eq("TABLERO: sin avisos", await errorToasts(), 0);
  await discardNew();

  // ------------------------------------------------------------ Tablas
  L.scenario("Tablas pegadas desde Word, Google Docs y una web");
  const cases = [
    { name: "Word", file: "word.html", head: ["Tarea", "Responsable", "Estado"], before: "Resumen de la reunión:", after: "Siguiente paso: enviar el resumen.", md: "| Tarea | Responsable | Estado |\n| --- | --- | --- |\n| Revisar el *presupuesto* \\| v2 | Ana Luis | Pendiente |\n| Ver [el documento](https://example.com/doc) |  | Hecho |" },
    { name: "Google Docs", file: "gdocs.html", head: ["Día", "Objetivo"], before: "Plan de la semana", after: "Fin del plan.", md: "| Día | Objetivo |\n| --- | --- |\n| Lunes | Cerrar la *release* 1.2 |\n| Martes | [Informe](https://example.com/informe) para **dirección** (segunda línea) |" },
    { name: "web", file: "web.html", head: ["Plan", "Precio", "Notas"], before: "Datos de ejemplo por plan:", after: "Precios con IVA.", md: "| Plan | Precio | Notas |\n| --- | --- | --- |\n| Básico | 5 € | Uso *personal* sin soporte |\n|  | 50 €/año | Pago anual: a\\|b |\n| **Pro** | Consultar en [la web](https://example.com/precios) |  |\n| Anidada | x y | \\*no\\* es cursiva |" },
  ];
  for (const c of cases) {
    const title = `Tabla ${c.name}`;
    await openNew();
    await p.locator('input[id$="-title"]').first().fill(title);
    const ed = U.dialog(p).locator("[contenteditable=true]").first();
    await ed.click();
    await pasteSynthetic({ bytes: null, html: fixture(c.file), text: `${c.before}\n${c.head.join("\t")}\n${c.after}` });
    await sleep(600);
    L.eq(`TABLA ${c.name}: se ve como tabla en el editor`, await ed.locator("table[data-md-table] th").allTextContents(), c.head);
    const text = await ed.innerText();
    L.check(`TABLA ${c.name}: el texto de alrededor sigue entrando`, text.includes(c.before) && text.includes(c.after), JSON.stringify(text.slice(0, 200)));
    if (c.name === "Word") await p.screenshot({ path: path.join(SHOTS, "paste-table-editor.png") });
    await p.keyboard.press("Alt+s");
    await L.eqEventually(`TABLA ${c.name}: se guarda como tabla Markdown`, async () => {
      const saved = (await desc(title)) ?? "";
      return saved.includes(c.md) ? c.md : saved;
    }, c.md);
    await sleep(500);
  }
  // Se ve como tabla en el detalle.
  await U.openTask(p, "Tabla web");
  L.eq("TABLA: en el detalle se pinta una tabla", await U.dialog(p).locator(".prose-md table th").allTextContents(), ["Plan", "Precio", "Notas"]);
  L.eq("TABLA: «|» escapado dentro de la celda", (await U.dialog(p).locator(".prose-md table td").allTextContents()).includes("Pago anual: a|b"), true);
  await p.screenshot({ path: path.join(SHOTS, "paste-table-detail.png") });
  await U.closeDialog(p);

  // Con el portapapeles real (Chrome limpia el HTML al escribirlo): una tabla de una web y Markdown en texto plano.
  await openNew();
  await p.locator('input[id$="-title"]').first().fill("Tabla real");
  let ed = U.dialog(p).locator("[contenteditable=true]").first();
  await ed.click();
  await p.evaluate(async () => {
    const html = "<p>Antes</p><table><tr><th>A</th><th>B</th></tr><tr><td><b>1</b></td><td>2|3</td></tr></table><p>Después</p>";
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob(["Antes\nA\tB\n1\t2|3\nDespués"], { type: "text/plain" }) })]);
  });
  await p.keyboard.press("Control+v");
  await sleep(500);
  await p.keyboard.press("Alt+s");
  await L.eqEventually("TABLA (Ctrl+V): se guarda con el texto de alrededor", () => desc("Tabla real"), "Antes\n\n| A | B |\n| --- | --- |\n| **1** | 2\\|3 |\n\nDespués");
  await sleep(500);

  await openNew();
  await p.locator('input[id$="-title"]').first().fill("Markdown plano");
  ed = U.dialog(p).locator("[contenteditable=true]").first();
  await ed.click();
  await p.evaluate(() => navigator.clipboard.writeText("## Título\n\n- uno\n- **dos**\n\n| a | b |\n|---|---|\n| 1 | 2 |"));
  await p.keyboard.press("Control+v");
  await sleep(500);
  await p.keyboard.press("Alt+s");
  await L.eqEventually("MARKDOWN: el pegado de Markdown en texto plano no cambia", () => desc("Markdown plano"), "## Título\n\n- uno\n- **dos**\n\n| a | b |\n|---|---|\n| 1 | 2 |");

  // Modo Markdown: una tabla de una hoja de cálculo (con la «foto» que añade Excel) entra como tabla Markdown, sin adjunto.
  await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN'`);
  await L.reload(p);
  await openNew();
  await p.locator('input[id$="-title"]').first().fill("Hoja en Markdown");
  const ta = U.dialog(p).locator("textarea[placeholder^='Markdown']").first();
  await ta.click();
  await p.keyboard.type("Ventas:");
  await pasteSynthetic({ html: '<google-sheets-html-origin><style>td{}</style><table><tr><td>Mes</td><td>Total</td></tr><tr><td>Enero</td><td>1.200</td></tr></table></google-sheets-html-origin>', text: "Mes\tTotal\nEnero\t1.200" });
  await sleep(500);
  L.eq("MARKDOWN: la tabla de la hoja entra como tabla Markdown", await ta.inputValue(), "Ventas:\n\n| Mes | Total |\n| --- | --- |\n| Enero | 1.200 |");
  L.eq("MARKDOWN: sin adjuntar la imagen de la hoja", await thumbs(), 0);
  await p.keyboard.press("Alt+s");
  await L.eqEventually("MARKDOWN: se guarda", () => desc("Hoja en Markdown"), "Ventas:\n\n| Mes | Total |\n| --- | --- |\n| Enero | 1.200 |");
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG'`);

  L.assertNoErrors("PEGADO", [s]);
} finally {
  await s.ctx.close();
  await L.closeBrowser();
  await L.closeDb();
}
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
if (failed.length) process.exitCode = 1;
