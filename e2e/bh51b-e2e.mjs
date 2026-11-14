// Caza de bugs 51b. Mover con el teclado varias veces seguidas: la respuesta del servidor a un movimiento ya no pisa lo
// que ha pintado otro posterior de la misma tarjeta. Antes, con Alt+→ y Alt+← seguidos, la respuesta del primero llegaba
// después de pintar el segundo y dejaba la tarjeta con la posición de la otra columna: el Alt+↑ siguiente la subía dos
// puestos o no hacía nada. Para que siempre llegue tarde, las acciones del servidor tardan medio segundo (red lenta).
// Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh51b-e2e.mjs      # PART=atajos
// QA_CPU_THROTTLE=4 frena la CPU de las páginas (como con la máquina cargada; ver e2e/qa/lib.mjs).
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { COL } = L;
const only = (process.env.PART || "atajos").split(",");

await L.prepareUsers();

// --- Alt+flechas seguidas ---------------------------------------------------------------------------------------------
if (only.includes("atajos")) {
  L.scenario("atajos: Alt+flechas seguidas en un tablero grande");
  await L.cleanBoard();
  // Muchas tarjetas: cada dibujo del tablero tarda, y la segunda pulsación llega antes de que acabe.
  await L.seedTasks(COL.backlog, Array.from({ length: 250 }, (_, i) => `Relleno ${i + 1}`));
  await L.seedTasks(COL.doing, ["X", "Y", "B"]);
  const s = await L.session({ viewport: U.WIDE });
  const p = s.page;
  const ROUNDS = Number(process.env.ROUNDS || 3);
  const reset = async () => {
    await L.q(`UPDATE "Task" t SET "columnId"=c.id, position=v.pos FROM "Column" c, (VALUES ('X',1024),('Y',2048),('B',3072)) v(title,pos) WHERE t.title=v.title AND c.name=$1 AND c."projectId"=t."projectId"`, [COL.doing]);
    await L.reload(p);
    await L.eqEventually("preparado: X, Y, B en «En progreso»", () => U.uiOrder(p, COL.doing), ["X", "Y", "B"]);
  };
  const focusB = async () => {
    await L.cardLoc(p, "B").focus();
    await L.checkEventually("la tarjeta B tiene el foco", () => p.evaluate(() => document.activeElement?.textContent?.includes("B") && document.activeElement.hasAttribute("data-task-card")));
  };
  // Red lenta para las acciones del servidor (no para el resto): la respuesta de cada movimiento llega medio segundo tarde.
  let slow = false;
  await p.route("**/*", async (route) => {
    if (slow && route.request().method() === "POST" && route.request().headers()["next-action"]) await L.sleep(500);
    await route.continue();
  });
  for (let r = 1; r <= ROUNDS; r++) {
    await reset();
    await focusB();
    slow = false;
    // Dos Alt+↑ seguidos: B sube dos puestos.
    await p.keyboard.press("Alt+ArrowUp");
    await p.keyboard.press("Alt+ArrowUp");
    await L.eqEventually(`ronda ${r}: dos Alt+↑ seguidos suben B dos puestos (BD)`, () => L.dbOrder(COL.doing), ["B", "X", "Y"]);
    await L.eqEventually(`ronda ${r}: … y en el tablero`, () => U.uiOrder(p, COL.doing), ["B", "X", "Y"]);
    await reset();
    await focusB();
    slow = true;
    // Alt+→ y Alt+← seguidos: B vuelve al final de «En progreso» al momento…
    await p.keyboard.press("Alt+ArrowRight");
    await p.keyboard.press("Alt+ArrowLeft");
    await L.eqEventually(`ronda ${r}: Alt+→ y Alt+← seguidos: B al final de «En progreso» en el tablero`, () => U.uiOrder(p, COL.doing), ["X", "Y", "B"]);
    // …y ahí sigue cuando llega la respuesta del Alt+→ (antes la ponía entre X e Y, o delante, con la posición de la otra columna).
    await L.sleep(800);
    L.eq(`ronda ${r}: la respuesta del Alt+→ no la mueve de sitio`, await U.uiOrder(p, COL.doing), ["X", "Y", "B"]);
    await p.keyboard.press("Alt+ArrowUp");
    await L.eqEventually(`ronda ${r}: y Alt+↑ la sube un puesto (BD)`, async () => [await L.dbOrder(COL.doing), await L.dbOrder(COL.next)], [["X", "B", "Y"], []], { timeout: 10000 });
    await L.eqEventually(`ronda ${r}: … y en el tablero`, () => U.uiOrder(p, COL.doing), ["X", "B", "Y"]);
    await L.checkEventually(`ronda ${r}: el foco sigue en B`, () => p.evaluate(() => !!document.activeElement?.hasAttribute("data-task-card") && document.activeElement.textContent.includes("B")));
  }
  slow = false;
  await p.unroute("**/*");
  L.assertNoErrors("atajos", [s]);
  await s.ctx.close();
  await L.cleanBoard();
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
