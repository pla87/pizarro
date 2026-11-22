// Ronda 55 (tablero, panel de tareas fijas): al abrir «Siempre en la release» la lista de la columna ya no muestra una barra
// de scroll si sus tarjetas caben (escritorio; con muchas sigue habiendo scroll; en móvil, a 390 px, se queda el hueco del
// final para que la última tarjeta suba por encima de la barra de selección); una copia con Ctrl soltada
// en el panel nace fija en ese panel (el de la release y el de «Siempre en el plan», y la de una fija en su propio panel),
// con un solo paso de deshacer; y arrastrar con Ctrl entre la lista y el panel abierto, con la columna llena, no acaba en
// «Algo ha fallado» (error #185 de React, «Maximum update depth exceeded»); y coger con Espacio una fija del panel y soltarla
// o cancelar deja el foco en su fila; con la red lenta, la copia provisional de un arrastre con Ctrl no llega nunca al
// servidor (ni por atajos, ni por la selección, ni como vecina al soltar otra junto a ella); y (caza de bugs 51a) una fija
// arrastrada del panel «Siempre en el plan» de una columna al de otra pasa allí como fija (antes no hacía nada aunque el
// lector de pantalla anunciaba el cambio) y se deshace, la de la release también, y en su propio panel no cambia.
// Misma base y servidor que tablero-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node tablero-fijas-e2e.mjs      # PART=scroll,copia,vaiven,foco,provisional,planes
import os from "node:os";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "scroll,copia,vaiven,foco,provisional,planes").split(",");

await L.prepareUsers();
const PID = "r55_project";
const NAME = "Zeta r55";
const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const COLS = [["r55e_o", "Otra", "NONE"], ["r55e_r", "Salto", "NEXT_RELEASE"], ["r55e_p", "Plan", "AI_PLAN"]];

