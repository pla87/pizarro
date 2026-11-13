// Copias de tareas con sus adjuntos (R48C1) y release con el editor con barra (R48C2). Misma base y servidor que
// board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r49-copy-e2e.mjs
// PART=dup,drag,keys,quota,mdup,rel,big,mrel para lanzar solo una parte.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep, COL } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "dup,drag,keys,quota,mdup,rel,big,mrel").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "r49-"));

// --- Ficheros de prueba ---------------------------------------------------------------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x % 256; raw[o + 1] = y % 256; raw[o + 2] = 90; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG = path.join(TMP, "captura.png"); fs.writeFileSync(PNG, makePng(400, 260));
const TXT = path.join(TMP, "notas.txt"); fs.writeFileSync(TXT, "Notas de la tarea\n".repeat(50));

const attachmentsOf = (title) => L.q(`SELECT a.id,a."originalName",a."isImage",a.size FROM "TaskAttachment" a JOIN "Task" t ON t.id=a."taskId" WHERE t.title=$1 ORDER BY a."originalName"`, [title]);
const countTitle = async (title) => Number((await L.q(`SELECT count(*) AS n FROM "Task" WHERE title=$1`, [title]))[0].n);

/** Sube los dos archivos a la tarea desde su detalle (como una persona). */
async function attachBoth(page, title) {
  await U.openTask(page, title);
  const input = U.dialog(page).locator("input[type=file]:not([capture])").first();
  await input.setInputFiles(PNG);
  await L.waitFor(async () => (await attachmentsOf(title)).length === 1, { timeout: 15000 });
  await input.setInputFiles(TXT);
  await L.waitFor(async () => (await attachmentsOf(title)).length === 2, { timeout: 15000 });
  await sleep(400);
  await U.closeDialog(page);
}

/** Bytes de un adjunto servido por la app (variante completa o miniatura). */
async function served(page, id, thumb = false) {
  return page.evaluate(async ([id, thumb]) => {
    const r = await fetch(`/api/attachments/${id}${thumb ? "?thumb=1" : ""}`);
    if (!r.ok) return { status: r.status };
    const b = new Uint8Array(await r.arrayBuffer());
    let h = 0;
    for (const x of b) h = (h * 31 + x) >>> 0;
    return { status: r.status, size: b.length, hash: h };
  }, [id, thumb]);
}

/** La copia tiene los mismos adjuntos que la original, con ids propios y el mismo contenido (y miniatura). */
async function sameAttachments(page, label, orig, copy) {
  const a = await attachmentsOf(orig), b = await attachmentsOf(copy);
  L.eq(`${label}: mismos adjuntos (nombre, tipo, tamaño)`, b.map((x) => [x.originalName, x.isImage, x.size]), a.map((x) => [x.originalName, x.isImage, x.size]));
  L.check(`${label}: cada copia con su propio id`, b.length > 0 && b.every((x) => !a.some((y) => y.id === x.id)));
  for (const [i, x] of b.entries()) {
    const y = a[i];
    if (!y) continue;
    L.eq(`${label}: «${x.originalName}» servido igual que el original`, await served(page, x.id), await served(page, y.id));
    if (x.isImage) L.eq(`${label}: miniatura de «${x.originalName}» igual`, await served(page, x.id, true), await served(page, y.id, true));
  }
  return b;
}

await L.prepareUsers();
const p = await L.project();
const [admin] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
await L.q(`UPDATE "Project" SET "storageQuotaMb"=NULL, "taskAttachMaxMb"=80 WHERE id=$1`, [p.id]);
await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN' WHERE id=$1`, [admin.id]);

