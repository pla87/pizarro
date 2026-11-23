// Columna «Asignación a persona» (rol NONE con persona y plazo): elegirla en el submenú «Rol de la columna», con la
// persona y «Vence en N días» en la cabecera y «Añadir personas al proyecto» (lleva a los miembros) con pocas personas;
// lo que entra (creada con el «+», cambiando «Columna» en el detalle, «Mover a…» de la selección, Alt+→) pasa a la
// persona y, sin fecha, vence hoy + N; con fecha la conserva; Ctrl+Z la devuelve con su responsable y su fecha. Cambiar
// solo el plazo no pregunta; cambiar la persona pide confirmación con el número de tarjetas. «Generar plan»: PDF
// descargado (attachment, «plan-…pdf»), botón ocupado mientras se genera y sin segunda descarga, aviso con un 429, y su
// texto por vencimiento, con lo rellenado de la descripción y las etiquetas. «Tipo por defecto…» de la columna; «Sin rol»
// quita persona y plazo; a 390 px cabe; en inglés. Crea y borra su proyecto y sus personas (`asig64_*`). Misma base y
// servidor que tablero-e2e.mjs (necesita `pdftotext`, de poppler-utils):
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node tablero-asignacion-e2e.mjs   # PART=rol,entrar,cambiar,plan,tipo,quitar,movil,en
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "rol,entrar,cambiar,plan,tipo,quitar,movil,en").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "asig64-"));

const P = "asig64_proj";
const COL = { back: "asig64_c_back", ana: "asig64_c_ana", done: "asig64_c_done" };
const ANA_COL = "Para Ana";
const PEOPLE = [["asig64_ana", "Ana Asig64"], ["asig64_bea", "Bea Asig64"], ["asig64_cai", "Cai Asig64"]];
const KINDS = [["asig64_k1", "Recado A64"], ["asig64_k2", "Encargo A64"]];
const MOBILE = { viewport: { width: 390, height: 844 }, mobile: true };

const pdfText = (file) => execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
const flat = (s) => s.replace(/\s+/g, " ");
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// --- Datos: restos de una pasada anterior, personas, proyecto privado y tipos propios ---------------------------------
async function cleanup() {
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [P]);
  await L.q(`DELETE FROM "User" WHERE id LIKE 'asig64_%'`).catch(() => {});
}
await L.prepareUsers();
await cleanup();
const [adm] = await L.q(`SELECT * FROM "User" WHERE email=$1`, [L.ADMIN]);
{
  const cols = Object.keys(adm).filter((c) => !["id", "email", "name"].includes(c));
  for (const [id, name] of PEOPLE) {
    await L.q(`INSERT INTO "User" (id,email,name,${cols.map((c) => `"${c}"`).join(",")}) VALUES ($1,$2,$3,${cols.map((_, i) => `$${i + 4}`).join(",")})`, [id, `${id.replace("_", ".")}@example.com`, name, ...cols.map((c) => adm[c])]);
  }
}
await L.q(`INSERT INTO "Project"(id,name,description,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,'Asignación 64','',true,$2,999960,NOW())`, [P, adm.id]);
await L.q(`INSERT INTO "Column"(id,"projectId",name,position) VALUES ($1,$4,'Backlog',1000),($2,$4,$5,2000),($3,$4,'Hecho',3000)`, [COL.back, COL.ana, COL.done, P, ANA_COL]);
// Miembros: quien entra, Ana y Bea (tres: «Añadir personas al proyecto» sale). Cai entra después.
for (const id of [adm.id, "asig64_ana", "asig64_bea"]) await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [P, id]);
// Solo dos tipos del proyecto, sin plantillas (los generales, ocultos): el «+» y «Tipo por defecto…» son previsibles.
await L.q(`INSERT INTO "ProjectHiddenKind"("projectId","kindId") SELECT $1,id FROM "TaskKind" WHERE "projectId" IS NULL`, [P]);
for (const [i, [id, name]] of KINDS.entries()) await L.q(`INSERT INTO "TaskKind"(id,name,color,position,"projectId") VALUES ($1,$2,'#2563eb',$3,$4)`, [id, name, i + 1, P]);
await L.q(`INSERT INTO "Label"(id,"projectId",name,color) VALUES ('asig64_l1',$1,'Urgente A64','#dc2626'),('asig64_l2',$1,'Casa A64','#16a34a')`, [P]);

