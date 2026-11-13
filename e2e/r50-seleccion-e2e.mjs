// Arrastrar una tarjeta que forma parte de una selección múltiple mueve toda la selección: se ve como un montón con una
// insignia («3»), las demás seleccionadas quedan atenuadas en su sitio y el hueco de destino dice «3 tarjetas irán aquí»;
// al soltar van todas juntas y en orden (columna y posición), con un solo paso de deshacer, y la selección se mantiene.
// Escape cancela; una tarjeta sin seleccionar se mueve sola; Ctrl al soltar copia solo la cogida; Alt+flechas sobre una
// seleccionada mueve todas; la otra persona lo ve por el canal en vivo; la columna de revisión pide confirmación; con el
// dedo (asa) y en modo oscuro. Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r50-seleccion-e2e.mjs
//   # PART=drag,cancel,single,copy,same,keys,live,review,touch,dark
import os from "node:os";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep, COL } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "drag,cancel,single,copy,same,keys,live,review,touch,dark").split(",");

await L.prepareUsers();
await L.cleanBoard();

/** Marca la tarjeta con su casilla (la de la propia tarjeta; con ratón o con el dedo). */
async function select(page, title, { tap = false } = {}) {
  const box = L.cardLoc(page, title).locator('button[aria-label="Seleccionar"]');
  if (tap) await box.tap();
  else await box.click();
  await L.waitFor(() => L.cardLoc(page, title).getAttribute("aria-pressed").then((v) => v === "true"), { timeout: 3000 });
}
/** Lo que han dicho los avisos del lector de pantalla del arrastre (región en vivo de dnd-kit). */
const announced = (page) => page.locator('[id^="DndLiveRegion"]').allTextContents().then((t) => t.join(" | "));
const rootGroup = (page) => page.evaluate(() => document.documentElement.getAttribute("data-group-drag"));
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Empieza a arrastrar `title` con el ratón (sin soltar). */
async function grab(page, title) {
  const c = center(await L.cardLoc(page, title).boundingBox());
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 8, c.y + 8, { steps: 4 });
  await sleep(150);
  return c;
}
/** Lleva el puntero a una columna (vacía: su hueco central) o al borde de una tarjeta. */
async function hover(page, target) {
  let x, y;
  if (target.card) {
    const b = await L.cardLoc(page, target.card).boundingBox();
    x = b.x + b.width / 2;
    y = target.where === "bottom" ? b.y + b.height - 4 : b.y + 4;
  } else {
    const b = await L.colLoc(page, target.column).boundingBox();
    x = b.x + b.width / 2;
    y = b.y + 150;
  }
  await page.mouse.move(x, y, { steps: 25 });
  await sleep(150);
  await page.mouse.move(x + 1, y + 1, { steps: 2 });
  await sleep(200);
}
/** Lo que se ve mientras dura el arrastre de una selección. */
async function dragState(page, dimmedTitle) {
  return page.evaluate((dimmed) => {
    const card = [...document.querySelectorAll("[data-task-card]")].find((c) => c.querySelector("p")?.textContent?.trim() === dimmed);
    const hole = document.querySelector("[data-dragging]");
    const holeStyle = hole ? getComputedStyle(hole) : null;
    return {
      root: document.documentElement.getAttribute("data-group-drag"),
      badge: document.querySelector("[data-drag-stack] [data-drag-count]")?.textContent ?? null,
      stackCards: document.querySelectorAll("[data-drag-stack] > span[aria-hidden]:not([data-drag-count])").length,
      dimmed: card ? Number(getComputedStyle(card).opacity) : null,
      holeLabel: hole ? getComputedStyle(hole, "::after").content : null,
      holeBorder: holeStyle?.outlineStyle ?? null,
      holeColor: holeStyle?.color ?? null,
      duplicate: !!document.querySelector("[data-duplicate-hint]"),
    };
  }, dimmedTitle);
}
const undoRows = async () => Number((await L.q(`SELECT count(*)::int AS n FROM "UndoEntry" WHERE kind='UNDO'`))[0].n);
/** ¿Están seguidas y en ese orden dentro de la lista? */
const contiguous = (list, block) => {
  const i = list.indexOf(block[0]);
  return i >= 0 && block.every((t, k) => list[i + k] === t);
};
const selectedCount = (page) => page.locator("[data-selection-bar]").innerText().catch(() => "");

