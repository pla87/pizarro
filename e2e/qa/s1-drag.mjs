// Escenario 1: arrastrar tarjetas (reordenar y cambiar de columna), historial, deshacer y rehacer.
import * as L from "./lib.mjs";
import * as U from "./ui.mjs";
const { COL } = L;

export async function run() {
  L.scenario("1. Arrastrar tarjetas, historial, deshacer/rehacer");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["A", "B", "C", "D"]);
  await L.seedTasks(COL.doing, ["X", "Y"]);
  const t0 = await L.dbNow();
  const s = await L.session({ viewport: U.WIDE });
  const p = s.page;
  const pos = async (t) => Number((await L.dbTask(t)).position);
  const posD0 = await pos("D");

  // --- reordenar dentro de la columna ---
  await U.drag(p, "D", { card: "A", where: "top" });
  L.eq("reordenar: orden en la UI", await U.uiOrder(p, COL.backlog), ["D", "A", "B", "C"]);
  await L.eqEventually("reordenar: orden en BD", () => L.dbOrder(COL.backlog), ["D", "A", "B", "C"]);
  await L.reload(p);
  L.eq("reordenar: orden en la UI tras recargar", await U.uiOrder(p, COL.backlog), ["D", "A", "B", "C"]);
  L.eq("reordenar: la otra columna no cambia", await L.dbOrder(COL.doing), ["X", "Y"]);
  L.eq("reordenar: sin evento de historial (solo cuenta cambiar de columna)", (await L.events("D")).filter((e) => e.code === "move" || e.code === "done").length, 0);
  let undo = await L.undoEntries("UNDO");
  L.check("reordenar: una entrada de deshacer «Reordenó»", undo.length === 1 && /Reordenó/.test(undo[0].label), JSON.stringify(undo.map((u) => u.label)));
  await U.logHas("reordenar: AppLog «Reordenó «D» en «Backlog»»", t0, "tasks.moveTask", "Reordenó «D» en «Backlog»");

  // --- deshacer (Ctrl+Z) y rehacer (Alt+Mayús+Z) ---
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer reordenar: orden en BD", () => L.dbOrder(COL.backlog), ["A", "B", "C", "D"]);
  L.eq("deshacer reordenar: posición original exacta", await pos("D"), posD0);
  L.eq("deshacer reordenar: orden en la UI", await U.uiOrder(p, COL.backlog), ["A", "B", "C", "D"]);
  L.check("deshacer reordenar: hay una entrada REDO", (await L.undoEntries("REDO")).length === 1);
  await U.logHas("deshacer reordenar: AppLog «Deshizo»", t0, "undo.undoLast", /^Deshizo: Reordenó/);
  await U.undoKey(p, "Alt+Shift+z", "REDO");
  await L.eqEventually("rehacer reordenar: orden en BD", () => L.dbOrder(COL.backlog), ["D", "A", "B", "C"]);
  L.eq("rehacer reordenar: orden en la UI", await U.uiOrder(p, COL.backlog), ["D", "A", "B", "C"]);
  await U.logHas("rehacer reordenar: AppLog «Rehízo»", t0, "undo.redoLast", /^Rehízo: Reordenó/);
  // Alt+Z también deshace
  await U.undoKey(p, "Alt+z");
  await L.eqEventually("Alt+Z deshace el reordenado", () => L.dbOrder(COL.backlog), ["A", "B", "C", "D"]);
  await U.undoKey(p, "Alt+Shift+z", "REDO");
  await L.eqEventually("Alt+Mayús+Z vuelve a rehacerlo", () => L.dbOrder(COL.backlog), ["D", "A", "B", "C"]);
  // dejar el estado inicial para la siguiente fase
  await U.undoKey(p, "Control+z");
  await L.eqEventually("estado inicial restaurado", () => L.dbOrder(COL.backlog), ["A", "B", "C", "D"]);

  // --- reordenar hacia abajo (al final) ---
  await U.drag(p, "A", { card: "D", where: "bottom" });
  await L.eqEventually("reordenar hacia el final: BD", () => L.dbOrder(COL.backlog), ["B", "C", "D", "A"]);
  L.eq("reordenar hacia el final: UI", await U.uiOrder(p, COL.backlog), ["B", "C", "D", "A"]);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer reordenar hacia el final", () => L.dbOrder(COL.backlog), ["A", "B", "C", "D"]);

  // --- entre columnas ---
  await U.drag(p, "B", { card: "Y", where: "top" });
  await L.eqEventually("cruzar columnas: BD destino (entre X e Y)", () => L.dbOrder(COL.doing), ["X", "B", "Y"]);
  L.eq("cruzar columnas: BD origen", await L.dbOrder(COL.backlog), ["A", "C", "D"]);
  L.eq("cruzar columnas: UI destino", await U.uiOrder(p, COL.doing), ["X", "B", "Y"]);
  L.eq("cruzar columnas: UI origen", await U.uiOrder(p, COL.backlog), ["A", "C", "D"]);
  await L.reload(p);
  L.eq("cruzar columnas: UI destino tras recargar", await U.uiOrder(p, COL.doing), ["X", "B", "Y"]);
  const ev = await L.events("B");
  L.check("cruzar columnas: evento «move» con el texto del historial", ev.length === 1 && ev[0].code === "move" && JSON.parse(ev[0].label).p.from === "Backlog" && JSON.parse(ev[0].label).p.to === "En progreso" && JSON.parse(ev[0].label).k === "Movió la tarea de «{from}» a «{to}»", JSON.stringify(ev));
  await U.logHas("cruzar columnas: AppLog «Movió «B» de «Backlog» a «En progreso»»", t0, "tasks.moveTask", "Movió «B» de «Backlog» a «En progreso»");
  await U.openTask(p, "B");
  L.check("cruzar columnas: el historial del diálogo muestra «Movió la tarea de «Backlog» a «En progreso»»", /Movió la tarea de «Backlog» a «En progreso»/.test(await U.historyText(p)));
  await U.closeDialog(p);
  // Arrastrar dentro de la misma columna no añade línea de historial
  await U.drag(p, "A", { card: "D", where: "bottom" });
  await L.eqEventually("tras reordenar A no hay evento nuevo para A", async () => (await L.events("A")).length, 0);

  // --- deshacer / rehacer de un cruce ---
  await U.undoKey(p, "Control+z"); // deshace el reordenado de A
  await U.undoKey(p, "Control+z"); // deshace el cruce de B
  await L.eqEventually("deshacer cruce: B vuelve a Backlog en su sitio", () => L.dbOrder(COL.backlog), ["A", "B", "C", "D"]);
  L.eq("deshacer cruce: En progreso", await L.dbOrder(COL.doing), ["X", "Y"]);
  L.eq("deshacer cruce: posición original de B", await pos("B"), 2048);
  L.eq("deshacer cruce: UI", [await U.uiOrder(p, COL.backlog), await U.uiOrder(p, COL.doing)], [["A", "B", "C", "D"], ["X", "Y"]]);
  await U.undoKey(p, "Alt+Shift+z", "REDO"); // rehace A
  await U.undoKey(p, "Alt+Shift+z", "REDO"); // rehace B
  await L.eqEventually("rehacer cruce: B otra vez entre X e Y", () => L.dbOrder(COL.doing), ["X", "B", "Y"]);
  L.eq("rehacer: reordenado de A también rehecho", await L.dbOrder(COL.backlog), ["C", "D", "A"]);
  await L.eqEventually("rehacer cruce: UI", () => U.uiOrder(p, COL.doing), ["X", "B", "Y"]);

  // --- a una columna vacía terminada ---
  await U.drag(p, "C", { column: COL.closed });
  await L.eqEventually("a columna vacía: BD", () => L.dbOrder(COL.closed), ["C"]);
  L.eq("a columna vacía: UI", await U.uiOrder(p, COL.closed), ["C"]);
  const evC = await L.events("C");
  L.check("a columna terminada: evento «done»", evC.length === 1 && evC[0].code === "done" && JSON.parse(evC[0].label).p.to === "Cerrado", JSON.stringify(evC));
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer: C vuelve a Backlog", () => L.dbOrder(COL.closed), []);
  L.eq("deshacer: orden de Backlog", await L.dbOrder(COL.backlog), ["C", "D", "A"]);

  // --- arrastrar al final de una columna con tarjetas ---
  // Soltar sobre una tarjeta de otra columna inserta ANTES de ella (incluso apuntando a su borde inferior).
  await U.drag(p, "D", { card: "Y", where: "bottom" });
  await L.eqEventually("cruce sobre el borde inferior de la última: entra antes de ella", () => L.dbOrder(COL.doing), ["X", "B", "D", "Y"]);
  L.eq("cruce sobre el borde inferior de la última: UI", await U.uiOrder(p, COL.doing), ["X", "B", "D", "Y"]);
  // Soltar en el hueco bajo la última tarjeta: va al final.
  await U.drag(p, "C", { below: COL.doing });
  await L.eqEventually("cruce soltando bajo la última tarjeta: al final", () => L.dbOrder(COL.doing), ["X", "B", "D", "Y", "C"]);
  L.eq("cruce soltando bajo la última tarjeta: UI", await U.uiOrder(p, COL.doing), ["X", "B", "D", "Y", "C"]);

  // --- el arrastre cancelado (soltar fuera) no cambia nada ---
  const before = JSON.stringify([await L.dbOrder(COL.backlog), await L.dbOrder(COL.doing)]);
  const n = (await L.undoEntries("UNDO")).length;
  const bb = await L.cardLoc(p, "A").boundingBox();
  await p.mouse.move(bb.x + 100, bb.y + 20); await p.mouse.down(); await p.mouse.move(bb.x + 110, bb.y + 40, { steps: 5 });
  await p.keyboard.press("Escape"); await p.mouse.up(); await L.sleep(600);
  L.eq("Escape durante el arrastre: sin cambios en BD", JSON.stringify([await L.dbOrder(COL.backlog), await L.dbOrder(COL.doing)]), before);
  L.eq("Escape durante el arrastre: sin entrada de deshacer nueva", (await L.undoEntries("UNDO")).length, n);

  L.assertNoErrors("escenario 1", [s]);
  await s.ctx.close();
}
await U.runStandalone(import.meta.url, run);
