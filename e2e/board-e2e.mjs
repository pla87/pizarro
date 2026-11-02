// Verificación de R16B1, R16F3, R16M1 y R16F1 (agente «board»).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { COL, sleep } = L;
const APP = process.env.APP_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "b1,f3,m1,f1").split(",");

await L.prepareUsers();

const dbOrderById = async (col) => {
  const p = await L.project();
  return (await L.q(`SELECT t.title FROM "Task" t JOIN "Column" c ON c.id=t."columnId" WHERE c.name=$1 AND c."projectId"=$2 AND t."archivedAt" IS NULL AND NOT t.evergreen ORDER BY t.position, t.id`, [col, p.id])).map((r) => r.title);
};
const ties = async () => (await L.q(`SELECT "columnId", position, count(*) n FROM "Task" GROUP BY 1,2 HAVING count(*)>1`)).length;

/** Arrastre con ratón; `mod` = tecla pulsada al soltar ("Control"/"Alt"); `toggle`: se pulsa y se suelta a mitad para ver el aviso. */
async function dragCard(page, title, target, { mod = null, shot = null, toggle = false } = {}) {
  const src = await L.cardLoc(page, title).boundingBox();
  let tx, ty;
  if (target.card) {
    const tb = await L.cardLoc(page, target.card).boundingBox();
    tx = tb.x + tb.width / 2; ty = target.where === "bottom" ? tb.y + tb.height - 4 : tb.y + 4;
  } else {
    const cb = await L.colLoc(page, target.column).boundingBox();
    tx = cb.x + cb.width / 2; ty = cb.y + 150;
  }
  const sx = src.x + src.width / 2, sy = src.y + src.height / 2;
  await page.mouse.move(sx, sy); await page.mouse.down();
  await page.mouse.move(sx + 8, sy + 8, { steps: 4 });
  const states = [];
  if (toggle) {
    await page.keyboard.down("Control"); await page.mouse.move(sx + 20, sy + 20, { steps: 2 }); await sleep(100);
    states.push(await page.locator("[data-duplicate-hint]").count());
    await page.keyboard.up("Control"); await sleep(100);
    states.push(await page.locator("[data-duplicate-hint]").count());
  }
  await page.mouse.move(tx, ty, { steps: 25 }); await sleep(150);
  if (mod) await page.keyboard.down(mod);
  await page.mouse.move(tx + 1, ty + 1, { steps: 2 }); await sleep(150);
  if (mod) states.push(await page.locator("[data-duplicate-hint]").count());
  if (shot) await page.screenshot({ path: shot });
  await page.mouse.up();
  if (mod) await page.keyboard.up(mod);
  await sleep(700);
  return states;
}