// --- Duplicar desde el detalle: adjuntos con su fichero, documentos de Google, borrado independiente, deshacer -------
if (only.includes("dup")) {
  L.scenario("dup: duplicar desde el detalle copia los adjuntos");
  await L.cleanBoard();
  const [orig] = await L.seedTasks(COL.backlog, ["Original"]);
  await L.seedTasks(COL.backlog, ["Siguiente"]);
  await L.q(`INSERT INTO "Subtask"(id,"taskId",title,done,position) VALUES ('r49_sub',$1,'Paso uno',true,1000)`, [orig]);
  await L.q(`INSERT INTO "TaskLink"(id,"taskId",kind,title,url,"externalId","shareStatus") VALUES ('r49_link',$1,'GOOGLE_DOC','Acta','https://docs.google.com/document/d/r49doc/edit','r49doc','SHARED')`, [orig]);
  const s = await L.session();
  const page = s.page;
  await attachBoth(page, "Original");
  await U.openTask(page, "Original");
  await U.dialog(page).getByRole("button", { name: "Duplicar", exact: true }).click();
  await page.getByText("Tarea duplicada").first().waitFor({ timeout: 10000 });
  await L.eqEventually("DUP: nace «Original (copia)»", () => countTitle("Original (copia)"), 1);
  const copied = await sameAttachments(page, "DUP", "Original", "Original (copia)");
  L.eq("DUP: sin aviso de adjuntos no copiados", await page.getByText(/No se ha(n)? copiado/).count(), 0);
  const [copy] = await L.q(`SELECT id FROM "Task" WHERE title='Original (copia)'`);
  L.eq("DUP: el documento de Google enlazado va con la copia (mismo documento)", (await L.q(`SELECT url,"externalId" FROM "TaskLink" WHERE "taskId"=$1`, [copy.id])).map((l) => [l.url, l.externalId]), [["https://docs.google.com/document/d/r49doc/edit", "r49doc"]]);
  L.eq("DUP: subtareas copiadas sin marcar", (await L.q(`SELECT title,done FROM "Subtask" WHERE "taskId"=$1`, [copy.id])).map((x) => [x.title, x.done]), [["Paso uno", false]]);
  await U.closeDialog(page);
  // La tarjeta de la copia cuenta sus adjuntos y su detalle los muestra (con la miniatura cargada).
  const card = L.cardLoc(page, "Original (copia)");
  L.check("DUP: la tarjeta de la copia indica adjuntos", /\b1\b/.test(await card.innerText()), await card.innerText());
  await U.openTask(page, "Original (copia)");
  const dlg = U.dialog(page);
  L.eq("DUP: el detalle de la copia ya no dice «Sin adjuntos»", await dlg.getByText("Sin adjuntos.").count(), 0);
  L.check("DUP: el detalle lista «notas.txt»", (await dlg.getByText("notas.txt").count()) > 0);
  await L.waitFor(async () => dlg.locator("img[src*='/api/attachments/']").first().evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false), { timeout: 8000 });
  L.check("DUP: la miniatura de la copia se carga", await dlg.locator("img[src*='/api/attachments/']").first().evaluate((img) => img.complete && img.naturalWidth > 0));
  await page.screenshot({ path: `${SHOTS}/r49-dup-detalle.png` });
  await U.closeDialog(page);

  // Borrar un adjunto de la original no toca el de la copia.
  await U.openTask(page, "Original");
  const del = U.dialog(page).getByRole("button", { name: "Borrar adjunto" }).first();
  await del.click({ force: true });
  await L.eqEventually("DUP: la original pierde un adjunto", async () => (await attachmentsOf("Original")).length, 1);
  await U.closeDialog(page);
  for (const x of copied) L.eq(`DUP: tras borrar el de la original, «${x.originalName}» de la copia sigue servido`, (await served(page, x.id)).status, 200);
  await U.undoKey(page, "Control+z");
  await L.eqEventually("DUP: deshacer devuelve el adjunto a la original", async () => (await attachmentsOf("Original")).length, 2);

  // Deshacer el duplicado quita la copia (y rehacer la devuelve con sus adjuntos).
  await U.undoKey(page, "Control+z");
  await L.eqEventually("DUP: deshacer quita la copia", () => countTitle("Original (copia)"), 0);
  L.eq("DUP: sin la copia, sus filas de adjuntos tampoco", Number((await L.q(`SELECT count(*) AS n FROM "TaskAttachment" WHERE id = ANY($1)`, [copied.map((x) => x.id)]))[0].n), 0);
  await U.undoKey(page, "Alt+Shift+z", "REDO");
  await L.eqEventually("DUP: rehacer la devuelve", () => countTitle("Original (copia)"), 1);
  L.eq("DUP: con los mismos adjuntos", (await attachmentsOf("Original (copia)")).map((x) => x.id).sort(), copied.map((x) => x.id).sort());
  for (const x of copied) L.eq(`DUP: tras rehacer, «${x.originalName}» se sirve`, (await served(page, x.id)).status, 200);
  L.assertNoErrors("DUP", [s]);
  await s.ctx.close();
}