/** Proyecto privado con las tres columnas (normal, release y plan para IA). */
async function seed() {
  await L.q(`DELETE FROM "Project" WHERE id=$1 OR name=$2`, [PID, NAME]);
  await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [adm.id]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,true,$3,999993,NOW())`, [PID, NAME, adm.id]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [PID, adm.id]);
  for (const [i, [id, name, role]] of COLS.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,role) VALUES ($1,$2,$3,$4,$5)`, [id, PID, name, (i + 1) * 1000, role]);
}
/** `n` tarjetas al final de la columna («prefijo 1», «prefijo 2»…); `fixed`: fijas. */
async function addTasks(columnId, n, prefix, { fixed = false, from = 0 } = {}) {
  await L.q(
    `INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,evergreen,"createdById","updatedAt")
     SELECT $1 || '_' || g, $2, $3, $4 || ' ' || g, 'kind_funcionalidad', g * 1024, $5, $6, NOW() FROM generate_series($7::int + 1, $7::int + $8::int) g`,
    [`${columnId}_${fixed ? "f" : "t"}`, PID, columnId, prefix, fixed, adm.id, from, n],
  );
}
/** Sesión con los paneles de fijas abiertos o plegados de antemano (estado guardado en localStorage, EvergreenPanel). */
const session = (open, opts = {}) => L.session({
  ...opts,
  init: `try { for (const k of ["pizarro:evergreen-open:${PID}", "pizarro:evergreen-open:${PID}:r55e_p"]) localStorage.setItem(k, ${JSON.stringify(open ? "1" : "0")}); } catch {}`,
});
async function openBoard(page, mobile = false) {
  await page.goto(`${L.BASE}/p/${PID}`);
  await L.colLoc(page, "Salto").waitFor({ state: "attached", timeout: 20000 });
  await L.liveOpen(page);
  if (mobile) await page.getByRole("button", { name: /^Salto/ }).first().tap();
  await sleep(700);
}
const list = (page, col) => L.colLoc(page, col).locator("[data-card-list]");
const scrollOf = (page, col) => list(page, col).evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, cards: el.querySelectorAll("[data-task-card]").length }));
// Filas del panel (en táctil el asa también lleva role=button: se cuentan por la marca de la fila).
const panelRows = (page, col) => L.colLoc(page, col).locator("[id^=evergreen-] [data-file-target]");
/** Punto por el que se coge: el centro, o el título (a la izquierda) en las filas del panel, cuyo centro es el interruptor de cadencia. */
const center = async (loc, { left = false } = {}) => {
  const b = await loc.boundingBox();
  return { x: left ? b.x + 24 : b.x + b.width / 2, y: b.y + b.height / 2 };
};
/** Arrastre con ratón de `from` a `to` (centros), con Ctrl pulsado desde el principio si `ctrl`. */
async function drag(page, from, to, { ctrl = true, row = false } = {}) {
  const a = await center(from, { left: row });
  const b = await center(to);
  await page.mouse.move(a.x, a.y);
  if (ctrl) await page.keyboard.down("Control");
  await page.mouse.down();
  await page.mouse.move(a.x + 12, a.y + 12, { steps: 3 });
  await page.mouse.move(b.x, b.y - 10, { steps: 15 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await sleep(250);
  await page.mouse.up();
  if (ctrl) await page.keyboard.up("Control");
}
const copyRow = (title) => L.q(`SELECT "columnId", evergreen, "evergreenEvery" FROM "Task" WHERE "projectId"=$1 AND title=$2 AND "archivedAt" IS NULL`, [PID, title]);

// --- C1: abrir el panel no hace aparecer scroll si las tarjetas caben ---------------------------------------------------------
if (only.includes("scroll")) {
  L.scenario("scroll: al abrir «Siempre en la release» la lista no muestra scroll si sus tarjetas caben");
  await seed();
  await addTasks("r55e_r", 5, "Tarea");
  await addTasks("r55e_r", 3, "Fija", { fixed: true, from: 100 });
  for (const [label, opts, mobile] of [["1280", { viewport: { width: 1280, height: 720 } }, false], ["1500", {}, false], ["390", { viewport: { width: 390, height: 900 }, mobile: true }, true]]) {
    const s = await session(false, opts);
    const { page } = s;
    await openBoard(page, mobile);
    const toggle = L.colLoc(page, "Salto").locator("button[aria-controls^=evergreen]");
    if (mobile) {
      // Móvil y tableta: el hueco del final se queda aunque las tarjetas quepan (data-fits solo cuenta desde `lg`): la barra
      // de selección y los botones flotantes tapan el final de la lista, y el hueco es lo que deja subir la última tarjeta
      // por encima. Con el panel abierto la lista puede tener algo de scroll (como las demás columnas en móvil).
      const padding = () => list(page, "Salto").evaluate((el) => getComputedStyle(el).paddingBottom);
      const lastAboveBar = async (what) => {
        await list(page, "Salto").evaluate((el) => (el.scrollTop = el.scrollHeight));
        await sleep(300);
        const last = await L.cardLoc(page, "Tarea 5").boundingBox();
        const bar = await page.locator("[data-selection-bar]").boundingBox();
        L.check(`SCROLL ${label}: ${what}, al bajar del todo la última tarjeta queda por encima de la barra de selección`, last && bar && last.y + last.height <= bar.y, JSON.stringify({ last, bar }));
      };
      const closed = await scrollOf(page, "Salto");
      L.eq(`SCROLL ${label}: plegado, cinco tarjetas`, closed.cards, 5);
      L.check(`SCROLL ${label}: plegado, las tarjetas caben (data-fits)`, await list(page, "Salto").evaluate((el) => el.hasAttribute("data-fits")));
      L.eq(`SCROLL ${label}: plegado, con el hueco del final aunque quepan`, await padding(), "160px");
      await L.cardLoc(page, "Tarea 1").locator("[aria-label=Seleccionar]").tap();
      await page.locator("[data-selection-bar]").waitFor();
      await lastAboveBar("plegado");
      await page.locator("[data-selection-bar] button[aria-label='Limpiar selección']").tap();
      await toggle.tap();
      await panelRows(page, "Salto").nth(2).waitFor();
      await sleep(400);
      const open = await scrollOf(page, "Salto");
      L.check(`SCROLL ${label}: con el panel abierto la lista es más baja`, open.ch < closed.ch, JSON.stringify({ closed, open }));
      L.eq(`SCROLL ${label}: abierto, también con el hueco`, await padding(), "160px");
      await L.cardLoc(page, "Tarea 1").locator("[aria-label=Seleccionar]").tap();
      await page.locator("[data-selection-bar]").waitFor();
      await lastAboveBar("abierto");
    } else {
      const closed = await scrollOf(page, "Salto");
      L.eq(`SCROLL ${label}: plegado, cinco tarjetas y sin scroll`, [closed.cards, closed.sh <= closed.ch + 1], [5, true]);
      await toggle.click();
      await panelRows(page, "Salto").nth(2).waitFor();
      await sleep(400);
      const open = await scrollOf(page, "Salto");
      L.check(`SCROLL ${label}: con el panel abierto la lista es más baja`, open.ch < closed.ch, JSON.stringify({ closed, open }));
      // 1280 × 720: antes 450 px de contenido en 379 (cinco tarjetas de ~370 px más el hueco del final): scroll innecesario.
      L.check(`SCROLL ${label}: y sigue sin scroll (las cinco caben)`, open.sh <= open.ch + 1, JSON.stringify(open));
    }
    L.eq(`SCROLL ${label}: las tres fijas en el panel`, await panelRows(page, "Salto").count(), 3);
    if (label === "1280") await page.screenshot({ path: `${SHOTS}/r55-panel-sin-scroll.png` });
    L.assertNoErrors(`SCROLL ${label}`, [s]);
    await s.ctx.close();
  }
  // Con muchas tarjetas sí hay scroll, y la última se puede ver entera por encima del panel.
  await addTasks("r55e_r", 25, "Más", { from: 10 });
  const s = await session(true, { viewport: { width: 1280, height: 720 } });
  const { page } = s;
  await openBoard(page);
  const full = await scrollOf(page, "Salto");
  L.check("SCROLL: con 30 tarjetas la lista tiene scroll", full.sh > full.ch + 50, JSON.stringify(full));
  await list(page, "Salto").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await sleep(300);
  const last = await L.cardLoc(page, "Más 35").boundingBox();
  const panel = await L.colLoc(page, "Salto").locator("[id^=evergreen-]").boundingBox();
  L.check("SCROLL: al final, la última tarjeta queda entera por encima del panel", last && panel && last.y + last.height <= panel.y, JSON.stringify({ last, panel }));
  L.assertNoErrors("SCROLL 30", [s]);
  await s.ctx.close();
}

// --- C2: copia con Ctrl en el panel de fijas ------------------------------------------------------------------------------------
if (only.includes("copia")) {
  L.scenario("copia: Ctrl al soltar sobre el panel de fijas crea la copia fija en ese panel (release y plan)");
  await seed();
  await addTasks("r55e_o", 4, "Origen");
  await addTasks("r55e_r", 5, "Tarea");
  await addTasks("r55e_r", 2, "Fija", { fixed: true, from: 100 });
  await addTasks("r55e_p", 3, "Paso");
  await addTasks("r55e_p", 1, "FijaPlan", { fixed: true, from: 100 });
  const s = await session(true);
  const { page } = s;
  await openBoard(page);
  const undoBefore = (await L.q(`SELECT count(*)::int AS n FROM "UndoEntry" WHERE "projectId"=$1`, [PID]))[0].n;

  await drag(page, L.cardLoc(page, "Origen 1"), L.colLoc(page, "Salto").locator("[id^=evergreen-]"));
  // Optimista: la copia aparece en el panel antes de que responda el servidor (y la sustituye la de verdad).
  L.check("COPIA: la copia aparece en el panel de la release", await L.waitFor(async () => (await panelRows(page, "Salto").filter({ hasText: "Origen 1 (copia)" }).count()) === 1));
  L.eq("COPIA: y no en la lista de la columna", await list(page, "Salto").getByText("Origen 1 (copia)").count(), 0);
  await L.eqEventually("COPIA: en la BD, fija en «Salto»", async () => JSON.stringify(await copyRow("Origen 1 (copia)")), JSON.stringify([{ columnId: "r55e_r", evergreen: true, evergreenEvery: 1 }]));
  L.eq("COPIA: la original sigue en «Otra», sin fijar", JSON.stringify(await copyRow("Origen 1")), JSON.stringify([{ columnId: "r55e_o", evergreen: false, evergreenEvery: 1 }]));
  await L.eqEventually("COPIA: una sola entrada de deshacer", async () => (await L.q(`SELECT count(*)::int AS n FROM "UndoEntry" WHERE "projectId"=$1`, [PID]))[0].n, undoBefore + 1);
  L.eq("COPIA: tres fijas en el panel", await panelRows(page, "Salto").count(), 3);
  await page.screenshot({ path: `${SHOTS}/r55-copia-panel.png` });

  // Panel «Siempre en el plan» de una columna de plan para IA.
  await drag(page, L.cardLoc(page, "Origen 2"), L.colLoc(page, "Plan").locator("[id^=evergreen-]"));
  L.check("COPIA: en el panel del plan, también", await L.waitFor(async () => (await panelRows(page, "Plan").filter({ hasText: "Origen 2 (copia)" }).count()) === 1));
  await L.eqEventually("COPIA: en la BD, fija en «Plan»", async () => JSON.stringify(await copyRow("Origen 2 (copia)")), JSON.stringify([{ columnId: "r55e_p", evergreen: true, evergreenEvery: 1 }]));

  // Una fija «cada dos» copiada con Ctrl en su propio panel: otra fija, con la misma cadencia (antes no hacía nada).
  await L.q(`UPDATE "Task" SET "evergreenEvery"=2 WHERE id='r55e_r_f_101'`);
  await openBoard(page);
  await drag(page, panelRows(page, "Salto").filter({ hasText: "Fija 101" }), L.colLoc(page, "Salto").locator("[id^=evergreen-] button", { hasText: "Añadir" }), { row: true });
  await L.eqEventually("COPIA: una fija copiada en su panel queda fija, con su cadencia", async () => JSON.stringify(await copyRow("Fija 101 (copia)")), JSON.stringify([{ columnId: "r55e_r", evergreen: true, evergreenEvery: 2 }]));
  L.check("COPIA: y se ve en el panel", await L.waitFor(async () => (await panelRows(page, "Salto").filter({ hasText: "Fija 101 (copia)" }).count()) === 1));

  // Sin Ctrl, soltar en el panel sigue moviendo la tarea (no la copia).
  await drag(page, L.cardLoc(page, "Origen 3"), L.colLoc(page, "Salto").locator("[id^=evergreen-]"), { ctrl: false });
  await L.eqEventually("COPIA: sin Ctrl la tarea se mueve al panel como fija", async () => JSON.stringify(await copyRow("Origen 3")), JSON.stringify([{ columnId: "r55e_r", evergreen: true, evergreenEvery: 1 }]));
  L.eq("COPIA: y no hay copia", (await copyRow("Origen 3 (copia)")).length, 0);

  // Deshacer la copia la quita del panel (un paso).
  await U.undoKey(page, "Control+z");
  await L.eqEventually("COPIA: deshacer devuelve «Origen 3» a «Otra»", async () => (await copyRow("Origen 3"))[0]?.columnId, "r55e_o");
  await U.undoKey(page, "Control+z");
  await L.eqEventually("COPIA: otro deshacer quita la copia de la fija", async () => (await copyRow("Fija 101 (copia)")).length, 0);
  L.check("COPIA: y desaparece del panel", await L.waitFor(async () => (await panelRows(page, "Salto").filter({ hasText: "Fija 101 (copia)" }).count()) === 0));
  L.assertNoErrors("COPIA", [s]);
  await s.ctx.close();
}

// --- C3: arrastres con Ctrl entre la lista y el panel abierto, con la columna llena --------------------------------------------
if (only.includes("vaiven")) {
  L.scenario("vaivén: arrastrar con Ctrl entre la lista llena y el panel abierto no acaba en «Algo ha fallado»");
  await seed();
  await addTasks("r55e_o", 8, "Origen");
  await addTasks("r55e_r", 120, "Rel");
  await addTasks("r55e_r", 3, "Fija", { fixed: true, from: 200 });
  await addTasks("r55e_p", 2, "FijaPlan", { fixed: true, from: 100 });
  const s = await session(true);
  const { page } = s;
  // Cuántos dibujos de React se encadenan sin volver al navegador (con un bucle de actualizaciones, React corta a los 50
  // con el error #185): se cuentan con el gancho de las herramientas de desarrollo, que React llama en cada dibujo.
  await page.addInitScript(() => {
    const stats = (window.__r55 = { max: 0, cur: 0 });
    let reset = false;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(), inject: () => 1, checkDCE() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {},
      onCommitFiberRoot() {
        stats.max = Math.max(stats.max, ++stats.cur);
        if (!reset) {
          reset = true;
          setTimeout(() => { reset = false; stats.cur = 0; }, 0);
        }
      },
    };
  });
  await openBoard(page);
  const failed = () => page.getByText("Algo ha fallado").count();
  const panel = L.colLoc(page, "Salto").locator("[id^=evergreen-]");
  for (let round = 0; round < 6; round++) {
    const fromPanel = round % 3 === 2;
    const src = fromPanel ? panelRows(page, "Salto").first() : L.cardLoc(page, `Origen ${1 + round}`);
    // El scroll automático de las vueltas anteriores puede haber movido el panel: la fija, a la vista.
    await src.scrollIntoViewIfNeeded();
    const a = await center(src, { left: fromPanel });
    const pb = await panel.boundingBox();
    const lb = await list(page, "Salto").boundingBox();
    await page.mouse.move(a.x, a.y);
    await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.move(a.x + 10, a.y + 10, { steps: 3 });
    await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height - 40, { steps: 12 });
    // Por la frontera entre la lista y el panel, encima del panel y otra vez a la lista (con scroll automático abajo).
    for (let k = 0; k < 8; k++) {
      await page.mouse.move(pb.x + 30 + k * 12, pb.y + 6, { steps: 3 });
      await page.mouse.move(pb.x + 30 + k * 12, pb.y - 6, { steps: 3 });
    }
    for (let k = 0; k < 10; k++) {
      await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height - 6 - (k % 3) * 8, { steps: 2 });
      await sleep(30);
    }
    if (round % 2) await page.mouse.move(lb.x + lb.width / 2, lb.y + 80, { steps: 8 });
    // Ctrl suelta y vuelta a pulsar a mitad (el aviso «+ Duplicar» va y viene).
    await page.keyboard.up("Control");
    await page.mouse.move(pb.x + pb.width / 2, pb.y + 20, { steps: 6 });
    await page.keyboard.down("Control");
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2, { steps: 6 });
    await sleep(200);
    // Antes de soltar, el arrastre sigue en marcha y con el aviso «+ Duplicar» (en la sexta vuelta, la fija ya arrastrada
    // en la tercera: antes no se podía volver a coger tras pasar por la lista).
    L.eq(`VAIVÉN ${round + 1}: arrastrando con «+ Duplicar»`, await page.evaluate(() => [document.documentElement.hasAttribute("data-card-drag"), !!document.querySelector("[data-duplicate-hint]")]), [true, true]);
    await page.mouse.up();
    await page.keyboard.up("Control");
    await sleep(900);
    L.eq(`VAIVÉN ${round + 1}: sin «Algo ha fallado»`, await failed(), 0);
  }
  const chained = await page.evaluate(() => window.__r55?.max ?? 0);
  L.check("VAIVÉN: los dibujos encadenados se quedan lejos del corte de React (50)", chained > 0 && chained < 25, String(chained));
  // Las copias (las de «Origen» y la de la fija, soltadas en el panel) son fijas: ninguna acaba en la lista.
  await L.eqEventually("VAIVÉN: seis copias, todas fijas en «Salto»", async () => JSON.stringify((await L.q(`SELECT evergreen, count(*)::int AS n FROM "Task" WHERE "projectId"=$1 AND title LIKE '%(copia)' GROUP BY evergreen`, [PID])).map((r) => [r.evergreen, r.n])), JSON.stringify([[true, 6]]));
  await page.screenshot({ path: `${SHOTS}/r55-vaiven.png` });
  L.assertNoErrors("VAIVÉN", [s]);
  await s.ctx.close();
}