// ---------------------------------------------------------------- R16B1
if (only.includes("b1")) {
  L.scenario("R16B1: empates y orden determinista");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["B1", "B2", "B3"]);
  await L.seedTasks(COL.doing, ["D1", "D2"]);
  const [n1, n2] = await L.seedTasks(COL.next, ["N-primera", "N-movida", "N-tercera"]);
  // Datos como los del usuario (antes de la migración): dos tarjetas en 1024 en la columna «Siguiente salto».
  await L.q(`UPDATE "Task" SET position=1024 WHERE id IN ($1,$2)`, [n1, n2]);
  const expected = await dbOrderById(COL.next);
  const s = await L.session({ viewport: { width: 1400, height: 900 } });
  const p = s.page;
  L.eq("B1: el tablero ordena las empatadas como el servidor (posición, id)", await U.uiOrder(p, COL.next), expected);
  let stable = true;
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const card = i % 2 ? "D1" : "B1";
    await U.drag(p, card, { column: i % 2 ? COL.backlog : COL.doing });
    // Además de la ida a la BD, otras filas se reescriben (como cualquier acción): el orden no debe moverse.
    await L.q(`UPDATE "Task" SET "updatedAt"=NOW() WHERE title IN ('B2','D2')`);
    await L.reload(p);
    const ui = await U.uiOrder(p, COL.next);
    seen.push(ui.join("|"));
    if (JSON.stringify(ui) !== JSON.stringify(expected)) stable = false;
  }
  L.check("B1: tras 6 movimientos entre OTRAS columnas y recargar, la 3.ª columna no cambia de orden", stable, JSON.stringify(seen));
  // Mover una tarjeta entre las dos empatadas: renumera la columna y ya no quedan empates.
  await U.drag(p, "B2", { card: expected[1], where: "top" });
  await L.eqEventually("B1: soltar entre dos empatadas la deja entre ellas", () => dbOrderById(COL.next), [expected[0], "B2", ...expected.slice(1)]);
  L.eq("B1: sin empates en la BD tras soltar entre ellas", await ties(), 0);
  L.eq("B1: UI = BD", await U.uiOrder(p, COL.next), await dbOrderById(COL.next));

  // Migración sobre datos con empates (activas, archivada y fija en la misma columna).
  await L.cleanBoard();
  const ids = await L.seedTasks(COL.next, ["M1", "M2", "M3", "M4"]);
  await L.q(`UPDATE "Task" SET position=1024 WHERE id = ANY($1)`, [ids.slice(0, 2)]);
  await L.q(`UPDATE "Task" SET "createdAt"=NOW() - interval '1 day' WHERE id=$1`, [ids[1]]);
  await L.q(`UPDATE "Task" SET "archivedAt"=NOW(), "archivedFromColumnId"="columnId" WHERE id=$1`, [ids[2]]);
  await L.q(`UPDATE "Task" SET evergreen=true WHERE id=$1`, [ids[3]]);
  const sql = fs.readFileSync(`${APP}/prisma/migrations/20261028110000_posiciones_sin_empates/migration.sql`, "utf8");
  await L.q(sql);
  const rows = await L.q(`SELECT title, position FROM "Task" WHERE id = ANY($1) ORDER BY position`, [ids]);
  L.eq("B1: la migración renumera por (posición, creación, id), con archivadas y fijas", rows.map((r) => [r.title, r.position]), [["M2", 1024], ["M1", 2048], ["M3", 3072], ["M4", 4096]]);
  L.eq("B1: sin empates tras la migración", await ties(), 0);
  L.assertNoErrors("B1", [s]);
  await s.ctx.close();
}