// --- Ratón: a una columna vacía, con el montón, el atenuado, el hueco y los avisos ----------------------------------
if (only.includes("drag")) {
  L.scenario("drag: arrastrar una seleccionada lleva toda la selección");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Sel A", "Sel B", "Sel C"]);
  await L.seedTasks(COL.doing, ["Sel D", "Sel E"]);
  const s = await L.session({ viewport: { width: 1600, height: 950 } });
  const { page } = s;
  for (const t of ["Sel A", "Sel C", "Sel D"]) await select(page, t);
  L.check("DRAG: la barra dice «3 seleccionadas»", /3 seleccionadas/.test(await selectedCount(page)));
  const undoBefore = await undoRows();
  await grab(page, "Sel C");
  let st = await dragState(page, "Sel A");
  L.eq("DRAG: la raíz marca el arrastre de 3", st.root, "3");
  L.eq("DRAG: el montón lleva la insignia «3»", st.badge, "3");
  L.eq("DRAG: con 3, dos cartas detrás", st.stackCards, 2);
  L.check("DRAG: las demás seleccionadas quedan atenuadas en su sitio", st.dimmed !== null && st.dimmed < 0.5, String(st.dimmed));
  L.eq("DRAG: el hueco dice cuántas caerán", st.holeLabel, '"3 tarjetas irán aquí"');
  L.eq("DRAG: el hueco es un recuadro discontinuo", st.holeBorder, "dashed");
  L.check("DRAG: aviso «Has cogido 3 tarjetas…»", (await announced(page)).includes("Has cogido 3 tarjetas («Sel C» y 2 más), en la columna Backlog."), await announced(page));
  await hover(page, { column: COL.next });
  await page.screenshot({ path: `${SHOTS}/r50-seleccion-grab.png` });
  await hover(page, { column: COL.closed });
  st = await dragState(page, "Sel D");
  L.check("DRAG: sobre otra columna sigue el montón y el atenuado", st.badge === "3" && st.dimmed < 0.5, JSON.stringify(st));
  L.check("DRAG: aviso de la columna de destino", (await announced(page)).includes("Las 3 tarjetas están sobre la columna Cerrado."), await announced(page));
  await page.screenshot({ path: `${SHOTS}/r50-seleccion-drag.png` });
  await page.mouse.up();
  await L.eqEventually("DRAG: las tres, juntas y en orden de tablero, en «Cerrado»", () => L.dbOrder(COL.closed), ["Sel A", "Sel C", "Sel D"]);
  L.eq("DRAG: en Backlog queda B", await L.dbOrder(COL.backlog), ["Sel B"]);
  L.eq("DRAG: en En progreso queda E", await L.dbOrder(COL.doing), ["Sel E"]);
  await L.eqEventually("DRAG: la pantalla también", () => U.uiOrder(page, COL.closed), ["Sel A", "Sel C", "Sel D"]);
  L.check("DRAG: aviso «Has soltado 3 tarjetas…»", (await announced(page)).includes("Has soltado 3 tarjetas en la columna Cerrado."), await announced(page));
  L.eq("DRAG: la raíz ya no marca el arrastre", await rootGroup(page), null);
  L.check("DRAG: la selección se mantiene (3 seleccionadas)", /3 seleccionadas/.test(await selectedCount(page)));
  L.check("DRAG: aviso «3 tarjetas movidas a «Cerrado»»", await page.getByText("3 tarjetas movidas a «Cerrado»").first().isVisible().catch(() => false));
  await L.eqEventually("DRAG: un solo paso de deshacer", undoRows, undoBefore + 1);
  await U.undoKey(page, "Alt+z");
  await L.eqEventually("DRAG: deshacer devuelve las tres a su sitio (Backlog)", () => L.dbOrder(COL.backlog), ["Sel A", "Sel B", "Sel C"]);
  L.eq("DRAG: deshacer devuelve D a En progreso", await L.dbOrder(COL.doing), ["Sel D", "Sel E"]);
  L.eq("DRAG: «Cerrado» vacía", await L.dbOrder(COL.closed), []);
  L.assertNoErrors("DRAG", [s]);
  await s.ctx.close();
}

