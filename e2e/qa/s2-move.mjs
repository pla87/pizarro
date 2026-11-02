// Escenario 2: mover desde el diálogo (select Columna), con atajos de teclado y con la barra de selección múltiple.
import * as L from "./lib.mjs";
import * as U from "./ui.mjs";
const { COL } = L;

export async function run() {
  L.scenario("2. Mover con el diálogo, atajos y selección múltiple");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["A", "B", "C", "D"]);
  await L.seedTasks(COL.doing, ["X", "Y"]);
  const t0 = await L.dbNow();
  const s = await L.session({ viewport: U.WIDE });
  const p = s.page;
  const pos = async (t) => Number((await L.dbTask(t)).position);

  // --- select «Columna» del diálogo ---
  await U.openTask(p, "A");
  await U.dialog(p).locator("select").first().selectOption({ label: COL.doing });
  await L.eqEventually("diálogo: A cambia a «En progreso» (BD)", async () => (await L.dbTask("A")).columnName, COL.doing);
  L.eq("diálogo: Backlog en BD", await L.dbOrder(COL.backlog), ["B", "C", "D"]);
  L.check("diálogo: X e Y no se mueven de columna", (await L.dbOrder(COL.doing)).includes("X") && (await L.dbOrder(COL.doing)).includes("Y") && (await L.dbOrder(COL.doing)).length === 3);
  const ev = await L.events("A");
  L.check("diálogo: evento «move» «Movió la tarea de «Backlog» a «En progreso»»", ev.length === 1 && ev[0].code === "move" && JSON.parse(ev[0].label).p.from === COL.backlog && JSON.parse(ev[0].label).p.to === COL.doing, JSON.stringify(ev));
  await U.logHas("diálogo: AppLog «Movió «A» de «Backlog» a «En progreso»»", t0, "tasks.moveTask", "Movió «A» de «Backlog» a «En progreso»");
  L.check("diálogo: el select refleja la columna nueva", (await U.dialog(p).locator("select").first().inputValue()) === (await L.dbTask("A")).columnId);
  // Corregido en v1.20.1: sin vecinas, el servidor la deja al final (como la pinta el tablero).
  L.eq("diálogo: A queda al final de «En progreso» (BD)", await L.dbOrder(COL.doing), ["X", "Y", "A"]);
  await U.closeDialog(p);
  await L.reload(p);
  L.eq("diálogo: A sigue en «En progreso» tras recargar", (await U.uiOrder(p, COL.doing)).includes("A"), true);
  L.eq("diálogo: UI Backlog tras recargar", await U.uiOrder(p, COL.backlog), ["B", "C", "D"]);
  // Deshacer desde el tablero
  await U.undoKey(p, "Control+z");
  await L.eqEventually("diálogo: deshacer devuelve A a Backlog en su sitio", () => L.dbOrder(COL.backlog), ["A", "B", "C", "D"]);
  L.eq("diálogo: deshacer restaura la posición", await pos("A"), 1024);
  L.eq("diálogo: En progreso intacta", await L.dbOrder(COL.doing), ["X", "Y"]);
  // Terminada desde el diálogo: evento «done»
  await U.openTask(p, "D");
  await U.dialog(p).locator("select").first().selectOption({ label: COL.closed });
  await L.eqEventually("diálogo a columna terminada: BD", async () => (await L.dbTask("D")).columnName, COL.closed);
  L.check("diálogo a columna terminada: evento «done»", (await L.events("D")).some((e) => e.code === "done"), JSON.stringify(await L.events("D")));
  await U.closeDialog(p);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("diálogo a terminada: deshacer", () => L.dbOrder(COL.closed), []);
  L.eq("diálogo a terminada: D vuelve a Backlog", await L.dbOrder(COL.backlog), ["A", "B", "C", "D"]);

  // --- atajos con la tarjeta enfocada ---
  await L.cardLoc(p, "B").focus();
  await p.keyboard.press("Alt+ArrowRight");
  await L.eqEventually("Alt+→: B pasa al final de «En progreso»", () => L.dbOrder(COL.doing), ["X", "Y", "B"]);
  L.eq("Alt+→: UI", await U.uiOrder(p, COL.doing), ["X", "Y", "B"]);
  L.eq("Alt+→: Backlog", await L.dbOrder(COL.backlog), ["A", "C", "D"]);
  L.check("Alt+→: evento «move»", (await L.events("B")).some((e) => e.code === "move" && JSON.parse(e.label).p.to === COL.doing));
  L.eq("Alt+→: el foco sigue en la tarjeta movida", await p.evaluate(() => document.activeElement?.getAttribute("data-task-card") !== null && document.activeElement?.textContent?.includes("B")), true);
  await p.keyboard.press("Alt+ArrowRight");
  await L.eqEventually("Alt+→ otra vez: B pasa a «Siguiente salto»", () => L.dbOrder(COL.next), ["B"]);
  await p.keyboard.press("Alt+ArrowLeft");
  await L.eqEventually("Alt+←: B vuelve a «En progreso» (al final)", () => L.dbOrder(COL.doing), ["X", "Y", "B"]);
  await p.keyboard.press("Alt+ArrowUp");
  await L.eqEventually("Alt+↑: B sube una posición", () => L.dbOrder(COL.doing), ["X", "B", "Y"]);
  L.eq("Alt+↑: UI", await U.uiOrder(p, COL.doing), ["X", "B", "Y"]);
  await p.keyboard.press("Alt+ArrowUp");
  await L.eqEventually("Alt+↑ otra vez: B primera", () => L.dbOrder(COL.doing), ["B", "X", "Y"]);
  await p.keyboard.press("Alt+ArrowUp"); await L.sleep(500);
  L.eq("Alt+↑ en la primera: no hace nada", await L.dbOrder(COL.doing), ["B", "X", "Y"]);
  await p.keyboard.press("Alt+ArrowDown");
  await L.eqEventually("Alt+↓: B baja una posición", () => L.dbOrder(COL.doing), ["X", "B", "Y"]);
  await p.keyboard.press("Alt+ArrowDown");
  await L.eqEventually("Alt+↓ otra vez: B al final", () => L.dbOrder(COL.doing), ["X", "Y", "B"]);
  await p.keyboard.press("Alt+ArrowDown"); await L.sleep(500);
  L.eq("Alt+↓ en la última: no hace nada", await L.dbOrder(COL.doing), ["X", "Y", "B"]);
  // Reordenar con atajo no genera evento de historial
  const mv = (await L.events("B")).filter((e) => e.code === "move").length;
  L.eq("atajos: los reordenados no añaden eventos «move» (solo los cambios de columna: 3)", mv, 3);
  await L.cardLoc(p, "A").focus();
  await p.keyboard.press("Alt+ArrowLeft"); await L.sleep(500);
  L.eq("Alt+← en la primera columna: no hace nada", await L.dbOrder(COL.backlog), ["A", "C", "D"]);
  await L.reload(p);
  L.eq("atajos: orden final tras recargar", [await U.uiOrder(p, COL.backlog), await U.uiOrder(p, COL.doing), await U.uiOrder(p, COL.next)], [["A", "C", "D"], ["X", "Y", "B"], []]);
  // deshacer los atajos (tres cambios de columna y cuatro reordenados + ...): se deshace B hasta Backlog
  for (let i = 0; i < 8; i++) await U.undoKey(p, "Control+z");
  await L.eqEventually("atajos: tras deshacer todo, vuelve el estado inicial", async () => [await L.dbOrder(COL.backlog), await L.dbOrder(COL.doing), await L.dbOrder(COL.next)], [["A", "B", "C", "D"], ["X", "Y"], []]);

  // --- selección múltiple ---
  await L.reload(p);
  const pick = (t) => L.cardLoc(p, t).locator("button[aria-label='Seleccionar']").click();
  await pick("B"); await pick("C"); await pick("X");
  const bar = p.getByText("3 seleccionadas");
  L.check("selección: la barra indica «3 seleccionadas»", await bar.isVisible());
  await p.getByRole("button", { name: /Mover a Siguiente salto/ }).click();
  await L.eqEventually("selección → Siguiente salto: BD", () => L.dbOrder(COL.next), ["B", "C", "X"]);
  L.eq("selección: UI Siguiente salto (orden de columna y posición)", await U.uiOrder(p, COL.next), ["B", "C", "X"]);
  L.eq("selección: orígenes en BD", [await L.dbOrder(COL.backlog), await L.dbOrder(COL.doing)], [["A", "D"], ["Y"]]);
  L.check("selección: la barra desaparece", !(await bar.isVisible().catch(() => false)));
  L.check("selección: toast «3 tarjetas movidas»", await p.getByText("3 tarjetas movidas a «Siguiente salto a producción»").isVisible().catch(() => false));
  const evs = (await Promise.all(["B", "C", "X"].map(L.events))).map((e) => e.slice(-1));
  L.check("selección: último evento «move» de cada tarea con «Movió la tarea a «…»»", evs.every((e) => e.length === 1 && e[0].code === "move" && JSON.parse(e[0].label).k === "Movió la tarea a «{to}»" && JSON.parse(e[0].label).p.to === COL.next), JSON.stringify(evs));
  await U.logHas("selección: AppLog tasks.moveTasks", t0, "tasks.moveTasks", /^Movió 3 .* a «Siguiente salto a producción»$/);
  const undo = await L.undoEntries("UNDO");
  L.check("selección: una sola entrada de deshacer para las tres", undo.filter((u) => /Movió \{count\}/.test(u.label) && JSON.parse(u.label).p.count.p.n === 3).length === 1, JSON.stringify(undo.map((u) => u.label)));
  const posNext = await Promise.all(["B", "C", "X"].map(pos));
  L.check("selección: posiciones crecientes B<C<X", posNext[0] < posNext[1] && posNext[1] < posNext[2], JSON.stringify(posNext));
  await U.undoKey(p, "Control+z");
  await L.eqEventually("selección: deshacer devuelve las tres a su sitio", async () => [await L.dbOrder(COL.backlog), await L.dbOrder(COL.doing), await L.dbOrder(COL.next)], [["A", "B", "C", "D"], ["X", "Y"], []]);
  L.eq("selección: posiciones originales (B=2048, X=1024)", [await pos("B"), await pos("X")], [2048, 1024]);
  await U.undoKey(p, "Alt+Shift+z", "REDO");
  await L.eqEventually("selección: rehacer vuelve a moverlas", () => L.dbOrder(COL.next), ["B", "C", "X"]);
  await U.undoKey(p, "Control+z");

  // Mover a… (select) a una columna terminada, con la columna marcada entera
  await L.reload(p);
  await p.getByRole("button", { name: "Seleccionar todas las tareas de «Backlog»" }).click();
  L.check("selección de columna entera: «4 seleccionadas»", await p.getByText("4 seleccionadas").isVisible());
  await p.locator("select").filter({ has: p.locator("option", { hasText: "Mover a…" }) }).selectOption({ label: COL.closed });
  await L.eqEventually("Mover a…: las 4 llegan a «Cerrado» en orden", () => L.dbOrder(COL.closed), ["A", "B", "C", "D"]);
  L.eq("Mover a…: Backlog vacío", await L.dbOrder(COL.backlog), []);
  L.check("Mover a… columna terminada: eventos «done»", (await Promise.all(["A", "B", "C", "D"].map(L.events))).every((e) => e.at(-1).code === "done"));
  L.eq("Mover a…: UI", await U.uiOrder(p, COL.closed), ["A", "B", "C", "D"]);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("Mover a…: deshacer", () => L.dbOrder(COL.backlog), ["A", "B", "C", "D"]);

  // Seleccionar con Espacio y limpiar
  await L.cardLoc(p, "A").focus();
  await p.keyboard.press("Space");
  L.check("Espacio selecciona la tarjeta con el foco", await p.getByText("1 seleccionada").isVisible());
  await p.getByRole("button", { name: "Limpiar selección" }).click();
  L.check("Limpiar selección oculta la barra", !(await p.getByText("1 seleccionada").isVisible().catch(() => false)));

  L.assertNoErrors("escenario 2", [s]);
  await s.ctx.close();
}
await U.runStandalone(import.meta.url, run);