// --- Foco tras arrastrar con teclado una fija de su panel ----------------------------------------------------------------------
if (only.includes("foco")) {
  L.scenario("foco: coger con Espacio una fija del panel y cancelar o soltar en su panel deja el foco en la fila");
  await seed();
  await addTasks("r55e_r", 4, "Tarea");
  await addTasks("r55e_r", 3, "Fija", { fixed: true, from: 100 });
  const s = await session(true);
  const { page } = s;
  await openBoard(page);
  const row = (title) => panelRows(page, "Salto").filter({ hasText: title });
  /** Lo que tiene el foco: la fila del panel (su título), otra cosa o <body>. */
  const focused = () => page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "body";
    const r = el.closest("[data-file-target]");
    return r ? `fila ${r.querySelector("span")?.textContent?.trim()}` : `${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? ""}`.trim();
  });
  /** Espera a que termine el arrastre (y la animación de soltar) y a que dnd-kit devuelva el foco. */
  const settled = async () => {
    await L.waitFor(async () => !(await page.evaluate(() => document.documentElement.hasAttribute("data-card-drag"))), { timeout: 4000 });
    await sleep(300);
  };
  for (const [label, end] of [["Escape", "Escape"], ["soltar en su panel", " "]]) {
    await row("Fija 102").focus();
    await page.keyboard.press(" ");
    L.check(`FOCO ${label}: Espacio coge la fija`, await L.waitFor(() => page.evaluate(() => document.documentElement.hasAttribute("data-card-drag"))));
    await sleep(200);
    await page.keyboard.press(end);
    await settled();
    L.eq(`FOCO ${label}: el foco sigue en la fila`, await focused(), "fila Fija 102");
    L.eq(`FOCO ${label}: la fija sigue en el panel`, await row("Fija 102").count(), 1);
  }
  // Con el ratón, de la fila a la lista y de vuelta a su panel sin soltar: la fila se vuelve a montar (su registro en dnd-kit
  // se perdió al quitarse la tarjeta de la lista) y se puede volver a coger, también con el teclado.
  {
    const a = await center(row("Fija 101"), { left: true });
    const b = await center(L.cardLoc(page, "Tarea 2"));
    const p = await center(L.colLoc(page, "Salto").locator("[id^=evergreen-]"));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 12, a.y + 12, { steps: 3 });
    await page.mouse.move(b.x, b.y, { steps: 15 });
    L.check("FOCO ratón: la fija pasa a la lista mientras se arrastra", await L.waitFor(async () => (await list(page, "Salto").locator("[data-task-card]").count()) === 5));
    await page.mouse.move(p.x, p.y, { steps: 15 });
    await sleep(250);
    await page.mouse.up();
    await settled();
  }
  L.eq("FOCO ratón: vuelve a su panel, fija", JSON.stringify(await copyRow("Fija 101")), JSON.stringify([{ columnId: "r55e_r", evergreen: true, evergreenEvery: 1 }]));
  await row("Fija 101").focus();
  await page.keyboard.press(" ");
  L.check("FOCO ratón: después, Espacio la vuelve a coger", await L.waitFor(() => page.evaluate(() => document.documentElement.hasAttribute("data-card-drag"))));
  await sleep(200);
  await page.keyboard.press("Escape");
  await settled();
  L.eq("FOCO ratón: y Escape deja el foco en su fila", await focused(), "fila Fija 101");
  // Y se puede volver a arrastrar con el ratón (el registro en dnd-kit sigue vivo): a la lista, deja de ser fija.
  await drag(page, row("Fija 101"), L.cardLoc(page, "Tarea 2"), { ctrl: false, row: true });
  await L.eqEventually("FOCO: después, la fila se arrastra a la lista con el ratón", async () => JSON.stringify(await copyRow("Fija 101")), JSON.stringify([{ columnId: "r55e_r", evergreen: false, evergreenEvery: 1 }]));
  L.assertNoErrors("FOCO", [s]);
  await s.ctx.close();
}

