// Tareas que se repiten: «Repetir» en «Nueva tarea» (se guarda al crear, junto a la fecha límite, compacto también a 390 px),
// sus apariciones futuras en el calendario (tenues, con el icono de repetir, abren la tarea original; nada antes de hoy ni de
// una tarea repetida sin fecha límite) y en el .ics (una serie con RRULE en la suscripción y en el de la columna Agenda).
// Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r49-repeat-e2e.mjs
import os from "node:os";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "new,cal,ics,mobile").split(",");

await L.prepareUsers();
await L.cleanBoard();
await L.q(`DELETE FROM "CalendarFeed"`);
const p = await L.project();
const TITLE = "Regar plantas r49";
const UNDATED = "Repaso diario r49";

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() || 7; // 1 = lunes … 7 = domingo
/** Hoy en la zona horaria de la instalación (la que pinta la página en <html data-tz>). */
const appToday = (page) => page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: document.documentElement.dataset.tz || undefined }).format(new Date()));
/** Ninguna caja del diálogo se sale por los lados ni hay scroll horizontal. */
const dialogOverflow = (page) => page.evaluate(() => {
  const dlg = document.querySelector("[role=dialog]");
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of dlg.querySelectorAll("input, select, button, label")) {
    if (!el.getClientRects().length) continue;
    const b = el.getBoundingClientRect();
    if (b.right > vw + 0.5 || b.left < -0.5) bad.push(el.getAttribute("aria-label") || el.id || el.textContent.trim().slice(0, 30));
  }
  if (document.documentElement.scrollWidth > vw + 1) bad.push("scroll horizontal de la página");
  return bad;
});

let today = null;
let due = null;
let taskId = null;

// --- «Nueva tarea»: el campo «Repetir» junto a la fecha límite, y crear lo guarda ------------------------------------
if (only.includes("new")) {
  L.scenario("new: «Repetir» en Nueva tarea");
  const s = await L.session();
  const { page } = s;
  today = await appToday(page);
  due = addDays(today, 10);
  await page.getByRole("button", { name: "Nueva tarea", exact: true }).first().click();
  const dlg = U.dialog(page);
  await dlg.waitFor();
  await dlg.getByRole("textbox", { name: "Título", exact: true }).fill(TITLE);
  const repeat = dlg.getByLabel("Repetir", { exact: true });
  L.eq("NEW: «Repetir» empieza en «No se repite»", await repeat.inputValue(), "NONE");
  L.eq("NEW: sin día mientras no se repite", await dlg.getByLabel("Día de la semana").count(), 0);
  const dueInput = dlg.getByLabel("Fecha límite (opcional)");
  // Justo debajo de la fecha límite y de la persona asignada (la fila siguiente de la misma cuadrícula).
  const [dueBox, repBox] = [await dueInput.boundingBox(), await repeat.boundingBox()];
  L.check("NEW: «Repetir» va en la fila de debajo de la fecha límite", repBox.y > dueBox.y && repBox.y - (dueBox.y + dueBox.height) < 60, JSON.stringify({ dueBox, repBox }));
  await repeat.selectOption("WEEKLY");
  const daySel = dlg.getByLabel("Día de la semana");
  L.check("NEW: semanal muestra el día de la semana", await daySel.isVisible());
  const dayBox = await daySel.boundingBox();
  L.check("NEW: el día va al lado de la regla (misma fila)", Math.abs(dayBox.y - repBox.y) < 4 && dayBox.x > repBox.x, JSON.stringify({ dayBox, repBox }));
  // Sin fecha, el día por defecto es el de hoy; al poner la fecha límite sigue a la fecha (no se eligió a mano).
  L.eq("NEW: sin fecha límite, el día es el de hoy", Number(await daySel.inputValue()), weekday(today));
  await dueInput.fill(due);
  L.eq("NEW: con fecha límite, el día pasa a ser el de la fecha", Number(await daySel.inputValue()), weekday(due));
  await page.screenshot({ path: `${SHOTS}/r49-nueva-tarea-1500.png` });
  await page.getByRole("button", { name: "Crear tarea" }).click();
  await L.eqEventually("NEW: la tarea se crea con la repetición semanal", async () => {
    const t = await L.dbTask(TITLE);
    return t ? [t.recurrence, t.recurrenceDay, t.dueDate?.toISOString().slice(0, 10)] : null;
  }, ["WEEKLY", weekday(due), due]);
  taskId = (await L.dbTask(TITLE)).id;
  await L.eqEventually("NEW: la tarjeta lleva el icono de repetir", () => L.cardLoc(page, TITLE).locator("[aria-label^='Cada semana']").count(), 1);

  // Otra, diaria y sin fecha límite (no tendrá previsión en el calendario).
  await page.getByRole("button", { name: "Nueva tarea", exact: true }).first().click();
  await dlg.waitFor();
  await dlg.getByRole("textbox", { name: "Título", exact: true }).fill(UNDATED);
  await dlg.getByLabel("Repetir", { exact: true }).selectOption("DAILY");
  L.eq("NEW: diaria sin selector de día", await dlg.locator("select").filter({ has: page.locator("option[value='7']") }).count(), 0);
  await page.getByRole("button", { name: "Crear tarea" }).click();
  await L.eqEventually("NEW: la diaria sin fecha se guarda", async () => {
    const t = await L.dbTask(UNDATED);
    return t ? [t.recurrence, t.recurrenceDay, t.dueDate] : null;
  }, ["DAILY", null, null]);

  // El detalle usa el mismo selector y muestra lo guardado.
  await U.openTask(page, TITLE);
  L.eq("NEW: el detalle muestra «Cada semana»", await U.dialog(page).getByLabel("Repetir", { exact: true }).inputValue(), "WEEKLY");
  L.eq("NEW: y el día de la fecha límite", Number(await U.dialog(page).getByLabel("Día de la semana").inputValue()), weekday(due));
  await U.closeDialog(page);
  L.assertNoErrors("NEW", [s]);
  await s.ctx.close();
}