// --- Ctrl al soltar en otra columna --------------------------------------------------------------------------------
if (only.includes("drag")) {
  L.scenario("drag: Ctrl al soltar en otra columna copia los adjuntos");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Arrastrada"]);
  await L.seedTasks(COL.doing, ["X"]);
  const s = await L.session({ viewport: { width: 1400, height: 900 } });
  const page = s.page;
  await attachBoth(page, "Arrastrada");
  const src = await L.cardLoc(page, "Arrastrada").boundingBox();
  const tb = await L.cardLoc(page, "X").boundingBox();
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(src.x + src.width / 2 + 8, src.y + src.height / 2 + 8, { steps: 4 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height - 4, { steps: 25 });
  await sleep(150);
  await page.keyboard.down("Control");
  await page.mouse.move(tb.x + tb.width / 2 + 1, tb.y + tb.height - 3, { steps: 2 });
  await sleep(150);
  await page.mouse.up();
  await page.keyboard.up("Control");
  await L.eqEventually("DRAG: la copia queda en «En progreso»", async () => (await L.q(`SELECT c.name FROM "Task" t JOIN "Column" c ON c.id=t."columnId" WHERE t.title='Arrastrada (copia)'`)).map((r) => r.name), [COL.doing]);
  await L.waitFor(async () => (await attachmentsOf("Arrastrada (copia)")).length === 2, { timeout: 8000 });
  await sameAttachments(page, "DRAG", "Arrastrada", "Arrastrada (copia)");
  L.assertNoErrors("DRAG", [s]);
  await s.ctx.close();
}

// --- Atajo Alt+Mayús+D ----------------------------------------------------------------------------------------------
if (only.includes("keys")) {
  L.scenario("keys: Alt+Mayús+D copia los adjuntos");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Por atajo"]);
  const s = await L.session();
  const page = s.page;
  await attachBoth(page, "Por atajo");
  await L.cardLoc(page, "Por atajo").focus();
  await page.keyboard.press("Alt+Shift+D");
  await L.eqEventually("KEYS: nace la copia", () => countTitle("Por atajo (copia)"), 1);
  await L.waitFor(async () => (await attachmentsOf("Por atajo (copia)")).length === 2, { timeout: 8000 });
  await sameAttachments(page, "KEYS", "Por atajo", "Por atajo (copia)");
  L.assertNoErrors("KEYS", [s]);
  await s.ctx.close();
}

// --- Cuota del proyecto: la copia se crea y avisa de lo que no cupo -------------------------------------------------
if (only.includes("quota")) {
  L.scenario("quota: lo que no cabe en la cuota no se copia y se avisa");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Pesada"]);
  const s = await L.session();
  const page = s.page;
  await attachBoth(page, "Pesada");
  const [{ used }] = await L.q(`SELECT COALESCE(SUM(a.size),0)::bigint AS used FROM "TaskAttachment" a JOIN "Task" t ON t.id=a."taskId" WHERE t."projectId"=$1`, [p.id]);
  const atts = await attachmentsOf("Pesada");
  const img = atts.find((a) => a.isImage), txt = atts.find((a) => !a.isImage);
  // Cuota justa para copiar la imagen (va primero) pero no el texto detrás: los adjuntos se copian en orden mientras caben.
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p.id]);
  const quotaBytes = Number(used) + img.size + txt.size - 1;
  const quotaMb = Math.ceil(quotaBytes / 1048576);
  // Relleno para que quede justo: un adjunto «virtual» en otra tarea (solo cuenta en la cuota).
  const [filler] = await L.seedTasks(COL.backlog, ["Relleno"]);
  await L.q(`INSERT INTO "TaskAttachment"(id,"taskId","originalName","mimeType","isImage",size) VALUES ('r49_fill',$1,'relleno.bin','application/octet-stream',false,$2)`, [filler, quotaMb * 1048576 - quotaBytes]);
  await L.q(`UPDATE "Project" SET "storageQuotaMb"=$1 WHERE id=$2`, [quotaMb, p.id]);
  await L.reload(page);
  await U.openTask(page, "Pesada");
  await U.dialog(page).getByRole("button", { name: "Duplicar", exact: true }).click();
  await L.eqEventually("QUOTA: la copia se crea igualmente", () => countTitle("Pesada (copia)"), 1);
  const notice = page.getByText(/No se ha copiado un adjunto: «notas\.txt»/).first();
  L.check("QUOTA: aviso con el adjunto que no se copió", await notice.waitFor({ timeout: 8000 }).then(() => true, () => false));
  L.check("QUOTA: el aviso explica la cuota", /Cuota de almacenamiento del proyecto superada/.test(await notice.innerText().catch(() => "")));
  await page.screenshot({ path: `${SHOTS}/r49-cuota.png` });
  L.eq("QUOTA: la copia lleva solo la imagen", (await attachmentsOf("Pesada (copia)")).map((a) => a.originalName), ["captura.png"]);
  await L.q(`UPDATE "Project" SET "storageQuotaMb"=NULL WHERE id=$1`, [p.id]);
  await L.q(`DELETE FROM "TaskAttachment" WHERE id='r49_fill'`);
  L.assertNoErrors("QUOTA", [s]);
  await s.ctx.close();
}

