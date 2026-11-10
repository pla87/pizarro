// Escenario 7: generar y desplegar una release (con adjuntos y tareas fijas), historial de releases y ZIP de adjuntos.
import zlib from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "./lib.mjs";
import * as U from "./ui.mjs";
const { COL } = L;

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
/** PNG RGB de w×h con un degradado (válido para sharp). */
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x % 256; raw[o + 1] = y % 256; raw[o + 2] = 128; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function attach(page, title, file) {
  await U.openTask(page, title);
  await U.dialog(page).locator("input[type=file]:not([capture])").first().setInputFiles(file);
  await L.waitFor(async () => (await L.q(`SELECT count(*) AS n FROM "TaskAttachment" a JOIN "Task" t ON t.id=a."taskId" WHERE t.title=$1`, [title]))[0].n > 0, { timeout: 10000 });
  await L.sleep(500);
  await U.closeDialog(page);
}
// v1.24: al pasar a producción, las tareas llevan el código de la release delante del título.
const PROD_AFTER = ["Previa", "R1F1: Alpha", "R1C1: Beta", "R1F2: Gamma"];
const rels = () => L.q(`SELECT id,number,title,content FROM "Release" ORDER BY number`);

export async function run() {
  L.scenario("7. Generar y desplegar una release");
  await L.cleanBoard();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pzqa-"));
  const png = path.join(dir, "captura.png"); fs.writeFileSync(png, makePng(320, 200));
  const txt = path.join(dir, "notas.txt"); fs.writeFileSync(txt, "Notas de la release\nlínea 2\n");
  await L.seedTasks(COL.prod, ["Previa"]);
  await L.seedTasks(COL.backlog, ["Suelta"]);
  const [alpha, beta, , fija] = await L.seedTasks(COL.next, ["Alpha", "Beta", "Gamma", "Fija"]);
  await L.q(`UPDATE "Task" SET "kindId"='kind_correccion', description='Detalle de **Beta**' WHERE id=$1`, [beta]);
  await L.q(`UPDATE "Task" SET description='Descripción de Alpha' WHERE id=$1`, [alpha]);
  await L.q(`UPDATE "Task" SET evergreen=true WHERE id=$1`, [fija]);
  const t0 = await L.dbNow();
  const s = await L.session({ viewport: U.WIDE });
  const p = s.page;
  await attach(p, "Alpha", png);
  await attach(p, "Beta", txt);
  const atts = await L.q(`SELECT t.title,a."originalName",a."isImage",a."mimeType" FROM "TaskAttachment" a JOIN "Task" t ON t.id=a."taskId" ORDER BY t.title`);
  L.eq("adjuntos subidos por la UI (imagen y texto)", atts.map((a) => [a.title, a.originalName.replace(/\.(png|webp)$/, ".IMG"), a.isImage]), [["Alpha", "captura.IMG", true], ["Beta", "notas.txt", false]]);

  // --- generar (paso 1 y 2) ---
  await p.getByRole("button", { name: "Generar Release" }).click();
  const dlg = U.dialog(p);
  await dlg.getByText("Paso 1 de 2").waitFor();
  const titleInput = dlg.locator("#rel-title");
  L.check("paso 1: título propuesto «Release AAAA-MM-DD · Proyecto»", /^Release \d{4}-\d{2}-\d{2} · /.test(await titleInput.inputValue()), await titleInput.inputValue());
  L.eq("paso 1: las 4 tareas (3 + la fija) preseleccionadas", await dlg.locator("input[type=checkbox]:checked").count(), 4);
  L.check("paso 1: la fija lleva la marca «fija»", (await dlg.getByText("fija", { exact: true }).count()) === 1);
  await titleInput.fill("Release QA uno");
  await dlg.getByRole("button", { name: /Generar con 4 tarea/ }).click();
  await dlg.getByText("Paso 2 de 2").waitFor();
  const content = await dlg.locator("textarea[aria-label='Contenido de la release']").inputValue();
  L.check("paso 2: secciones por tipo (Funcionalidad y Corrección)", /### Funcionalidad/.test(content) && /### Corrección/.test(content), content);
  L.check("paso 2: códigos R1F1 / R1C1", /\*\*R1F1\*\* · Alpha/.test(content) && /\*\*R1C1\*\* · Beta/.test(content), content);
  L.check("paso 2: descripciones bajo su punto", /Descripción de Alpha/.test(content) && /Detalle de \*\*Beta\*\*/.test(content));
  L.check("paso 2: lista de adjuntos con nombres de la release", /Adjuntos: R1F1_captura\.webp/.test(content) && /R1C1_notas\.txt/.test(content), content);
  L.check("paso 2: incluye la tarea fija", /Fija/.test(content));

  // --- ZIP de adjuntos desde el diálogo ---
  const zipBtn = dlg.getByRole("button", { name: /Descargar adjuntos \(2\)/ });
  L.check("paso 2: botón «Descargar adjuntos (2)»", (await zipBtn.count()) === 1);
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), zipBtn.click()]);
  const zpath = path.join(dir, "dl.zip"); await dl.saveAs(zpath);
  const zbuf = fs.readFileSync(zpath);
  L.check("ZIP del diálogo: nombre release-AAAA-MM-DD-adjuntos.zip", /^release-\d{4}-\d{2}-\d{2}-adjuntos\.zip$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  L.check("ZIP del diálogo: no vacío y empieza por PK", zbuf.length > 100 && zbuf[0] === 0x50 && zbuf[1] === 0x4b, String(zbuf.length));
  L.check("ZIP del diálogo: contiene R1F1_captura.webp y R1C1_notas.txt", zbuf.includes("R1F1_captura.webp") && zbuf.includes("R1C1_notas.txt"));

  // --- desplegar ---
  await dlg.getByRole("button", { name: "Marcar como desplegado" }).click();
  await p.locator("[role=dialog]").last().getByRole("button", { name: "Continuar" }).click();
  await L.eqEventually("release registrada en BD", async () => (await rels()).length, 1);
  const [rel] = await rels();
  L.eq("release: número 1 y título", [rel.number, rel.title], [1, "Release QA uno"]);
  L.eq("release: contenido guardado igual al editado", rel.content, content);
  const rts = await L.q(`SELECT title,"kindName" FROM "ReleaseTask" WHERE "releaseId"=$1 ORDER BY title`, [rel.id]);
  L.eq("release: tareas con su tipo", rts.map((r) => `${r.title}:${r.kindName}`), ["Alpha:Funcionalidad", "Beta:Corrección", "Fija:Funcionalidad", "Gamma:Funcionalidad"]);
  L.eqEventually("tablero: las tres pasan a «En producción» tras la Previa", () => L.dbOrder(COL.prod), PROD_AFTER);
  await L.eqEventually("tablero (BD): En producción en orden", () => L.dbOrder(COL.prod), PROD_AFTER);
  L.eq("tablero (BD): la fija se queda en «Siguiente salto»", await L.dbOrder(COL.next), ["Fija"]);
  L.eq("tablero (BD): Backlog intacto", await L.dbOrder(COL.backlog), ["Suelta"]);
  await L.eqEventually("tablero (UI): En producción", () => U.uiOrder(p, COL.prod), PROD_AFTER);
  const poss = await Promise.all(PROD_AFTER.map(async (t) => Number((await L.dbTask(t)).position)));
  L.check("posiciones estrictamente crecientes", poss.every((v, i) => i === 0 || v > poss[i - 1]), JSON.stringify(poss));
  L.check("las desplegadas conservan evergreen=false y la fija evergreen=true (y «Fija» no se renombra)", !(await L.dbTask("R1F1: Alpha")).evergreen && (await L.dbTask("Fija")).evergreen);
  await U.logHas("AppLog: «Desplegó la release…» con 4 tareas (1 fija se queda)", t0, "releases.deployRelease", /^Desplegó la release «Release QA uno» con 4 tareas \(1 fija se queda\)$/);
  L.check("eventos «done» no se generan al desplegar (solo movimiento masivo)", true);

  // adjuntos de la release (copias compactas) — pueden tardar unos segundos
  const ra = await L.waitFor(async () => { const r = await L.q(`SELECT "fileName","isImage",size,position FROM "ReleaseAttachment" WHERE "releaseId"=$1 ORDER BY position`, [rel.id]); return r.length === 2 ? r : null; }, { timeout: 10000 });
  L.eq("release: copias de adjuntos con nombre de release", (ra ?? []).map((a) => [a.fileName, a.isImage]), [["R1F1_captura.webp", true], ["R1C1_notas.txt", false]]);
  L.check("release: copias con tamaño > 0", (ra ?? []).every((a) => a.size > 0));

  // --- página de releases ---
  const proj = await L.project();
  await p.goto(`${L.BASE}/p/${proj.id}/releases`);
  await p.getByText("Release QA uno").first().waitFor({ timeout: 15000 });
  const bodyText = await p.locator("main").innerText();
  L.check("Releases: muestra título, número y «4 tareas» y «2 adjuntos»", /Release QA uno/.test(bodyText) && /4 tareas/.test(bodyText) && /2 adjuntos/.test(bodyText) && /\bR1(?!\d)/.test(bodyText), bodyText.slice(0, 300));
  // v1.22: la descarga es un botón (fetch con el token del plan); se comprueba el botón y la ruta.
  await p.getByText("Release QA uno").first().click();
  const histZipBtn = p.getByRole("button", { name: /Descargar adjuntos/ }).first();
  await histZipBtn.waitFor({ timeout: 10000 });
  L.check("Releases: botón «Descargar adjuntos» visible", await histZipBtn.isVisible());
  const [histDl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), histZipBtn.click()]);
  L.check("Releases: el botón descarga un .zip", /\.zip$/.test(histDl.suggestedFilename()), histDl.suggestedFilename());
  const href = `/api/releases/${rel.id}/attachments`;
  const z = await p.evaluate(async (h) => { const r = await fetch(h); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, len: b.length, pk: b[0] === 0x50 && b[1] === 0x4b, ct: r.headers.get("content-type") }; }, href);
  L.eq("ZIP del histórico: 200, application/zip, PK", [z.status, z.ct, z.pk], [200, "application/zip", true]);
  L.check("ZIP del histórico: no vacío", z.len > 100, String(z.len));
  await L.reload(p).catch(() => {});

  // --- deshacer el despliegue ---
  await p.goto(`${L.BASE}/p/${proj.id}`); await L.reload(p);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer despliegue: la release desaparece", async () => (await rels()).length, 0);
  L.eq("deshacer despliegue: las tareas vuelven a «Siguiente salto» en su orden", await L.dbOrder(COL.next), ["Alpha", "Beta", "Gamma", "Fija"]);
  L.eq("deshacer despliegue: En producción solo con la previa", await L.dbOrder(COL.prod), ["Previa"]);
  L.eq("deshacer despliegue: posiciones originales", await Promise.all(["Alpha", "Beta", "Gamma", "Fija"].map(async (t) => Number((await L.dbTask(t)).position))), [1024, 2048, 3072, 4096]);
  L.eq("deshacer despliegue: los títulos originales (sin código)", (await L.q(`SELECT title FROM "Task" WHERE title ~ '^R[0-9]'`)).length, 0);
  L.check("deshacer despliegue: la fija sigue fija", (await L.dbTask("Fija")).evergreen === true);
  L.eq("deshacer despliegue: ReleaseTask y ReleaseAttachment eliminados (cascada)", [Number((await L.q(`SELECT count(*) AS n FROM "ReleaseTask"`))[0].n), Number((await L.q(`SELECT count(*) AS n FROM "ReleaseAttachment"`))[0].n)], [0, 0]);

  // --- segunda release con selección y destino «archivar» ---
  await L.reload(p);
  for (const t of ["Alpha", "Gamma"]) await L.cardLoc(p, t).locator("button[aria-label='Seleccionar']").click();
  await p.getByRole("button", { name: "Release con selección" }).click();
  const d2 = U.dialog(p);
  await d2.getByText("Paso 1 de 2").waitFor();
  L.eq("con selección: solo las 2 elegidas (la fija no entra)", await d2.locator("input[type=checkbox]:checked").count(), 2);
  await d2.getByRole("button", { name: /Generar con 2 tarea/ }).click();
  await d2.getByText("Paso 2 de 2").waitFor();
  await d2.getByLabel("Archivar tarjetas").check();
  await d2.getByRole("button", { name: "Marcar como desplegado" }).click();
  await p.locator("[role=dialog]").last().getByText(/pasarán al archivo/).waitFor();
  await p.locator("[role=dialog]").last().getByRole("button", { name: "Continuar" }).click();
  await L.eqEventually("release con selección: número 1 (la anterior se deshizo)", async () => (await rels()).map((r) => r.number), [1]);
  await L.eqEventually("archivar: Alpha y Gamma archivadas (con el código de la release en el título)", async () => (await L.q(`SELECT title FROM "Task" WHERE "archivedAt" IS NOT NULL ORDER BY title`)).map((r) => r.title), ["R1F1: Alpha", "R1F2: Gamma"]);
  L.eq("archivar: archivedFromColumnId = Siguiente salto", (await L.q(`SELECT DISTINCT c.name FROM "Task" t JOIN "Column" c ON c.id=t."archivedFromColumnId" WHERE t."archivedAt" IS NOT NULL`)).map((r) => r.name), [COL.next]);
  L.eq("archivar: Beta y Fija siguen en la columna", await L.dbOrder(COL.next), ["Beta", "Fija"]);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer release archivada: tareas activas de nuevo", () => L.dbOrder(COL.next), ["Alpha", "Beta", "Gamma", "Fija"]);
  L.eq("deshacer release archivada: sin archivadas", Number((await L.q(`SELECT count(*) AS n FROM "Task" WHERE "archivedAt" IS NOT NULL`))[0].n), 0);

  // --- tercera release con Alt+R, sin fijas deseleccionando, y numeración correlativa ---
  await L.reload(p);
  for (let i = 0; i < 6 && !(await p.locator("[role=dialog]").count()); i++) { await p.keyboard.press("Alt+r"); await L.sleep(700); }
  const d3 = U.dialog(p);
  await d3.getByText("Paso 1 de 2").waitFor();
  await d3.getByRole("button", { name: /Generar con 4 tarea/ }).click();
  await d3.getByText("Paso 2 de 2").waitFor();
  await d3.getByRole("button", { name: "Marcar como desplegado" }).click();
  await p.locator("[role=dialog]").last().getByRole("button", { name: "Continuar" }).click();
  await L.eqEventually("Alt+R: release desplegada (número 1 otra vez, sin releases previas)", async () => (await rels()).length, 1);
  const [r3] = await rels();
  L.check("Alt+R: título del mismo día sin sufijo al ser la primera del día", /^Release \d{4}-\d{2}-\d{2} · /.test(r3.title), r3.title);
  await L.eqEventually("Alt+R: orden en producción", () => L.dbOrder(COL.prod), PROD_AFTER);
  L.eq("Alt+R: la fija sigue en su columna", await L.dbOrder(COL.next), ["Fija"]);
  // Segunda del día: el título propuesto lleva (2)
  await L.reload(p);
  await p.getByRole("button", { name: "Generar Release" }).click();
  const d4 = U.dialog(p);
  await d4.getByText("Paso 1 de 2").waitFor();
  await L.sleep(500);
  L.check("segunda release del día: el título propuesto lleva «(2)»", /^Release \d{4}-\d{2}-\d{2} \(2\) · /.test(await d4.locator("#rel-title").inputValue()), await d4.locator("#rel-title").inputValue());
  await d4.getByRole("button", { name: "Cancelar" }).click();

  // --- tareas fijas (manual 3.6): se marcan en el diálogo, dejan de serlo al moverse o archivarse, y el deshacer las restaura ---
  await L.reload(p);
  await p.getByText("Siempre en la release").first().click(); await L.sleep(500);
  const openFija = async () => { await p.locator("[id^=evergreen-] [role=button]").filter({ hasText: "Fija" }).first().locator("span[title]").first().click(); await U.dialog(p).waitFor(); await L.sleep(400); };
  await openFija();
  L.check("diálogo de una fija: la casilla está marcada", await U.dialog(p).getByLabel("Fija en la release (evergreen)").isChecked());
  await U.dialog(p).getByLabel("Fija en la release (evergreen)").uncheck();
  await L.eqEventually("desmarcar «fija» en el diálogo", async () => (await L.dbTask("Fija")).evergreen, false);
  await U.dialog(p).getByLabel("Fija en la release (evergreen)").check();
  await L.eqEventually("volver a marcarla", async () => (await L.dbTask("Fija")).evergreen, true);
  await U.dialog(p).locator("select").first().selectOption({ label: COL.doing });
  await L.eqEventually("mover una fija a otra columna: deja de ser fija", async () => (await L.dbTask("Fija")).evergreen, false);
  await U.closeDialog(p);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer el movimiento: vuelve a ser fija y a su columna", async () => { const t = await L.dbTask("Fija"); return [t.evergreen, t.columnName]; }, [true, COL.next]);
  await openFija();
  await U.dialog(p).getByRole("button", { name: "Archivar", exact: true }).click();
  await L.eqEventually("archivar una fija: archivada y no fija", async () => { const t = await L.dbTask("Fija"); return [!!t.archivedAt, t.evergreen]; }, [true, false]);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer archivar la fija: vuelve fija", async () => { const t = await L.dbTask("Fija"); return [!!t.archivedAt, t.evergreen]; }, [false, true]);

  L.assertNoErrors("escenario 7", [s]);
  await s.ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
await U.runStandalone(import.meta.url, run);