// Si se lanza una parte suelta, la tarea se prepara por SQL.
if (!taskId) {
  const s = await L.session();
  today = await appToday(s.page);
  await s.ctx.close();
  due = addDays(today, 10);
  const [id] = await L.seedTasks(L.COL.backlog, [TITLE]);
  await L.q(`UPDATE "Task" SET recurrence='WEEKLY', "recurrenceDay"=$2, "dueDate"=$3 WHERE id=$1`, [id, weekday(due), due]);
  const [id2] = await L.seedTasks(L.COL.backlog, [UNDATED]);
  await L.q(`UPDATE "Task" SET recurrence='DAILY' WHERE id=$1`, [id2]);
  taskId = id;
}
const expected = [7, 14, 21, 28, 35, 42].map((n) => addDays(due, n));

// --- Calendario: apariciones futuras tenues, con icono, que abren la tarea original ------------------------------------
if (only.includes("cal")) {
  L.scenario("cal: apariciones previstas en el calendario");
  const s = await L.session();
  const { page } = s;
  const month = expected[1].slice(0, 7);
  await page.goto(`${L.BASE}/calendar?month=${month}`);
  await page.locator("[data-week]").first().waitFor({ timeout: 20000 });
  const shown = await page.locator("[data-repeat]").evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => e.dataset.repeatDay));
  const grid = await page.locator("[data-day]").evaluateAll((els) => els.map((e) => e.dataset.day));
  const want = expected.filter((d) => grid.includes(d));
  L.check("CAL: hay apariciones previstas en el mes", want.length >= 2, want.join(","));
  L.eq("CAL: una por semana, el día de la regla, en las celdas visibles", [...shown].sort(), want);
  L.check("CAL: ninguna el día de la tarea ni antes", shown.every((d) => d > due && d > today), shown.join(","));
  L.eq("CAL: todas son de la tarea original", [...new Set(await page.locator("[data-repeat]").evaluateAll((els) => els.map((e) => e.dataset.repeat)))], [taskId]);
  const chip = page.locator(`[data-repeat-day="${want[0]}"]`).first();
  const look = await chip.evaluate((el) => ({ opacity: Number(getComputedStyle(el).opacity), border: getComputedStyle(el).borderTopStyle, icon: !!el.querySelector("svg"), draggable: el.getAttribute("draggable") }));
  L.check("CAL: más tenue que una tarea", look.opacity < 1, String(look.opacity));
  L.eq("CAL: borde discontinuo, icono de repetir y no se arrastra", [look.border, look.icon, look.draggable], ["dashed", true, "false"]);
  L.check("CAL: el título dice que es una repetición prevista", ((await chip.getAttribute("title")) ?? "").includes("Repetición prevista"));
  L.check("CAL: leyenda de las repeticiones", await page.getByText("Repeticiones previstas: se crean al terminar la anterior.", { exact: false }).first().isVisible());
  L.eq("CAL: la tarea sin fecha límite no se pinta", await page.locator("a", { hasText: UNDATED }).count(), 0);
  await page.screenshot({ path: `${SHOTS}/r49-calendario-1500.png` });
  await chip.click();
  await page.waitForURL((u) => u.pathname === `/p/${p.id}` && u.searchParams.get("task") === taskId, { timeout: 20000 });
  await U.dialog(page).waitFor({ timeout: 20000 });
  L.check("CAL: al pulsarla se abre la tarea original", (await U.dialog(page).getByLabel("Repetir", { exact: true }).inputValue()) === "WEEKLY");
  await U.closeDialog(page);

  // El mes actual: nada antes de mañana (la tarea en sí, en su fecha límite, como siempre).
  await page.goto(`${L.BASE}/calendar?month=${today.slice(0, 7)}`);
  await page.locator("[data-week]").first().waitFor({ timeout: 20000 });
  const now = await page.locator("[data-repeat]").evaluateAll((els) => els.map((e) => e.dataset.repeatDay));
  L.check("CAL: en el mes actual, ninguna hoy ni antes", now.every((d) => d > today), now.join(","));
  // Un mes lejano (dos años): sigue habiendo una por semana, sin recorrer los meses de en medio.
  const farMonth = addDays(today, 730).slice(0, 7);
  await page.goto(`${L.BASE}/calendar?month=${farMonth}`);
  await page.locator("[data-week]").first().waitFor({ timeout: 20000 });
  const far = await page.locator("[data-repeat]").evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => e.dataset.repeatDay));
  L.check("CAL: dos años después, 5 o 6 por cuadrícula, todas en el día de la semana", far.length >= 5 && far.length <= 6 && far.every((d) => weekday(d) === weekday(due)), far.join(","));
  L.assertNoErrors("CAL", [s]);
  await s.ctx.close();
}

