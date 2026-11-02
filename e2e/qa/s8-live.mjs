// Escenario 8: actualización en vivo: un segundo navegador ve en ≤ 3 s lo que hace el primero.
import * as L from "./lib.mjs";
import * as U from "./ui.mjs";
const { COL } = L;

/** Espera a que la UI de `page` cumpla `fn`; devuelve los segundos que tardó (o null si no ocurrió en 8 s). */
async function seen(page, fn, max = 8000) {
  const t = Date.now();
  const ok = await L.waitFor(fn, { timeout: max, step: 100 });
  return ok ? (Date.now() - t) / 1000 : null;
}

export async function run() {
  L.scenario("8. Actualización en vivo entre dos navegadores");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["A", "B", "C"]);
  await L.seedTasks(COL.doing, ["X"]);
  const a = await L.session({ viewport: U.WIDE });
  const b = await L.session({ email: L.USER2, viewport: U.WIDE });
  await L.sleep(1500); // deja que el canal en vivo (SSE) conecte
  const lat = [];
  const expect = async (name, fn) => { const s = await seen(b.page, fn); if (s !== null) lat.push(s); L.check(`${name} (≤ 3 s; tardó ${s === null ? ">8" : s.toFixed(1)} s)`, s !== null && s <= 3); };

  await U.drag(a.page, "C", { card: "A", where: "top" });
  await expect("reordenar: el segundo navegador ve C la primera", async () => (await U.uiOrder(b.page, COL.backlog)).join() === "C,A,B");
  await U.drag(a.page, "B", { card: "X", where: "top" });
  await expect("cruce de columnas: B aparece en «En progreso» y sale de Backlog", async () => (await U.uiOrder(b.page, COL.doing)).join() === "B,X" && (await U.uiOrder(b.page, COL.backlog)).join() === "C,A");
  // movimiento con atajo
  await L.cardLoc(a.page, "X").focus();
  await a.page.keyboard.press("Alt+ArrowRight");
  await expect("Alt+→: X pasa a «Siguiente salto»", async () => (await U.uiOrder(b.page, COL.next)).join() === "X");
  // edición de título
  await U.openTask(a.page, "A");
  const t = U.dialog(a.page).locator("textarea[aria-label='Título']").first();
  await t.click(); await a.page.keyboard.press("Control+A"); await a.page.keyboard.type("A renombrada"); await a.page.keyboard.press("Enter");
  await expect("título editado visible en el otro navegador", async () => (await U.uiOrder(b.page, COL.backlog)).includes("A renombrada"));
  // archivar
  await U.dialog(a.page).getByRole("button", { name: "Archivar", exact: true }).click();
  await expect("archivar: la tarjeta desaparece del otro navegador", async () => !(await U.uiOrder(b.page, COL.backlog)).includes("A renombrada"));
  // deshacer
  await U.undoKey(a.page, "Control+z");
  await expect("deshacer archivar: vuelve a aparecer", async () => (await U.uiOrder(b.page, COL.backlog)).includes("A renombrada"));
  // el segundo también mueve y el primero lo ve
  await U.drag(b.page, "C", { column: COL.closed });
  await expect2(a.page, "el movimiento de B lo ve A", async () => (await U.uiOrder(a.page, COL.closed)).join() === "C");
  // multi-selección en A
  await L.cardLoc(a.page, "B").locator("button[aria-label='Seleccionar']").click();
  await a.page.getByRole("button", { name: /Mover a Siguiente salto/ }).click();
  await expect("selección múltiple: B llega a «Siguiente salto»", async () => (await U.uiOrder(b.page, COL.next)).join() === "X,B");
  // borrar
  await U.openTask(a.page, "X");
  await U.dialog(a.page).getByRole("button", { name: "Borrar", exact: true }).first().click();
  await a.page.locator("[role=dialog]").last().getByRole("button", { name: "Borrar" }).click();
  await expect("borrar: desaparece del otro navegador", async () => (await U.uiOrder(b.page, COL.next)).join() === "B");
  L.check("latencia máxima observada ≤ 3 s", Math.max(...lat) <= 3, `máx ${Math.max(...lat).toFixed(1)} s`);
  L.assertNoErrors("escenario 8", [a, b]);
  await a.ctx.close(); await b.ctx.close();

  async function expect2(page, name, fn) { const s = await seen(page, fn); L.check(`${name} (≤ 3 s; tardó ${s === null ? ">8" : s.toFixed(1)} s)`, s !== null && s <= 3); }
}
await U.runStandalone(import.meta.url, run);