// --- Escape cancela el arrastre de todas ------------------------------------------------------------------------------
if (only.includes("cancel")) {
  L.scenario("cancel: Escape a medio arrastre");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Esc A", "Esc B", "Esc C"]);
  const s = await L.session({ viewport: { width: 1600, height: 950 } });
  const { page } = s;
  await select(page, "Esc A");
  await select(page, "Esc C");
  const undoBefore = await undoRows();
  await grab(page, "Esc A");
  await hover(page, { column: COL.doing });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await sleep(600);
  L.eq("CANCEL: no se mueve ninguna", await L.dbOrder(COL.backlog), ["Esc A", "Esc B", "Esc C"]);
  L.eq("CANCEL: nada que deshacer", await undoRows(), undoBefore);
  L.eq("CANCEL: la raíz ya no marca el arrastre", await rootGroup(page), null);
  L.check("CANCEL: aviso «las 2 tarjetas vuelven a su sitio»", (await announced(page)).includes("Arrastre cancelado: las 2 tarjetas vuelven a su sitio."), await announced(page));
  const opacity = await L.cardLoc(page, "Esc C").evaluate((el) => Number(getComputedStyle(el).opacity));
  L.eq("CANCEL: las seleccionadas vuelven a verse normales", opacity, 1);
  L.assertNoErrors("CANCEL", [s]);
  await s.ctx.close();
}

// --- Una sin seleccionar se mueve sola --------------------------------------------------------------------------------
if (only.includes("single")) {
  L.scenario("single: arrastrar una tarjeta NO seleccionada mientras hay selección");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Uno A", "Uno B", "Uno C"]);
  const s = await L.session({ viewport: { width: 1600, height: 950 } });
  const { page } = s;
  await select(page, "Uno A");
  await select(page, "Uno C");
  await grab(page, "Uno B");
  const st = await dragState(page, "Uno A");
  L.check("SINGLE: sin montón ni atenuado", st.badge === null && st.root === null && st.dimmed === 1, JSON.stringify(st));
  await hover(page, { column: COL.closed });
  await page.mouse.up();
  await L.eqEventually("SINGLE: solo B pasa a «Cerrado»", () => L.dbOrder(COL.closed), ["Uno B"]);
  L.eq("SINGLE: A y C siguen en Backlog", await L.dbOrder(COL.backlog), ["Uno A", "Uno C"]);
  L.check("SINGLE: la selección sigue (2 seleccionadas)", /2 seleccionadas/.test(await selectedCount(page)));
  L.assertNoErrors("SINGLE", [s]);
  await s.ctx.close();
}

// --- Ctrl al soltar: copia solo la cogida -----------------------------------------------------------------------------
if (only.includes("copy")) {
  L.scenario("copy: Ctrl al soltar una selección copia solo la tarjeta cogida");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Copia A", "Copia B"]);
  const s = await L.session({ viewport: { width: 1600, height: 950 } });
  const { page } = s;
  await select(page, "Copia A");
  await select(page, "Copia B");
  await grab(page, "Copia B");
  await hover(page, { column: COL.closed });
  L.eq("COPY: sin Ctrl, el montón de 2", (await dragState(page, "Copia A")).badge, "2");
  await page.keyboard.down("Control");
  await page.mouse.move(700, 400, { steps: 2 });
  await hover(page, { column: COL.closed });
  const st = await dragState(page, "Copia A");
  L.check("COPY: con Ctrl, una sola tarjeta con «+ Duplicar» y sin atenuado", st.badge === null && st.duplicate && st.root === null && st.dimmed === 1, JSON.stringify(st));
  await page.mouse.up();
  await page.keyboard.up("Control");
  await L.eqEventually("COPY: en «Cerrado», solo la copia de B", () => L.dbOrder(COL.closed), ["Copia B (copia)"]);
  L.eq("COPY: las originales no se mueven", await L.dbOrder(COL.backlog), ["Copia A", "Copia B"]);
  L.assertNoErrors("COPY", [s]);
  await s.ctx.close();
}

