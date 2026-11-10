// Verificación de R16B1, R16F3, R16M1 y R16F1 (agente «board»), de los diálogos propios del menú de la columna (dlg),
// de la descripción de la tarea (desc: pegar Markdown con código dentro de una negrita, tablas, conflicto), de los
// comentarios (com: borrador local, editar los propios con aviso en vivo, menciones legibles mientras se escribe) y del
// detalle (det: adjuntos por nombre y contador, subtareas pegadas, https automático, confirmar al cerrar con cambios) y de
// la ronda 44 (r44: micrófono del título solo al editarlo; columnas que siguen por abajo, sin esquinas inferiores) y de
// la ronda 46 (r46: «Nuevo proyecto» con un solo desplegable; cerrar el detalle con un comentario o un renombrado a medias;
// borradores de comentarios al cerrar sesión).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { COL, sleep } = L;
const APP = process.env.APP_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "b1,f3,m1,f1,dlg,vt,desc,com,det,r44,r46").split(",");

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
    L.eq(`VT ${label}: tablero → «Ver como lista» (botón de acción, sin aria-pressed)`, [await tog.getAttribute("aria-label"), await tog.getAttribute("aria-pressed")], ["Ver como lista", null]);
    await tog.click(); await sleep(600);
    const b = await tog.boundingBox();
    L.eq(`VT ${label}: lista → «Ver como tablero» (sin aria-pressed)`, [await tog.getAttribute("aria-label"), await tog.getAttribute("aria-pressed")], ["Ver como tablero", null]);
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

