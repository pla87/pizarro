// Escenario 5: edición simultánea del texto de una tarea (updateTask con `since` / contentUpdatedAt).
import * as L from "./lib.mjs";
import * as U from "./ui.mjs";
const { COL } = L;

const desc = async (title) => ((await L.q(`SELECT description FROM "Task" WHERE title=$1`, [title]))[0]?.description ?? "").trim();
async function editDescription(page, text) {
  const d = U.dialog(page);
  const edit = d.getByRole("button", { name: "Editar" }).first();
  const empty = d.getByRole("button", { name: "Añade una descripción…" });
  if (await empty.count()) await empty.click(); else await edit.click();
  const ed = d.locator("[role=textbox][contenteditable]").first();
  await ed.click(); await page.keyboard.press("Control+A"); await page.keyboard.type(text);
  await page.keyboard.press("Control+Enter");
}

export async function run() {
  L.scenario("5. Conflicto de edición simultánea del texto");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Compartida", "Titulo2"]);
  const t0 = await L.dbNow();
  const a = await L.session({ viewport: U.WIDE });
  const b = await L.session({ email: L.USER2, viewport: U.WIDE });
  await U.openTask(a.page, "Compartida");
  await U.openTask(b.page, "Compartida");

  // A guarda primero
  await editDescription(a.page, "Texto de Administrador");
  await L.eqEventually("A guarda su descripción", () => desc("Compartida"), "Texto de Administrador");
  const [r1] = await L.q(`SELECT "contentUpdatedById" AS u FROM "Task" WHERE title='Compartida'`);
  L.check("contentUpdatedById registra a A", !!r1.u);

  // B (que abrió antes) intenta guardar otra descripción
  await editDescription(b.page, "Texto de la Segunda");
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

  // Tras recargar, B ya puede guardar (versión nueva)
  await editDescription(b.page, "Segunda ya actualizada");
  await L.eqEventually("B guarda tras la recarga", () => desc("Compartida"), "Segunda ya actualizada");
  // Y ahora A (con su versión anterior) recibe el conflicto con el nombre de B
  await editDescription(a.page, "Otro intento de A");
  const msgA = a.page.getByText(/Segunda Persona ha cambiado el texto de esta tarea/);
  await msgA.first().waitFor({ timeout: 6000 }).catch(() => {});
  L.check("A recibe el conflicto con el nombre de B", (await msgA.count()) > 0);
  L.eq("la BD conserva el texto de B", await desc("Compartida"), "Segunda ya actualizada");
  await U.closeDialog(a.page); await U.closeDialog(b.page);

  // Mismo usuario en dos pestañas: no hay conflicto (el último gana)
  const a2 = await a.ctx.newPage();
  const errs2 = []; a2.on("pageerror", (e) => errs2.push(e.message)); a2.on("console", (m) => m.type() === "error" && errs2.push(m.text()));
  await a2.goto(a.page.url()); await U.openTask(a2, "Titulo2"); await U.openTask(a.page, "Titulo2");
  await editDescription(a.page, "Desde la pestaña 1");
  await L.eqEventually("pestaña 1 guarda", () => desc("Titulo2"), "Desde la pestaña 1");
  await editDescription(a2, "Desde la pestaña 2");
  await L.eqEventually("mismo usuario: la pestaña 2 sobrescribe sin conflicto", () => desc("Titulo2"), "Desde la pestaña 2");
  L.eq("mismo usuario: sin aviso de conflicto", await a2.getByText(/ha cambiado el texto/).count(), 0);
  await a2.close();
  await U.closeDialog(a.page);

  // Conflicto sobre el título (renombrar desde la tarjeta con F2 mientras otra persona lo cambió)
  await L.reload(a.page); await L.reload(b.page);
  await U.openTask(b.page, "Titulo2");
  const bt = U.dialog(b.page).locator("textarea[aria-label='Título']").first();
  await U.openTask(a.page, "Titulo2");
  const at = U.dialog(a.page).locator("textarea[aria-label='Título']").first();
  await at.click(); await a.page.keyboard.press("Control+A"); await a.page.keyboard.type("Titulo A"); await a.page.keyboard.press("Enter");
  await L.eqEventually("A renombra", async () => (await L.dbTask("Titulo A")) !== undefined, true);
  await bt.click(); await b.page.keyboard.press("Control+A"); await b.page.keyboard.type("Titulo B"); await b.page.keyboard.press("Enter");
  const msgT = b.page.getByText(/Administrador ha cambiado el texto de esta tarea/);
  await msgT.first().waitFor({ timeout: 6000 }).catch(() => {});
  L.check("conflicto también al cambiar el título", (await msgT.count()) > 0);
  L.eq("la BD conserva el título de A", [(await L.dbTask("Titulo A")) !== undefined, (await L.dbTask("Titulo B")) === undefined], [true, true]);
  // Cambios que no son de texto (columna, tipo) no entran en conflicto
  await b.page.waitForTimeout(500);
  await b.page.locator("[role=dialog] select").first().selectOption({ label: COL.doing });
  await L.eqEventually("mover no genera conflicto", async () => (await L.dbTask("Titulo A")).columnName, COL.doing);

  L.assertNoErrors("escenario 5 (A)", [a]);
  L.check("escenario 5 (B): sin errores de página (los avisos de conflicto son toasts)", b.errors.filter((e) => /pageerror/.test(e)).length === 0, b.errors.join(" | "));
  const consoleB = b.errors.filter((e) => !/pageerror/.test(e));
  if (consoleB.length) L.note("B: errores de consola durante el conflicto", consoleB.join(" | ").slice(0, 300));
  await a.ctx.close(); await b.ctx.close();
}
await U.runStandalone(import.meta.url, run);