// --- Copia provisional con la red lenta ----------------------------------------------------------------------------------------
if (only.includes("provisional")) {
  L.scenario("provisional: con la red lenta, la copia provisional de un arrastre con Ctrl no se envía nunca al servidor");
  await seed();
  await addTasks("r55e_o", 3, "Origen");
  await addTasks("r55e_r", 4, "Tarea");
  const s = await session(false);
  const { page } = s;
  await openBoard(page);
  // Las acciones de servidor (POST con la cabecera Next-Action) tardan 2,5 s en salir; se anotan las que llevan el id provisional.
  const leaked = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /pending-copy-/.test(r.postData() ?? "")) leaked.push(r.postData().slice(0, 200));
  });
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) await sleep(2500);
    await route.continue().catch(() => {});
  });
  const pendingCard = () => page.locator("[data-card-list] [data-task-card^=pending-copy-]");
  await drag(page, L.cardLoc(page, "Origen 1"), L.cardLoc(page, "Tarea 3"));
  L.check("PROVISIONAL: la copia aparece en el acto", await L.waitFor(async () => (await pendingCard().count()) === 1, { timeout: 2000 }));
  L.eq("PROVISIONAL: marcada como ocupada y no disponible", await pendingCard().evaluate((el) => [el.getAttribute("aria-busy"), el.getAttribute("aria-disabled")]), ["true", "true"]);
  // Atajos sobre la provisional (asignarme, renombrar, subir, seleccionar, duplicar): nada.
  await pendingCard().focus();
  for (const key of ["Alt+m", "F2", "Alt+ArrowUp", " ", "Alt+Shift+D"]) await page.keyboard.press(key);
  L.eq("PROVISIONAL: F2 no abre el renombrado", await page.locator("[data-card-list] [data-task-card^=pending-copy-] input, [data-card-list] [data-task-card^=pending-copy-] textarea").count(), 0);
  L.eq("PROVISIONAL: Espacio no la selecciona", await page.locator("[data-selection-bar]").count(), 0);
  // Otra tarjeta soltada sobre la provisional (antes iba con nextId = pending-copy-1 y acababa al final).
  await drag(page, L.cardLoc(page, "Origen 2"), pendingCard(), { ctrl: false });
  await L.eqEventually("PROVISIONAL: la copia de verdad sustituye a la provisional", async () => (await pendingCard().count()) === 0 && (await L.cardLoc(page, "Origen 1 (copia)").count()) === 1, true, { timeout: 12000 });
  await L.eqEventually("PROVISIONAL: «Origen 2» pasa a «Salto»", async () => (await copyRow("Origen 2"))[0]?.columnId, "r55e_r", { timeout: 12000 });
  await sleep(3000);
  L.eq("PROVISIONAL: ninguna petición llevó el id provisional", leaked, []);
  const order = await L.q(`SELECT title FROM "Task" WHERE "columnId"='r55e_r' AND "archivedAt" IS NULL ORDER BY position`);
  L.check("PROVISIONAL: «Origen 2» no acaba al final de la columna", order.at(-1)?.title !== "Origen 2", JSON.stringify(order.map((r) => r.title)));
  // Sin tarjetas fantasma: las que se ven en «Salto» son las de la BD.
  L.eq("PROVISIONAL: en pantalla, las mismas tarjetas que en la BD", await list(page, "Salto").locator("[data-task-card]").count(), order.length);
  await page.unroute("**/*");
  L.assertNoErrors("PROVISIONAL", [s]);
  await s.ctx.close();
}

