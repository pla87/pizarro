// Escenario 5: edición simultánea del texto de una tarea (updateTask con `since` / contentUpdatedAt).
import * as L from "./lib.mjs";
import * as U from "./ui.mjs";
const { COL } = L;

const desc = async (title) => ((await L.q(`SELECT description FROM "Task" WHERE title=$1`, [title]))[0]?.description ?? "").trim();
async function typeDescription(page, text) {
  const d = U.dialog(page);
  const edit = d.getByRole("button", { name: "Editar" }).first();
  const empty = d.getByRole("button", { name: "Añade una descripción…" });
  if (await empty.count()) await empty.click(); else await edit.click();
  const ed = d.locator("[role=textbox][contenteditable]").first();
  await ed.click(); await page.keyboard.press("Control+A"); await page.keyboard.type(text);
}
async function editDescription(page, text) {
  await typeDescription(page, text);
  await page.keyboard.press("Control+Enter");
}

export async function run() {
  L.scenario("5. Conflicto de edición simultánea del texto");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Compartida", "Titulo2", "Titulo3", "Titulo4"]);
  const t0 = await L.dbNow();
  const a = await L.session({ viewport: U.WIDE });
  const b = await L.session({ email: L.USER2, viewport: U.WIDE });
  await U.openTask(a.page, "Compartida");
  await U.openTask(b.page, "Compartida");

  // B empieza a escribir su descripción; A guarda la suya antes (si B no la estuviera editando, vería la de A al momento
  // y no habría conflicto).
  await typeDescription(b.page, "Texto de la Segunda");
  await editDescription(a.page, "Texto de Administrador");
  await L.eqEventually("A guarda su descripción", () => desc("Compartida"), "Texto de Administrador");
  const [r1] = await L.q(`SELECT "contentUpdatedById" AS u FROM "Task" WHERE title='Compartida'`);
  L.check("contentUpdatedById registra a A", !!r1.u);

  // B (que escribía sobre el texto anterior) guarda su descripción
  await b.page.bringToFront();
  await b.page.keyboard.press("Control+Enter");
  const msg = b.page.getByText(/ha cambiado el texto de esta tarea mientras la editabas/);
  await msg.first().waitFor({ timeout: 6000 }).catch(() => {});
  L.check("B ve el aviso de conflicto con el nombre de A", (await msg.count()) > 0 && /Administrador ha cambiado el texto de esta tarea mientras la editabas\. Se ha recargado con sus cambios: vuelve a aplicar los tuyos\./.test(await msg.first().innerText()), await msg.first().innerText().catch(() => "sin aviso"));
  L.eq("B no pisa el texto de A en la BD", await desc("Compartida"), "Texto de Administrador");
  await L.sleep(800);
  L.check("B recarga el diálogo con el texto de A", (await U.dialog(b.page).innerText()).includes("Texto de Administrador"));
  L.check("la tarjeta de B sigue abierta (el diálogo no se cierra)", (await b.page.locator("[role=dialog]").count()) === 1);
  L.eq("no hay evento de descripción de B", (await L.events("Compartida")).filter((e) => /descripción/.test(e.label)).length, 1);
  await U.logHas("AppLog: updateTask rechazada (warn) con el mensaje de conflicto", t0, "tasks.updateTask", /ha cambiado el texto de esta tarea/);
  const warn = (await L.logs(t0, "tasks.updateTask")).find((l) => /ha cambiado el texto/.test(l.message));
  L.eq("el conflicto se registra como warn", warn?.level, "warn");

  // A empieza otro cambio; tras recargar, B ya puede guardar (versión nueva)
  await typeDescription(a.page, "Otro intento de A");
  await editDescription(b.page, "Segunda ya actualizada");
  await L.eqEventually("B guarda tras la recarga", () => desc("Compartida"), "Segunda ya actualizada");
  // Y ahora A (que escribía sobre la versión anterior) recibe el conflicto con el nombre de B
  await a.page.bringToFront();
  await a.page.keyboard.press("Control+Enter");
  const msgA = a.page.getByText(/Segunda Persona ha cambiado el texto de esta tarea/);
  await msgA.first().waitFor({ timeout: 6000 }).catch(() => {});
  L.check("A recibe el conflicto con el nombre de B", (await msgA.count()) > 0);
  L.eq("la BD conserva el texto de B", await desc("Compartida"), "Segunda ya actualizada");
  await U.closeDialog(a.page); await U.closeDialog(b.page);
  // El aviso de A se va solo: lo que se compruebe después en esta pestaña no debe contarlo.
  await a.page.getByText(/ha cambiado el texto/).first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});

  // Mismo usuario en dos pestañas: la segunda, que escribía su descripción a la vez, no pisa lo guardado en la primera
  // (aviso propio); la primera puede volver a guardar sin conflicto (su versión avanza con cada guardado). Si la segunda no
  // la estuviera editando, vería la de la primera al momento y no habría conflicto.
  const a2 = await a.ctx.newPage();
  const errs2 = []; a2.on("pageerror", (e) => errs2.push(e.message)); a2.on("console", (m) => m.type() === "error" && errs2.push(m.text()));
  await a2.goto(a.page.url()); await U.openTask(a2, "Titulo2"); await U.openTask(a.page, "Titulo2");
  await typeDescription(a2, "Desde la pestaña 2");
  await editDescription(a.page, "Desde la pestaña 1");
  await L.eqEventually("pestaña 1 guarda", () => desc("Titulo2"), "Desde la pestaña 1");
  await editDescription(a.page, "Desde la pestaña 1 otra vez");
  await L.eqEventually("pestaña 1 vuelve a guardar sin conflicto", () => desc("Titulo2"), "Desde la pestaña 1 otra vez");
  L.eq("pestaña 1: sin aviso de conflicto", await a.page.getByText(/ha cambiado el texto|Has cambiado el texto/).count(), 0);
  await a2.bringToFront();
  await U.dialog(a2).locator("[role=textbox][contenteditable]").first().press("Control+Enter");
  const msg2 = a2.getByText(/Has cambiado el texto de esta tarea en otra pestaña u otro dispositivo/);
  await msg2.first().waitFor({ timeout: 6000 }).catch(() => {});
  L.check("mismo usuario: la pestaña 2 recibe el aviso de la otra pestaña", (await msg2.count()) > 0);
  L.eq("mismo usuario: la pestaña 2 no pisa lo de la pestaña 1", await desc("Titulo2"), "Desde la pestaña 1 otra vez");
  await a2.close();
  await U.closeDialog(a.page);

  // Conflicto sobre el título (renombrar desde la tarjeta con F2 mientras otra persona lo cambió)
  await L.reload(a.page); await L.reload(b.page);
  await U.openTask(b.page, "Titulo2");
  const bt = U.dialog(b.page).locator("textarea[aria-label='Título']").first();
  await U.openTask(a.page, "Titulo2");
  const at = U.dialog(a.page).locator("textarea[aria-label='Título']").first();
  // B empieza a escribir su título (sobre el anterior) y A guarda el suyo antes. Si B no lo estuviera editando, vería el de
  // A al momento y no habría conflicto.
  await bt.click(); await b.page.keyboard.press("Control+A"); await b.page.keyboard.type("Titulo B");
  await at.click(); await a.page.keyboard.press("Control+A"); await a.page.keyboard.type("Titulo A"); await a.page.keyboard.press("Enter");
  await L.eqEventually("A renombra", async () => (await L.dbTask("Titulo A")) !== undefined, true);
  await bt.press("Enter");
  const msgT = b.page.getByText(/Administrador ha cambiado el texto de esta tarea/);
  await msgT.first().waitFor({ timeout: 6000 }).catch(() => {});
  L.check("conflicto también al cambiar el título", (await msgT.count()) > 0);
  L.eq("la BD conserva el título de A", [(await L.dbTask("Titulo A")) !== undefined, (await L.dbTask("Titulo B")) === undefined], [true, true]);
  // Cambios que no son de texto (columna, tipo) no entran en conflicto
  await b.page.waitForTimeout(500);
  await b.page.locator("[role=dialog] select").first().selectOption({ label: COL.doing });
  await L.eqEventually("mover no genera conflicto", async () => (await L.dbTask("Titulo A")).columnName, COL.doing);

  // Título escrito a la vez: lo que B está escribiendo no se pisa cuando A guarda el suyo (antes, en menos de un segundo
  // el campo de B, aún con el foco, pasaba al texto de A y lo de B se perdía sin aviso). Al salir, B recibe el conflicto.
  await U.closeDialog(a.page); await U.closeDialog(b.page);
  await b.page.getByText(/ha cambiado el texto/).first().waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  await U.openTask(a.page, "Titulo3"); await U.openTask(b.page, "Titulo3");
  const at3 = U.dialog(a.page).locator("textarea[aria-label='Título']").first();
  const bt3 = U.dialog(b.page).locator("textarea[aria-label='Título']").first();
  await at3.click(); await a.page.keyboard.press("Control+A"); await a.page.keyboard.type("Titulo3 de A");
  await bt3.click(); await b.page.keyboard.press("Control+A"); await b.page.keyboard.type("Titulo3 de B");
  await at3.evaluate((el) => el.blur());
  await L.eqEventually("a la vez: A guarda su título", async () => (await L.dbTask("Titulo3 de A")) !== undefined, true);
  await L.eqEventually("a la vez: la tarjeta de B recibe el título de A en vivo", () => L.cardLoc(b.page, "Titulo3 de A").count(), 1);
  L.eq("a la vez: el campo de B conserva lo que escribe", await bt3.inputValue(), "Titulo3 de B");
  L.check("a la vez: B sigue con el foco en su campo", await bt3.evaluate((el) => document.activeElement === el));
  await b.page.keyboard.press("Enter");
  const msg3 = b.page.getByText(/Administrador ha cambiado el texto de esta tarea/);
  await msg3.first().waitFor({ timeout: 6000 }).catch(() => {});
  L.check("a la vez: B recibe el conflicto al guardar", (await msg3.count()) > 0);
  L.check("a la vez: el aviso ofrece «Copiar tu texto»", (await b.page.getByRole("button", { name: "Copiar tu texto" }).count()) > 0);
  L.eq("a la vez: la BD conserva el título de A", [(await L.dbTask("Titulo3 de A")) !== undefined, (await L.dbTask("Titulo3 de B")) === undefined], [true, true]);
  await L.eqEventually("a la vez: tras el conflicto el campo de B muestra el título guardado", () => bt3.inputValue(), "Titulo3 de A");

  // Cambio ajeno sin que B esté editando: el campo de B pasa en vivo al título de A y, si B lo edita luego, se guarda sin
  // falso conflicto (antes la versión del texto de B seguía siendo la de la apertura y el servidor lo rechazaba).
  await U.closeDialog(a.page); await U.closeDialog(b.page);
  await b.page.getByText(/ha cambiado el texto/).first().waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  await U.openTask(a.page, "Titulo4"); await U.openTask(b.page, "Titulo4");
  const at4 = U.dialog(a.page).locator("textarea[aria-label='Título']").first();
  const bt4 = U.dialog(b.page).locator("textarea[aria-label='Título']").first();
  await at4.click(); await a.page.keyboard.press("Control+A"); await a.page.keyboard.type("Titulo4 de A"); await a.page.keyboard.press("Enter");
  await L.eqEventually("en vivo: A guarda su título", async () => (await L.dbTask("Titulo4 de A")) !== undefined, true);
  await L.eqEventually("en vivo: el campo de B (sin editar) pasa al título de A", () => bt4.inputValue(), "Titulo4 de A");
  await b.page.waitForTimeout(800);
  await bt4.click(); await b.page.keyboard.press("End"); await b.page.keyboard.type(" y B"); await b.page.keyboard.press("Enter");
  const falseConflict = await b.page.getByText(/ha cambiado el texto de esta tarea/).first().waitFor({ timeout: 3000 }).then(() => true, () => false);
  L.check("en vivo: B no recibe un falso conflicto", !falseConflict);
  await L.eqEventually("en vivo: B edita después y se guarda", async () => (await L.dbTask("Titulo4 de A y B")) !== undefined, true);

  L.assertNoErrors("escenario 5 (A)", [a]);
  L.check("escenario 5 (B): sin errores de página (los avisos de conflicto son toasts)", b.errors.filter((e) => /pageerror/.test(e)).length === 0, b.errors.join(" | "));
  const consoleB = b.errors.filter((e) => !/pageerror/.test(e));
  if (consoleB.length) L.note("B: errores de consola durante el conflicto", consoleB.join(" | ").slice(0, 300));
  await a.ctx.close(); await b.ctx.close();
}
await U.runStandalone(import.meta.url, run);