// --- Móvil (390 px): duplicar desde el detalle -----------------------------------------------------------------------
if (only.includes("mdup")) {
  L.scenario("mdup: duplicar en el móvil");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Móvil"]);
  const d = await L.session();
  await attachBoth(d.page, "Móvil");
  await d.ctx.close();
  const s = await L.session({ viewport: { width: 390, height: 800 }, mobile: true });
  const page = s.page;
  await L.cardLoc(page, "Móvil").click();
  await U.dialog(page).waitFor();
  await sleep(400);
  await U.dialog(page).getByRole("button", { name: "Duplicar", exact: true }).click();
  await L.eqEventually("MDUP: nace la copia", () => countTitle("Móvil (copia)"), 1);
  await L.waitFor(async () => (await attachmentsOf("Móvil (copia)")).length === 2, { timeout: 8000 });
  await sameAttachments(page, "MDUP", "Móvil", "Móvil (copia)");
  await page.screenshot({ path: `${SHOTS}/r49-movil-duplicar.png` });
  L.eq("MDUP: sin desbordamiento horizontal", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  L.assertNoErrors("MDUP", [s]);
  await s.ctx.close();
}

// --- Release con la barra de formato --------------------------------------------------------------------------------
const HEADER = "# Novedades\n\nHola **equipo**, esto es lo nuevo.";
const FOOTER = "_Gracias_ — el equipo";
const FOOTER2 = "Más info en https://example.com";
async function seedTemplates() {
  await L.q(`DELETE FROM "ReleaseTemplate" WHERE "userId"=$1`, [admin.id]);
  await L.q(`INSERT INTO "ReleaseTemplate"(id,"userId",kind,name,content,position) VALUES ('r49_h','${admin.id}','HEADER','Cabecera r49',$1,1),('r49_f','${admin.id}','FOOTER','Pie r49',$2,1),('r49_f2','${admin.id}','FOOTER','Pie dos',$3,2)`, [HEADER, FOOTER, FOOTER2]);
}
/** Abre «Generar release» (Alt+R), genera y devuelve el diálogo en el paso 2. */
async function generate(page, n, { mobile = false } = {}) {
  if (mobile) {
    // En el móvil, como una persona: la pestaña de la columna y su botón «Generar Release».
    await page.locator("button").filter({ hasText: /^Siguiente salto/ }).first().tap();
    await sleep(400);
    await page.getByRole("button", { name: /Generar Release/ }).filter({ visible: true }).first().tap();
  } else {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press("Alt+R");
  }
  const dlg = U.dialog(page);
  await dlg.getByText("Paso 1 de 2").waitFor();
  // El número de la release (R1…) llega del servidor al abrir: se genera con él, como haría una persona.
  await sleep(1500);
  await dlg.getByRole("button", { name: new RegExp(`Generar con ${n} tarea`) }).click();
  await dlg.getByText("Paso 2 de 2").waitFor({ timeout: 20000 });
  return dlg;
}
async function downloadMd(page, dlg) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), dlg.getByRole("button", { name: ".md", exact: true }).click()]);
  const file = path.join(TMP, `dl-${Date.now()}.md`);
  await dl.saveAs(file);
  return fs.readFileSync(file, "utf8");
}
async function downloadTxt(page, dlg) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), dlg.getByRole("button", { name: ".txt", exact: true }).click()]);
  const file = path.join(TMP, `dl-${Date.now()}.txt`);
  await dl.saveAs(file);
  return fs.readFileSync(file, "utf8");
}
/** Pone el cursor del editor justo detrás de `text` (primer nodo de texto que lo contiene): clic o toque en su última letra. */
async function caretAfter(page, text, { mobile = false } = {}) {
  const pt = await page.evaluate((text) => {
    const root = document.querySelector("[data-release-editor=rich] .ProseMirror");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.data.indexOf(text);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i + text.length - 1);
      r.setEnd(n, i + text.length);
      r.startContainer.parentElement.scrollIntoView({ block: "center" });
      const box = r.getBoundingClientRect();
      return { x: box.right - 1, y: box.top + box.height / 2 };
    }
    throw new Error(`no está «${text}»`);
  }, text);
  if (mobile) await page.touchscreen.tap(pt.x, pt.y);
  else await page.mouse.click(pt.x, pt.y);
  await sleep(200);
}