// --- .ics: serie con RRULE en la suscripción y en el de la columna Agenda ------------------------------------------------
if (only.includes("ics")) {
  L.scenario("ics: serie RRULE");
  const s = await L.session();
  const { page } = s;
  await page.goto(`${L.BASE}/calendar`);
  await page.locator("[data-week]").first().waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /Suscribirse/ }).first().click();
  await page.getByRole("button", { name: "Generar enlace de suscripción" }).click();
  const link = page.locator("input[readonly]").first();
  await link.waitFor({ timeout: 10000 });
  const path = new URL(await link.inputValue()).pathname;
  const res = await fetch(`${L.BASE}${path}`);
  const ics = (await res.text()).replace(/\r\n /g, "");
  L.eq("ICS: la suscripción responde", res.status, 200);
  const vevent = (uid) => ics.split("BEGIN:VEVENT").find((b) => b.includes(`UID:${uid}\r\n`)) ?? "";
  const serie = vevent(`${taskId}-repeat@pizarro`);
  const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][weekday(due) - 1];
  L.check("ICS: un VEVENT de serie con RRULE semanal", serie.includes(`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY}\r\n`), serie.slice(0, 400));
  L.check("ICS: empieza en la primera aparición prevista (día completo)", serie.includes(`DTSTART;VALUE=DATE:${expected[0].replace(/-/g, "")}\r\n`));
  L.check("ICS: enlaza a la tarea original", serie.includes(`/p/${p.id}?task=${taskId}`));
  L.check("ICS: la tarea en sí sigue con su evento, sin RRULE", vevent(`${taskId}@pizarro`).includes(`DTSTART;VALUE=DATE:${due.replace(/-/g, "")}`) && !vevent(`${taskId}@pizarro`).includes("RRULE"));
  L.eq("ICS: una sola serie (ni copias por semana ni la de la tarea sin fecha)", ics.split("\r\n").filter((l) => l.startsWith("RRULE:")).length, 1);
  L.eq("ICS: ningún evento suelto de la serie", (ics.match(new RegExp(`UID:${taskId}-repeat-`, "g")) ?? []).length, 0);

  // Columna Agenda: el mismo VEVENT de serie en su .ics.
  const cols = await L.columnIds();
  await L.q(`UPDATE "Column" SET role='AGENDA' WHERE id=$1`, [cols[L.COL.backlog]]);
  const r2 = await page.request.get(`${L.BASE}/api/projects/${p.id}/columns/${cols[L.COL.backlog]}/ics`);
  const agenda = (await r2.text()).replace(/\r\n /g, "");
  L.eq("ICS: el .ics de la columna Agenda responde", r2.status(), 200);
  L.check("ICS: y lleva la misma serie", agenda.includes(`UID:${taskId}-repeat@pizarro\r\n`) && agenda.includes(`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY}\r\n`));
  await L.q(`UPDATE "Column" SET role='NONE' WHERE id=$1`, [cols[L.COL.backlog]]);
  L.assertNoErrors("ICS", [s]);
  await s.ctx.close();
}