// --- Dentro de la misma columna ---------------------------------------------------------------------------------------
if (only.includes("same")) {
  L.scenario("same: reordenar una selección dentro de su columna y hacia otra con tarjetas");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Mis A", "Mis B", "Mis C", "Mis D", "Mis E"]);
  await L.seedTasks(COL.doing, ["Otra P", "Otra Q", "Otra R"]);
  const s = await L.session({ viewport: { width: 1600, height: 950 } });
  const { page } = s;
  await select(page, "Mis A");
  await select(page, "Mis C");
  await grab(page, "Mis A");
  await hover(page, { card: "Mis D", where: "bottom" });
  await page.mouse.up();
  await L.waitFor(async () => (await L.dbOrder(COL.backlog)).indexOf("Mis A") > 0, { timeout: 6000 });
  let order = await L.dbOrder(COL.backlog);
  L.check("SAME: A y C quedan seguidas, en ese orden", contiguous(order, ["Mis A", "Mis C"]), order.join(","));
  L.eq("SAME: el resto no cambia de orden", order.filter((t) => !["Mis A", "Mis C"].includes(t)), ["Mis B", "Mis D", "Mis E"]);
  L.check("SAME: el bloque baja (tras D)", order.indexOf("Mis A") > order.indexOf("Mis D"), order.join(","));
  await L.eqEventually("SAME: la pantalla coincide", () => U.uiOrder(page, COL.backlog), order);
  // Ahora entre dos tarjetas de otra columna.
  await grab(page, "Mis C");
  await hover(page, { card: "Otra Q", where: "top" });
  await page.mouse.up();
  await L.waitFor(async () => (await L.dbOrder(COL.doing)).length === 5, { timeout: 6000 });
  order = await L.dbOrder(COL.doing);
  L.check("SAME: en la otra columna, juntas y en orden", contiguous(order, ["Mis A", "Mis C"]), order.join(","));
  L.eq("SAME: sus tarjetas no cambian de orden", order.filter((t) => t.startsWith("Otra")), ["Otra P", "Otra Q", "Otra R"]);
  L.check("SAME: el bloque cae entre P y R", order.indexOf("Mis A") > 0 && order.indexOf("Mis C") < 4, order.join(","));
  await L.eqEventually("SAME: la pantalla coincide", () => U.uiOrder(page, COL.doing), order);
  L.assertNoErrors("SAME", [s]);
  await s.ctx.close();
}