// ---------------------------------------------------------------- R16F3
if (only.includes("f3")) {
  L.scenario("R16F3: Ctrl/Alt al soltar duplica");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["A", "B", "C"]);
  await L.seedTasks(COL.doing, ["X", "Y"]);
  const s = await L.session({ viewport: { width: 1400, height: 900 } });
  const p = s.page;
  // 1) Ctrl a otra columna, entre X e Y; el aviso aparece y desaparece en vivo.
  const st = await dragCard(p, "A", { card: "Y", where: "top" }, { mod: "Control", toggle: true, shot: `${SHOTS}/board-f3-hint.png` });
  L.eq("F3: aviso «+ Duplicar» con Ctrl, sin él al soltarla, y otra vez al pulsarla", st, [1, 0, 1]);
  await L.eqEventually("F3: la copia queda entre X e Y", () => dbOrderById(COL.doing), ["X", "A (copia)", "Y"]);
  L.eq("F3: la original sigue en Backlog", await dbOrderById(COL.backlog), ["A", "B", "C"]);
  L.eq("F3: UI de En progreso", await U.uiOrder(p, COL.doing), ["X", "A (copia)", "Y"]);
  L.eq("F3: UI de Backlog", await U.uiOrder(p, COL.backlog), ["A", "B", "C"]);
  let log = [];
  await L.waitFor(async () => (log = await L.q(`SELECT message FROM "AppLog" WHERE action='tasks.duplicateTask' AND message LIKE 'Duplicó «A»%' AND "createdAt" > NOW() AT TIME ZONE 'UTC' - interval '20 seconds' ORDER BY "createdAt" DESC LIMIT 1`)).length > 0);
  L.check("F3: registro «Duplicó … en …»", /Duplicó «A» en «En progreso»/.test(log[0]?.message ?? ""), log[0]?.message);
  // Deshacer: una sola entrada que borra la copia.
  await U.undoKey(p, "Control+z");
  await L.eqEventually("F3: deshacer quita la copia", () => dbOrderById(COL.doing), ["X", "Y"]);
  L.eq("F3: deshacer no toca la original", await dbOrderById(COL.backlog), ["A", "B", "C"]);
  // 2) Alt en la misma columna: C sobre A (arriba del todo).
  await L.reload(p);
  await dragCard(p, "C", { card: "A", where: "top" }, { mod: "Alt" });
  await L.eqEventually("F3: Alt en la misma columna deja la copia donde se suelta", () => dbOrderById(COL.backlog), ["C (copia)", "A", "B", "C"]);
  L.eq("F3: UI igual que la BD", await U.uiOrder(p, COL.backlog), ["C (copia)", "A", "B", "C"]);
  // 3) Sin tecla: se mueve como siempre.
  await dragCard(p, "B", { card: "X", where: "top" });
  await L.eqEventually("F3: sin Ctrl/Alt se mueve (sin copia)", () => dbOrderById(COL.doing), ["B", "X", "Y"]);
  L.eq("F3: Backlog sin B", await dbOrderById(COL.backlog), ["C (copia)", "A", "C"]);
  L.eq("F3: sin empates", await ties(), 0);
  // 4) Teclado: Espacio + flechas con Ctrl pulsada no duplica (solo ratón).
  await L.reload(p);
  const n0 = await L.taskCount();
  await L.cardLoc(p, "Y").focus();
  await p.keyboard.press("Space"); await sleep(200);
  await p.keyboard.press("ArrowUp"); await sleep(200);
  await p.keyboard.down("Control"); await p.keyboard.press("Space"); await p.keyboard.up("Control");
  await sleep(1000);
  L.eq("F3: arrastre con teclado: no crea copias", await L.taskCount(), n0);
  L.assertNoErrors("F3", [s]);
  await s.ctx.close();
}

// ---------------------------------------------------------------- R16M1
if (only.includes("m1")) {
  L.scenario("R16M1: móvil, saltar a la columna de la tarea creada");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["A", "B"]);
  await L.seedTasks(COL.doing, Array.from({ length: 14 }, (_, i) => `P${i + 1}`));
  const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const p = s.page;
  const activeTab = () => p.locator("[data-mobile-tabs] [data-active]").textContent();
  L.check("M1: empieza en Backlog", (await activeTab()).startsWith(COL.backlog));
  await p.getByRole("button", { name: "Nueva tarea o captura" }).tap();
  const d = U.dialog(p); await d.waitFor(); await sleep(400);
  await d.getByRole("textbox", { name: "Título" }).fill("Nueva en curso");
  await d.locator("select").first().selectOption({ label: COL.doing });
  await d.getByRole("button", { name: /^Crear/ }).first().tap();
  await d.waitFor({ state: "detached" });
  let flashing = 0;
  await L.waitFor(async () => (flashing = await p.locator("[data-task-card][data-flash]").count()) > 0, { timeout: 3000, step: 50 });
  await sleep(700);
  await p.screenshot({ path: `${SHOTS}/board-m1.png` });
  L.check("M1: la pestaña activa pasa a «En progreso»", (await activeTab()).startsWith(COL.doing), await activeTab());
  const card = L.cardLoc(p, "Nueva en curso");
  const box = await card.boundingBox();
  L.check("M1: la tarjeta nueva está a la vista (scroll hasta ella)", !!box && box.y >= 0 && box.y + box.height <= 844, JSON.stringify(box));
  L.check("M1: destello en la tarjeta nueva", flashing === 1);
  await sleep(1500);
  L.eq("M1: el destello se quita solo", await p.locator("[data-task-card][data-flash]").count(), 0);
  // Varias tareas desde el botón de crear varias (en la columna visible).
  await p.getByRole("button", { name: COL.backlog }).first().tap(); await sleep(300);
  L.assertNoErrors("M1", [s]);
  await s.ctx.close();
}

