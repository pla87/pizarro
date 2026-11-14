// Caza de bugs 52 (Documentación, archivar/borrar al instante): (1) en un HTML de Documentación, un enlace al PROPIO
// documento por su nombre («indice.html#abajo» dentro de indice.html) se desplaza en el marco (antes abría una pestaña nueva
// con el mismo documento en cada clic), un enlace sin ruta («», «?v=2») tampoco sale desactivado como «no está en la
// Documentación», y los nombres se comparan como se guardan al subir (espacios seguidos en uno, tildes descompuestas de
// macOS); (2) un binario que empieza por FF FE (el BOM de UTF-16) ya no pasa por texto y un HTML con
// `<meta charset="unicode">` sin BOM se ve bien; (3) archivar o borrar desde el detalle sin red, con la descripción a medio
// escribir: la tarjeta vuelve y, al abrirla otra vez, lo escrito sigue ahí (antes se perdía). Misma base y servidor que
// board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh52-e2e.mjs      # PART=enlaces,binario,borrador
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { COL, sleep } = L;
const only = (process.env.PART || "enlaces,binario,borrador").split(",");

await L.prepareUsers();
const p0 = await L.project();
const [me] = await L.q(`SELECT id, "editorMode" FROM "User" WHERE email=$1`, [L.ADMIN]);
await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [me.id]);

/** Sube un documento con el selector de archivos (desde memoria: los nombres con tildes no dependen del disco). */
async function upload(page, name, body, mimeType = "text/html") {
  await page.goto(`${L.BASE}/p/${p0.id}/docs`);
  await page.getByRole("heading", { name: /Documentación/ }).first().waitFor({ timeout: 15000 });
  await sleep(1000); // hidratación: el cambio del selector lo atiende React
  await page.locator("input[type=file][aria-label='Subir archivos']").setInputFiles({ name, mimeType, buffer: Buffer.from(body) });
  return L.waitFor(async () => (await L.q(`SELECT 1 FROM "ProjectDocument" WHERE "projectId"=$1 AND name=$2`, [p0.id, name.normalize("NFC").replace(/\s+/g, " ")])).length === 1, { timeout: 15000 });
}
const doc = async (name) => (await L.q(`SELECT id,kind FROM "ProjectDocument" WHERE "projectId"=$1 AND name=$2`, [p0.id, name]))[0];
async function openDoc(page, name) {
  const d = await doc(name);
  await page.goto(`${L.BASE}/p/${p0.id}/docs`);
  await page.locator(`[data-doc-open="${d.id}"]`).first().click();
  await U.dialog(page).getByText(name).first().waitFor();
  return d;
}

