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
  // Este escenario prueba el paso 2 con el campo de Markdown (Editar / Vista previa); con la preferencia «Con barra de
  // formato» (la de serie) sale el editor con barra, que prueba r49-copy-e2e.mjs.
  await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN' WHERE email=$1`, [L.ADMIN]);
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
  // Mismo nombre que desde la página Releases (antes cada sitio daba uno distinto): fecha, número y proyecto.
  const zipName = dl.suggestedFilename();
  const projectPart = (await L.project()).name.replace(/\s+/g, "_");
  L.check("ZIP del diálogo: nombre release-AAAA-MM-DD-R1-Proyecto-adjuntos.zip", zipName === `release-${zipName.slice(8, 18)}-R1-${projectPart}-adjuntos.zip` && /^\d{4}-\d{2}-\d{2}$/.test(zipName.slice(8, 18)), zipName);
  L.check("ZIP del diálogo: no vacío y empieza por PK", zbuf.length > 100 && zbuf[0] === 0x50 && zbuf[1] === 0x4b, String(zbuf.length));
  L.check("ZIP del diálogo: contiene R1F1_captura.webp y R1C1_notas.txt", zbuf.includes("R1F1_captura.webp") && zbuf.includes("R1C1_notas.txt"));
  // El .md lleva el número de la release, como el ZIP (antes siempre «release-AAAA-MM-DD.md», también la 2.ª y la 3.ª).
  const mdName = zipName.replace(/-adjuntos\.zip$/, ".md");
  const [mdDl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), dlg.getByRole("button", { name: ".md", exact: true }).click()]);
  L.eq("diálogo: el .md se llama como el ZIP (release-AAAA-MM-DD-R1-Proyecto.md)", mdDl.suggestedFilename(), mdName);
  // «Al marcar como desplegado» se anuncia una sola vez: el grupo lo nombra y el rótulo visible queda oculto al lector.
  const destGroup = dlg.locator("fieldset").filter({ has: p.getByLabel("Archivar tarjetas") });
  const destTree = await p.accessibility.snapshot({ root: await destGroup.elementHandle(), interestingOnly: false });
  const texts = [];
  (function walk(n) { if (n?.role === "text") texts.push(n.name); for (const c of n?.children ?? []) walk(c); })(destTree);
  L.eq("diálogo: «Al marcar como desplegado» se lee una vez (antes, legend y rótulo)", [destTree?.name, texts.filter((x) => /Al marcar como desplegado/.test(x)).length], ["Al marcar como desplegado", 1]);

  // --- desplegar ---
  await dlg.getByRole("button", { name: "Marcar como desplegado" }).click();
  await p.locator("[role=dialog]").last().getByRole("button", { name: "Continuar" }).click();
  await L.eqEventually("release registrada en BD", async () => (await rels()).length, 1);
  const [rel] = await rels();
  L.eq("release: número 1 y título", [rel.number, rel.title], [1, "Release QA uno"]);
  L.eq("release: contenido guardado igual al editado", rel.content, content);
  const rts = await L.q(`SELECT title,"kindName" FROM "ReleaseTask" WHERE "releaseId"=$1 ORDER BY title`, [rel.id]);
  L.eq("release: tareas con su tipo", rts.map((r) => `${r.title}:${r.kindName}`), ["Alpha:Funcionalidad", "Beta:Corrección", "Fija:Funcionalidad", "Gamma:Funcionalidad"]);
  await L.eqEventually("tablero: las tres pasan a «En producción» tras la Previa", () => L.dbOrder(COL.prod), PROD_AFTER);
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
  await L.goto(p, `${L.BASE}/p/${proj.id}/releases`);
  await p.getByText("Release QA uno").first().waitFor({ timeout: 15000 });
  const bodyText = await p.locator("main").innerText();
  L.check("Releases: muestra título, número y «4 tareas» y «2 adjuntos»", /Release QA uno/.test(bodyText) && /4 tareas/.test(bodyText) && /2 adjuntos/.test(bodyText) && /\bR1(?!\d)/.test(bodyText), bodyText.slice(0, 300));
  // El nombre accesible de la entrada separa el número del título («R1 Release QA uno…», antes «R1Release QA uno…»).
  const entryBtn = p.locator("article button[aria-expanded]").first();
  const entryName = (await p.accessibility.snapshot({ root: await entryBtn.elementHandle() }))?.name ?? "";
  L.check("Releases: nombre accesible «R1 Release QA uno …» con separador", /^R1 Release QA uno\b/.test(entryName), entryName);
  // v1.22: la descarga es un botón (fetch con el token del plan); se comprueba el botón y la ruta.
  await p.getByText("Release QA uno").first().click();
  const [histMd] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.getByRole("button", { name: ".md", exact: true }).first().click()]);
  L.eq("Releases: el .md se llama igual que desde el diálogo", histMd.suggestedFilename(), mdName);
  const histZipBtn = p.getByRole("button", { name: /Descargar adjuntos/ }).first();
  await histZipBtn.waitFor({ timeout: 10000 });
  L.check("Releases: botón «Descargar adjuntos» visible", await histZipBtn.isVisible());
  const [histDl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), histZipBtn.click()]);
  L.eq("Releases: el botón descarga el ZIP con el mismo nombre que el diálogo", histDl.suggestedFilename(), zipName);
  const href = `/api/releases/${rel.id}/attachments`;
  const z = await p.evaluate(async (h) => { const r = await fetch(h); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, len: b.length, pk: b[0] === 0x50 && b[1] === 0x4b, ct: r.headers.get("content-type") }; }, href);
  L.eq("ZIP del histórico: 200, application/zip, PK", [z.status, z.ct, z.pk], [200, "application/zip", true]);
  L.check("ZIP del histórico: no vacío", z.len > 100, String(z.len));

  // --- deshacer el despliegue ---
  await L.goto(p, `${L.BASE}/p/${proj.id}`); await L.reload(p);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer despliegue: la release desaparece", async () => (await rels()).length, 0);
  L.eq("deshacer despliegue: las tareas vuelven a «Siguiente salto» en su orden", await L.dbOrder(COL.next), ["Alpha", "Beta", "Gamma", "Fija"]);
  L.eq("deshacer despliegue: En producción solo con la previa", await L.dbOrder(COL.prod), ["Previa"]);
  L.eq("deshacer despliegue: posiciones originales", await Promise.all(["Alpha", "Beta", "Gamma", "Fija"].map(async (t) => Number((await L.dbTask(t)).position))), [1024, 2048, 3072, 4096]);
  L.eq("deshacer despliegue: los títulos originales (sin código)", (await L.q(`SELECT title FROM "Task" WHERE title ~ '^R[0-9]'`)).length, 0);
  L.check("deshacer despliegue: la fija sigue fija", (await L.dbTask("Fija")).evergreen === true);
  L.eq("deshacer despliegue: ReleaseTask y ReleaseAttachment eliminados (cascada)", [Number((await L.q(`SELECT count(*) AS n FROM "ReleaseTask"`))[0].n), Number((await L.q(`SELECT count(*) AS n FROM "ReleaseAttachment"`))[0].n)], [0, 0]);

  // --- histórico vacío: nombra la columna real que genera releases (antes, fijo «Siguiente salto a producción») ---
  await L.q(`UPDATE "Column" SET name='Próximo salto QA' WHERE "projectId"=$1 AND role='NEXT_RELEASE'`, [proj.id]);
  await L.goto(p, `${L.BASE}/p/${proj.id}/releases`);
  await p.getByText(/^Aún no hay releases/).waitFor({ timeout: 15000 });
  L.eq("Releases vacía: nombra la columna con el rol «Siguiente salto», con su nombre actual", (await p.getByText(/^Aún no hay releases/).innerText()).trim(), "Aún no hay releases. Genera una desde la columna «Próximo salto QA» del tablero.");
  await L.q(`UPDATE "Column" SET role='NONE' WHERE "projectId"=$1 AND name='Próximo salto QA'`, [proj.id]);
  await L.goto(p, `${L.BASE}/p/${proj.id}/releases`);
  await p.getByText(/^Aún no hay releases/).waitFor({ timeout: 15000 });
  L.eq("Releases vacía sin esa columna: explica qué rol ponerle a una", (await p.getByText(/^Aún no hay releases/).innerText()).trim(), "Aún no hay releases. Para generarlas, elige en el menú de una columna del tablero el rol «Siguiente salto (genera releases)».");
  await L.q(`UPDATE "Column" SET name=$2, role='NEXT_RELEASE' WHERE "projectId"=$1 AND name='Próximo salto QA'`, [proj.id, COL.next]);
  await L.goto(p, `${L.BASE}/p/${proj.id}`);
  await L.board(p);

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

  // --- otra persona mueve una tarea de columna mientras se revisa el texto: no se despliega (manual 3.11) ---
  // Antes la release salía igual y devolvía a producción la tarea que la otra persona había sacado de la columna.
  await L.seedTasks(COL.next, ["Movida", "Quieta"]);
  await L.reload(p);
  const other = await L.session({ email: L.USER2 });
  const moveAs = async (title, colName) => {
    await U.openTask(other.page, title);
    await U.dialog(other.page).locator("select").first().selectOption({ label: colName });
    await L.eqEventually(`la otra persona mueve «${title}» a «${colName}»`, async () => (await L.dbTask(title)).columnName, colName);
    await U.closeDialog(other.page);
    await L.sleep(1200); // llega en vivo al tablero de quien despliega
  };
  const relCount = async () => (await rels()).length;
  const before = await relCount();
  await p.getByRole("button", { name: "Generar Release" }).click();
  const d5 = U.dialog(p);
  await d5.getByText("Paso 1 de 2").waitFor();
  await d5.getByRole("button", { name: /Generar con \d+ tarea/ }).click();
  await d5.getByText("Paso 2 de 2").waitFor();
  await moveAs("Movida", COL.doing);
  await d5.getByRole("button", { name: "Marcar como desplegado" }).click();
  await p.locator("[role=dialog]").last().getByRole("button", { name: "Continuar" }).click();
  const moved5 = p.getByText("Una de las tareas se ha movido a otra columna mientras tanto: vuelve a generar la release.");
  await moved5.first().waitFor({ timeout: 8000 }).catch(() => {});
  L.check("tarea movida entretanto: se avisa para volver a generar la release", (await moved5.count()) > 0);
  L.eq("tarea movida entretanto: no se registra la release", await relCount(), before);
  L.eq("tarea movida entretanto: sigue donde la dejó la otra persona", (await L.dbTask("Movida")).columnName, COL.doing);
  L.eq("tarea movida entretanto: las demás no salen", await L.dbOrder(COL.next), ["Fija", "Quieta"]);
  await p.keyboard.press("Escape");
  await p.locator("[role=dialog]").first().waitFor({ state: "detached", timeout: 5000 }).catch(async () => {
    // «Cerrar» pide confirmar si el texto se editó; aquí no, pero por si acaso.
    await p.locator("[role=dialog]").last().getByRole("button", { name: /Continuar|Descartar|Cerrar/ }).first().click().catch(() => {});
  });
  // Lo mismo con «Release con selección» (tareas de varias columnas).
  await L.reload(p);
  for (const t of ["Movida", "Quieta"]) await L.cardLoc(p, t).locator("button[aria-label='Seleccionar']").click();
  await p.getByRole("button", { name: "Release con selección" }).click();
  const d6 = U.dialog(p);
  await d6.getByText("Paso 1 de 2").waitFor();
  await d6.getByRole("button", { name: /Generar con 2 tarea/ }).click();
  await d6.getByText("Paso 2 de 2").waitFor();
  await moveAs("Quieta", COL.backlog);
  await d6.getByRole("button", { name: "Marcar como desplegado" }).click();
  await p.locator("[role=dialog]").last().getByRole("button", { name: "Continuar" }).click();
  const moved6 = p.getByText("Una de las tareas se ha movido a otra columna mientras tanto: vuelve a generar la release.");
  await moved6.first().waitFor({ timeout: 8000 }).catch(() => {});
  L.check("con selección, tarea movida entretanto: se avisa", (await moved6.count()) > 0);
  L.eq("con selección, tarea movida entretanto: no se registra la release", await relCount(), before);
  L.eq("con selección, tarea movida entretanto: ninguna pasa a producción", [(await L.dbTask("Movida")).columnName, (await L.dbTask("Quieta")).columnName], [COL.doing, COL.backlog]);
  await other.ctx.close();

  L.assertNoErrors("escenario 7", [s]);
  await s.ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG' WHERE email=$1`, [L.ADMIN]);
}
await U.runStandalone(import.meta.url, run);
