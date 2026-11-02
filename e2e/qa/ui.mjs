// Helpers de interacción con el tablero (arrastre, diálogo de tarea, historial, deshacer).
import { fileURLToPath } from "node:url";
import * as L from "./lib.mjs";
const { sleep, colLoc, cardLoc } = L;

export const WIDE = { width: 2100, height: 1000 };

/** Títulos de las tarjetas de una columna, en orden visual. */
export async function uiOrder(page, colName) {
  return (await colLoc(page, colName).locator("[data-task-card] p").allTextContents()).map((s) => s.trim());
}
/** Espera a que no haya guardados pendientes (red en reposo + margen corto para el render). */
export async function settle(page) {
  await sleep(500);
}
/** Comprueba (con reintentos: el log se escribe tras la respuesta) que existe un AppLog con ese mensaje. */
export async function logHas(name, since, action, test) {
  const fn = typeof test === "string" ? (m) => m === test : (m) => test.test(m);
  let last = [];
  const ok = await L.waitFor(async () => { last = await L.logs(since, action); return last.some((l) => fn(l.message)); }, { timeout: 5000 });
  return L.check(name, ok, JSON.stringify(last.map((l) => l.message)));
}
/** Arrastra la tarjeta `title` con el ratón. target: {card, where: "top"|"bottom"} o {column} (final / columna vacía). */
export async function drag(page, title, target, fromCol) {
  const srcCard = fromCol ? colLoc(page, fromCol).locator("[data-task-card]").filter({ has: page.locator("p", { hasText: new RegExp(`^\\s*${title}\\s*$`) }) }).first() : cardLoc(page, title);
  const src = await srcCard.boundingBox();
  let tx, ty;
  if (target.card) {
    const tb = await cardLoc(page, target.card).boundingBox();
    tx = tb.x + tb.width / 2;
    ty = target.where === "bottom" ? tb.y + tb.height - 4 : tb.y + 4;
  } else if (target.below) {
    const cards = await colLoc(page, target.below).locator("[data-task-card]").all();
    const lb = await cards[cards.length - 1].boundingBox();
    const cb = await colLoc(page, target.below).boundingBox();
    tx = cb.x + cb.width / 2;
    ty = lb.y + lb.height + 40;
  } else {
    const cb = await colLoc(page, target.column).boundingBox();
    tx = cb.x + cb.width / 2;
    ty = cb.y + 150;
  }
  const sx = src.x + src.width / 2, sy = src.y + src.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 8, sy + 8, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 25 });
  await sleep(150);
  await page.mouse.move(tx + 1, ty + 1, { steps: 2 });
  await sleep(150);
  await page.mouse.up();
  await settle(page);
}
export const dialog = (page) => page.locator("[role=dialog]").first();
export async function openTask(page, title) {
  await cardLoc(page, title).click();
  await dialog(page).waitFor();
  await sleep(400);
}
export async function closeDialog(page) {
  await page.keyboard.press("Escape");
  await dialog(page).waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await settle(page);
}
/** Texto del historial del diálogo abierto (lo despliega si hace falta). */
export async function historyText(page) {
  const d = dialog(page);
  const btn = d.getByRole("button", { name: "Historial" });
  if (await btn.count()) {
    await btn.click();
    await d.getByText("Cargando…").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await sleep(400);
  }
  return d.innerText();
}
/** Número de UndoEntry de un tipo (sondeo de que una acción ya se registró). */
export async function undoCount(kind) {
  return Number((await L.q(`SELECT count(*) AS n FROM "UndoEntry" WHERE kind=$1`, [kind]))[0].n);
}
/** Pulsa un atajo y espera a que cambie la tabla de deshacer/rehacer. */
export async function undoKey(page, combo, kind = "UNDO") {
  // La entrada de deshacer se escribe al final de la acción (tras el cambio visible en BD): se espera a que el contador se estabilice.
  let before = await undoCount(kind), stable = 0;
  while (stable < 3) { await sleep(150); const n = await undoCount(kind); if (n === before) stable++; else { before = n; stable = 0; } }
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press(combo);
  await L.waitFor(async () => (await undoCount(kind)) !== before, { timeout: 6000 });
  await settle(page);
}
/** Ejecuta un escenario suelto (node sN-...mjs): prepara usuarios, lo corre e imprime el resumen. */
export async function runStandalone(metaUrl, fn) {
  if (process.argv[1] !== fileURLToPath(metaUrl)) return;
  await L.prepareUsers();
  try { await fn(); } catch (e) { L.check("el escenario terminó sin excepción", false, e.stack || String(e)); }
  await L.closeBrowser(); await L.closeDb();
  const failed = L.results.filter((r) => !r.pass).length;
  console.log(`\n${L.results.length - failed}/${L.results.length} OK`);
  process.exit(failed ? 1 : 0);
}