let seq = 0;
async function seed(columnId, title, { assigneeId = null, due = null, description = "", labels = [], kindId = KINDS[0][0] } = {}) {
  const id = `asig64_t${++seq}`;
  await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,description,"kindId",position,"assigneeId","dueDate","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,NOW())`,
    [id, P, columnId, title, description, kindId, seq * 1024, assigneeId, due, adm.id]);
  for (const l of labels) await L.q(`INSERT INTO "TaskLabel"("taskId","labelId") VALUES ($1,$2)`, [id, l]);
  return id;
}
const resetTasks = () => L.q(`DELETE FROM "Task" WHERE "projectId"=$1`, [P]);
const setAssign = (assigneeId, days) => L.q(`UPDATE "Column" SET role='NONE', "assigneeId"=$2, "assignDueDays"=$3 WHERE id=$1`, [COL.ana, assigneeId, days]);
const colRow = async () => (await L.q(`SELECT role,"assigneeId","assignDueDays","defaultKindId" FROM "Column" WHERE id=$1`, [COL.ana]))[0];
const task = async (title) => (await L.q(`SELECT t."columnId", t."assigneeId", to_char(t."dueDate",'YYYY-MM-DD') due FROM "Task" t WHERE t."projectId"=$1 AND t.title=$2`, [P, title]))[0];
const taskState = async (title) => { const r = await task(title); return r ? [r.columnId, r.assigneeId, r.due] : null; };