if (only.includes("rel") || only.includes("mrel")) {
  await L.cleanBoard();
  await seedTemplates();
  const [alfa, beta] = await L.seedTasks(COL.next, ["Tarea Alfa", "Tarea Beta", "Tarea Gamma"]);
  await L.q(`UPDATE "Task" SET description='Descripción de Alfa' WHERE id=$1`, [alfa]);
  await L.q(`UPDATE "Task" SET description=$2, "linkUrl"='https://example.com/beta?a=1&b=2' WHERE id=$1`, [beta, "Detalle de **Beta**:\n\n- uno\n- dos"]);
}

let markdownText = null;
if (only.includes("rel")) {
  L.scenario("rel: con «Markdown», como siempre (Editar / Vista previa)");
  await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN' WHERE id=$1`, [admin.id]);
  {
    const s = await L.session();
    const dlg = await generate(s.page, 3);
    L.eq("REL-MD: pestañas Editar y Vista previa", [await dlg.getByRole("tab", { name: "Editar" }).count(), await dlg.getByRole("tab", { name: "Vista previa" }).count()], [1, 1]);
    markdownText = await dlg.locator("textarea[aria-label='Contenido de la release']").inputValue();
    L.check("REL-MD: cabecera con «# Novedades» y pie", markdownText.startsWith("# Novedades\n") && markdownText.includes(FOOTER), markdownText);
    L.eq("REL-MD: el .md es el texto del campo", await downloadMd(s.page, dlg), markdownText);
    await s.ctx.close();
  }

  L.scenario("rel: con «Con barra de formato», el editor con barra y sin pestañas");
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG' WHERE id=$1`, [admin.id]);
  const s = await L.session();
  await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  const page = s.page;
  const dlg = await generate(page, 3);
  const editor = dlg.locator("[data-release-editor=rich] .ProseMirror");
  await editor.waitFor({ timeout: 10000 });
  L.eq("REL: sin pestañas Editar / Vista previa", [await dlg.getByRole("tab").count(), await dlg.getByText("Vista previa").count()], [0, 0]);
  L.eq("REL: sin el campo de Markdown", await dlg.locator("textarea[aria-label='Contenido de la release']").count(), 0);
  L.check("REL: barra de formato (Negrita, Lista…)", (await dlg.getByRole("toolbar").getByRole("button", { name: /Negrita/ }).count()) === 1);
  L.check("REL: el editor muestra el texto con formato (negrita, sin asteriscos)", (await editor.locator("strong", { hasText: "R1F1" }).count()) === 1 && !(await editor.innerText()).includes("**"));
  await page.screenshot({ path: `${SHOTS}/r49-release-barra.png` });

  // Sin tocar nada: Copiar todo, .md y .txt dan exactamente lo mismo que con Markdown.
  await dlg.getByRole("button", { name: "Copiar todo" }).click();
  await page.getByText("Copiado al portapapeles").first().waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  L.eq("REL: Copiar todo sin editar = texto de Markdown", clip, markdownText);
  L.eq("REL: .md sin editar = texto de Markdown", await downloadMd(page, dlg), markdownText);
  L.eq("REL: .txt sin editar = texto de Markdown", await downloadTxt(page, dlg), markdownText);

  // Editar el título de una tarea: solo cambia ese punto; cabecera (con «#»), enlaces <…>, sangrías y pie se conservan.
  await caretAfter(page, "Tarea Alfa");
  await page.keyboard.type(" editada");
  const edited = await downloadMd(page, dlg);
  // El punto editado sale como lo escribe el editor (el salto de línea, como salto «  \n»); todo lo demás, idéntico.
  const editedItem = /- \*\*R1F1\*\* · Tarea Alfa editada {0,2}\n {0,2}Descripción de Alfa/;
  L.check("REL: tras editar, la tarea editada lleva el cambio", editedItem.test(edited), edited);
  L.eq("REL: tras editar, el resto queda idéntico (cabecera con #, enlace <…>, sangrías, pie)", edited.replace(editedItem, "@@"), markdownText.replace("- **R1F1** · Tarea Alfa\n  Descripción de Alfa", "@@"));
  await dlg.getByRole("button", { name: "Copiar todo" }).click();
  await sleep(300);
  L.eq("REL: Copiar todo tras editar = .md", await page.evaluate(() => navigator.clipboard.readText()), edited);

  // Cambiar el pie con el texto ya editado: se sustituye (no se duplica) y la edición sigue.
  await dlg.locator("#rel-footer").selectOption({ label: "Pie dos" });
  await sleep(300);
  const swapped = await downloadMd(page, dlg);
  L.eq("REL: el pie se cambia en el texto editado", swapped, edited.replace(`${FOOTER}\n`, `${FOOTER2}\n`));
  L.check("REL: el editor muestra el pie nuevo y conserva la edición", (await editor.innerText()).includes("Más info en") && (await editor.innerText()).includes("Tarea Alfa editada") && !(await editor.innerText()).includes("Gracias"));
  // Y la cabecera: «Ninguna» la quita.
  await dlg.locator("#rel-header").selectOption({ label: "Ninguna" });
  await sleep(300);
  const noHeader = await downloadMd(page, dlg);
  L.check("REL: sin cabecera, el texto empieza por la primera sección", noHeader.startsWith("### Funcionalidad\n- **R1F1** · Tarea Alfa editada"), noHeader.slice(0, 80));

  // Formato con la barra: negrita sobre una palabra nueva sale como **…** en el Markdown.
  await caretAfter(page, "Tarea Gamma");
  await page.keyboard.type(" ");
  await page.keyboard.press("Control+b");
  await page.keyboard.type("urgente");
  await page.keyboard.press("Control+b");
  L.check("REL: la negrita de la barra sale en Markdown", (await downloadMd(page, dlg)).includes("Tarea Gamma **urgente**"));

  // Volver al paso 1 avisa de los cambios; desplegar guarda el texto editado.
  await dlg.getByRole("button", { name: "Cambiar tareas" }).click();
  const confirmDlg = page.locator("[role=dialog]").filter({ hasText: "Se perderán los cambios" });
  L.check("REL: volver a la selección avisa de que se pierden los cambios", await confirmDlg.waitFor({ timeout: 5000 }).then(() => true, () => false));
  await confirmDlg.getByRole("button", { name: "Cancelar" }).click();
  await sleep(200);
  const final = await downloadMd(page, dlg);
  await dlg.getByRole("button", { name: "Marcar como desplegado" }).click();
  await page.locator("[role=dialog]").filter({ hasText: "Desplegar la release" }).getByRole("button", { name: "Continuar" }).click();
  await L.eqEventually("REL: la release guardada lleva el texto editado", async () => (await L.q(`SELECT content FROM "Release" ORDER BY number DESC LIMIT 1`))[0]?.content ?? null, final);
  L.assertNoErrors("REL", [s]);
  await s.ctx.close();
}