// ---------------------------------------------------------------- R16F1
if (only.includes("f1")) {
  L.scenario("R16F1: deshacer, rehacer y filtros en móvil");
  await L.cleanBoard();
  const [a] = await L.seedTasks(COL.backlog, ["Mía", "Otra"]);
  const [u] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
  await L.q(`UPDATE "Task" SET "assigneeId"=$1 WHERE id=$2`, [u.id, a]);
  const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const p = s.page;
  const vis = async (name) => {
    const b = p.getByRole("button", { name, exact: true }).first();
    const box = await b.boundingBox();
    return !!box && box.width > 0 && box.x >= 0 && box.x + box.width <= 390;
  };
  L.check("F1: Deshacer visible en la barra superior", await vis("Deshacer la última acción"));
  L.check("F1: Rehacer visible en la barra superior", await vis("Rehacer la última acción"));
  L.check("F1: Filtros visible en la barra de pestañas", await vis("Filtros"));
  L.check("F1: Buscar visible en la barra de pestañas", await vis("Buscar"));
  await p.screenshot({ path: `${SHOTS}/board-f1-bar.png` });
  await p.getByRole("button", { name: "Filtros", exact: true }).first().tap(); await sleep(300);
  await p.screenshot({ path: `${SHOTS}/board-f1-filter.png` });
  await p.getByRole("button", { name: "Mis tareas" }).tap(); await sleep(300);
  await p.keyboard.press("Escape"); await sleep(300);
  L.eq("F1: el filtro «Mis tareas» se aplica", (await p.locator("[data-task-card]:visible p").allTextContents()).map((x) => x.trim()), ["Mía"]);
  L.check("F1: el botón muestra el contador", await vis("Filtros (1 activos)"));
  await p.getByRole("button", { name: "Quitar el filtro" }).first().tap(); await sleep(300);
  L.eq("F1: quitar el filtro", (await p.locator("[data-task-card]:visible p").allTextContents()).map((x) => x.trim()), ["Mía", "Otra"]);
  // Deshacer y rehacer desde la barra superior (mover con el asa y deshacer).
  await L.cardLoc(p, "Otra").locator("button[aria-label='Seleccionar']").tap();
  await p.locator("select").filter({ has: p.locator("option", { hasText: "Mover a…" }) }).selectOption({ label: COL.doing });
  await L.eqEventually("F1: movida", () => L.dbOrder(COL.doing), ["Otra"]);
  await sleep(400);
  await p.getByRole("button", { name: "Deshacer la última acción", exact: true }).first().tap();
  await L.eqEventually("F1: deshacer desde la barra", () => L.dbOrder(COL.backlog), ["Mía", "Otra"]);
  await p.getByRole("button", { name: "Rehacer la última acción", exact: true }).first().tap();
  await L.eqEventually("F1: rehacer desde la barra", () => L.dbOrder(COL.doing), ["Otra"]);
  // Con el detalle abierto (tapa la barra): deshacer/rehacer en su cabecera, solo de esa tarea.
  await L.cardLoc(p, "Mía").tap();
  const d = U.dialog(p); await d.waitFor(); await sleep(600);
  L.check("F1: Deshacer en la cabecera del detalle", await d.getByRole("button", { name: "Deshacer la última acción en la tarea" }).isVisible());
  L.check("F1: Rehacer en la cabecera del detalle", await d.getByRole("button", { name: "Rehacer la última acción en la tarea" }).isVisible());
  await d.locator("select").first().selectOption({ label: COL.closed });
  await L.eqEventually("F1: cambiada de columna en el detalle", () => L.dbOrder(COL.closed), ["Mía"]);
  await sleep(400);
  await p.screenshot({ path: `${SHOTS}/board-f1-dialog.png` });
  await d.getByRole("button", { name: "Deshacer la última acción en la tarea" }).tap();
  await L.eqEventually("F1: deshacer desde el detalle", () => L.dbOrder(COL.backlog), ["Mía"]);
  L.assertNoErrors("F1", [s]);
  await s.ctx.close();
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