// ---------------------------------------------------------------- Comentarios: borrador, edición y menciones legibles
if (only.includes("com")) {
  L.scenario("COM: borrador de comentario, editar comentarios propios (en vivo) y menciones legibles al escribir");
  await L.cleanBoard();
  await L.q(`DELETE FROM "Notification"`);
  // Dos personas más para mencionar (id solo con letras y números, como un cuid: «qa_user_2» no sería una mención válida).
  const [adm] = await L.q(`SELECT * FROM "User" WHERE email=$1`, [L.ADMIN]);
  for (const [id, email, name] of [["qacom3", "qacom3@example.com", "Tercera Persona"], ["qacom4", "qacom4@example.com", "Cuarta Persona"]]) {
    if ((await L.q(`SELECT 1 FROM "User" WHERE id=$1`, [id])).length) continue;
    const cols = Object.keys(adm).filter((c) => !["id", "email", "name"].includes(c));
    await L.q(`INSERT INTO "User" (id,email,name,${cols.map((c) => `"${c}"`).join(",")}) VALUES ($1,$2,$3,${cols.map((_, i) => `$${i + 4}`).join(",")})`, [id, email, name, ...cols.map((c) => adm[c])]);
  }
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") SELECT p.id,u.id FROM "Project" p CROSS JOIN "User" u ON CONFLICT DO NOTHING`);
  const [tid] = await L.seedTasks(COL.backlog, ["Comentarios"]);
  const bodyOf = async () => (await L.q(`SELECT body FROM "TaskComment" WHERE "taskId"=$1 ORDER BY "createdAt" LIMIT 1`, [tid]))[0]?.body;
  const mentionsOf = async (id) => (await L.q(`SELECT count(*)::int n FROM "Notification" WHERE "userId"=$1 AND type='MENTION'`, [id]))[0].n;
  const s = await L.session({ viewport: { width: 1400, height: 900 } });
  const p = s.page;
  const key = `pz-draft-comment:${adm.id}:${tid}`;
  const draft = () => p.evaluate((k) => localStorage.getItem(k), key);
  await U.openTask(p, "Comentarios");
  const box = () => U.dialog(p).locator('textarea[aria-label="Nuevo comentario"]');
  const marks = () => U.dialog(p).locator("[data-mention-backdrop] mark");
  await box().click();
  await p.keyboard.type("Hola @Cua");
  await p.keyboard.press("Enter");
  await p.keyboard.type("revisa esto");
  L.eq("COM: al elegir a alguien se ve «@Nombre», sin el id", await box().inputValue(), "Hola @Cuarta Persona revisa esto");
  L.eq("COM: la mención sale resaltada", await marks().count(), 1);
  await U.dialog(p).locator("section").filter({ has: p.locator('textarea[aria-label="Nuevo comentario"]') }).last().screenshot({ path: path.join(SHOTS, "com-mencion.png") });
  L.check("COM: el borrador se guarda al momento, con la mención completa", ((await draft()) ?? "").includes("@[Cuarta Persona](user:qacom4)"));
  await U.closeDialog(p);
  await L.reload(p);
  await U.openTask(p, "Comentarios");
  L.eq("COM: tras cerrar y recargar, el borrador vuelve (con la mención)", [await box().inputValue(), await marks().count()], ["Hola @Cuarta Persona revisa esto", 1]);
  // El servidor rechaza el envío (tarea archivada entretanto): el texto y el borrador siguen.
  await L.q(`UPDATE "Task" SET "archivedAt"=NOW() WHERE id=$1`, [tid]);
  await box().click();
  await p.keyboard.press("Control+Enter");
  await sleep(1200);
  L.eq("COM: un error al enviar no pierde el texto ni el borrador", [await box().inputValue(), !!(await draft())], ["Hola @Cuarta Persona revisa esto", true]);
  await L.q(`UPDATE "Task" SET "archivedAt"=NULL WHERE id=$1`, [tid]);
  await box().click();
  await p.keyboard.press("Control+Enter");
  await L.eqEventually("COM: se guarda en el formato de siempre", bodyOf, "Hola @[Cuarta Persona](user:qacom4) revisa esto");
  L.eq("COM: enviar vacía la caja y borra el borrador", [await box().inputValue(), await draft()], ["", null]);
  await L.eqEventually("COM: la mención avisa", () => mentionsOf("qacom4"), 1);
  // Retroceso al final de una mención la borra entera; borrar dentro la deja como texto, sin id.
  await box().click();
  await p.keyboard.type("@Ter");
  await p.keyboard.press("Enter");
  await p.keyboard.press("Backspace");
  await p.keyboard.press("Backspace");
  L.eq("COM: Retroceso al final de la mención la borra entera (y vaciar borra el borrador)", [await box().inputValue(), await draft()], ["", null]);
  await p.keyboard.type("@Ter");
  await p.keyboard.press("Enter");
  for (let i = 0; i < 3; i++) await p.keyboard.press("ArrowLeft");
  await p.keyboard.press("Backspace");
  L.eq("COM: borrar dentro de la mención no deja un id huérfano", JSON.parse((await draft()) ?? "{}").value?.text, "@Tercera Persna ");
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Backspace");

  // Otra persona con la tarea abierta: no puede editar lo ajeno y ve la edición en vivo.
  const s2 = await L.session({ email: L.USER2, viewport: { width: 1400, height: 900 } });
  const p2 = s2.page;
  await U.openTask(p2, "Comentarios");
  const theirs = U.dialog(p2).locator("[data-comment-id]").first();
  L.eq("COM: sin lápiz en el comentario de otra persona", await theirs.getByRole("button", { name: "Editar comentario" }).count(), 0);
  const mine = U.dialog(p).locator("[data-comment-id]").first();
  const pencil = mine.getByRole("button", { name: "Editar comentario" });
  L.eq("COM: el lápiz no se ve sin pasar el ratón", await pencil.evaluate((el) => getComputedStyle(el).opacity), "0");
  await mine.hover();
  await sleep(200);
  L.eq("COM: al pasar el ratón sí", await pencil.evaluate((el) => getComputedStyle(el).opacity), "1");
  await pencil.click();
  const edit = U.dialog(p).locator('textarea[aria-label="Editar comentario"]');
  L.eq("COM: la edición también muestra «@Nombre»", await edit.inputValue(), "Hola @Cuarta Persona revisa esto");
  await p.keyboard.press("Escape");
  L.eq("COM: Escape cancela la edición sin cerrar el detalle", [await edit.count(), await U.dialog(p).count()], [0, 1]);
  await mine.hover();
  await pencil.click();
  await p.keyboard.type(" y @Ter");
  await p.keyboard.press("Enter");
  await p.keyboard.type("también");
  await mine.screenshot({ path: path.join(SHOTS, "com-editando.png") });
  await p.keyboard.press("Control+Enter");
  await L.eqEventually("COM: Ctrl+Enter guarda la edición", bodyOf, "Hola @[Cuarta Persona](user:qacom4) revisa esto y @[Tercera Persona](user:qacom3) también");
  await L.eqEventually("COM: la mención nueva avisa", () => mentionsOf("qacom3"), 1);
  L.eq("COM: quien ya estaba mencionado no recibe otro aviso", await mentionsOf("qacom4"), 1);
  L.check("COM: «(editado)» con la fecha en el título", /^Editado el /.test((await mine.getByText("(editado)").getAttribute("title")) ?? ""));
  await L.eqEventually("COM: la otra persona ve la edición en vivo", async () => (await theirs.innerText()).includes("@Tercera Persona también") && (await theirs.innerText()).includes("(editado)"), true, { timeout: 8000 });
  await U.closeDialog(p);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("COM: deshacer devuelve el texto anterior", bodyOf, "Hola @[Cuarta Persona](user:qacom4) revisa esto");
  await L.eqEventually("COM: y la otra persona lo ve en vivo, sin «(editado)»", async () => (await theirs.innerText()).includes("también") || (await theirs.innerText()).includes("(editado)"), false, { timeout: 8000 });

  // Un borrador de más de 24 h se descarta, y los caducados de otras tareas se limpian al cargar.
  await p.evaluate(([k1, k2]) => {
    for (const k of [k1, k2]) localStorage.setItem(k, JSON.stringify({ at: Date.now() - 25 * 3600_000, value: { text: "de ayer" } }));
  }, [key, `pz-draft-comment:${adm.id}:otra`]);
  await L.reload(p);
  await U.openTask(p, "Comentarios");
  L.eq("COM: los borradores caducados no vuelven y se limpian", [await box().inputValue(), await p.evaluate((k) => localStorage.getItem(k), `pz-draft-comment:${adm.id}:otra`)], ["", null]);
  L.assertNoErrors("COM escritorio", [s, s2]);
  await s2.ctx.close();
  await s.ctx.close();

  // Móvil: el lápiz siempre visible (no hay ratón) y la mención resaltada al escribir.
  const m = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const mp = m.page;
  await U.openTask(mp, "Comentarios");
  const mc = U.dialog(mp).locator("[data-comment-id]").first();
  await mc.scrollIntoViewIfNeeded();
  L.eq("COM móvil: el lápiz se ve sin pasar el ratón", await mc.getByRole("button", { name: "Editar comentario" }).evaluate((el) => getComputedStyle(el).opacity), "1");
  await mc.getByRole("button", { name: "Editar comentario" }).tap();
  await U.dialog(mp).locator('textarea[aria-label="Editar comentario"]').waitFor();
  await mp.screenshot({ path: path.join(SHOTS, "com-movil-editando.png") });
  await mc.getByRole("button", { name: "Cancelar", exact: true }).tap();
  const mbox = U.dialog(mp).locator('textarea[aria-label="Nuevo comentario"]');
  await mbox.tap();
  await mp.keyboard.type("Ojo @Cua");
  await mp.keyboard.press("Enter");
  L.eq("COM móvil: «@Nombre» resaltado", [await mbox.inputValue(), await U.dialog(mp).locator("[data-mention-backdrop] mark").count()], ["Ojo @Cuarta Persona ", 1]);
  L.check("COM móvil: sin scroll horizontal", await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  L.assertNoErrors("COM móvil", [m]);
  await m.ctx.close();
}

if (only.includes("det")) {
  L.scenario("R43: detalle de la tarea (adjuntos por nombre y contador, subtareas pegadas, https automático, cerrar con cambios)");
  await L.cleanBoard();
  const [tid] = await L.seedTasks(COL.backlog, ["Detalle R43"]);
  const row = async () => (await L.q(`SELECT title, description, "linkUrl" FROM "Task" WHERE id=$1`, [tid]))[0];
  const subs = async () => (await L.q(`SELECT title FROM "Subtask" WHERE "taskId"=$1 ORDER BY position`, [tid])).map((r) => r.title);
  const s = await L.session({ viewport: { width: 1366, height: 768 } });
  await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  const p = s.page;
  const pasteInto = async (target, text) => {
    await target.focus();
    await p.evaluate((v) => navigator.clipboard.writeText(v), text);
    await p.keyboard.press("Control+v");
    await sleep(500);
  };
  await U.openTask(p, "Detalle R43");
  let d = U.dialog(p);

  // Título hasta el micrófono: el aviso «Guardado» flota sin reservar ancho.
  const title = d.locator("textarea[aria-label='Título']").first();
  const close = d.getByRole("button", { name: "Cerrar" }).first();
  const [tb, xb] = [await title.boundingBox(), await close.boundingBox()];
  L.check("R43C4: la caja del título llega hasta la X (sin hueco para «Guardado»)", xb.x - (tb.x + tb.width) <= 12, `hueco ${Math.round(xb.x - (tb.x + tb.width))} px`);
  await title.click();
  await p.keyboard.press("End");
  await p.keyboard.type(" editado");
  await p.keyboard.press("Enter");
  const status = d.locator("[data-save-status]");
  L.check("R43C4: «Guardado» se ve tras guardar el título", await L.waitFor(async () => (await status.innerText()).includes("Guardado") && (await status.evaluate((e) => getComputedStyle(e).opacity)) === "1", { timeout: 5000 }));
  await p.screenshot({ path: `${SHOTS}/r43-guardado-1366.png` });
  const [tb2, sb] = [await title.boundingBox(), await status.boundingBox()];
  L.check("R43C4: «Guardado» no tapa el título (queda sobre la línea inferior de la cabecera)", sb.y >= tb2.y + tb2.height - 2, JSON.stringify({ tb2, sb }));

  // Adjuntos: por nombre (natural, sin mayúsculas ni acentos) y contador en el encabezado; el orden se mantiene al subir más.
  const fileInput = d.locator("input[type=file][multiple]").first();
  const txt = (name) => ({ name, mimeType: "text/plain", buffer: Buffer.from(`contenido de ${name}`) });
  await fileInput.setInputFiles(["informe 10.txt", "Zeta.txt", "informe 2.txt", "árbol.txt"].map(txt));
  const names = () => d.locator("li span[title]").allTextContents();
  await L.eqEventually("R43M2: adjuntos ordenados por nombre", names, ["árbol.txt", "informe 2.txt", "informe 10.txt", "Zeta.txt"], { timeout: 15000 });
  L.eq("R43M1: «Capturas y adjuntos (4)»", (await d.getByRole("heading", { name: /^Capturas y adjuntos/ }).innerText()).trim(), "Capturas y adjuntos (4)");
  await fileInput.setInputFiles([txt("Beta.txt")]);
  await L.eqEventually("R43M2: el nuevo adjunto entra en su sitio", names, ["árbol.txt", "Beta.txt", "informe 2.txt", "informe 10.txt", "Zeta.txt"], { timeout: 15000 });
  L.eq("R43M1: el contador sube a 5", (await d.getByRole("heading", { name: /^Capturas y adjuntos/ }).innerText()).trim(), "Capturas y adjuntos (5)");

  // Subtareas pegadas con varias líneas: una por línea (sin viñetas) y un solo «Deshacer».
  const newSub = d.getByPlaceholder("Añadir subtarea…");
  await pasteInto(newSub, "- Comprar pan\n* Llamar\n\n1. Revisar\n[ ] Enviar\n");
  await L.eqEventually("R43: pegar 4 líneas crea 4 subtareas sin viñetas", subs, ["Comprar pan", "Llamar", "Revisar", "Enviar"]);
  L.eq("R43: el campo queda vacío tras pegar varias líneas", await newSub.inputValue(), "");
  await U.undoKey(p, "Control+z");
  await L.eqEventually("R43: un solo deshacer quita las 4", subs, []);
  await pasteInto(newSub, "Una sola línea\n");
  L.eq("R43: una sola línea se pega en el campo", await newSub.inputValue(), "Una sola línea");
  await newSub.fill("");

  // Enlace sin esquema: se completa con https://; javascript: se sigue rechazando.
  const link = d.locator('input[type="url"]').first();
  await link.fill("example.com/r43");
  await link.press("Enter");
  await L.eqEventually("R43: «example.com/r43» se guarda como https://example.com/r43", async () => (await row()).linkUrl, "https://example.com/r43");
  L.eq("R43: el campo muestra el enlace completo", await link.inputValue(), "https://example.com/r43");
  await link.fill("javascript:alert(1)");
  await link.press("Enter");
  await sleep(800);
  L.eq("R43: javascript: no se guarda", (await row()).linkUrl, "https://example.com/r43");
  await link.fill("https://example.com/r43");
  await link.press("Enter");
  await sleep(300);

  // Cerrar con la descripción a medio escribir pide confirmación; «Seguir editando» la conserva.
  await d.getByRole("button", { name: "Añade una descripción…" }).click();
  await sleep(600);
  await p.keyboard.type("Texto sin guardar");
  await close.click();
  const confirmDlg = p.locator("[role=dialog]").filter({ hasText: "La descripción tiene cambios sin guardar" });
  L.check("R43: cerrar con la X pide confirmación", await confirmDlg.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await p.screenshot({ path: `${SHOTS}/r43-confirmar-cierre.png` });
  await confirmDlg.getByRole("button", { name: "Seguir editando" }).click();
  await sleep(400);
  L.check("R43: «Seguir editando» deja el detalle abierto con el texto", (await d.isVisible()) && (await d.locator("[contenteditable=true]").first().innerText()).includes("Texto sin guardar"), await d.locator("[contenteditable=true]").first().innerText().catch((e) => e.message));
  await d.locator("[contenteditable=true]").first().click();
  await p.keyboard.press("Escape");
  const escConfirm = p.locator("[role=dialog]").filter({ hasText: "¿Descartar los cambios de la descripción?" });
  L.check("R43: Escape en el editor con cambios pregunta", await escConfirm.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await escConfirm.getByRole("button", { name: "Seguir editando" }).click();
  await sleep(300);
  await p.mouse.click(5, 5); // fuera del diálogo
  L.check("R43: clic fuera también pregunta", await confirmDlg.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await confirmDlg.getByRole("button", { name: "Descartar cambios" }).click();
  await d.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  L.check("R43: «Descartar cambios» cierra sin guardar", (await p.locator("[role=dialog]").count()) === 0 && !(await row()).description);
  // Sin cambios no pregunta.
  await U.openTask(p, "Detalle R43 editado");
  d = U.dialog(p);
  await d.getByRole("button", { name: "Añade una descripción…" }).click();
  await sleep(500);
  await p.mouse.click(5, 5);
  L.check("R43: sin cambios en la descripción cierra sin preguntar", await d.waitFor({ state: "detached", timeout: 4000 }).then(() => true, () => false));
  // El editor con barra reescribe «* a» como «- a» al abrir: eso no cuenta como cambio (ni tras hacer clic dentro).
  await L.q(`UPDATE "Task" SET description=$1 WHERE id=$2`, ["* uno\n* dos\n\nTexto con **negrita**", tid]);
  await L.reload(p);
  await U.openTask(p, "Detalle R43 editado");
  d = U.dialog(p);
  await d.getByRole("button", { name: "Editar" }).first().click();
  await sleep(600);
  await d.locator("[contenteditable=true]").first().click();
  await p.keyboard.press("End");
  await p.mouse.click(5, 5);
  L.check("R43: abrir el editor y hacer clic sin escribir no pregunta al cerrar", await d.waitFor({ state: "detached", timeout: 4000 }).then(() => true, () => false));
  await L.q(`UPDATE "Task" SET description='' WHERE id=$1`, [tid]);
  L.assertNoErrors("R43 escritorio", [s]);
  await s.ctx.close();

  // Móvil: el botón atrás también pregunta y, si se sigue editando, volver atrás vuelve a preguntar (no sale del tablero).
  const m = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  await U.openTask(m.page, "Detalle R43 editado");
  const md = U.dialog(m.page);
  await md.getByRole("button", { name: "Añade una descripción…" }).click();
  await sleep(600);
  await m.page.keyboard.type("Móvil sin guardar");
  await m.page.screenshot({ path: `${SHOTS}/r43-movil-390.png` });
  const boardUrl = m.page.url();
  const mConfirm = m.page.locator("[role=dialog]").filter({ hasText: "La descripción tiene cambios sin guardar" });
  await m.page.goBack();
  L.check("R43 móvil: atrás pide confirmación", await mConfirm.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await mConfirm.getByRole("button", { name: "Seguir editando" }).click();
  await sleep(800);
  await m.page.goBack();
  L.check("R43 móvil: atrás otra vez vuelve a preguntar", await mConfirm.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await mConfirm.getByRole("button", { name: "Descartar cambios" }).click();
  await md.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await sleep(500);
  L.check("R43 móvil: tras descartar sigue en el tablero", (await m.page.locator("[role=dialog]").count()) === 0 && m.page.url().split("?")[0] === boardUrl.split("?")[0], m.page.url());
  L.assertNoErrors("R43 móvil", [m]);
  await m.ctx.close();

  // Nueva tarea: subtareas pegadas y contador/orden de los archivos.
  const n = await L.session({ viewport: { width: 1440, height: 900 } });
  await n.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  await n.page.keyboard.press("Alt+n");
  const nt = n.page.locator('input[id$="-title"]').first();
  await nt.waitFor();
  await nt.fill("Nueva R43");
  const ns = n.page.locator('input[id$="-subtask"]').first();
  await ns.focus();
  await n.page.evaluate(() => navigator.clipboard.writeText("- uno\n- dos\n- tres"));
  await n.page.keyboard.press("Control+v");
  await sleep(300);
  await U.dialog(n.page).locator("input[type=file][multiple]").first().setInputFiles(["b.txt", "A.txt"].map(txt));
  await sleep(300);
  L.eq("R43M1: «Capturas y adjuntos (2)» en Nueva tarea", (await U.dialog(n.page).getByText(/^Capturas y adjuntos/).innerText()).trim(), "Capturas y adjuntos (2)");
  L.eq("R43M2: archivos por nombre en Nueva tarea", await U.dialog(n.page).locator("[title$='.txt']").evaluateAll((els) => els.map((e) => e.getAttribute("title"))), ["A.txt", "b.txt"]);
  await n.page.keyboard.press("Alt+s");
  await L.eqEventually("R43: Nueva tarea crea una subtarea por línea pegada", async () => (await L.q(`SELECT s.title FROM "Subtask" s JOIN "Task" t ON t.id=s."taskId" WHERE t.title='Nueva R43' ORDER BY s.position`)).map((r) => r.title), ["uno", "dos", "tres"]);
  L.assertNoErrors("R43 nueva tarea", [n]);
  await n.ctx.close();
}

if (only.includes("r44")) {
  // Reconocimiento de voz simulado: empieza a «escuchar» y no termina hasta que se para (Chromium sin servicio de voz).
  const fakeSpeech = () => {
    window.SpeechRecognition = class {
      start() { window.__dictating = true; }
      stop() { window.__dictating = false; this.onend?.(); }
      abort() { window.__dictating = false; }
    };
  };
  const micOf = (scope) => scope.locator("[data-while-editing]").first();
  // Oculto: transparente y sin recibir clics (sigue en el orden de Tab y montado, para no cortar un dictado).
  const shown = (loc) => loc.evaluate((el) => getComputedStyle(el).opacity === "1" && getComputedStyle(el).pointerEvents !== "none");
  const box = async (loc) => {
    const b = await loc.boundingBox();
    return b && { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) };
  };

  L.scenario("R44C1: el micrófono del título solo se ve al editarlo");
  await L.cleanBoard();
  const long = "Revisar el flujo completo de facturación trimestral con el equipo de soporte y dejar anotadas las dudas abiertas";
  await L.seedTasks(COL.backlog, ["Micro R44", long]);
  for (const [label, viewport, mobile] of [["1440", { width: 1440, height: 900 }, false], ["1366", { width: 1366, height: 768 }, false], ["móvil", { width: 390, height: 844 }, true]]) {
    const s = await L.session({ viewport, mobile, init: fakeSpeech });
    const p = s.page;
    for (const title of mobile ? ["Micro R44"] : ["Micro R44", long]) {
      const tag = `C1 ${label} «${title.slice(0, 12)}»`;
      await U.openTask(p, title);
      const d = U.dialog(p);
      const mic = micOf(d);
      const ta = d.locator("textarea[aria-label='Título']").first();
      // En móvil, sin editar, el título es un botón (dos líneas como mucho); en escritorio, el propio campo.
      const field = mobile ? d.getByRole("button", { name: "Título" }).first() : ta;
      L.check(`${tag}: sin editar, el micrófono no se ve`, !(await shown(mic)));
      // Pulsar donde iría el micrófono es pulsar el título.
      L.check(`${tag}: sin editar, el hueco del micrófono no recibe clics`, await mic.locator("button").evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !el.contains(hit) && !!hit?.closest("[aria-label='Título']");
      }));
      const head = d.locator("[data-save-status]").locator("..");
      const before = [await box(field), await box(head)];
      if (title === "Micro R44") await p.screenshot({ path: `${SHOTS}/r44-micro-${label}-reposo.png` });
      if (mobile) await field.tap();
      else await field.click();
      await sleep(200);
      L.check(`${tag}: al editar el título se ve el micrófono`, await shown(mic));
      const after = [await box(ta), await box(head)];
      if (!mobile) L.eq(`${tag}: el título y la cabecera no cambian de tamaño al salir el micrófono`, after.map((b) => [b.w, b.h]), before.map((b) => [b.w, b.h]));
      if (title === "Micro R44") await p.screenshot({ path: `${SHOTS}/r44-micro-${label}-editando.png` });
      // Pulsar el micrófono no quita el foco al título (ni en el mousedown) y empieza a dictar.
      const btn = mic.locator("button");
      if (mobile) await btn.tap();
      else {
        const mb = await btn.boundingBox();
        await p.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
        await p.mouse.down();
        L.check(`${tag}: al pulsar el micrófono el título conserva el foco`, await ta.evaluate((el) => el === document.activeElement));
        await p.mouse.up();
      }
      await sleep(100);
      L.check(`${tag}: el micrófono dicta`, (await btn.getAttribute("aria-pressed")) === "true" && (await p.evaluate(() => window.__dictating)));
      // Si el foco sale sin pulsar fuera (p. ej., al cambiar de ventana), el dictado sigue y el botón se sigue viendo.
      await ta.evaluate((el) => el.blur());
      await sleep(200);
      L.check(`${tag}: dictando, el micrófono sigue a la vista aunque el título pierda el foco`, (await shown(mic)) && (await p.evaluate(() => window.__dictating)));
      if (mobile) await btn.tap();
      else await btn.click();
      await sleep(200);
      L.check(`${tag}: al parar el dictado sin foco en el título, el micrófono se oculta`, !(await shown(mic)) && !(await p.evaluate(() => window.__dictating)));
      if (!mobile) {
        // Con el teclado: Tab desde el título llega al micrófono, que sigue visible.
        await ta.focus();
        await p.keyboard.press("Tab");
        L.check(`${tag}: con Tab desde el título el foco pasa al micrófono, visible`, (await btn.evaluate((el) => el === document.activeElement)) && (await shown(mic)));
      }
      await U.closeDialog(p);
      if (await p.locator("[role=dialog]").count()) await U.closeDialog(p);
    }
    if (!mobile) {
      // Nueva tarea: el título entra con el foco (se ve el micrófono); al pasar a otro campo se oculta, sin mover el campo.
      await p.keyboard.press("Alt+n");
      const nt = p.locator('input[id$="-title"]').first();
      await nt.waitFor();
      await sleep(400);
      const nd = U.dialog(p);
      const nmic = micOf(nd);
      const nb = await box(nt);
      L.check(`C1 ${label} Nueva tarea: con el foco en el título se ve el micrófono`, (await nt.evaluate((el) => el === document.activeElement)) && (await shown(nmic)));
      await p.screenshot({ path: `${SHOTS}/r44-nueva-${label}-titulo.png` });
      await nd.locator("select").first().focus();
      await sleep(150);
      L.check(`C1 ${label} Nueva tarea: con el foco en otro campo no se ve`, !(await shown(nmic)));
      L.eq(`C1 ${label} Nueva tarea: el campo del título no cambia de tamaño`, await box(nt), nb);
      const others = await nd.locator("button[data-dictation]").evaluateAll((els) => els.filter((e) => !e.closest("[data-while-editing]") && getComputedStyle(e).visibility === "visible").length);
      L.check(`C1 ${label} Nueva tarea: el micrófono de la descripción no cambia (sigue a la vista)`, others >= 1, `visibles: ${others}`);
      await p.screenshot({ path: `${SHOTS}/r44-nueva-${label}-otro-campo.png` });
      await p.keyboard.press("Escape");
      await sleep(500);
      if (await p.locator("[role=dialog]").count()) await p.keyboard.press("Escape");
      await sleep(300);
    }
    // Oscuro: mismo comportamiento (capturas).
    await p.emulateMedia({ colorScheme: "dark" });
    await U.openTask(p, "Micro R44");
    const dd = U.dialog(p);
    L.check(`C1 ${label} oscuro: sin editar, el micrófono no se ve`, !(await shown(micOf(dd))));
    await p.screenshot({ path: `${SHOTS}/r44-micro-${label}-oscuro-reposo.png` });
    if (mobile) await dd.getByRole("button", { name: "Título" }).first().tap();
    else await dd.locator("textarea[aria-label='Título']").first().click();
    await sleep(200);
    L.check(`C1 ${label} oscuro: al editar, sí`, await shown(micOf(dd)));
    await p.screenshot({ path: `${SHOTS}/r44-micro-${label}-oscuro-editando.png` });
    await U.closeDialog(p);
    L.assertNoErrors(`C1 ${label}`, [s]);
    await s.ctx.close();
  }

  L.scenario("R44C2: columnas que siguen por abajo, sin esquinas inferiores");
  await L.cleanBoard();
  const pad = (i) => String(i).padStart(2, "0");
  await L.seedTasks(COL.backlog, Array.from({ length: 20 }, (_, i) => `B${pad(i + 1)}`));
  await L.seedTasks(COL.doing, ["E1", "E2", "E3"]);
  await L.seedTasks(COL.next, Array.from({ length: 16 }, (_, i) => `R${pad(i + 1)}`));
  // Oráculo independiente del cálculo de la app: la última tarjeta acaba por debajo de lo visible de la lista o de la ventana.
  const state = (page, name) => L.colLoc(page, name).evaluate((col) => {
    const list = col.querySelector("[data-card-list]");
    const cards = list.querySelectorAll("[data-task-card]");
    const last = cards[cards.length - 1];
    const bottom = Math.min(list.getBoundingClientRect().bottom, window.innerHeight);
    return {
      attr: col.hasAttribute("data-more-below"),
      radius: getComputedStyle(col).borderBottomLeftRadius,
      hidden: !!last && last.getBoundingClientRect().bottom > bottom + 1,
      overflow: list.scrollHeight > list.clientHeight,
    };
  });
  const scrollList = (page, name, to) => L.colLoc(page, name).evaluate((col, f) => {
    const list = col.querySelector("[data-card-list]");
    list.scrollTop = f === "end" ? list.scrollHeight : f === "top" ? 0 : list.scrollHeight - list.clientHeight - Number(f);
  }, to);
  for (const [label, viewport] of [["1366", { width: 1366, height: 768 }], ["1440", { width: 1440, height: 900 }]]) {
    const s = await L.session({ viewport });
    const p = s.page;
    for (const scheme of ["light", "dark"]) {
      await p.emulateMedia({ colorScheme: scheme });
      await sleep(300);
      const b = await state(p, COL.backlog);
      L.check(`C2 ${label} ${scheme}: Backlog con tarjetas cortadas abajo → esquinas inferiores rectas`, b.hidden && b.attr && b.radius === "0px", JSON.stringify(b));
      const e = await state(p, COL.doing);
      L.check(`C2 ${label} ${scheme}: «En progreso» (todo cabe) → redondeada`, !e.hidden && !e.attr && e.radius !== "0px", JSON.stringify(e));
      const r = await state(p, COL.next);
      L.check(`C2 ${label} ${scheme}: la de la release (con «Siempre en la release») sigue redondeada aunque tenga scroll`, r.overflow && !r.attr && r.radius !== "0px", JSON.stringify(r));
      await p.screenshot({ path: `${SHOTS}/r44-columnas-${label}-${scheme}.png` });
    }
    await p.emulateMedia({ colorScheme: "light" });
    await scrollList(p, COL.backlog, "end");
    await sleep(200);
    let b = await state(p, COL.backlog);
    L.check(`C2 ${label}: al llegar al final del scroll → redondeada`, !b.hidden && !b.attr && b.radius !== "0px", JSON.stringify(b));
    await p.screenshot({ path: `${SHOTS}/r44-columnas-${label}-final.png` });
    // Solo queda por ver el hueco del final (la última tarjeta se ve entera): sigue redondeada.
    await scrollList(p, COL.backlog, 10);
    await sleep(200);
    b = await state(p, COL.backlog);
    L.check(`C2 ${label}: con solo el hueco del final por ver → redondeada`, !b.hidden && !b.attr, JSON.stringify(b));
    await scrollList(p, COL.backlog, 150);
    await sleep(200);
    b = await state(p, COL.backlog);
    L.check(`C2 ${label}: subiendo un poco (la última tarjeta se corta) → recta otra vez`, b.hidden && b.attr, JSON.stringify(b));
    await scrollList(p, COL.backlog, "top");
    await sleep(200);
    L.check(`C2 ${label}: arriba del todo → recta`, (await state(p, COL.backlog)).attr);
    // Ventana más baja: «En progreso» deja de caber; al volver, cabe otra vez.
    await p.setViewportSize({ width: viewport.width, height: 320 });
    await sleep(300);
    const lo = await state(p, COL.doing);
    L.check(`C2 ${label}: al encoger la ventana, «En progreso» ya no cabe → recta`, lo.hidden && lo.attr, JSON.stringify(lo));
    await p.setViewportSize(viewport);
    await sleep(300);
    L.check(`C2 ${label}: al volver al tamaño, redondeada`, !(await state(p, COL.doing)).attr);
    L.assertNoErrors(`C2 ${label}`, [s]);
    await s.ctx.close();
  }

  // En vivo y al añadir/quitar tarjetas: otra persona pasa tarjetas a «En progreso» con Alt+→ hasta que no caben.
  const a = await L.session({ viewport: { width: 1366, height: 768 } });
  const o = await L.session({ email: L.USER2, viewport: { width: 1366, height: 768 } });
  await sleep(1500); // canal en vivo
  let moved = 0;
  for (let i = 1; i <= 20 && !(await state(a.page, COL.doing)).hidden; i++) {
    await L.cardLoc(o.page, `B${pad(i)}`).focus();
    await o.page.keyboard.press("Alt+ArrowRight");
    moved = i;
    await L.waitFor(async () => (await U.uiOrder(a.page, COL.doing)).includes(`B${pad(i)}`), { timeout: 5000 });
    await sleep(300);
  }
  let st = await state(a.page, COL.doing);
  L.check(`C2 en vivo: con las tarjetas que llegan de otra persona (${moved}) «En progreso» pasa a recta`, st.hidden && st.attr, JSON.stringify(st));
  await a.page.screenshot({ path: `${SHOTS}/r44-columnas-en-vivo.png` });
  // Quitarlas desde aquí (Alt+←) la devuelve a redondeada en cuanto vuelve a caber.
  for (let i = moved; i >= 1 && (await state(a.page, COL.doing)).hidden; i--) {
    await L.cardLoc(a.page, `B${pad(i)}`).focus();
    await a.page.keyboard.press("Alt+ArrowLeft");
    await sleep(500);
  }
  st = await state(a.page, COL.doing);
  L.check("C2: al quitar tarjetas hasta que vuelven a caber → redondeada", !st.hidden && !st.attr, JSON.stringify(st));
  // Arrastre con el ratón: soltar tarjetas en «En progreso» hasta que no caben.
  const inDoing = (await U.uiOrder(a.page, COL.doing)).length;
  for (let i = 0; i < 4 && !(await state(a.page, COL.doing)).hidden; i++) {
    const title = (await U.uiOrder(a.page, COL.backlog))[0];
    await L.cardLoc(a.page, title).scrollIntoViewIfNeeded();
    await U.drag(a.page, title, { column: COL.doing });
  }
  await sleep(300);
  st = await state(a.page, COL.doing);
  await a.page.screenshot({ path: `${SHOTS}/r44-columnas-arrastre.png` });
  L.check("C2 arrastre: al soltar tarjetas hasta no caber → recta", st.hidden && st.attr, JSON.stringify({ ...st, antes: inDoing, ahora: (await U.uiOrder(a.page, COL.doing)).length }));
  L.assertNoErrors("C2 en vivo", [a, o]);
  await o.ctx.close();
  await a.ctx.close();

  // Móvil: una columna a la vista, mismo criterio; al cambiar de pestaña se recalcula.
  const m = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const mp = m.page;
  const tab = (name) => mp.locator("[data-mobile-tabs] button", { hasText: name }).first();
  for (const scheme of ["light", "dark"]) {
    await mp.emulateMedia({ colorScheme: scheme });
    await tab(COL.backlog).tap();
    await sleep(600);
    const mb = await state(mp, COL.backlog);
    L.check(`C2 móvil ${scheme}: Backlog con tarjetas cortadas → recta`, mb.hidden && mb.attr && mb.radius === "0px", JSON.stringify(mb));
    await mp.screenshot({ path: `${SHOTS}/r44-columnas-movil-${scheme}.png` });
    await tab(COL.closed).tap();
    await sleep(600);
    const mc = await state(mp, COL.closed);
    L.check(`C2 móvil ${scheme}: columna vacía → redondeada`, !mc.attr && mc.radius !== "0px", JSON.stringify(mc));
    await tab("Siguiente salto").tap();
    await sleep(600);
    const mr = await state(mp, COL.next);
    L.check(`C2 móvil ${scheme}: la de la release, redondeada siempre`, mr.overflow && !mr.attr && mr.radius !== "0px", JSON.stringify(mr));
    await mp.screenshot({ path: `${SHOTS}/r44-columnas-movil-release-${scheme}.png` });
  }
  L.assertNoErrors("C2 móvil", [m]);
  await m.ctx.close();
}

// ---------------------------------------------------------------- R46
if (only.includes("r46")) {
  L.scenario("R46: «Nuevo proyecto» mínimo; cerrar el detalle con un comentario o un renombrado a medias; borradores al cerrar sesión");
  await L.cleanBoard();
  const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
  const before = (await L.q(`SELECT id FROM "Project"`)).map((r) => r.id);
  // El diálogo es de administradores: la sesión se abre como miembro (sin el segundo paso) y después pasa a admin.
  const asAdmin = (on) => L.q(`UPDATE "User" SET role=$1 WHERE email=$2`, [on ? "ADMIN" : "MEMBER", L.ADMIN]);
  const newProjectDialog = (page) => page.locator("[role=dialog]").filter({ has: page.locator("#project-name") });
  const openNewProject = async (page, mobile = false) => {
    if (mobile) {
      await page.getByRole("button", { name: "Abrir menú" }).tap();
      await sleep(400);
    }
    const scope = mobile ? page.locator("aside[role=dialog]") : page.locator("aside").first();
    await scope.locator("button[aria-haspopup]").first().click();
    await page.getByRole("menuitem", { name: "Nuevo proyecto" }).click();
    const nd = newProjectDialog(page);
    await nd.waitFor();
    await sleep(300);
    return nd;
  };
  const structure = (nd) => nd.locator("#project-start").evaluate((sel) => [...sel.children].map((c) => (c.tagName === "OPTGROUP" ? { group: c.label, n: c.children.length } : c.textContent)));
  const help = (nd) => nd.locator("#project-start-help").innerText();
  const [{ name: firstTemplate, columns: tplColumns }] = await L.q(`SELECT name, columns FROM "ProjectTemplate" ORDER BY name LIMIT 1`);
  let s = await L.session({ viewport: { width: 1366, height: 768 } });
  let p = s.page;
  await asAdmin(true);
  try {
    await L.reload(p);
    let nd = await openNewProject(p);
    await L.eqEventually("R46M1: «Empezar con» es un solo desplegable: en blanco, «Ejemplos» (4) y «Plantillas»", async () => {
      const st = await structure(nd);
      return [st[0], st[1], st[2]?.group, (st[2]?.n ?? 0) > 0];
    }, ["Proyecto en blanco", { group: "Ejemplos", n: 4 }, "Plantillas", true]);
    L.eq("R46M1: sin tarjetas-radio, sin cabeceras en mayúsculas y una sola línea de ayuda", await nd.evaluate((el) => ({
      radios: el.querySelectorAll("input[type=radio]").length,
      upper: [...el.querySelectorAll("*")].filter((x) => getComputedStyle(x).textTransform === "uppercase" && x.textContent.trim()).length,
      paragraphs: el.querySelectorAll("p").length,
    })), { radios: 0, upper: 0, paragraphs: 1 });
    L.eq("R46M1: por defecto, proyecto en blanco", [await nd.locator("#project-start").inputValue(), await help(nd)], ["blank", "Columnas por defecto, sin tarjetas."]);
    L.eq("R46M1: casilla de privado e «Importar desde un archivo…» en el pie", [await nd.getByLabel("Crear como proyecto privado inicialmente").count(), await nd.getByRole("button", { name: "Importar desde un archivo…" }).count()], [1, 1]);
    const sel = nd.locator("#project-start");
    const nameBox = nd.locator("#project-name");
    await sel.selectOption({ label: "Familia y casa" });
    L.eq("R46M1: elegir un ejemplo propone su nombre", await nameBox.inputValue(), "Familia y casa");
    L.check("R46M1: la ayuda describe el ejemplo y avisa de las tarjetas de muestra", /^Compras.*Con tarjetas de muestra que puedes borrar\.$/.test(await help(nd)), await help(nd));
    await p.screenshot({ path: `${SHOTS}/r46-nuevo-proyecto-ejemplo.png` });
    await sel.selectOption({ label: "Equipo de software" });
    L.eq("R46M1: otro ejemplo cambia el nombre propuesto", await nameBox.inputValue(), "Equipo de software");
    await sel.selectOption("blank");
    L.eq("R46M1: volver a «en blanco» quita el nombre propuesto", await nameBox.inputValue(), "");
    await nameBox.fill("Mi casa R46");
    await sel.selectOption({ label: "Familia y casa" });
    L.eq("R46M1: un nombre escrito a mano no se pisa", await nameBox.inputValue(), "Mi casa R46");
    await sel.selectOption({ label: firstTemplate });
    L.check("R46M1: la plantilla tiene su línea de ayuda", (await help(nd)) !== "Columnas por defecto, sin tarjetas." && (await help(nd)).length > 0, await help(nd));
    await p.screenshot({ path: `${SHOTS}/r46-nuevo-proyecto-plantilla.png` });
    await sel.selectOption({ label: "Familia y casa" });
    await nd.getByLabel("Crear como proyecto privado inicialmente").check();
    await nd.getByRole("button", { name: "Crear", exact: true }).click();
    await p.waitForURL(/\/p\/[^/]+\/settings/, { timeout: 15000 });
    const [made] = await L.q(`SELECT p.id, p."isPrivate", (SELECT count(*)::int FROM "Task" t WHERE t."projectId"=p.id) AS tasks FROM "Project" p WHERE name='Mi casa R46'`);
    L.check("R46M1: crea el proyecto del ejemplo, privado y con tarjetas de muestra", !!made && made.isPrivate && made.tasks > 0, JSON.stringify(made));
    // Plantilla: la estructura de la plantilla, sin tarjetas.
    nd = await openNewProject(p);
    await L.eqEventually("R46M1: las plantillas llegan al desplegable", async () => (await structure(nd))[2]?.group, "Plantillas");
    await nd.locator("#project-start").selectOption({ label: firstTemplate });
    await nd.locator("#project-name").fill("Plantilla R46");
    await nd.getByRole("button", { name: "Crear", exact: true }).click();
    await p.waitForURL(/\/p\/[^/]+\/settings/, { timeout: 15000 });
    await sleep(500);
    const [fromTpl] = await L.q(`SELECT p.id, (SELECT count(*)::int FROM "Task" t WHERE t."projectId"=p.id) AS tasks, (SELECT json_agg(c.name ORDER BY c.position) FROM "Column" c WHERE c."projectId"=p.id) AS cols FROM "Project" p WHERE name='Plantilla R46'`);
    L.eq("R46M1: con una plantilla, sus columnas y sin tarjetas", [fromTpl?.cols, fromTpl?.tasks], [tplColumns.map((c) => c.name), 0]);
    // Importar desde un archivo: sigue en el mismo diálogo y «Volver» regresa al formulario.
    nd = await openNewProject(p);
    await nd.getByRole("button", { name: "Importar desde un archivo…" }).click();
    await sleep(300);
    const importer = p.locator("[role=dialog]").filter({ has: p.locator("input[type=file]") });
    L.check("R46M1: «Importar desde un archivo…» abre la importación", (await importer.count()) === 1 && (await importer.getByLabel("Crear como proyecto privado inicialmente").count()) === 1);
    await importer.getByRole("button", { name: "Volver" }).click();
    L.check("R46M1: «Volver» regresa al formulario", await p.locator("#project-start").waitFor({ timeout: 3000 }).then(() => true, () => false));
    await p.emulateMedia({ colorScheme: "dark" });
    await sleep(200);
    await p.screenshot({ path: `${SHOTS}/r46-nuevo-proyecto-oscuro.png` });
    await p.emulateMedia({ colorScheme: "light" });
    await newProjectDialog(p).getByRole("button", { name: "Cancelar" }).click();
    L.assertNoErrors("R46M1 escritorio", [s]);
    await s.ctx.close();

    // Móvil: cabe en 390 px sin scroll horizontal y el pie no se sale.
    await asAdmin(false);
    const m = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
    await asAdmin(true);
    await L.reload(m.page);
    nd = await openNewProject(m.page, true);
    await L.eqEventually("R46M1 móvil: los ejemplos llegan al desplegable", async () => (await structure(nd))[1]?.group, "Ejemplos");
    await nd.locator("#project-start").selectOption({ label: "Preparación de un evento" });
    await sleep(200);
    const fit = await nd.evaluate((el) => ({
      overflow: document.documentElement.scrollWidth > innerWidth || el.scrollWidth > el.clientWidth + 1,
      inside: [...el.querySelectorAll("button, select, input")].every((x) => { const r = x.getBoundingClientRect(); return r.width === 0 || (r.left >= 0 && r.right <= innerWidth); }),
    }));
    L.eq("R46M1 móvil: sin scroll horizontal y todo dentro de la pantalla", fit, { overflow: false, inside: true });
    L.eq("R46M1 móvil: el ejemplo propone su nombre", await nd.locator("#project-name").inputValue(), "Preparación de un evento");
    await m.page.screenshot({ path: `${SHOTS}/r46-nuevo-proyecto-movil.png` });
    await nd.getByRole("button", { name: "Cancelar" }).tap();
    L.assertNoErrors("R46M1 móvil", [m]);
    await m.ctx.close();
  } finally {
    await asAdmin(false);
    await L.q(`DELETE FROM "Project" WHERE NOT (id = ANY($1::text[]))`, [before]);
  }

  // Detalle: un comentario en edición con cambios pide confirmación al cerrar; un renombrado a medias no se guarda al descartar.
  const [tid] = await L.seedTasks(COL.backlog, ["Detalle R46"]);
  await L.q(`INSERT INTO "Subtask"(id,"taskId",title,position) VALUES ('r46sub',$1,'Sub original',1024)`, [tid]);
  await L.q(`INSERT INTO "TaskComment"(id,"taskId","authorId",body) VALUES ('r46com',$1,$2,'Comentario original')`, [tid, adm.id]);
  const subTitle = async () => (await L.q(`SELECT title FROM "Subtask" WHERE id='r46sub'`))[0].title;
  const comBody = async () => (await L.q(`SELECT body FROM "TaskComment" WHERE id='r46com'`))[0].body;
  const taskRow = async () => (await L.q(`SELECT title, description FROM "Task" WHERE id=$1`, [tid]))[0];
  const confirmOf = (page, text) => page.locator("[role=dialog]").filter({ hasText: text });
  s = await L.session({ viewport: { width: 1366, height: 768 } });
  p = s.page;
  let d = U.dialog(p);
  const closeX = () => d.getByRole("button", { name: "Cerrar", exact: true }).first();
  const comConfirm = confirmOf(p, "Estás editando un comentario y tiene cambios sin guardar");
  const subConfirm = confirmOf(p, "Hay una subtarea a medio escribir");
  await U.openTask(p, "Detalle R46");
  const mine = d.locator("[data-comment-id]").first();
  await mine.hover();
  await mine.getByRole("button", { name: "Editar comentario" }).click();
  const edit = d.locator('textarea[aria-label="Editar comentario"]');
  await edit.waitFor();
  await p.keyboard.type(" cambiado");
  await closeX().click();
  L.check("R46a: cerrar con un comentario en edición con cambios pregunta", await comConfirm.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await p.screenshot({ path: `${SHOTS}/r46-comentario-confirmar.png` });
  await comConfirm.getByRole("button", { name: "Seguir editando" }).click();
  await sleep(400);
  L.eq("R46a: «Seguir editando» deja la edición abierta con el texto", await edit.inputValue().catch((e) => e.message), "Comentario original cambiado");
  await p.mouse.click(5, 5);
  L.check("R46a: clic fuera también pregunta", await comConfirm.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await comConfirm.getByRole("button", { name: "Descartar cambios" }).click();
  await d.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await sleep(500);
  L.eq("R46a: «Descartar cambios» cierra y el comentario sigue como estaba", [await p.locator("[role=dialog]").count(), await comBody()], [0, "Comentario original"]);
  await U.openTask(p, "Detalle R46");
  await mine.hover();
  await mine.getByRole("button", { name: "Editar comentario" }).click();
  await edit.waitFor();
  await closeX().click();
  L.check("R46a: un comentario abierto sin cambios no pregunta", await d.waitFor({ state: "detached", timeout: 4000 }).then(() => true, () => false));

  // Renombrar una subtarea y cerrar: también pregunta con la X (antes la X la guardaba sin preguntar).
  await U.openTask(p, "Detalle R46");
  const subSpan = d.locator("li span[tabindex='0']", { hasText: "Sub original" });
  await subSpan.dblclick();
  const subInput = d.locator("li input.input");
  await subInput.fill("Sub renombrada");
  await closeX().click();
  L.check("R46b: cerrar con la X durante un renombrado pregunta", await subConfirm.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await subConfirm.getByRole("button", { name: "Seguir editando" }).click();
  await sleep(400);
  L.eq("R46b: «Seguir editando» vuelve al campo con su texto, sin guardar", [await p.evaluate(() => document.activeElement?.value), await subTitle()], ["Sub renombrada", "Sub original"]);
  await p.mouse.click(5, 5);
  L.check("R46b: clic fuera pregunta", await subConfirm.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await subConfirm.getByRole("button", { name: "Descartar cambios" }).click();
  await d.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await sleep(800);
  L.eq("R46b: «Descartar cambios» no guarda el renombrado", await subTitle(), "Sub original");
  // Salir del campo sin cerrar sigue guardando.
  await U.openTask(p, "Detalle R46");
  await subSpan.dblclick();
  await subInput.fill("Sub guardada");
  await d.getByRole("heading", { name: "Subtareas" }).click();
  await L.eqEventually("R46b: salir del campo (sin cerrar) guarda el renombrado", subTitle, "Sub guardada");
  await closeX().click();
  await d.waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
  L.assertNoErrors("R46 detalle escritorio", [s]);

  // Cerrar sesión: los borradores de comentarios se borran siempre; los demás, según la opción del perfil.
  const keys = () => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pz-draft-")).sort());
  const seedDrafts = () => p.evaluate((uid) => {
    const v = JSON.stringify({ at: Date.now(), value: { text: "borrador" } });
    localStorage.setItem(`pz-draft-comment:${uid}:x`, v);
    localStorage.setItem(`pz-draft-edit:${uid}:y`, v);
  }, adm.id);
  const logout = async () => {
    await p.locator("aside").first().getByRole("button", { name: "Cerrar sesión" }).click();
    await p.waitForURL(/\/login/, { timeout: 10000 });
    await sleep(300);
  };
  await L.q(`UPDATE "User" SET "clearDraftsOnLogout"=false WHERE id=$1`, [adm.id]);
  await L.reload(p);
  await seedDrafts();
  await logout();
  L.eq("R46c: sin la opción, al cerrar sesión se borran solo los borradores de comentarios", await keys(), [`pz-draft-edit:${adm.id}:y`]);
  await L.q(`UPDATE "User" SET "clearDraftsOnLogout"=true WHERE id=$1`, [adm.id]);
  await L.login(p, L.ADMIN);
  await seedDrafts();
  await logout();
  L.eq("R46c: con la opción, se borran todos", await keys(), []);
  await L.q(`UPDATE "User" SET "clearDraftsOnLogout"=false WHERE id=$1`, [adm.id]);
  await s.ctx.close();

  // Móvil con el botón atrás: el renombrado sigue en su campo mientras se pregunta y «Descartar» no lo guarda.
  const m = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const mp = m.page;
  d = U.dialog(mp);
  const boardUrl = mp.url();
  const mSub = confirmOf(mp, "Hay una subtarea a medio escribir");
  await U.openTask(mp, "Detalle R46");
  await d.getByRole("button", { name: "Editar subtarea" }).first().tap();
  await d.locator("li input.input").fill("Sub móvil");
  await mp.goBack();
  L.check("R46b móvil: atrás durante un renombrado pregunta", await mSub.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await sleep(300);
  L.eq("R46b móvil: mientras pregunta, el renombrado no se ha guardado", await subTitle(), "Sub guardada");
  await mp.screenshot({ path: `${SHOTS}/r46-movil-renombrado-confirmar.png` });
  await mSub.getByRole("button", { name: "Seguir editando" }).tap();
  await sleep(500);
  L.eq("R46b móvil: «Seguir editando» vuelve al campo con su texto", [await mp.evaluate(() => document.activeElement?.value), await subTitle()], ["Sub móvil", "Sub guardada"]);
  await mp.goBack();
  L.check("R46b móvil: atrás otra vez vuelve a preguntar", await mSub.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await mSub.getByRole("button", { name: "Descartar cambios" }).tap();
  await d.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await sleep(800);
  L.eq("R46b móvil: «Descartar cambios» no guarda el renombrado y sigue en el tablero", [await subTitle(), await mp.locator("[role=dialog]").count(), mp.url().split("?")[0]], ["Sub guardada", 0, boardUrl.split("?")[0]]);
  // Título en edición con la descripción a medias: «Descartar» descarta la descripción y el título se guarda al cerrar
  // (como al salir del campo, igual que en escritorio).
  await U.openTask(mp, "Detalle R46");
  await d.getByRole("button", { name: "Añade una descripción…" }).tap();
  await sleep(600);
  await mp.keyboard.type("Descripción móvil");
  await d.getByRole("button", { name: "Título", exact: true }).first().tap();
  await sleep(300);
  await mp.keyboard.press("Control+a");
  await mp.keyboard.type("Detalle R46 título");
  await mp.goBack();
  const mDesc = confirmOf(mp, "La descripción tiene cambios sin guardar");
  L.check("R46b móvil: atrás con la descripción a medias pregunta", await mDesc.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await mDesc.getByRole("button", { name: "Descartar cambios" }).tap();
  await d.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await L.eqEventually("R46b móvil: tras descartar, el título se guarda y la descripción no", async () => { const r = await taskRow(); return [r.title, r.description]; }, ["Detalle R46 título", ""]);
  // Comentario en edición + atrás.
  await U.openTask(mp, "Detalle R46 título");
  const mMine = d.locator("[data-comment-id]").first();
  await mMine.getByRole("button", { name: "Editar comentario" }).tap();
  await d.locator('textarea[aria-label="Editar comentario"]').waitFor();
  await mp.keyboard.type(" desde el móvil");
  await mp.goBack();
  const mCom = confirmOf(mp, "Estás editando un comentario y tiene cambios sin guardar");
  L.check("R46a móvil: atrás con un comentario en edición pregunta", await mCom.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await mCom.getByRole("button", { name: "Descartar cambios" }).tap();
  await d.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await sleep(500);
  L.eq("R46a móvil: «Descartar cambios» deja el comentario como estaba", await comBody(), "Comentario original");
  L.assertNoErrors("R46 móvil", [m]);
  await m.ctx.close();
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