// --- Enlaces al propio documento y nombres arreglados --------------------------------------------------------------------
if (only.includes("enlaces")) {
  L.scenario("enlaces: el propio documento, sin ruta, espacios seguidos y tildes de macOS");
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p0.id]);
  const s = await L.session();
  const { page } = s;
  const filler = Array.from({ length: 80 }, (_, i) => `<p>Relleno ${i}</p>`).join("");
  const nfd = "lección.html".normalize("NFD");
  L.check("subida: «lección.html»", await upload(page, "lección.html", `<html><body><h1>Lección</h1></body></html>`));
  L.check("subida: «a  b.html» (se guarda «a b.html»)", await upload(page, "a  b.html", `<html><body><h1>AB</h1></body></html>`));
  L.check("subida: «indice.html»", await upload(page, "indice.html", `<!doctype html><html><head><title>Índice</title></head><body><h1 id="arriba">Índice</h1>
<a id="self" href="indice.html#abajo">Abajo (por su nombre)</a>
<a id="selfmay" href="./INDICE.HTML">Arriba (por su nombre, sin apartado)</a>
<a id="vacio" href="">Este documento</a>
<a id="query" href="?v=2#abajo">Abajo (con consulta)</a>
<a id="nfd" href="${encodeURIComponent(nfd)}">Lección (NFD)</a>
<a id="dosesp" href="a%20%20b.html">AB</a>
<a id="falta" href="otro.html">No está</a>
${filler}<h2 id="abajo">Abajo del todo</h2>${filler}</body></html>`));
  const dIndice = await doc("indice.html");
  const dLeccion = await doc("lección.html");
  const dAb = await doc("a b.html");
  await openDoc(page, "indice.html");
  const frameEl = page.locator("iframe[data-testid=doc-html]");
  const frame = page.frameLocator("iframe[data-testid=doc-html]");
  await frame.getByRole("heading", { name: "Índice" }).waitFor({ timeout: 10000 });
  const attr = (id, a) => frame.locator(`#${id}`).getAttribute(a);
  L.eq("ENL: «indice.html#abajo» dentro de indice.html se queda en el marco", [await attr("self", "href"), await attr("self", "target")], ["about:srcdoc#abajo", "_self"]);
  L.eq("ENL: «./INDICE.HTML» (sin apartado), al principio del mismo documento", [await attr("selfmay", "href"), await attr("selfmay", "target")], ["about:srcdoc#", "_self"]);
  L.eq("ENL: href vacío = este documento (no «no está en la Documentación»)", [await attr("vacio", "href"), await attr("vacio", "title")], ["about:srcdoc#", null]);
  L.eq("ENL: «?v=2#abajo» = este documento", await attr("query", "href"), "about:srcdoc#abajo");
  L.eq("ENL: tildes descompuestas (NFD) encuentran «lección.html»", await attr("nfd", "href"), `/p/${p0.id}/docs?doc=${dLeccion.id}`);
  L.eq("ENL: «a%20%20b.html» encuentra «a b.html»", await attr("dosesp", "href"), `/p/${p0.id}/docs?doc=${dAb.id}`);
  L.eq("ENL: un fichero que no está sigue desactivado", [await attr("falta", "href"), await attr("falta", "aria-disabled")], [null, "true"]);
  L.check("ENL: ningún enlace apunta al propio documento con ?doc=", !(await frameEl.getAttribute("srcdoc")).includes(`doc=${dIndice.id}`));

  // Clic en el enlace al propio documento: se desplaza al apartado, sin abrir pestañas ni salir de la página.
  let popped = 0;
  const onPage = () => { popped++; };
  page.context().on("page", onPage);
  const url0 = page.url();
  const top = () => frame.locator("#abajo").evaluate((el) => Math.round(el.getBoundingClientRect().top));
  await frame.locator("#self").click();
  await L.checkEventually("ENL: clic en «indice.html#abajo»: el marco baja al apartado", async () => { const y = await top(); return [y > -20 && y < 400, String(y)]; });
  await frame.locator("#selfmay").scrollIntoViewIfNeeded();
  await frame.locator("#selfmay").click();
  await L.checkEventually("ENL: clic en «./INDICE.HTML»: vuelve arriba", async () => { const y = await frame.locator("#arriba").evaluate((el) => Math.round(el.getBoundingClientRect().top)); return [y >= 0 && y < 100, String(y)]; });
  await frame.locator("#query").click();
  await L.checkEventually("ENL: clic en «?v=2#abajo»: baja al apartado", async () => { const y = await top(); return [y > -20 && y < 400, String(y)]; });
  await sleep(500);
  L.check("ENL: ninguno ha abierto otra pestaña ni cambiado la página", popped === 0 && page.url() === url0 && (await frameEl.count()) === 1, `${popped} pestañas, ${page.url()}`);
  L.check("ENL: el marco sigue mostrando el documento", await frame.getByRole("heading", { name: "Índice" }).isVisible());
  page.context().off("page", onPage);
  // El enlace NFD abre «lección.html» en otra pestaña.
  const [tab] = await Promise.all([page.context().waitForEvent("page", { timeout: 10000 }), frame.locator("#nfd").click()]);
  await tab.waitForLoadState();
  await tab.frameLocator("iframe[data-testid=doc-html]").getByRole("heading", { name: "Lección" }).waitFor({ timeout: 15000 });
  L.eq("ENL: la pestaña del enlace NFD es «lección.html»", new URL(tab.url()).search, `?doc=${dLeccion.id}`);
  await tab.close();
  // Chromium avisa en la consola de cada desplazamiento dentro del marco sin scripts: es esperado (como en r52-html).
  L.assertNoErrors("enlaces", [{ errors: s.errors.filter((e) => !/Blocked script execution in 'about:srcdoc/.test(e)) }]);
  await s.ctx.close();
}

// --- Binarios con BOM de UTF-16 y meta «unicode» -----------------------------------------------------------------------------
if (only.includes("binario")) {
  L.scenario("binario: FF FE delante no lo convierte en texto; <meta charset=unicode> sin BOM");
  const s = await L.session();
  const { page } = s;
  // Ruido determinista (sin controles en los bytes): con el BOM delante, antes se veía como texto (caracteres chinos).
  const noise = Buffer.from(Array.from({ length: 3000 }, (_, i) => ((Math.imul(i + 1, 2654435761) >>> 13) & 0xff)));
  L.check("subida: «datos.txt» (FF FE + binario)", await upload(page, "datos.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), noise]), "text/plain"));
  L.check("subida: «sonido.html» (FE FF + binario)", await upload(page, "sonido.html", Buffer.concat([Buffer.from([0xfe, 0xff]), noise])));
  L.check("subida: «nota16.txt» (UTF-16 de verdad)", await upload(page, "nota16.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Camión 你好 😀 fin", "utf16le")]), "text/plain"));
  L.check("subida: «word.html» (meta unicode, sin BOM)", await upload(page, "word.html", Buffer.from('<html><head><meta http-equiv="Content-Type" content="text/html; charset=unicode"></head><body><p id="t">Camión ñandú</p></body></html>')));
  L.eq("BIN: tipos", Object.fromEntries(await Promise.all(["datos.txt", "sonido.html", "nota16.txt", "word.html"].map(async (n) => [n, (await doc(n)).kind]))), { "datos.txt": "OTHER", "sonido.html": "OTHER", "nota16.txt": "TEXT", "word.html": "HTML" });
  await openDoc(page, "datos.txt");
  L.check("BIN: «datos.txt» binario: sin vista previa, solo descarga", (await page.locator("[data-testid=doc-text]").count()) === 0 && (await U.dialog(page).getByText(/no tiene vista previa/).isVisible()));
  await page.keyboard.press("Escape");
  await openDoc(page, "nota16.txt");
  await page.locator("[data-testid=doc-text]").waitFor({ timeout: 10000 });
  L.eq("BIN: «nota16.txt» UTF-16 de verdad se sigue viendo", await page.locator("[data-testid=doc-text]").innerText(), "Camión 你好 😀 fin");
  await page.keyboard.press("Escape");
  await openDoc(page, "word.html");
  const frame = page.frameLocator("iframe[data-testid=doc-html]");
  await frame.locator("#t").waitFor({ timeout: 10000 });
  L.eq("BIN: «word.html» con meta «unicode» sin BOM se ve bien (antes, caracteres chinos)", await frame.locator("#t").innerText(), "Camión ñandú");
  L.assertNoErrors("binario", [s]);
  await s.ctx.close();
}

// --- Borrador tras archivar o borrar sin red ------------------------------------------------------------------------------
if (only.includes("borrador")) {
  L.scenario("borrador: archivar o borrar desde el detalle sin red no pierde lo escrito");
  await L.cleanBoard();
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG' WHERE id=$1`, [me.id]);
  await L.seedTasks(COL.backlog, ["Archivo sin red", "Borro sin red", "Otra tarea"]);
  const s = await L.session({ viewport: U.WIDE });
  const p = s.page;
  const descOf = async (title) => (await L.q(`SELECT description FROM "Task" WHERE title=$1`, [title]))[0]?.description ?? null;
  async function typeDescription(text) {
    const d = U.dialog(p);
    await d.getByRole("button", { name: "Añade una descripción…" }).click();
    await d.locator("[role=textbox][contenteditable]").first().click();
    await p.keyboard.type(text);
    await sleep(600); // el borrador recoge el texto con un pequeño retardo
  }
  for (const [title, action] of [["Archivo sin red", "archivar"], ["Borro sin red", "borrar"]]) {
    const text = `Lo que escribí antes de ${action}`;
    await U.openTask(p, title);
    await typeDescription(text);
    await s.ctx.setOffline(true);
    if (action === "archivar") await U.dialog(p).getByRole("button", { name: "Archivar" }).first().click();
    else {
      // El de la tarea (con la descripción abierta también hay un «Borrar» del texto).
      await U.dialog(p).getByRole("button", { name: "Borrar", exact: true }).last().click();
      await p.locator("[role=dialog]").filter({ hasText: "¿Borrar definitivamente esta tarea" }).getByRole("button", { name: "Borrar", exact: true }).click();
    }
    await U.dialog(p).waitFor({ state: "detached", timeout: 3000 });
    await L.checkEventually(`${action} sin red: la tarjeta vuelve`, async () => (await L.cardLoc(p, title).count()) === 1, { timeout: 8000 });
    await s.ctx.setOffline(false);
    await sleep(800);
    await U.openTask(p, title);
    await L.checkEventually(`${action} sin red: al abrirla otra vez, lo escrito sigue en la descripción`, async () => (await U.dialog(p).locator("[role=textbox][contenteditable]").first().innerText().catch(() => "")).includes(text), { timeout: 5000 });
    await U.dialog(p).locator("[role=textbox][contenteditable]").first().click();
    await p.keyboard.press("Control+Enter");
    await L.eqEventually(`${action} sin red: … y se guarda`, () => descOf(title), text, { timeout: 8000 });
    await U.closeDialog(p);
    L.eq(`${action} sin red: sigue en la BD, sin archivar`, (await L.q(`SELECT "archivedAt" IS NULL AS a FROM "Task" WHERE title=$1`, [title]))[0]?.a, true);
  }
  // Una tarea sin borrador se abre limpia (no hereda el de otra).
  await U.openTask(p, "Otra tarea");
  await sleep(800);
  L.check("borrador: otra tarea no recibe el texto de ninguna", !(await U.dialog(p).innerText()).includes("Lo que escribí"));
  await U.closeDialog(p);
  s.errors = s.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e));
  L.assertNoErrors("borrador", [s]);
  await s.ctx.close();
  await L.q(`UPDATE "User" SET "editorMode"=$2 WHERE id=$1`, [me.id, me.editorMode]);
  await L.cleanBoard();
}

await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p0.id]);
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
