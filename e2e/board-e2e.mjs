// Verificación de R16B1, R16F3, R16M1 y R16F1 (agente «board»), de los diálogos propios del menú de la columna (dlg)
// y de la descripción de la tarea (desc: pegar Markdown con código dentro de una negrita, tablas, conflicto).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { COL, sleep } = L;
const APP = process.env.APP_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "b1,f3,m1,f1,dlg,vt,desc").split(",");

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

// ---------------------------------------------------------------- Diálogos propios del menú de la columna
// Renombrar, «Límite de tarjetas…» y el plazo de «Esperando» usan un cuadro de la app, no window.prompt (que algunos
// navegadores integrados no muestran): foco en el campo con el texto seleccionado, Intro acepta, Escape cancela,
// error en línea sin cerrar y las mismas acciones de servidor.
if (only.includes("dlg")) {
  L.scenario("Diálogos propios del menú de la columna (sin window.prompt)");
  await L.cleanBoard();
  await L.seedTasks(COL.doing, ["W1", "W2", "W3"]);
  const proj = await L.project();
  const colRow = async (name) => (await L.q(`SELECT name, role, "wipLimit", "waitingDays" FROM "Column" WHERE "projectId"=$1 AND name=$2`, [proj.id, name]))[0] ?? null;
  const natives = [];
  const watchNative = (p) => p.on("dialog", (d) => { natives.push(d.type()); d.dismiss().catch(() => {}); });
  const openColMenu = async (p, col, item, tap = false) => {
    const act = (loc) => (tap ? loc.tap() : loc.click());
    await act(L.colLoc(p, col).getByRole("button", { name: "Opciones de columna" }));
    await act(p.getByRole("menuitem", { name: item }));
  };
  const promptDialog = async (p, title) => { const d = p.getByRole("dialog", { name: title }); await d.waitFor(); await sleep(300); return d; };
  const active = (p) => p.evaluate(() => { const el = document.activeElement; return { tag: el?.tagName, value: el?.value ?? null, sel: [el?.selectionStart ?? null, el?.selectionEnd ?? null], label: el?.getAttribute("aria-label") ?? null }; });

  // Escritorio (1280 px)
  const s = await L.session({ viewport: { width: 1280, height: 800 } });
  const p = s.page;
  watchNative(p);
  // Renombrar: foco en el campo con el nombre seleccionado; se escribe encima e Intro guarda.
  await openColMenu(p, COL.backlog, "Renombrar");
  let d = await promptDialog(p, "Renombrar columna");
  L.eq("DLG: renombrar abre el cuadro con el nombre seleccionado y el foco en el campo", await active(p), { tag: "INPUT", value: COL.backlog, sel: [0, COL.backlog.length], label: null });
  await p.keyboard.type("Pendiente");
  await p.keyboard.press("Enter");
  await L.eqEventually("DLG: Intro guarda el nombre nuevo (renameColumn)", async () => (await colRow("Pendiente"))?.name ?? null, "Pendiente");
  await d.waitFor({ state: "detached" });
  L.eq("DLG: al cerrar, el foco vuelve al botón «⋯» de la columna", (await active(p)).label, "Opciones de columna");
  // Vacío = no cambiar; Escape cancela.
  await openColMenu(p, "Pendiente", "Renombrar");
  d = await promptDialog(p, "Renombrar columna");
  await d.getByRole("textbox", { name: "Nombre de la columna" }).fill("");
  await p.keyboard.press("Enter");
  await d.waitFor({ state: "detached" });
  await openColMenu(p, "Pendiente", "Renombrar");
  d = await promptDialog(p, "Renombrar columna");
  await p.keyboard.type("Otro nombre");
  await p.keyboard.press("Escape");
  await d.waitFor({ state: "detached" });
  await sleep(600);
  L.check("DLG: vacío no renombra y Escape cancela", (await colRow("Pendiente")) && !(await colRow("")) && !(await colRow("Otro nombre")));
  await openColMenu(p, "Pendiente", "Renombrar");
  d = await promptDialog(p, "Renombrar columna");
  await d.getByRole("textbox", { name: "Nombre de la columna" }).fill(COL.backlog);
  await d.getByRole("button", { name: "Guardar" }).click();
  await L.eqEventually("DLG: «Guardar» también guarda", async () => (await colRow(COL.backlog))?.name ?? null, COL.backlog);

  // Límite de tarjetas: error en línea sin cerrar; ↑ suma uno; vacío = quitar el límite.
  await openColMenu(p, COL.doing, /^Límite de tarjetas/);
  d = await promptDialog(p, "Límite de tarjetas");
  const wipInput = d.getByRole("textbox", { name: /Máximo de tarjetas/ });
  L.eq("DLG: límite sin valor (placeholder «Sin límite»)", [await wipInput.inputValue(), await wipInput.getAttribute("placeholder")], ["", "Sin límite"]);
  await p.keyboard.type("abc");
  await p.keyboard.press("Enter");
  await sleep(300);
  L.eq("DLG: un límite no válido muestra el error en línea y no cierra", [await d.getByRole("alert").textContent(), await wipInput.getAttribute("aria-invalid"), await d.isVisible()], ["Indica un número entero entre 1 y 999, o déjalo vacío.", "true", true]);
  await p.screenshot({ path: `${SHOTS}/board-dlg-wip-error.png` });
  L.eq("DLG: sin cambios en la BD tras el error", (await colRow(COL.doing)).wipLimit, null);
  await wipInput.fill("2");
  L.eq("DLG: al escribir se quita el error", await d.getByRole("alert").count(), 0);
  await d.getByRole("button", { name: "Guardar" }).click();
  await L.eqEventually("DLG: guarda el límite (setColumnWipLimit)", async () => (await colRow(COL.doing)).wipLimit, 2);
  await L.eqEventually("DLG: la columna avisa al pasarse (3 de 2)", () => L.colLoc(p, COL.doing).getAttribute("data-wip-over"), "true");
  await openColMenu(p, COL.doing, /^Límite de tarjetas/);
  d = await promptDialog(p, "Límite de tarjetas");
  L.eq("DLG: el límite actual aparece seleccionado", await active(p), { tag: "INPUT", value: "2", sel: [0, 1], label: null });
  await p.keyboard.press("ArrowUp");
  L.eq("DLG: ↑ suma uno", await wipInput.inputValue(), "3");
  await p.keyboard.press("Enter");
  await L.eqEventually("DLG: Intro guarda 3", async () => (await colRow(COL.doing)).wipLimit, 3);
  await openColMenu(p, COL.doing, /^Límite de tarjetas/);
  d = await promptDialog(p, "Límite de tarjetas");
  await wipInput.fill("");
  await p.keyboard.press("Enter");
  await L.eqEventually("DLG: vacío quita el límite", async () => (await colRow(COL.doing)).wipLimit, null);

  // Plazo de «Esperando»: misma regla (entero de 1 a 365), error en línea.
  const closedRole = (await colRow(COL.closed)).role;
  await L.q(`UPDATE "Column" SET role='WAITING' WHERE "projectId"=$1 AND name=$2`, [proj.id, COL.closed]);
  await L.reload(p);
  await openColMenu(p, COL.closed, /^Recordar tras 3 d/);
  d = await promptDialog(p, "Plazo de espera");
  L.eq("DLG: plazo con el valor actual (3) seleccionado", await active(p), { tag: "INPUT", value: "3", sel: [0, 1], label: null });
  await p.keyboard.type("0");
  await p.keyboard.press("Enter");
  await sleep(300);
  L.eq("DLG: plazo no válido: error en línea", await d.getByRole("alert").textContent(), "Indica un número entero de días.");
  await d.getByRole("textbox").fill("7");
  await p.keyboard.press("Enter");
  await L.eqEventually("DLG: guarda el plazo (setColumnWaitingDays)", async () => (await colRow(COL.closed)).waitingDays, 7);
  await L.q(`UPDATE "Column" SET role=$3, "waitingDays"=NULL WHERE "projectId"=$1 AND name=$2`, [proj.id, COL.closed, closedRole]);
  L.assertNoErrors("DLG escritorio", [s]);
  await s.ctx.close();

  // Móvil (390 px): arriba del todo, sin salirse por los lados, 16 px (iOS no amplía) y con el teclado abierto.
  const m = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const mp = m.page;
  watchNative(mp);
  await openColMenu(mp, COL.backlog, /^Límite de tarjetas/, true);
  d = await promptDialog(mp, "Límite de tarjetas");
  const box = await d.boundingBox();
  L.check("DLG móvil: el cuadro va arriba y cabe a lo ancho", box.y <= 1 && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  L.eq("DLG móvil: campo a 16 px", await d.getByRole("textbox").evaluate((el) => getComputedStyle(el).fontSize), "16px");
  await mp.keyboard.type("5");
  await d.getByRole("button", { name: "Guardar" }).tap();
  await L.eqEventually("DLG móvil: guarda el límite", async () => (await colRow(COL.backlog)).wipLimit, 5);
  // Teclado abierto: la zona visible se reduce a ~420 px; el campo y los botones siguen a la vista.
  await mp.setViewportSize({ width: 390, height: 420 });
  await openColMenu(mp, COL.backlog, /^Límite de tarjetas/, true);
  d = await promptDialog(mp, "Límite de tarjetas");
  const save = await d.getByRole("button", { name: "Guardar" }).boundingBox();
  L.check("DLG móvil: con el teclado abierto se ven el campo y «Guardar»", save && save.y + save.height <= 420 && (await d.getByRole("textbox").isVisible()), JSON.stringify(save));
  await d.getByRole("textbox").fill("");
  await d.getByRole("button", { name: "Guardar" }).tap();
  await L.eqEventually("DLG móvil: vacío quita el límite", async () => (await colRow(COL.backlog)).wipLimit, null);
  // Modo oscuro.
  await mp.setViewportSize({ width: 390, height: 844 });
  await mp.emulateMedia({ colorScheme: "dark" });
  await openColMenu(mp, COL.backlog, "Renombrar", true);
  d = await promptDialog(mp, "Renombrar columna");
  await mp.screenshot({ path: `${SHOTS}/board-dlg-mobile-dark.png` });
  L.check("DLG móvil: en modo oscuro el cuadro no es blanco", (await d.evaluate((el) => getComputedStyle(el).backgroundColor)) !== "rgb(255, 255, 255)");
  await d.getByRole("button", { name: "Cancelar" }).tap();
  await d.waitFor({ state: "detached" });
  L.eq("DLG: ningún window.prompt/confirm/alert nativo", natives, []);
  L.assertNoErrors("DLG móvil", [m]);
  await m.ctx.close();
}

if (only.includes("vt")) {
  L.scenario("R41C3/R41C4 y R41M1: conmutador de vista en un solo icono y título recortado");
  await L.cleanBoard();
  for (const [label, viewport, mobile] of [["escritorio", { width: 1280, height: 800 }, false], ["móvil", { width: 390, height: 844 }, true]]) {
    const s = await L.session({ viewport, mobile });
    const tog = s.page.locator("[data-view-toggle]:visible");
    L.eq(`VT ${label}: un único botón de icono`, await tog.count(), 1);
    const flt = await s.page.locator('button[aria-label^="Filtros"]:visible').first().boundingBox();
    const a = await tog.boundingBox();
    L.check(`VT ${label}: justo a la derecha del filtro`, a.x > flt.x && a.x - (flt.x + flt.width) < 16 && Math.abs(a.y - flt.y) < 3, JSON.stringify({ flt, a }));
    L.eq(`VT ${label}: tablero → «Ver como lista» (sin pulsar)`, [await tog.getAttribute("aria-label"), await tog.getAttribute("aria-pressed")], ["Ver como lista", "false"]);
    await tog.click(); await sleep(600);
    const b = await tog.boundingBox();
    L.eq(`VT ${label}: lista → «Ver como tablero» (pulsado)`, [await tog.getAttribute("aria-label"), await tog.getAttribute("aria-pressed")], ["Ver como tablero", "true"]);
    L.eq(`VT ${label}: no se mueve al pasar a lista`, b, a);
    await tog.click(); await sleep(600);
    L.eq(`VT ${label}: no se mueve al volver al tablero`, await tog.boundingBox(), a);
    L.assertNoErrors(`VT ${label}`, [s]);
    await s.ctx.close();
  }
  // Título largo al crear: campo en rojo, se guarda recortado y sale el aviso.
  const d = await L.session({ viewport: { width: 1280, height: 800 } });
  await d.page.keyboard.press("Alt+n");
  const input = d.page.locator('input[id$="-title"]').first();
  await input.waitFor();
  await input.fill("T".repeat(300));
  L.eq("VT: título de 300: aria-invalid y ayuda «n/máx»", [await input.getAttribute("aria-invalid"), (await d.page.locator('[id$="-title-hint"]').innerText()).trim()], ["true", "300/210"]);
  await d.page.keyboard.press("Alt+s");
  L.check("VT: aviso «Título recortado a 210 caracteres»", await d.page.getByText("Título recortado a 210 caracteres").first().waitFor({ timeout: 8000 }).then(() => true, () => false));
  await L.eqEventually("VT: se guarda recortado a 210", async () => (await L.q(`SELECT length(title) n FROM "Task" WHERE title LIKE 'TTTT%'`)).map((r) => r.n), [210]);
  L.assertNoErrors("VT título", [d]);
  await d.ctx.close();
}

if (only.includes("desc")) {
  L.scenario("R42C1 y campos de la tarea: pegar Markdown con negrita y código, tablas, «Sr.» y conflicto sin perder el texto");
  await L.cleanBoard();
  const LINE = "* **Guardado Local en Borrador (`localStorage`):**";
  const SAVED = "- **Guardado Local en Borrador (`localStorage`):**";
  const desc = async (title) => (await L.q(`SELECT description FROM "Task" WHERE title=$1`, [title]))[0]?.description;
  const editorOf = (d, mode) => (mode === "WYSIWYG" ? d.locator("[contenteditable=true]").first() : d.locator("textarea[placeholder^='Markdown']").first());
  /** Pega con el portapapeles real (Ctrl+V), como desde un .txt. */
  const paste = async (s, target, text) => {
    await target.focus();
    await s.page.evaluate((v) => navigator.clipboard.writeText(v), text);
    await s.page.keyboard.press("Control+v");
    await sleep(400);
  };
  try {
    for (const mode of ["WYSIWYG", "MARKDOWN"]) {
      await L.q(`UPDATE "User" SET "editorMode"=$1`, [mode]);
      await L.seedTasks(COL.backlog, [`Pegar ${mode}`]);
      const s = await L.session({ viewport: { width: 1400, height: 900 } });
      await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
      const p = s.page;
      await U.openTask(p, `Pegar ${mode}`);
      const d = U.dialog(p);
      await d.getByRole("button", { name: "Añade una descripción…" }).click();
      await sleep(800);
      const ed = editorOf(d, mode);
      await paste(s, ed, LINE);
      if (mode === "WYSIWYG") L.eq("DESC: con barra, se pega como lista con negrita y código", await ed.locator("ul > li strong > code").textContent().catch(() => null), "localStorage");
      await p.keyboard.press("Control+Enter");
      const want = mode === "WYSIWYG" ? SAVED : LINE;
      await L.eqEventually(`DESC ${mode}: se guarda en el detalle`, () => desc(`Pegar ${mode}`), want);
      L.eq(`DESC ${mode}: se ve con negrita y código`, await d.locator(".prose-md li strong code").first().textContent(), "localStorage");
      await U.closeDialog(p);
      // Nueva tarea.
      await p.keyboard.press("Alt+n");
      const title = p.locator('input[id$="-title"]').first();
      await title.waitFor();
      await title.fill(`Nueva ${mode}`);
      await sleep(800);
      await paste(s, editorOf(U.dialog(p), mode), LINE);
      await p.keyboard.press("Alt+s");
      await L.eqEventually(`DESC ${mode}: se guarda en Nueva tarea`, () => desc(`Nueva ${mode}`), want);
      L.assertNoErrors(`DESC ${mode}`, [s]);
      await s.ctx.close();
    }

    // Con barra: abrir y guardar no estropea tablas, «Sr. García» (no es una lista), código en una lista numerada ni
    // entidades dentro de código.
    await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG'`);
    const rich = "Sr. García vino hoy\n\n| a | b |\n|---|---|\n| `1` | **2** |\n\n1. uno\n   ```js\n   x()\n   ```\n2. dos\n\nusa `&nbsp;` aquí";
    const [rid] = await L.seedTasks(COL.backlog, ["Rica"]);
    await L.q(`UPDATE "Task" SET description=$1 WHERE id=$2`, [rich, rid]);
    const s = await L.session({ viewport: { width: 1400, height: 900 } });
    await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
    const p = s.page;
    await U.openTask(p, "Rica");
    let d = U.dialog(p);
    await d.getByRole("button", { name: "Editar" }).first().click();
    await sleep(800);
    let ed = d.locator("[contenteditable=true]").first();
    L.eq("DESC: la tabla se ve en el editor con barra", await ed.locator("table[data-md-table] td").allTextContents(), ["`1`", "**2**"]);
    await ed.click();
    await p.keyboard.press("Control+End");
    await p.keyboard.type(" fin");
    await p.keyboard.press("Control+Enter");
    await L.eqEventually("DESC: tabla, «Sr.», código numerado y entidades en código intactos tras guardar", () => desc("Rica"), `${rich} fin`);
    await U.closeDialog(p);

    // Conflicto: otra persona cambia el texto mientras se edita; el aviso permite copiar lo escrito.
    await U.openTask(p, "Rica");
    d = U.dialog(p);
    await d.getByRole("button", { name: "Editar" }).first().click();
    await sleep(800);
    ed = d.locator("[contenteditable=true]").first();
    await ed.click();
    await p.keyboard.press("Control+a");
    await p.keyboard.type("Mi texto largo que no quiero perder");
    await L.q(`UPDATE "Task" SET description='Texto de la otra persona', "contentUpdatedAt"=NOW() + interval '1 second', "contentUpdatedById"='qa_user_2' WHERE id=$1`, [rid]);
    await p.keyboard.press("Control+Enter");
    const copy = p.getByRole("button", { name: "Copiar tu texto" });
    L.check("DESC: el aviso de conflicto ofrece «Copiar tu texto»", await copy.waitFor({ timeout: 6000 }).then(() => true, () => false));
    await copy.click();
    await sleep(300);
    L.eq("DESC: «Copiar tu texto» copia lo que no se guardó", await p.evaluate(() => navigator.clipboard.readText()), "Mi texto largo que no quiero perder");
    L.eq("DESC: no pisa el texto de la otra persona", await desc("Rica"), "Texto de la otra persona");
    L.assertNoErrors("DESC con barra", [s]);
    await s.ctx.close();

    // Borrador recuperado (la página se cerró editando) mientras otra persona cambió el texto: no se pisa su cambio.
    {
      const s2 = await L.session({ viewport: { width: 1400, height: 900 } });
      await s2.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
      const p2 = s2.page;
      const proj = await L.project();
      const [me] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
      const [old] = await L.q(`SELECT (NOW() - interval '1 hour') AS t`);
      await L.q(`UPDATE "Task" SET description='Cambio de Beto', "contentUpdatedAt"=NOW(), "contentUpdatedById"='qa_user_2' WHERE id=$1`, [rid]);
      await p2.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify({ at: Date.now(), value })), [`pz-draft-edit:${me.id}:${proj.id}`, { taskId: rid, description: "Mi borrador de ayer", base: new Date(old.t).toISOString() }]);
      await L.reload(p2);
      const dd = U.dialog(p2);
      await dd.waitFor();
      const ed2 = dd.locator("[contenteditable=true]").first();
      await ed2.waitFor();
      L.eq("DESC: el borrador recuperado se abre con lo escrito", (await ed2.innerText()).trim(), "Mi borrador de ayer");
      await ed2.click();
      await p2.keyboard.press("Control+Enter");
      L.check("DESC: guardar el borrador avisa del conflicto (con «Copiar tu texto»)", await p2.getByRole("button", { name: "Copiar tu texto" }).waitFor({ timeout: 6000 }).then(() => true, () => false));
      L.eq("DESC: el borrador no pisa el cambio de la otra persona", await desc("Rica"), "Cambio de Beto");
      await U.closeDialog(p2);

      // Título pegado con saltos de línea (un espacio, no palabras pegadas) y coste con coma decimal.
      await L.q(`UPDATE "Project" SET "taskFields"='{cost,hours}' WHERE id=$1`, [proj.id]);
      await L.reload(p2);
      await U.openTask(p2, "Rica");
      const td = U.dialog(p2);
      const ttl = td.locator("textarea[aria-label='Título']").first();
      await ttl.click();
      await p2.keyboard.press("Control+a");
      await p2.evaluate(() => navigator.clipboard.writeText("Primera línea\nsegunda línea\n"));
      await p2.keyboard.press("Control+v");
      await p2.keyboard.press("Enter");
      await L.eqEventually("DESC: título pegado en dos líneas → una línea con espacio", async () => (await L.q(`SELECT title FROM "Task" WHERE id=$1`, [rid]))[0].title, "Primera línea segunda línea");
      const cost = td.locator('input[id$="-cost"]');
      await cost.click();
      await p2.keyboard.type("12,5");
      await td.locator('input[id$="-est"]').click();
      await p2.keyboard.type("1,5");
      await p2.keyboard.press("ArrowUp");
      L.eq("DESC: ↑ suma un cuarto de hora conservando la coma", await td.locator('input[id$="-est"]').inputValue(), "1,75");
      await cost.click();
      await L.eqEventually("DESC: coste «12,5» → 12,50 € (no 125) y horas «1,75»", async () => {
        const [r] = await L.q(`SELECT cost::text c, "estimatedHours"::text h FROM "Task" WHERE id=$1`, [rid]);
        return [r.c, r.h];
      }, ["12.50", "1.75"]);
      // Enlace externo: deshacer su cambio con el detalle abierto lo muestra en el campo, y «Guardar» no lo vuelve a escribir.
      const linkRow = async () => (await L.q(`SELECT "linkUrl" FROM "Task" WHERE id=$1`, [rid]))[0].linkUrl;
      const linkInput = td.locator('input[type="url"]').first();
      await linkInput.fill("https://example.com/nuevo");
      await linkInput.press("Enter");
      await L.eqEventually("DESC: el enlace se guarda al salir del campo", linkRow, "https://example.com/nuevo");
      await U.undoKey(p2, "Control+z");
      await L.eqEventually("DESC: deshacer quita el enlace", linkRow, null);
      await L.eqEventually("DESC: el campo del enlace refleja el deshacer", () => linkInput.inputValue(), "");
      await p2.keyboard.press("Alt+s");
      await td.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      await sleep(500);
      L.eq("DESC: «Guardar» no repone el enlace deshecho", await linkRow(), null);
      await L.q(`UPDATE "Project" SET "taskFields"='{}' WHERE id=$1`, [proj.id]);
      L.assertNoErrors("DESC borrador y campos", [s2]);
      await s2.ctx.close();
    }
  } finally {
    await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG'`);
    await L.q(`UPDATE "Project" SET "taskFields"='{}'`);
  }
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