// --- Release grande (300 tareas con descripción): escribir y exportar sin esperas ------------------------------------
if (only.includes("big")) {
  L.scenario("big: release de 300 tareas con el editor con barra");
  await L.cleanBoard();
  await seedTemplates();
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG' WHERE id=$1`, [admin.id]);
  const ids = await L.seedTasks(COL.next, Array.from({ length: 300 }, (_, i) => `Grande ${String(i + 1).padStart(3, "0")}`));
  await L.q(`UPDATE "Task" SET description='Descripción larga de la tarea con **negrita**, un [enlace](https://example.com) y una lista:' || E'\\n\\n- primero\\n- segundo\\n\\nY un párrafo final bastante largo para que la release pese de verdad, como las de un proyecto grande.' WHERE id = ANY($1)`, [ids]);
  const s = await L.session();
  await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  const page = s.page;
  let t0 = Date.now();
  const dlg = await generate(page, 300);
  await dlg.locator("[data-release-editor=rich] .ProseMirror li").nth(299).waitFor({ timeout: 20000 });
  const openMs = Date.now() - t0;
  L.note("BIG: generar y mostrar en el editor", `${openMs} ms`);
  L.check("BIG: el editor se muestra en menos de 8 s", openMs < 8000, `${openMs} ms`);
  const size = (await downloadMd(page, dlg)).length;
  L.note("BIG: tamaño del texto", `${Math.round(size / 1024)} KB`);
  // Latencia de cada tecla (hasta el fotograma siguiente) en la release y, de referencia, en un campo de texto normal
  // en la misma página: con 300 tareas escribir no debe costar más que en un campo vacío (el Markdown no se escribe en
  // cada tecla).
  await caretAfter(page, "Grande 150");
  const perKey = await page.evaluate(async () => {
    const typeIn = async (el, n) => {
      el.focus();
      const times = [];
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        document.execCommand("insertText", false, "x");
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      return times[n >> 1];
    };
    const editor = document.querySelector("[data-release-editor=rich] .ProseMirror");
    const sel = getSelection().getRangeAt(0);
    const ref = document.createElement("textarea");
    document.querySelector("[role=dialog]").appendChild(ref);
    const plain = await typeIn(ref, 40);
    ref.remove();
    editor.focus();
    getSelection().removeAllRanges();
    getSelection().addRange(sel);
    const rich = await typeIn(editor, 40);
    return { rich, plain };
  });
  L.note("BIG: por tecla, release / campo de texto (mediana)", `${Math.round(perKey.rich)} / ${Math.round(perKey.plain)} ms`);
  L.check("BIG: escribir en la release grande cuesta como en un campo de texto", perKey.rich < perKey.plain * 2 + 30, JSON.stringify(perKey));
  t0 = Date.now();
  await dlg.getByRole("button", { name: "Copiar todo" }).click();
  await page.getByText("Copiado al portapapeles").first().waitFor({ timeout: 10000 });
  const copyMs = Date.now() - t0;
  L.note("BIG: Copiar todo tras editar", `${copyMs} ms`);
  L.check("BIG: Copiar todo tras editar en menos de 3 s", copyMs < 3000, `${copyMs} ms`);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  L.check("BIG: lo copiado lleva la edición y el resto intacto", clip.includes("Grande 150" + "x".repeat(40)) && clip.startsWith("# Novedades\n") && clip.includes("  Descripción larga de la tarea con **negrita**"), clip.slice(clip.indexOf("Grande 150") - 40, clip.indexOf("Grande 150") + 200));
  L.assertNoErrors("BIG", [s]);
  await s.ctx.close();
  await L.q(`DELETE FROM "Task" WHERE id = ANY($1)`, [ids]);
}