// --- Teclado: Alt+flechas sobre una seleccionada mueve todas ---------------------------------------------------------
if (only.includes("keys")) {
  L.scenario("keys: Alt+flechas con selección");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Tec A", "Tec B", "Tec C"]);
  await L.seedTasks(COL.doing, ["Tec P"]);
  const s = await L.session({ viewport: { width: 1600, height: 950 } });
  const { page } = s;
  await select(page, "Tec A");
  await select(page, "Tec C");
  const undoBefore = await undoRows();
  await L.cardLoc(page, "Tec C").focus();
  await page.keyboard.press("Alt+ArrowRight");
  await L.eqEventually("KEYS: Alt+→ lleva las dos al final de la columna siguiente", () => L.dbOrder(COL.doing), ["Tec P", "Tec A", "Tec C"]);
  L.eq("KEYS: en Backlog queda B", await L.dbOrder(COL.backlog), ["Tec B"]);
  await L.eqEventually("KEYS: un solo paso de deshacer", undoRows, undoBefore + 1);
  L.eq("KEYS: el foco sigue en la tarjeta", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Tec C");
  await page.keyboard.press("Alt+ArrowUp");
  await L.eqEventually("KEYS: Alt+↑ sube el bloque un puesto", () => L.dbOrder(COL.doing), ["Tec A", "Tec C", "Tec P"]);
  await page.keyboard.press("Alt+ArrowDown");
  await L.eqEventually("KEYS: Alt+↓ lo baja", () => L.dbOrder(COL.doing), ["Tec P", "Tec A", "Tec C"]);
  L.check("KEYS: la selección se mantiene para seguir moviendo", /2 seleccionadas/.test(await selectedCount(page)));
  // Una sin seleccionar se mueve sola, como siempre.
  await L.cardLoc(page, "Tec P").focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await L.eqEventually("KEYS: Alt+← sobre una sin seleccionar mueve solo esa", () => L.dbOrder(COL.backlog), ["Tec B", "Tec P"]);
  L.eq("KEYS: las seleccionadas no se mueven", await L.dbOrder(COL.doing), ["Tec A", "Tec C"]);
  L.assertNoErrors("KEYS", [s]);
  await s.ctx.close();
}

// --- Tiempo real: la otra persona lo ve sin recargar -----------------------------------------------------------------
if (only.includes("live")) {
  L.scenario("live: otra persona ve la selección movida por el canal en vivo");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Viva A", "Viva B", "Viva C"]);
  const s1 = await L.session({ viewport: { width: 1600, height: 950 } });
  const s2 = await L.session({ email: L.USER2, viewport: { width: 1600, height: 950 } });
  await L.liveOpen(s1.page);
  await L.liveOpen(s2.page);
  await select(s1.page, "Viva A");
  await select(s1.page, "Viva B");
  await grab(s1.page, "Viva B");
  await hover(s1.page, { column: COL.closed });
  await s1.page.mouse.up();
  await L.eqEventually("LIVE: en la base", () => L.dbOrder(COL.closed), ["Viva A", "Viva B"]);
  await L.eqEventually("LIVE: la otra persona las ve en «Cerrado»", () => U.uiOrder(s2.page, COL.closed), ["Viva A", "Viva B"], { timeout: 15000 });
  L.eq("LIVE: y en Backlog solo C", await U.uiOrder(s2.page, COL.backlog), ["Viva C"]);
  L.assertNoErrors("LIVE", [s1, s2]);
  await s1.ctx.close();
  await s2.ctx.close();
}

// --- Columna de revisión: pide confirmación por las subtareas sin marcar -----------------------------------------------
if (only.includes("review")) {
  L.scenario("review: sacar una selección de «Revisión» con subtareas pendientes");
  await L.cleanBoard();
  const p = await L.project();
  const [{ role }] = await L.q(`SELECT role FROM "Column" WHERE "projectId"=$1 AND name=$2`, [p.id, COL.doing]);
  await L.q(`UPDATE "Column" SET role='REVIEW' WHERE "projectId"=$1 AND name=$2`, [p.id, COL.doing]);
  try {
    const [ra] = await L.seedTasks(COL.doing, ["Rev A", "Rev B"]);
    await L.q(`INSERT INTO "Subtask"(id,"taskId",title,done,position) VALUES ('r50sub1',$1,'Probar en el móvil',false,1)`, [ra]);
    const s = await L.session({ viewport: { width: 1600, height: 950 } });
    const { page } = s;
    await select(page, "Rev A");
    await select(page, "Rev B");
    await grab(page, "Rev B");
    await hover(page, { column: COL.closed });
    await page.mouse.up();
    const dlg = page.getByRole("alertdialog").or(page.getByRole("dialog")).filter({ hasText: "Faltan requisitos" }).first();
    await dlg.waitFor({ timeout: 6000 });
    L.check("REVIEW: pide confirmación con la subtarea pendiente", (await dlg.innerText()).includes("Probar en el móvil"));
    await dlg.getByRole("button", { name: "Cancelar" }).click();
    await sleep(600);
    L.eq("REVIEW: al cancelar no se mueve ninguna", await L.dbOrder(COL.doing), ["Rev A", "Rev B"]);
    await L.eqEventually("REVIEW: y la pantalla sigue igual", () => U.uiOrder(page, COL.doing), ["Rev A", "Rev B"]);
    await grab(page, "Rev A");
    await hover(page, { column: COL.closed });
    await page.mouse.up();
    await dlg.waitFor({ timeout: 6000 });
    await dlg.getByRole("button", { name: "Mover igualmente" }).click();
    await L.eqEventually("REVIEW: «Mover igualmente» las lleva juntas", () => L.dbOrder(COL.closed), ["Rev A", "Rev B"]);
    L.assertNoErrors("REVIEW", [s]);
    await s.ctx.close();
  } finally {
    await L.q(`UPDATE "Column" SET role=$3 WHERE "projectId"=$1 AND name=$2`, [p.id, COL.doing, role]);
  }
}

// --- Con el dedo (asa), en el móvil -----------------------------------------------------------------------------------
async function touchDrag(page, from, to, during) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (x, y) => [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(from.x, from.y) });
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps) });
    await sleep(16);
  }
  await sleep(250);
  const seen = during ? await during() : null;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(800);
  return seen;
}
if (only.includes("touch")) {
  L.scenario("touch: con el dedo, desde el asa");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Dedo A", "Dedo B", "Dedo C", "Dedo D"]);
  const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = s;
  await select(page, "Dedo B", { tap: true });
  await select(page, "Dedo D", { tap: true });
  const handle = await L.cardLoc(page, "Dedo D").locator("button[aria-label='Arrastrar para reordenar']").boundingBox();
  const top = await L.cardLoc(page, "Dedo A").boundingBox();
  const st = await touchDrag(page, center(handle), { x: top.x + top.width / 2, y: top.y + 5 }, async () => {
    await page.screenshot({ path: `${SHOTS}/r50-seleccion-touch-drag.png` });
    return dragState(page, "Dedo B");
  });
  L.check("TOUCH: montón con la insignia «2» y B atenuada", st.badge === "2" && st.dimmed < 0.5, JSON.stringify(st));
  await L.eqEventually("TOUCH: B y D, juntas, arriba del todo", () => L.dbOrder(COL.backlog), ["Dedo B", "Dedo D", "Dedo A", "Dedo C"]);
  L.check("TOUCH: la selección sigue", /2 seleccionadas/.test(await selectedCount(page)));
  await page.screenshot({ path: `${SHOTS}/r50-seleccion-touch.png` });
  L.assertNoErrors("TOUCH", [s]);
  await s.ctx.close();
}

