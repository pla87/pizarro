// Caza de bugs 51a (plan de trabajo para IA, botones de columna, programa y plantillas): el Markdown del plan con
// descripciones raras (un bloque de código sin cerrar ya no se traga las tareas siguientes ni el pie; ``` dentro de un
// bloque de ```` no se toca; títulos setext rebajados; saltos de línea forzados conservados), el título de «Generar plan
// de trabajo» y «Generar release» a 390 px con el icono visible y el paso recortado con «…», y con más de 500 tareas
// «Generar» se desactiva con su motivo (antes salía el error de zod en inglés). El arrastre de una fija entre los paneles
// de dos planes está en tablero-fijas-e2e.mjs (PART=planes). Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node plan-ia-markdown-e2e.mjs      # PART=markdown,titulo,limite
import { marked } from "marked";
import os from "node:os";
import * as L from "./qa/lib.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "markdown,titulo,limite").split(",");

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