// --- Móvil (390 px): «Nueva tarea» sin desbordes y el calendario en lista ----------------------------------------------
if (only.includes("mobile")) {
  L.scenario("mobile: 390 px");
  const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = s;
  await page.getByRole("button", { name: "Nueva tarea o captura" }).tap();
  const dlg = U.dialog(page);
  await dlg.waitFor();
  await sleep(400);
  const repeat = dlg.getByLabel("Repetir", { exact: true });
  await repeat.scrollIntoViewIfNeeded();
  await repeat.selectOption("MONTHLY");
  const daySel = dlg.getByLabel("Día del mes");
  L.check("MOBILE: mensual muestra el día del mes", await daySel.isVisible());
  const [a, b] = [await repeat.boundingBox(), await daySel.boundingBox()];
  L.check("MOBILE: regla y día en la misma fila", Math.abs(a.y - b.y) < 4, JSON.stringify({ a, b }));
  L.eq("MOBILE: nada del diálogo se sale de la pantalla", await dialogOverflow(page), []);
  await sleep(200);
  await page.screenshot({ path: `${SHOTS}/r49-nueva-tarea-390.png` });
  await dlg.getByRole("button", { name: "Cancelar" }).tap();
  await dlg.waitFor({ state: "detached" });

  await page.goto(`${L.BASE}/calendar?month=${expected[1].slice(0, 7)}`);
  await page.locator("h1").first().waitFor({ timeout: 20000 });
  const items = await page.locator("[data-repeat]").evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => ({ day: e.dataset.repeatDay, right: e.getBoundingClientRect().right })));
  L.check("MOBILE: la lista del mes muestra las apariciones previstas", items.length >= 2 && items.every((x) => expected.includes(x.day)), JSON.stringify(items));
  L.check("MOBILE: sin salirse de la pantalla", items.every((x) => x.right <= 390.5) && (await page.evaluate(() => document.documentElement.scrollWidth <= 391)));
  await page.locator(`[data-repeat-day="${items[0].day}"]`).filter({ visible: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/r49-calendario-390.png` });
  await page.locator(`[data-repeat-day="${items[0].day}"]`).filter({ visible: true }).first().click();
  await page.waitForURL((u) => u.searchParams.get("task") === taskId, { timeout: 20000 });
  L.check("MOBILE: al tocarla se abre la tarea original", await U.dialog(page).waitFor({ timeout: 20000 }).then(() => true, () => false));
  L.assertNoErrors("MOBILE", [s]);
  await s.ctx.close();
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
