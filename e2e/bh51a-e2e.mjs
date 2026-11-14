// Caza de bugs 51a (plan de trabajo para IA, botones de columna, programa y plantillas): el Markdown del plan con
// descripciones raras (un bloque de código sin cerrar ya no se traga las tareas siguientes ni el pie; ``` dentro de un
// bloque de ```` no se toca; títulos setext rebajados; saltos de línea forzados conservados), una tarea fija arrastrada
// del panel «Siempre en el plan» de una columna al de otra pasa allí (antes no hacía nada aunque el lector de pantalla
// anunciaba el cambio) y se deshace, el título de «Generar plan de trabajo» y «Generar release» a 390 px con el icono
// visible y el paso recortado con «…», y con más de 500 tareas «Generar» se desactiva con su motivo (antes salía el
// error de zod en inglés). Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh51a-e2e.mjs      # PART=markdown,fijas,titulo,limite
import { marked } from "marked";
import os from "node:os";
import * as L from "./qa/lib.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "markdown,fijas,titulo,limite").split(",");

await L.prepareUsers();
const PID = "bh51a_project";
const NAME = "Zeta bh51a";
const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);

/** Proyecto privado con «Plan A» y «Plan B» (rol AI_PLAN), «Salto» (release) y «Otra»; `tasks`: [id, columna, título, descripción, fija]. */
async function seed(tasks) {
  await L.q(`DELETE FROM "Project" WHERE id=$1 OR name=$2`, [PID, NAME]);
  await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN', locale='ES' WHERE id=$1`, [adm.id]);
  const users = await L.q(`SELECT id FROM "User" WHERE email IN ($1,$2)`, [L.ADMIN, L.USER2]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,true,$3,999995,NOW())`, [PID, NAME, adm.id]);
  for (const u of users) await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [PID, u.id]);
  const cols = [["bh51a_a", "Plan A", "AI_PLAN"], ["bh51a_b", "Plan B", "AI_PLAN"], ["bh51a_salto", "Salto", "NEXT_RELEASE"], ["bh51a_otra", "Otra", "NONE"]];
  for (const [i, [id, name, role]] of cols.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,role) VALUES ($1,$2,$3,$4,$5)`, [id, PID, name, (i + 1) * 1000, role]);
  for (const [i, [id, col, title, desc, fixed]] of tasks.entries()) {
    await L.q(
      `INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,description,evergreen,"createdById","updatedAt") VALUES ($1,$2,$3,$4,'kind_funcionalidad',$5,$6,$7,$8,NOW())`,
      [id, PID, col, title, (i + 1) * 1024, desc ?? "", !!fixed, adm.id],
    );
  }
}
async function openBoard(page) {
  await page.goto(`${L.BASE}/p/${PID}`);
  await L.colLoc(page, "Plan A").waitFor({ timeout: 20000 });
  await L.liveOpen(page);
  await sleep(400);
}
const planDialog = (page) => page.locator("[role=dialog]").filter({ hasText: /Generar plan de trabajo|Generate work plan/ }).first();
async function openPlan(page, col = "Plan A") {
  await L.colLoc(page, col).getByRole("button", { name: "Generar plan de trabajo" }).click();
  const dlg = planDialog(page);
  await dlg.locator("[data-plan-step=select]").waitFor({ timeout: 10000 });
  await sleep(1000);
  return dlg;
}
async function toStep2(dlg) {
  await dlg.getByRole("button", { name: /^\s*Generar con \d+ tarea/ }).click();
  await dlg.locator("[data-plan-step=edit]").waitFor({ timeout: 15000 });
  await sleep(300);
}
const planText = (dlg) => dlg.getByRole("textbox", { name: "Texto del plan de trabajo" }).inputValue();
const where = async (id) => (await L.q(`SELECT "columnId", evergreen FROM "Task" WHERE id=$1`, [id]))[0];