const appToday = (page) => page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: document.documentElement.dataset.tz || undefined }).format(new Date()));
async function openBoard(page) {
  await L.goto(page, `${L.BASE}/p/${P}`);
  await L.colLoc(page, ANA_COL).waitFor({ state: "attached", timeout: 20000 });
  await sleep(500);
}
const anaCol = (page) => L.colLoc(page, ANA_COL);
async function columnMenu(page, colName = ANA_COL, english = false) {
  await L.colLoc(page, colName).getByRole("button", { name: english ? "Column options" : "Opciones de columna" }).click();
}
async function roleMenu(page, english = false) {
  await columnMenu(page, ANA_COL, english);
  await page.getByRole("menuitem", { name: english ? /^Column role/ : /^Rol de la columna/ }).click();
}
const assignDialog = (page, english = false) => page.getByRole("dialog").filter({ hasText: english ? "Assign to person" : "Asignación a persona" }).first();
async function saveAssign(page, { person, days }) {
  const d = assignDialog(page);
  await d.waitFor();
  if (person) await d.getByLabel("Persona", { exact: true }).selectOption({ label: person });
  if (days !== undefined) await d.getByLabel("Vence en (días, opcional)").fill(String(days));
  await d.getByRole("button", { name: "Guardar", exact: true }).click();
}
const headerText = async (page) => ((await anaCol(page).locator("[data-assign-person]").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();

const sessions = [];
await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [adm.id]);
try {
  const s = await L.session({ viewport: { width: 1500, height: 900 } });
  sessions.push(s);
  const { page } = s;
  await openBoard(page);
  const today = await appToday(page);

  // --- rol: submenú «Rol de la columna» → «Asignación a persona» ------------------------------------------------------
  if (only.includes("rol")) {
    L.scenario("rol: elegir persona y plazo desde el menú de la columna");
    await setAssign(null, null);
    await resetTasks();
    await L.reload(page);
    await roleMenu(page);
    const item = page.getByRole("menuitemradio", { name: "Asignación a persona" });
    L.eq("ROL: la opción está en el submenú, sin marcar", await item.getAttribute("aria-checked"), "false");
    await item.click();
    const d = assignDialog(page);
    await d.waitFor();
    const options = (await d.getByLabel("Persona", { exact: true }).locator("option").allInnerTexts()).map((x) => x.trim());
    L.check("ROL: «Persona» ofrece a las del proyecto", ["Ana Asig64", "Bea Asig64"].every((n) => options.includes(n)) && !options.includes("Cai Asig64"), options.join(" | "));
    L.eq("ROL: con tres personas sale «Añadir personas al proyecto»", await d.locator("[data-assign-add-people]").count(), 1);
    await page.screenshot({ path: `${SHOTS}/asig64-dialogo.png` });
    await saveAssign(page, { person: "Ana Asig64", days: 5 });
    await L.eqEventually("ROL: la columna queda con Ana y 5 días (rol NONE)", async () => { const c = await colRow(); return [c.role, c.assigneeId, c.assignDueDays]; }, ["NONE", "asig64_ana", 5]);
    await L.checkEventually("ROL: la cabecera muestra la persona y «Vence en 5 días»", async () => { const h = await headerText(page); return [h.includes("Ana Asig64") && h.includes("Vence en 5 días"), h]; });
    await roleMenu(page);
    L.eq("ROL: el submenú la marca como elegida", await page.getByRole("menuitemradio", { name: /Asignación a persona/ }).getAttribute("aria-checked"), "true");
    L.eq("ROL: y «Sin rol» no", await page.getByRole("menuitemradio", { name: /Sin rol/ }).getAttribute("aria-checked"), "false");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await sleep(200);
    // Pulsar la cabecera abre el diálogo con lo elegido; «Añadir personas al proyecto» lleva a los miembros.
    await anaCol(page).locator("[data-assign-person]").click();
    await d.waitFor();
    L.eq("ROL: el diálogo abre con la persona y el plazo", [await d.getByLabel("Persona", { exact: true }).inputValue(), await d.getByLabel("Vence en (días, opcional)").inputValue()], ["asig64_ana", "5"]);
    await d.locator("[data-assign-add-people]").click();
    await page.waitForURL(/\/settings/, { timeout: 15000 });
    const u = new URL(page.url());
    L.eq("ROL: «Añadir personas» lleva a Ajustes del proyecto, en los miembros", [u.pathname, u.searchParams.get("tab"), u.hash], [`/p/${P}/settings`, "general", "#members"]);
    const members = page.locator("#members").first();
    await members.waitFor({ timeout: 15000 });
    await L.checkEventually("ROL: la sección de miembros queda a la vista", async () => {
      const b = await members.boundingBox();
      const h = page.viewportSize().height;
      return [!!b && b.y < h && b.y + Math.min(b.height, 40) > 0, JSON.stringify(b)];
    });
    // Con cuatro personas ya no sale.
    await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,'asig64_cai')`, [P]);
    await openBoard(page);
    await anaCol(page).locator("[data-assign-person]").click();
    await d.waitFor();
    L.eq("ROL: con cuatro personas no sale «Añadir personas»", await d.locator("[data-assign-add-people]").count(), 0);
    await d.getByRole("button", { name: "Cancelar", exact: true }).click();
    await d.waitFor({ state: "detached" });
    await L.q(`DELETE FROM "ProjectMember" WHERE "projectId"=$1 AND "userId"='asig64_cai'`, [P]);
  }

  // --- entrar: crear, mover (detalle, «Mover a…», Alt+→) y deshacer -----------------------------------------------------
  if (only.includes("entrar")) {
    L.scenario("entrar: lo que entra pasa a la persona; sin fecha vence hoy + N");
    await setAssign("asig64_ana", 5);
    await resetTasks();
    const due20 = addDays(today, 20), due25 = addDays(today, 25), due30 = addDays(today, 30);
    await seed(COL.back, "Detalle A64", { due: due20 });
    await seed(COL.back, "Selección A64", { due: due25, assigneeId: "asig64_bea" });
    await seed(COL.back, "Teclado A64", { due: due30 });
    await openBoard(page);
    // «+» de la columna: la nota dice persona y plazo; «Responsable» viene con la persona.
    await anaCol(page).getByRole("button", { name: `Añadir tarea en ${ANA_COL}` }).click();
    const dlg = U.dialog(page);
    await dlg.waitFor();
    const note = dlg.locator("[data-column-assigns]");
    await note.waitFor({ timeout: 10000 });
    L.eq("ENTRAR: la nota de «Nueva tarea» dice persona y plazo", (await note.innerText()).trim(), "Esta columna asigna sus tarjetas a Ana Asig64 y, sin fecha, vencen en 5 días");
    L.eq("ENTRAR: «Responsable» viene con la persona", await dlg.getByLabel("Responsable", { exact: true }).inputValue(), "asig64_ana");
    await dlg.locator('input[id$="-title"]').fill("Nueva A64");
    await dlg.getByRole("button", { name: "Crear tarea" }).click();
    await dlg.waitFor({ state: "detached", timeout: 10000 });
    await L.eqEventually("ENTRAR: la nueva queda de Ana y vence hoy + 5", () => taskState("Nueva A64"), [COL.ana, "asig64_ana", addDays(today, 5)]);

    // Cambiando «Columna» en el detalle: pasa a Ana y conserva su fecha.
    await U.openTask(page, "Detalle A64");
    await dlg.getByLabel("Columna", { exact: true }).selectOption({ label: ANA_COL });
    await L.eqEventually("ENTRAR: con «Columna» del detalle pasa a Ana y conserva su fecha", () => taskState("Detalle A64"), [COL.ana, "asig64_ana", due20]);
    await L.eqEventually("ENTRAR: el detalle muestra a Ana como responsable", () => dlg.getByLabel("Responsable", { exact: true }).inputValue(), "asig64_ana");
    await U.closeDialog(page);
    await U.undoKey(page, "Control+z");
    await L.eqEventually("ENTRAR: Ctrl+Z la devuelve sin responsable y con su fecha", () => taskState("Detalle A64"), [COL.back, null, due20]);

    // «Mover a…» de la barra de selección.
    await L.cardLoc(page, "Selección A64").focus();
    await page.keyboard.press("Space");
    const moveTo = page.locator("[data-selection-bar] select").filter({ has: page.locator("option", { hasText: "Mover a…" }) });
    await moveTo.waitFor({ timeout: 5000 });
    await moveTo.selectOption({ label: ANA_COL });
    await L.eqEventually("ENTRAR: «Mover a…» la pasa de Bea a Ana y conserva su fecha", () => taskState("Selección A64"), [COL.ana, "asig64_ana", due25]);
    await page.keyboard.press("Escape");
    await U.undoKey(page, "Control+z");
    await L.eqEventually("ENTRAR: Ctrl+Z la devuelve a Bea con su fecha", () => taskState("Selección A64"), [COL.back, "asig64_bea", due25]);

    // Alt+→ con el teclado.
    await L.cardLoc(page, "Teclado A64").focus();
    await page.keyboard.press("Alt+ArrowRight");
    await L.eqEventually("ENTRAR: Alt+→ la pasa a Ana y conserva su fecha", () => taskState("Teclado A64"), [COL.ana, "asig64_ana", due30]);
    await L.checkEventually("ENTRAR: la tarjeta ya está en la columna", async () => (await anaCol(page).locator("[data-task-card]").filter({ hasText: "Teclado A64" }).count()) === 1);
    await U.undoKey(page, "Control+z");
    await L.eqEventually("ENTRAR: Ctrl+Z la devuelve sin responsable y con su fecha", () => taskState("Teclado A64"), [COL.back, null, due30]);
    await L.checkEventually("ENTRAR: y vuelve al Backlog en el tablero", async () => (await L.colLoc(page, "Backlog").locator("[data-task-card]").filter({ hasText: "Teclado A64" }).count()) === 1);
  }

  // --- cambiar: solo el plazo (sin confirmación) y la persona (con confirmación) ---------------------------------------
  if (only.includes("cambiar")) {
    L.scenario("cambiar: plazo sin preguntar, persona con confirmación");
    await setAssign("asig64_ana", 5);
    await resetTasks();
    await seed(COL.ana, "Uno A64", { assigneeId: "asig64_ana", due: addDays(today, 3) });
    await seed(COL.ana, "Dos A64", { assigneeId: "asig64_ana" });
    await seed(COL.ana, "Tres A64", { assigneeId: "asig64_bea" });
    await openBoard(page);
    await anaCol(page).locator("[data-assign-person]").click();
    await saveAssign(page, { days: 9 });
    await sleep(400);
    L.eq("CAMBIAR: solo el plazo no pide confirmación", await page.getByRole("dialog").count(), 0);
    await L.eqEventually("CAMBIAR: el plazo cambia", async () => (await colRow()).assignDueDays, 9);
    await L.checkEventually("CAMBIAR: la cabecera dice «Vence en 9 días»", async () => { const h = await headerText(page); return [h.includes("Vence en 9 días"), h]; });
    L.eq("CAMBIAR: las tarjetas siguen como estaban", [await taskState("Uno A64"), await taskState("Dos A64"), await taskState("Tres A64")].map((x) => x?.[1]), ["asig64_ana", "asig64_ana", "asig64_bea"]);
    // Cambiar la persona: confirmación con cuántas cambian (las de Bea se quedan; pasan las otras dos).
    await anaCol(page).locator("[data-assign-person]").click();
    await saveAssign(page, { person: "Bea Asig64" });
    const confirm = page.getByRole("dialog").filter({ hasText: "pasarán a esa persona" });
    await confirm.waitFor({ timeout: 5000 });
    L.check("CAMBIAR: la confirmación dice cuántas tarjetas", (await confirm.innerText()).includes(`Las 2 tarjetas de «${ANA_COL}» que no son de Bea Asig64 pasarán a esa persona.`), await confirm.innerText());
    await confirm.getByRole("button", { name: "Asignar", exact: true }).click();
    await L.eqEventually("CAMBIAR: todas pasan a Bea", async () => (await L.q(`SELECT DISTINCT "assigneeId" a FROM "Task" WHERE "columnId"=$1`, [COL.ana])).map((r) => r.a), ["asig64_bea"]);
    await L.eqEventually("CAMBIAR: la columna es de Bea con el mismo plazo", async () => { const c = await colRow(); return [c.assigneeId, c.assignDueDays]; }, ["asig64_bea", 9]);
    await L.checkEventually("CAMBIAR: la cabecera muestra a Bea", async () => { const h = await headerText(page); return [h.includes("Bea Asig64"), h]; });
    await L.checkEventually("CAMBIAR: aviso de las reasignadas", async () => (await page.getByText("2 tarjetas asignadas a Bea Asig64").count()) > 0);
  }

  // --- plan: «Generar plan» ------------------------------------------------------------------------------------------
  if (only.includes("plan")) {
    L.scenario("plan: PDF descargado, botón ocupado, 429 y contenido");
    await setAssign("asig64_ana", 5);
    await resetTasks();
    const description = "**Objetivo:**\nComprar pintura azul\n\n**Riesgos:**\n\n- \n\n**Quién:** Ana en persona\n";
    await seed(COL.ana, "Vencida A64", { assigneeId: "asig64_ana", due: addDays(today, -2) });
    await seed(COL.ana, "Para hoy A64", { assigneeId: "asig64_ana", due: today, description, labels: ["asig64_l1", "asig64_l2"] });
    await seed(COL.ana, "Lejana A64", { assigneeId: "asig64_ana", due: addDays(today, 60) });
    await seed(COL.ana, "Sin fecha A64", { assigneeId: "asig64_ana" });
    await seed(COL.ana, "De Bea A64", { assigneeId: "asig64_bea" });
    await openBoard(page);
    const btn = anaCol(page).locator("[data-column-action] button");
    await btn.waitFor();
    L.eq("PLAN: el botón dice «Generar plan»", (await btn.innerText()).trim(), "Generar plan");
    const head = await anaCol(page).locator("header").first().boundingBox();
    const bb = await btn.boundingBox();
    L.check("PLAN: está bajo la cabecera de la columna", bb.y >= head.y + head.height - 1, JSON.stringify({ head, bb }));

    let downloads = 0;
    page.on("download", () => downloads++);
    const [dl, res] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page.waitForResponse((r) => r.url().includes(`/columns/${COL.ana}/plan`), { timeout: 30000 }),
      btn.click(),
    ]);
    L.check("PLAN: el nombre es «plan-…pdf»", /^plan-.+\.pdf$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    L.check("PLAN: se sirve como attachment", /^attachment;/.test(res.headers()["content-disposition"] ?? ""), res.headers()["content-disposition"]);
    L.eq("PLAN: es un PDF", res.headers()["content-type"], "application/pdf");
    L.eq("PLAN: el tablero sigue en su página", new URL(page.url()).pathname, `/p/${P}`);
    const file = path.join(TMP, "plan.pdf");
    await dl.saveAs(file);
    const text = flat(pdfText(file));
    L.check("PLAN: título con la persona", text.includes("Plan de Ana Asig64"), text.slice(0, 300));
    const order = ["Vencidas", "Hoy", "Más adelante", "Sin fecha"].map((h) => text.indexOf(`${h} (1)`));
    L.check("PLAN: agrupado por vencimiento, en orden", order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), JSON.stringify(order));
    const at = (title) => text.indexOf(title);
    L.check("PLAN: cada tarea en su grupo", at("Vencida A64") > order[0] && at("Para hoy A64") > order[1] && at("Lejana A64") > order[2] && at("Sin fecha A64") > order[3], JSON.stringify([at("Vencida A64"), at("Para hoy A64"), at("Lejana A64"), at("Sin fecha A64")]));
    L.check("PLAN: lo rellenado de la descripción", text.includes("Objetivo: Comprar pintura azul") && text.includes("Quién: Ana en persona"), text);
    L.check("PLAN: sin los apartados vacíos", !text.includes("Riesgos"), text);
    L.check("PLAN: con las etiquetas", text.includes("Casa A64, Urgente A64"), text);
    L.check("PLAN: la de Bea no sale, pero se avisa", !text.includes("De Bea A64") && text.includes("1 tarjeta de la columna es de otra persona"), text);

    // Ocupado mientras se genera (respuesta retrasada): aria-busy sin aria-disabled, y otro clic no descarga otra vez.
    const before = downloads;
    await page.route("**/columns/*/plan", async (route) => { await sleep(2500); await route.continue(); });
    const done = page.waitForEvent("download", { timeout: 30000 });
    await btn.click();
    await L.eqEventually("PLAN: ocupado (aria-busy) y sin aria-disabled", async () => [await btn.getAttribute("aria-busy"), await btn.getAttribute("aria-disabled")], ["true", null]);
    L.eq("PLAN: dice «Generando plan…»", (await btn.innerText()).trim(), "Generando plan…");
    await btn.click();
    await done;
    await sleep(1500);
    L.eq("PLAN: el segundo clic no lanza otra descarga", downloads - before, 1);
    await L.eqEventually("PLAN: al terminar deja de estar ocupado", () => btn.getAttribute("aria-busy"), null);
    await page.unroute("**/columns/*/plan");

    // Un 429 simulado: el aviso.
    await page.route("**/columns/*/plan", (route) => route.fulfill({ status: 429, body: "" }));
    await btn.click();
    await L.checkEventually("PLAN: con un 429 sale el aviso", async () => (await page.getByText("Demasiadas peticiones, espera un momento.").count()) > 0);
    L.eq("PLAN: y no descarga nada", downloads - before, 1);
    await page.unroute("**/columns/*/plan");
    await L.eqEventually("PLAN: el botón vuelve a estar libre", () => btn.getAttribute("aria-busy"), null);
  }

  // --- tipo: «Tipo por defecto…» --------------------------------------------------------------------------------------
  if (only.includes("tipo")) {
    L.scenario("tipo: «Tipo por defecto…» de la columna");
    await setAssign("asig64_ana", 5);
    await L.q(`UPDATE "Column" SET "defaultKindId"=NULL WHERE id=$1`, [COL.ana]);
    await openBoard(page);
    const dlg = U.dialog(page);
    const checked = () => dlg.getByRole("radiogroup", { name: "Tipo" }).locator("[role=radio][aria-checked=true]").innerText().then((x) => x.trim());
    // El último usado: «Recado A64» (se crea una tarea con él en el Backlog).
    await L.colLoc(page, "Backlog").getByRole("button", { name: "Añadir tarea en Backlog" }).click();
    await dlg.waitFor();
    await dlg.getByRole("radio", { name: KINDS[0][1], exact: true }).click();
    await dlg.locator('input[id$="-title"]').fill("Último tipo A64");
    await dlg.getByRole("button", { name: "Crear tarea" }).click();
    await dlg.waitFor({ state: "detached", timeout: 10000 });
    await L.checkEventually("TIPO: creada con «Recado A64»", async () => !!(await task("Último tipo A64")));
    // Tipo por defecto «Encargo A64».
    await columnMenu(page);
    await page.getByRole("menuitem", { name: "Tipo por defecto…" }).click();
    const kd = page.getByRole("dialog").filter({ hasText: "Tipo por defecto" });
    await kd.getByLabel("Tipo por defecto").selectOption({ label: KINDS[1][1] });
    await kd.getByRole("button", { name: "Guardar", exact: true }).click();
    await L.eqEventually("TIPO: guardado en la columna", async () => (await colRow()).defaultKindId, KINDS[1][0]);
    await columnMenu(page);
    L.eq("TIPO: el menú lo dice", await page.getByRole("menuitem", { name: `Tipo por defecto: ${KINDS[1][1]}…` }).count(), 1);
    await page.keyboard.press("Escape");
    await anaCol(page).getByRole("button", { name: `Añadir tarea en ${ANA_COL}` }).click();
    await dlg.waitFor();
    await L.eqEventually("TIPO: el «+» de la columna lo preselecciona", checked, KINDS[1][1]);
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached", timeout: 5000 });
    // «Ninguno»: vuelve el último usado.
    await columnMenu(page);
    await page.getByRole("menuitem", { name: /^Tipo por defecto/ }).click();
    await kd.getByLabel("Tipo por defecto").selectOption({ label: "Ninguno" });
    await kd.getByRole("button", { name: "Guardar", exact: true }).click();
    await L.eqEventually("TIPO: «Ninguno» lo quita", async () => (await colRow()).defaultKindId, null);
    await anaCol(page).getByRole("button", { name: `Añadir tarea en ${ANA_COL}` }).click();
    await dlg.waitFor();
    await L.eqEventually("TIPO: con «Ninguno» vuelve el último usado", checked, KINDS[0][1]);
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached", timeout: 5000 });
  }

  // --- quitar: «Sin rol» --------------------------------------------------------------------------------------------------
  if (only.includes("quitar")) {
    L.scenario("quitar: otro rol quita persona y plazo; las tarjetas conservan su responsable");
    await setAssign("asig64_ana", 5);
    await resetTasks();
    await seed(COL.ana, "Queda de Ana A64", { assigneeId: "asig64_ana", due: addDays(today, 5) });
    await openBoard(page);
    await anaCol(page).locator("[data-assign-person]").waitFor();
    await roleMenu(page);
    await page.getByRole("menuitemradio", { name: /Sin rol/ }).click();
    await L.eqEventually("QUITAR: la columna queda sin persona ni plazo", async () => { const c = await colRow(); return [c.role, c.assigneeId, c.assignDueDays]; }, ["NONE", null, null]);
    await L.eqEventually("QUITAR: la cabecera ya no muestra persona ni plazo", async () => [await anaCol(page).locator("[data-assign-person]").count(), await anaCol(page).locator("[data-assign-warning]").count(), await anaCol(page).getByText(/Vence en/).count()], [0, 0, 0]);
    L.eq("QUITAR: ni «Generar plan»", await anaCol(page).locator("[data-column-action]").count(), 0);
    L.eq("QUITAR: la tarjeta conserva su responsable y su fecha", await taskState("Queda de Ana A64"), [COL.ana, "asig64_ana", addDays(today, 5)]);
    await L.reload(page);
    L.eq("QUITAR: tras recargar, igual", await anaCol(page).locator("[data-assign-person]").count(), 0);
  }
  L.assertNoErrors("ASIG", [s]);
  await s.ctx.close();

  // --- movil: a 390 px ------------------------------------------------------------------------------------------------
  if (only.includes("movil")) {
    L.scenario("movil: cabecera y diálogo a 390 px");
    await setAssign("asig64_ana", 12);
    await L.q(`UPDATE "User" SET name='Ana Asig64 con un nombre bastante largo para el móvil' WHERE id='asig64_ana'`);
    await resetTasks();
    await seed(COL.ana, "Móvil A64", { assigneeId: "asig64_ana" });
    const m = await L.session(MOBILE);
    sessions.push(m);
    await openBoard(m.page);
    await m.page.locator("[data-mobile-tabs] button", { hasText: new RegExp(`^${ANA_COL}`) }).tap();
    const col = anaCol(m.page);
    const person = col.locator("[data-assign-person]");
    await person.waitFor({ state: "visible", timeout: 10000 });
    const pb = await person.boundingBox();
    L.check("MOVIL: la persona y el plazo caben en la pantalla", pb.x >= 0 && pb.x + pb.width <= 390, JSON.stringify(pb));
    L.check("MOVIL: se ve «Vence en 12 días»", await person.getByText("Vence en 12 días").isVisible());
    const due = await person.getByText("Vence en 12 días").boundingBox();
    L.check("MOVIL: el plazo no se sale del botón", due.x + due.width <= pb.x + pb.width + 1, JSON.stringify({ due, pb }));
    L.eq("MOVIL: sin scroll horizontal", await m.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const ab = await col.locator("[data-column-action] button").boundingBox();
    L.check("MOVIL: «Generar plan» cabe", ab.x >= 0 && ab.x + ab.width <= 390, JSON.stringify(ab));
    await m.page.screenshot({ path: `${SHOTS}/asig64-movil.png` });
    await person.tap();
    const d = assignDialog(m.page);
    await d.waitFor();
    await sleep(300);
    const db = await d.boundingBox();
    L.check("MOVIL: el diálogo cabe en 390 px", db.x >= 0 && db.x + db.width <= 390, JSON.stringify(db));
    L.eq("MOVIL: sin scroll horizontal dentro del diálogo", await d.evaluate((el) => [...el.querySelectorAll("*")].every((x) => x.scrollWidth <= x.clientWidth + 1 || getComputedStyle(x).overflowX === "visible")), true);
    for (const label of ["Persona", "Vence en (días, opcional)"]) {
      const b = await d.getByLabel(label, { exact: true }).boundingBox();
      L.check(`MOVIL: «${label}» cabe`, b.x >= 0 && b.x + b.width <= 390, JSON.stringify(b));
    }
    await m.page.screenshot({ path: `${SHOTS}/asig64-movil-dialogo.png` });
    L.assertNoErrors("MOVIL", [m]);
    await m.ctx.close();
    await L.q(`UPDATE "User" SET name='Ana Asig64' WHERE id='asig64_ana'`);
  }

  // --- en: textos en inglés --------------------------------------------------------------------------------------------
  if (only.includes("en")) {
    L.scenario("en: textos en inglés");
    await setAssign("asig64_ana", 1);
    await resetTasks();
    await seed(COL.ana, "English A64", { assigneeId: "asig64_ana", due: addDays(today, -1) });
    await L.q(`UPDATE "User" SET locale='EN' WHERE id=$1`, [adm.id]);
    const e = await L.session();
    sessions.push(e);
    const { page: pe } = e;
    await openBoard(pe);
    await L.checkEventually("EN: la cabecera dice «Due in 1 day»", async () => { const h = await headerText(pe); return [h.includes("Ana Asig64") && h.includes("Due in 1 day"), h]; });
    const btn = anaCol(pe).locator("[data-column-action] button");
    L.eq("EN: «Generate plan»", (await btn.innerText()).trim(), "Generate plan");
    await roleMenu(pe, true);
    L.eq("EN: el submenú marca «Assign to person»", await pe.getByRole("menuitemradio", { name: /Assign to person/ }).getAttribute("aria-checked"), "true");
    await pe.keyboard.press("Escape");
    await pe.keyboard.press("Escape");
    await anaCol(pe).locator("[data-assign-person]").click();
    const d = assignDialog(pe, true);
    await d.waitFor();
    L.eq("EN: el diálogo en inglés", [await d.getByLabel("Person", { exact: true }).count(), await d.getByLabel("Due in (days, optional)").count(), await d.getByRole("button", { name: "Save", exact: true }).count(), await d.locator("[data-assign-add-people]").innerText()], [1, 1, 1, "Add people to the project"]);
    await d.getByRole("button", { name: "Cancel", exact: true }).click();
    await d.waitFor({ state: "detached" });
    await anaCol(pe).getByRole("button", { name: `Add task in ${ANA_COL}` }).click();
    const nt = U.dialog(pe);
    await nt.waitFor();
    L.eq("EN: la nota de «New task»", (await nt.locator("[data-column-assigns]").innerText()).trim(), "This column assigns its cards to Ana Asig64 and, without a date, they're due in 1 day");
    await pe.keyboard.press("Escape");
    await nt.waitFor({ state: "detached", timeout: 5000 });
    const [dl] = await Promise.all([pe.waitForEvent("download", { timeout: 30000 }), btn.click()]);
    const file = path.join(TMP, "plan-en.pdf");
    await dl.saveAs(file);
    const text = flat(pdfText(file));
    L.check("EN: el PDF en inglés", text.includes("Ana Asig64's plan") && text.includes("Overdue (1)"), text.slice(0, 400));
    L.check("EN: nombre del fichero «plan-…pdf»", /^plan-.+\.pdf$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    L.assertNoErrors("EN", [e]);
    await e.ctx.close();
  }
} catch (err) {
  L.check("la suite terminó sin excepción", false, err.stack || String(err));
} finally {
  await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [adm.id]);
  for (const x of sessions) await x.ctx.close().catch(() => {});
  await cleanup();
}

fs.rmSync(TMP, { recursive: true, force: true });
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