// --- Fija de un plan al panel de otro (caza de bugs 51a) --------------------------------------------------------------
if (only.includes("planes")) {
  L.scenario("planes: arrastrar una fija del panel de «Plan A» al de «Plan B» la lleva allí como fija; deshacer la devuelve");
  // Otro reparto de columnas: dos planes para IA, la release y una normal.
  await L.q(`DELETE FROM "Project" WHERE id=$1 OR name=$2`, [PID, NAME]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,true,$3,999993,NOW())`, [PID, NAME, adm.id]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [PID, adm.id]);
  const cols = [["r55p_a", "Plan A", "AI_PLAN"], ["r55p_b", "Plan B", "AI_PLAN"], ["r55p_salto", "Salto", "NEXT_RELEASE"], ["r55p_otra", "Otra", "NONE"]];
  for (const [i, [id, name, role]] of cols.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,role) VALUES ($1,$2,$3,$4,$5)`, [id, PID, name, (i + 1) * 1000, role]);
  const tasks = [["r55p_a1", "r55p_a", "A normal", false], ["r55p_af", "r55p_a", "A fija", true], ["r55p_b1", "r55p_b", "B normal", false], ["r55p_bf", "r55p_b", "B fija", true], ["r55p_rf", "r55p_salto", "Release fija", true]];
  for (const [i, [id, col, title, fixed]] of tasks.entries()) {
    await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,evergreen,"createdById","updatedAt") VALUES ($1,$2,$3,$4,'kind_funcionalidad',$5,$6,$7,NOW())`, [id, PID, col, title, (i + 1) * 1024, fixed, adm.id]);
  }
  const where = async (id) => (await L.q(`SELECT "columnId", evergreen FROM "Task" WHERE id=$1`, [id]))[0];
  const s = await L.session();
  const { page } = s;
  await page.goto(`${L.BASE}/p/${PID}`);
  await L.colLoc(page, "Plan A").waitFor({ timeout: 20000 });
  await L.liveOpen(page);
  await sleep(400);
  const panel = (col) => L.colLoc(page, col).locator("button[aria-controls^=evergreen]");
  for (const col of ["Plan A", "Plan B", "Salto"]) if ((await panel(col).getAttribute("aria-expanded")) !== "true") await panel(col).click();
  await sleep(400);
  const fixedCard = (col, title) => L.colLoc(page, col).locator("[id^=evergreen-] [role=button]").filter({ hasText: title }).first();
  /** Arrastra una fija sobre la lista del panel de otra columna. */
  async function dragToPanel(title, from, to) {
    const sb = await fixedCard(from, title).boundingBox();
    const tb = await L.colLoc(page, to).locator("[id^=evergreen-]").boundingBox();
    await page.mouse.move(sb.x + 20, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + 30, sb.y + sb.height / 2 + 8, { steps: 4 });
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 25 });
    await sleep(150);
    await page.mouse.move(tb.x + tb.width / 2 + 1, tb.y + tb.height / 2 + 1, { steps: 2 });
    await sleep(150);
    await page.mouse.up();
  }
  await dragToPanel("A fija", "Plan A", "Plan B");
  await L.eqEventually("PLANES: en la base pasa a «Plan B» y sigue fija", async () => JSON.stringify(await where("r55p_af")), JSON.stringify({ columnId: "r55p_b", evergreen: true }));
  await L.eqEventually("PLANES: el panel de «Plan B» la muestra", async () => fixedCard("Plan B", "A fija").count(), 1);
  L.eq("PLANES: y el de «Plan A» ya no", await fixedCard("Plan A", "A fija").count(), 0);
  L.eq("PLANES: el contador de «Plan B» dice 2", (await panel("Plan B").innerText()).replace(/\s+/g, " ").trim(), "Siempre en el plan 2");
  await page.screenshot({ path: `${SHOTS}/fijas-entre-planes.png` });
  await sleep(300);
  await page.keyboard.press("Control+z");
  await L.eqEventually("PLANES: deshacer la devuelve a «Plan A» como fija", async () => JSON.stringify(await where("r55p_af")), JSON.stringify({ columnId: "r55p_a", evergreen: true }));
  await L.eqEventually("PLANES: y el tablero también", async () => fixedCard("Plan A", "A fija").count(), 1);
  // De la release a un plan, igual.
  await sleep(4500);
  await dragToPanel("Release fija", "Salto", "Plan A");
  await L.eqEventually("PLANES: una fija de la release soltada en el panel de un plan pasa a ser fija del plan", async () => JSON.stringify(await where("r55p_rf")), JSON.stringify({ columnId: "r55p_a", evergreen: true }));
  // Sobre su propio panel no hace nada.
  await sleep(300);
  await dragToPanel("B fija", "Plan B", "Plan B");
  await sleep(800);
  L.eq("PLANES: soltarla en su propio panel no la cambia", JSON.stringify(await where("r55p_bf")), JSON.stringify({ columnId: "r55p_b", evergreen: true }));
  L.assertNoErrors("PLANES", [s]);
  await s.ctx.close();
}

await L.q(`DELETE FROM "Project" WHERE id=$1`, [PID]);
await L.closeBrowser(); await L.closeDb();
const failedChecks = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failedChecks.length}/${L.results.length} OK`);
for (const f of failedChecks) console.log("FAIL", f.name, f.detail);
process.exitCode = failedChecks.length ? 1 : 0;