// --- Modo oscuro ------------------------------------------------------------------------------------------------------
if (only.includes("dark")) {
  L.scenario("dark: el montón y el hueco en modo oscuro");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Noche A", "Noche B", "Noche C"]);
  const s = await L.session({ viewport: { width: 1600, height: 950 }, init: () => { try { document.documentElement.dataset.theme = "dark"; } catch { /* aún no */ } } });
  const { page } = s;
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await select(page, "Noche A");
  await select(page, "Noche B");
  await select(page, "Noche C");
  await grab(page, "Noche B");
  await hover(page, { column: COL.doing });
  const st = await dragState(page, "Noche A");
  const back = await page.evaluate(() => getComputedStyle(document.querySelector("[data-drag-stack] > span[aria-hidden]")).backgroundColor);
  L.check("DARK: las cartas de detrás no son blancas", back !== "rgb(255, 255, 255)", back);
  const light = await page.evaluate(() => { const el = document.createElement("span"); el.style.color = "var(--color-brand-300)"; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; });
  L.eq("DARK: el texto del hueco va en el tono claro de la marca", st.holeColor, light);
  L.eq("DARK: insignia «3»", st.badge, "3");
  await page.screenshot({ path: `${SHOTS}/r50-seleccion-dark.png` });
  await page.mouse.up();
  await L.eqEventually("DARK: las tres en En progreso", () => L.dbOrder(COL.doing), ["Noche A", "Noche B", "Noche C"]);
  L.assertNoErrors("DARK", [s]);
  await s.ctx.close();
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