// --- Markdown con descripciones raras -------------------------------------------------------------------------------------
if (only.includes("markdown")) {
  L.scenario("markdown: bloques de código sin cerrar o anidados, títulos setext y saltos forzados en el plan");
  await seed([
    ["bh51a_m1", "bh51a_a", "Uno ``` con # y | raros 😀", "Texto\n\n````md\n```js\n# dentro\n```\n````\n\n# Título real"],
    ["bh51a_m2", "bh51a_a", "Dos sin cerrar", "Pega esto:\n\n```bash\nnpm test\n# comentario"],
    ["bh51a_m3", "bh51a_a", "Tres setext", "Notas\n---\nCalle Mayor 1  \nMadrid"],
    ["bh51a_m4", "bh51a_a", "Cuatro final", "| a | b |\n|---|---|\n| 1 | 2 |"],
  ]);
  const s = await L.session();
  const { page } = s;
  await openBoard(page);
  const dlg = await openPlan(page);
  await toStep2(dlg);
  const text = await planText(dlg);
  const headings = marked.lexer(text).filter((t) => t.type === "heading").map((t) => `${t.depth} ${t.text}`);
  L.eq("MD: las cuatro tareas y el pie son títulos (el bloque sin cerrar no se traga el resto)", headings.filter((h) => /^(3 \d\.|2 Entrega)/.test(h)), [
    "3 1. Uno ``` con # y | raros 😀", "3 2. Dos sin cerrar", "3 3. Tres setext", "3 4. Cuatro final", "2 Entrega",
  ]);
  L.check("MD: el bloque sin cerrar se cierra tras su última línea", text.includes("```bash\nnpm test\n# comentario\n```\n\n### 3. Tres setext"), text.slice(text.indexOf("Dos sin cerrar"), text.indexOf("Tres setext") + 20));
  L.check("MD: ``` dentro de ```` queda tal cual (su «# dentro» no se rebaja)", text.includes("````md\n```js\n# dentro\n```\n````"));
  L.check("MD: el título de la descripción baja a ####", text.includes("\n#### Título real\n"));
  L.check("MD: «Notas» subrayado con --- pasa a ##### (no es un ## dentro de la tarea)", text.includes("\n##### Notas\n") && !headings.includes("2 Notas"));
  L.check("MD: el salto de línea forzado (dos espacios) se conserva", text.includes("Calle Mayor 1  \nMadrid"));
  L.check("MD: la tabla sigue siendo una tabla", marked.lexer(text).some((t) => t.type === "table" && t.header.map((h) => h.text).join() === "a,b"));
  L.check("MD: ni títulos de nivel 1 o 2 sueltos entre las tareas", !headings.some((h) => /^[12] /.test(h) && !/^(1 Plan de trabajo|2 (Instrucciones para la IA|Contexto del proyecto|Tareas|Entrega))/.test(h)), headings.join(" | "));
  await page.keyboard.press("Escape");
  L.assertNoErrors("MD", [s]);
  await s.ctx.close();
}

// --- Fija de un plan al panel de otro -------------------------------------------------------------------------------------
if (only.includes("fijas")) {
  L.scenario("fijas: arrastrar una fija del panel de «Plan A» al de «Plan B» la lleva allí como fija; deshacer la devuelve");
  await seed([
    ["bh51a_a1", "bh51a_a", "A normal", ""], ["bh51a_af", "bh51a_a", "A fija bh51a", "", true],
    ["bh51a_b1", "bh51a_b", "B normal", ""], ["bh51a_bf", "bh51a_b", "B fija bh51a", "", true],
    ["bh51a_rf", "bh51a_salto", "Release fija bh51a", "", true],
  ]);
  const s = await L.session();
  const { page } = s;
  await openBoard(page);
  const panel = (col) => L.colLoc(page, col).locator("button[aria-controls^=evergreen]");
  for (const col of ["Plan A", "Plan B", "Salto"]) if ((await panel(col).getAttribute("aria-expanded")) !== "true") await panel(col).click();
  await sleep(400);
  const fixedCard = (col, title) => L.colLoc(page, col).locator("[id^=evergreen-] [role=button]").filter({ hasText: title }).first();
  /** Arrastra una fija sobre la lista del panel de otra columna. */
  async function dragToPanel(title, from, to) {
    const sb = await fixedCard(from, title).boundingBox();
    const tb = await L.colLoc(page, to).locator("[id^=evergreen-]").boundingBox();
    await page.mouse.move(sb.x + 20, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + 30, sb.y + sb.height / 2 + 8, { steps: 4 });
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 25 });
    await sleep(150);
    await page.mouse.move(tb.x + tb.width / 2 + 1, tb.y + tb.height / 2 + 1, { steps: 2 });
    await sleep(150);
    await page.mouse.up();
  }
  await dragToPanel("A fija bh51a", "Plan A", "Plan B");
  await L.eqEventually("FIJAS: en la base pasa a «Plan B» y sigue fija", async () => JSON.stringify(await where("bh51a_af")), JSON.stringify({ columnId: "bh51a_b", evergreen: true }));
  await L.eqEventually("FIJAS: el panel de «Plan B» la muestra", async () => fixedCard("Plan B", "A fija bh51a").count(), 1);
  L.eq("FIJAS: y el de «Plan A» ya no", await fixedCard("Plan A", "A fija bh51a").count(), 0);
  L.eq("FIJAS: el contador de «Plan B» dice 2", (await panel("Plan B").innerText()).replace(/\s+/g, " ").trim(), "Siempre en el plan 2");
  await page.screenshot({ path: `${SHOTS}/bh51a-fijas.png` });
  await sleep(300);
  await page.keyboard.press("Control+z");
  await L.eqEventually("FIJAS: deshacer la devuelve a «Plan A» como fija", async () => JSON.stringify(await where("bh51a_af")), JSON.stringify({ columnId: "bh51a_a", evergreen: true }));
  await L.eqEventually("FIJAS: y el tablero también", async () => fixedCard("Plan A", "A fija bh51a").count(), 1);
  // De la release a un plan, igual.
  await sleep(4500);
  await dragToPanel("Release fija bh51a", "Salto", "Plan A");
  await L.eqEventually("FIJAS: una fija de la release soltada en el panel de un plan pasa a ser fija del plan", async () => JSON.stringify(await where("bh51a_rf")), JSON.stringify({ columnId: "bh51a_a", evergreen: true }));
  // Sobre su propio panel no hace nada.
  await sleep(300);
  await dragToPanel("B fija bh51a", "Plan B", "Plan B");
  await sleep(800);
  L.eq("FIJAS: soltarla en su propio panel no la cambia", JSON.stringify(await where("bh51a_bf")), JSON.stringify({ columnId: "bh51a_b", evergreen: true }));
  L.assertNoErrors("FIJAS", [s]);
  await s.ctx.close();
}

