// Escenario 9: móvil (390x844): abrir una tarea, cambiar la columna con el select, selección múltiple y deshacer.
import * as L from "./lib.mjs";
import * as U from "./ui.mjs";
const { COL } = L;

export async function run() {
  L.scenario("9. Móvil 390x844");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["A", "B", "C"]);
  await L.seedTasks(COL.doing, ["X"]);
  const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const p = s.page;
  const tab = (name) => p.locator("button").filter({ hasText: new RegExp(`^${name}\\s*\\d*$`) }).first();
  const cards = async () => (await p.locator("[data-task-card]:visible p").allTextContents()).map((x) => x.trim());
  L.eq("móvil: se ve una sola columna (Backlog) con sus tarjetas", await cards(), ["A", "B", "C"]);
  L.check("móvil: pestañas de columna con contadores", (await tab("Backlog").textContent()).includes("3") && (await tab("En progreso").textContent()).includes("1"));

  // Abrir con un toque y cambiar la columna con el select
  await L.cardLoc(p, "A").tap();
  await U.dialog(p).waitFor();
  await L.sleep(500);
  const sel = U.dialog(p).locator("select").first();
  L.eq("móvil: el select muestra la columna actual", await sel.evaluate((e) => e.selectedOptions[0].textContent), COL.backlog);
  await sel.selectOption({ label: COL.doing });
  await L.eqEventually("móvil: columna cambiada en BD", async () => (await L.dbTask("A")).columnName, COL.doing);
  const ev = await L.events("A");
  L.check("móvil: evento «move» registrado", ev.length === 1 && ev[0].code === "move" && JSON.parse(ev[0].label).p.to === COL.doing, JSON.stringify(ev));
  L.eq("móvil: Backlog en BD", await L.dbOrder(COL.backlog), ["B", "C"]);
  L.eq("móvil: el select refleja la nueva columna", await sel.evaluate((e) => e.selectedOptions[0].textContent), COL.doing);
  await U.dialog(p).getByRole("button", { name: "Cerrar" }).first().tap();
  await U.dialog(p).waitFor({ state: "detached" }).catch(() => {});
  await L.sleep(500);
  L.eq("móvil: Backlog muestra B y C", await cards(), ["B", "C"]);
  L.check("móvil: contadores actualizados (Backlog 2, En progreso 2)", (await tab("Backlog").textContent()).includes("2") && (await tab("En progreso").textContent()).includes("2"));
  await tab("En progreso").tap();
  await L.sleep(500);
  L.check("móvil: en «En progreso» aparece A", (await cards()).includes("A") && (await cards()).includes("X"), JSON.stringify(await cards()));
  await L.reload(p);
  await tab("En progreso").tap(); await L.sleep(400);
  L.check("móvil: tras recargar, A sigue en «En progreso»", (await cards()).includes("A"));

  // Deshacer desde la cabecera
  const n0 = await U.undoCount("UNDO");
  await p.getByRole("button", { name: "Deshacer la última acción" }).first().tap();
  await L.eqEventually("móvil: deshacer devuelve A a Backlog", () => L.dbOrder(COL.backlog), ["A", "B", "C"]);
  await L.checkEventually("móvil: la entrada de deshacer se consumió", async () => (await U.undoCount("UNDO")) < n0);

  // Selección múltiple en móvil
  await L.reload(p);
  for (const t of ["B", "C"]) await L.cardLoc(p, t).locator("button[aria-label='Seleccionar']").tap();
  L.check("móvil: barra «2 seleccionadas»", await p.getByText("2 seleccionadas").isVisible());
  await p.locator("select").filter({ has: p.locator("option", { hasText: "Mover a…" }) }).selectOption({ label: COL.closed });
  await L.eqEventually("móvil: las dos pasan a «Cerrado» en orden", () => L.dbOrder(COL.closed), ["B", "C"]);
  // El historial se escribe al final de la acción, después del cambio en la BD (y las consultas, en fila).
  await L.checkEventually("móvil: eventos «done»", async () => { const last = [(await L.events("B")).at(-1)?.code, (await L.events("C")).at(-1)?.code]; return [last.every((c) => c === "done"), last]; });
  L.eq("móvil: Backlog conserva solo A", await L.dbOrder(COL.backlog), ["A"]);
  await L.sleep(500);
  L.eq("móvil: UI de Backlog", await cards(), ["A"]);
  await p.getByRole("button", { name: "Deshacer la última acción" }).first().tap();
  await L.eqEventually("móvil: deshacer la selección múltiple", () => L.dbOrder(COL.backlog), ["A", "B", "C"]);

  // Reordenar con el asa (táctil): arrastrar la asa de C sobre A
  await L.reload(p);
  const handle = L.cardLoc(p, "C").locator("button[aria-label='Arrastrar para reordenar']");
  const hb = await handle.boundingBox(), ab = await L.cardLoc(p, "A").boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down();
  await p.mouse.move(hb.x + hb.width / 2, hb.y - 10, { steps: 4 });
  await p.mouse.move(ab.x + ab.width / 2, ab.y + 5, { steps: 20 }); await L.sleep(200);
  await p.mouse.up(); await L.sleep(700);
  await L.eqEventually("móvil: reordenar con el asa (C la primera)", () => L.dbOrder(COL.backlog), ["C", "A", "B"]);
  L.eq("móvil: UI reordenada", await cards(), ["C", "A", "B"]);

  L.assertNoErrors("escenario 9", [s]);
  await s.ctx.close();

  // Escape con el menú móvil y un diálogo encima («Instalar app», solo visible en iOS): el primer Escape cierra el diálogo,
  // el segundo el menú.
  const s2 = await L.session({ viewport: { width: 390, height: 844 }, mobile: true, init: () => {
    Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" });
  } });
  const q = s2.page;
  await q.getByRole("button", { name: "Abrir menú" }).tap();
  const drawer = q.getByRole("button", { name: "Cerrar menú" });
  await drawer.waitFor();
  await q.getByRole("button", { name: "Instalar app" }).tap();
  const dlg = q.getByRole("dialog", { name: "Añadir Pizarro a la pantalla de inicio" });
  await dlg.waitFor();
  await q.keyboard.press("Escape"); await L.sleep(400);
  L.check("Escape con menú y diálogo: el primer Escape cierra solo el diálogo", (await dlg.count()) === 0 && (await drawer.isVisible()));
  await q.keyboard.press("Escape"); await L.sleep(400);
  L.check("Escape con menú y diálogo: el segundo Escape cierra el menú", !(await drawer.isVisible()));
  L.assertNoErrors("escenario 9 (Escape)", [s2]);
  await s2.ctx.close();
}
await U.runStandalone(import.meta.url, run);