// --- Release en el móvil (390 px) ------------------------------------------------------------------------------------
if (only.includes("mrel")) {
  L.scenario("mrel: release con barra en el móvil");
  await L.cleanBoard();
  await seedTemplates();
  await L.seedTasks(COL.next, ["Tarea Alfa", "Tarea Beta"]);
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG' WHERE id=$1`, [admin.id]);
  const s = await L.session({ viewport: { width: 390, height: 800 }, mobile: true });
  const page = s.page;
  const dlg = await generate(page, 2, { mobile: true });
  const editor = dlg.locator("[data-release-editor=rich] .ProseMirror");
  await editor.waitFor({ timeout: 10000 });
  L.eq("MREL: sin pestañas", await dlg.getByRole("tab").count(), 0);
  const box = await page.evaluate(() => {
    const vw = window.innerWidth;
    const bar = document.querySelector("[data-release-editor=rich] [role=toolbar]")?.getBoundingClientRect();
    const ed = document.querySelector("[data-release-editor=rich] .ProseMirror")?.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > vw, barInside: !!bar && bar.left >= -0.5 && bar.right <= vw + 0.5, editorInside: !!ed && ed.left >= -0.5 && ed.right <= vw + 0.5, editorHeight: ed?.height ?? 0 };
  });
  L.eq("MREL: sin desbordamiento horizontal", box.overflow, false);
  L.check("MREL: la barra cabe en la pantalla", box.barInside, JSON.stringify(box));
  L.check("MREL: el editor cabe en la pantalla y tiene alto para escribir", box.editorInside && box.editorHeight > 200, JSON.stringify(box));
  await caretAfter(page, "Tarea Beta", { mobile: true });
  await page.keyboard.type(" (móvil)");
  L.check("MREL: se puede escribir", (await editor.innerText()).includes("Tarea Beta (móvil)"));
  L.check("MREL: el .md lleva lo escrito", (await downloadMd(page, dlg)).includes("Tarea Beta (móvil)"));
  await page.screenshot({ path: `${SHOTS}/r49-release-movil.png` });
  L.assertNoErrors("MREL", [s]);
  await s.ctx.close();
  await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN' WHERE id=$1`, [admin.id]);
}

await L.q(`DELETE FROM "ReleaseTemplate" WHERE id LIKE 'r49_%'`);
await L.closeBrowser(); await L.closeDb();
fs.rmSync(TMP, { recursive: true, force: true });
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