// --- Título del diálogo a 390 px ------------------------------------------------------------------------------------------
if (only.includes("titulo")) {
  L.scenario("titulo: a 390 px el icono de «Generar plan de trabajo» y de «Generar release» no desaparece y el paso se recorta");
  await seed([["bh51a_t1", "bh51a_a", "Una tarea", ""], ["bh51a_t2", "bh51a_salto", "Para la release", ""]]);
  const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = s;
  await page.goto(`${L.BASE}/p/${PID}`);
  await page.locator("[data-column-action]").first().waitFor({ timeout: 20000 });
  await sleep(600);
  /** Ancho del icono del título, si el nombre se ve entero y si el paso cabe o está recortado con «…». */
  const titleBox = (dlg) => dlg.locator("h2").first().evaluate((h) => {
    const svg = h.querySelector("svg");
    const [name, step] = h.querySelectorAll(":scope > span > span");
    return { icon: Math.round(svg.getBoundingClientRect().width), name: name.scrollWidth <= name.clientWidth + 1, step: getComputedStyle(step).textOverflow, fits: h.scrollWidth <= h.clientWidth + 1 };
  });
  await page.getByRole("button", { name: "Generar plan de trabajo" }).click();
  const dlg = planDialog(page);
  await dlg.locator("[data-plan-step=select]").waitFor();
  await sleep(800);
  await toStep2(dlg);
  L.eq("TIT: en el paso 2 del plan, icono de 18 px, nombre entero y paso con «…»", await titleBox(dlg), { icon: 18, name: true, step: "ellipsis", fits: true });
  await page.screenshot({ path: `${SHOTS}/bh51a-titulo-plan.png` });
  await page.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached" });
  // «Generar release»: la columna «Salto» en el selector de columnas de móvil.
  await page.getByRole("button", { name: /^Salto/ }).first().click();
  await sleep(400);
  await page.getByRole("button", { name: "Generar Release" }).click();
  const rel = page.locator("[role=dialog]").filter({ hasText: "Generar release" }).first();
  await rel.getByRole("button", { name: /^\s*Generar con \d+ tarea/ }).click();
  await rel.getByRole("button", { name: "Cambiar tareas" }).waitFor({ timeout: 15000 });
  await sleep(300);
  L.eq("TIT: en el paso 2 de la release, igual", await titleBox(rel), { icon: 18, name: true, step: "ellipsis", fits: true });
  L.assertNoErrors("TIT", [s]);
  await s.ctx.close();
}

// --- Más de 500 tareas -----------------------------------------------------------------------------------------------------
if (only.includes("limite")) {
  L.scenario("limite: con más de 500 tareas en el plan, «Generar» se desactiva y dice por qué");
  await seed([]);
  await L.q(
    `INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"createdById","updatedAt")
     SELECT 'bh51a_l' || g, $1, 'bh51a_a', 'Tarea ' || g, 'kind_funcionalidad', g * 1024, $2, NOW() FROM generate_series(1, 501) g`,
    [PID, adm.id],
  );
  const s = await L.session();
  const { page } = s;
  await openBoard(page);
  const dlg = await openPlan(page);
  const gen = dlg.getByRole("button", { name: /^\s*Generar con \d+ tarea/ });
  L.eq("LIM: con 501 marcadas, «Generar» desactivado", await gen.isDisabled(), true);
  L.eq("LIM: con el motivo", (await dlg.getByRole("alert").innerText()).trim(), "Un plan de trabajo admite como mucho 500 tareas: quita alguna de la selección.");
  await dlg.getByRole("checkbox").first().uncheck();
  L.eq("LIM: con 500, se puede generar", await gen.isDisabled(), false);
  L.eq("LIM: y el aviso desaparece", await dlg.getByRole("alert").count(), 0);
  await toStep2(dlg);
  L.check("LIM: el plan lleva la tarea 500", (await planText(dlg)).includes("### 500. Tarea 501"));
  await page.keyboard.press("Escape");
  L.assertNoErrors("LIM", [s]);
  await s.ctx.close();
}

await L.q(`DELETE FROM "Project" WHERE id=$1`, [PID]);
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
