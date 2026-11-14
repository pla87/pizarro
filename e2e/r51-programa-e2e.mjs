// Columna «Programa del curso» (ronda 51): versiones del PDF guardado en Documentación («Programa – fecha_vN.pdf», cada
// publicación un documento nuevo; el diálogo dice qué versión es; sigue subiendo aunque se borre uno) y tope de 100
// sesiones en la columna: contador «n/100», «+» desactivado con su motivo al llegar a 100, crear desde «+», arrastrar una
// tarjeta y «Mover a…» a la columna llena se rechazan con el mensaje y la tarjeta vuelve, el rol no se da a una columna
// con más de 100, y con datos antiguos por encima el PDF incluye solo las 100 primeras y lo avisa (antes y después de
// publicar). En inglés, los textos. Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r51-programa-e2e.mjs      # PART=version,limite,pdf,rol,en
import os from "node:os";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "version,limite,pdf,rol,en").split(",");

await L.prepareUsers();
const PID = "r51p_project";
const NAME = "Zeta r51 programa";
const PROG = "r51p_prog";
const OTRA = "r51p_otra";
const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const [two] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.USER2]);
// Cada persona puede generar 5 PDF por minuto: «version» los genera con el admin y «pdf» y «en» con la segunda persona.

/** Proyecto privado con «Programa» (rol PROGRAM, `sessions` tarjetas), «Otra» (`others` tarjetas) y «Hecho». */
async function seed({ sessions = 2, others = 1 } = {}) {
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [PID]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,true,$3,999996,NOW())`, [PID, NAME, adm.id]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2),($1,$3)`, [PID, adm.id, two.id]);
  const cols = [[PROG, "Programa", "PROGRAM", false], [OTRA, "Otra", "NONE", false], ["r51p_hecho", "Hecho", "NONE", true]];
  for (const [i, [id, name, role, done]] of cols.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,role,"isDone") VALUES ($1,$2,$3,$4,$5,$6)`, [id, PID, name, (i + 1) * 1000, role, done]);
  await addTasks(PROG, sessions, "Sesión r51");
  await addTasks(OTRA, others, "Otra r51");
}
/** `n` tarjetas más al final de la columna (títulos «prefijo 1», «prefijo 2»… a partir de las que ya hay). */
async function addTasks(columnId, n, prefix) {
  if (n <= 0) return;
  const [{ c }] = await L.q(`SELECT count(*)::int c FROM "Task" WHERE "columnId"=$1`, [columnId]);
  await L.q(
    `INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"createdById","updatedAt")
     SELECT 'r51p_' || $1 || '_' || g, $2, $1, $3 || ' ' || g, 'kind_funcionalidad', g * 1024, $4, NOW() FROM generate_series($5::int + 1, $5::int + $6::int) g`,
    [columnId, PID, prefix, adm.id, c, n],
  );
}
const active = async (columnId) => (await L.q(`SELECT count(*)::int c FROM "Task" WHERE "columnId"=$1 AND "archivedAt" IS NULL`, [columnId]))[0].c;
const appToday = (page) => page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: document.documentElement.dataset.tz || undefined }).format(new Date()));

async function openBoard(page) {
  await page.goto(`${L.BASE}/p/${PID}`);
  await L.colLoc(page, "Programa").waitFor({ timeout: 15000 });
  await L.liveOpen(page);
  await sleep(300);
}
const programCol = (page) => L.colLoc(page, "Programa");
const badge = (page) => programCol(page).locator("[data-session-badge]");
const plus = (page) => programCol(page).getByRole("button", { name: /^Añadir tarea en Programa|^Add task in Programa/ });
const dlg = (page) => page.locator("[role=dialog]").filter({ hasText: /Publicar programa|Publish programme/ }).first();
async function openPublish(page) {
  await programCol(page).getByRole("button", { name: /Publicar programa \(PDF\)|Publish programme \(PDF\)/ }).click();
  await dlg(page).waitFor();
  await sleep(300);
}
async function publish(page, english = false) {
  await dlg(page).getByRole("button", { name: english ? "Publish" : "Publicar", exact: true }).click();
  await dlg(page).locator("[data-program-ready]").waitFor({ timeout: 30000 });
}
const toastWith = (page, text) => L.waitFor(async () => (await page.getByText(text).count()) > 0, { timeout: 8000 });

try {
  // --- Versiones del PDF guardado ------------------------------------------------------------------------------------
  if (only.includes("version")) {
    L.scenario("version: cada publicación guardada es «Programa – fecha_vN.pdf» y el diálogo dice la versión");
    await seed();
    const s = await L.session();
    const { page } = s;
    await openBoard(page);
    const today = await appToday(page);
    await openPublish(page);
    const label = dlg(page).getByLabel(`Guardar también en Documentación como una versión nueva («Programa – ${today}_vN.pdf»)`);
    L.check("VER: la casilla dice que se guarda como versión nueva («_vN»)", await label.isChecked());
    await publish(page);
    const st1 = dlg(page).getByRole("status");
    L.eq("VER: la primera es la versión 1", [await st1.getAttribute("data-program-version"), (await st1.innerText()).replace(/\s+/g, " ")], ["1", `Guardado en Documentación como «Programa – ${today}_v1.pdf» (versión 1 del programa). Abrir Documentación`]);
    await page.screenshot({ path: `${SHOTS}/r51-programa-version1.png` });
    await dlg(page).getByRole("button", { name: "Cerrar" }).first().click();
    await openPublish(page);
    await publish(page);
    L.eq("VER: la segunda, la 2", await dlg(page).getByRole("status").getAttribute("data-program-version"), "2");
    await dlg(page).getByRole("button", { name: "Cerrar" }).first().click();
    const names = async () => (await L.q(`SELECT name FROM "ProjectDocument" WHERE "projectId"=$1 ORDER BY name`, [PID])).map((d) => d.name);
    L.eq("VER: las dos quedan en Documentación (no se sustituye la anterior)", await names(), [`Programa – ${today}_v1.pdf`, `Programa – ${today}_v2.pdf`]);
    // Borrada para siempre la 2 (papelera purgada), la siguiente es la 3.
    await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1 AND name LIKE '%\\_v2.pdf'`, [PID]);
    await openPublish(page);
    await publish(page);
    L.eq("VER: aunque se borre la 2, la siguiente es la 3", await dlg(page).getByRole("status").getAttribute("data-program-version"), "3");
    L.eq("VER: en Documentación, la 1 y la 3", await names(), [`Programa – ${today}_v1.pdf`, `Programa – ${today}_v3.pdf`]);
    L.eq("VER: la versión queda en el proyecto", (await L.q(`SELECT "programVersion" v FROM "Project" WHERE id=$1`, [PID]))[0].v, 3);
    // Sin guardar, no gasta versión ni dice ninguna.
    await dlg(page).getByRole("button", { name: "Cerrar" }).first().click();
    await openPublish(page);
    await label.uncheck();
    await publish(page);
    L.eq("VER: sin guardar, ni versión ni aviso de guardado", await dlg(page).getByRole("status").count(), 0);
    L.eq("VER: y no se gasta número", (await L.q(`SELECT "programVersion" v FROM "Project" WHERE id=$1`, [PID]))[0].v, 3);
    await dlg(page).getByRole("button", { name: "Cerrar" }).first().click();
    L.assertNoErrors("VER", [s]);
    await s.ctx.close();
  }

  // --- Tope de 100 sesiones en el tablero ----------------------------------------------------------------------------
  if (only.includes("limite")) {
    L.scenario("limite: contador n/100, «+» desactivado al llegar a 100 y lo que intenta entrar se rechaza");
    await seed({ sessions: 99, others: 2 });
    const s = await L.session();
    const { page } = s;
    await openBoard(page);
    L.eq("LIM: el contador dice «99/100»", (await badge(page).innerText()).trim(), "99/100");
    L.eq("LIM: con 99, el «+» funciona", await plus(page).isDisabled(), false);
    await plus(page).click();
    const nt = U.dialog(page);
    await nt.waitFor();
    await sleep(300);
    await nt.getByRole("textbox", { name: "Título", exact: true }).fill("La cien r51");
    await nt.getByRole("button", { name: "Crear tarea" }).click();
    await nt.waitFor({ state: "detached", timeout: 10000 });
    await L.eqEventually("LIM: tras crear la 100, «100/100»", async () => (await badge(page).innerText()).trim(), "100/100");
    L.eq("LIM: el «+» queda desactivado", await plus(page).isDisabled(), true);
    L.eq("LIM: con el motivo", await plus(page).getAttribute("title"), "La columna «Programa» admite como mucho 100 sesiones.");
    L.eq("LIM: el contador explica el tope", await badge(page).getAttribute("title"), "Sesiones: 100 de 100 como mucho");
    await page.screenshot({ path: `${SHOTS}/r51-programa-lleno.png` });
    // Arrastrar una tarjeta de «Otra» a «Programa»: se rechaza con el mensaje y vuelve.
    await U.drag(page, "Otra r51 1", { column: "Programa" });
    L.check("LIM: arrastrar a la columna llena avisa", await toastWith(page, "La columna «Programa» admite como mucho 100 sesiones."));
    await L.eqEventually("LIM: la tarjeta sigue en «Otra»", async () => (await L.dbTask("Otra r51 1")).columnName, "Otra");
    await L.eqEventually("LIM: y en el tablero también", async () => programCol(page).locator("[data-task-card]").filter({ hasText: "Otra r51 1" }).count(), 0);
    L.eq("LIM: «Programa» sigue con 100", await active(PROG), 100);
    // «Mover a…» de la barra de selección: tampoco.
    await sleep(4500); // que se vaya el aviso anterior
    await L.cardLoc(page, "Otra r51 2").locator('button[aria-label="Seleccionar"]').click();
    const bar = page.locator("select").filter({ has: page.locator("option", { hasText: "Mover a…" }) });
    await bar.selectOption({ label: "Programa" });
    L.check("LIM: «Mover a…» a la columna llena avisa", await toastWith(page, "La columna «Programa» admite como mucho 100 sesiones."));
    await sleep(500);
    L.eq("LIM: no se mueve ninguna", [await active(PROG), await active(OTRA)], [100, 2]);
    await page.keyboard.press("Escape");
    L.assertNoErrors("LIM", [s]);
    await s.ctx.close();
  }

  // --- PDF con más de 100 (datos antiguos) ---------------------------------------------------------------------------
  if (only.includes("pdf")) {
    L.scenario("pdf: con más de 100 sesiones, el PDF lleva las 100 primeras y avisa");
    await seed({ sessions: 103 });
    const s = await L.session({ email: L.USER2 });
    const { page } = s;
    await openBoard(page);
    L.eq("PDF: el contador dice «103/100»", (await badge(page).innerText()).trim(), "103/100");
    await openPublish(page);
    const over = await dlg(page).locator("[data-program-over]").innerText();
    L.eq("PDF: antes de publicar avisa", over, "La columna tiene 103 sesiones y el programa admite como mucho 100: el PDF incluirá solo las 100 primeras.");
    const href = await dlg(page).getByRole("link", { name: "Vista previa sin guardar" }).getAttribute("href");
    const res = await page.request.get(L.BASE + href);
    L.eq("PDF: la vista previa dice cuántas se quedan fuera", [res.status(), res.headers()["x-pizarro-program-omitted"]], [200, "3"]);
    await publish(page);
    L.eq("PDF: después de publicar también", await dlg(page).locator("[data-program-omitted]").innerText(), "El PDF incluye solo las 100 primeras sesiones: 3 se han quedado fuera.");
    await page.screenshot({ path: `${SHOTS}/r51-programa-omitidas.png` });
    await dlg(page).getByRole("button", { name: "Cerrar" }).first().click();
    L.assertNoErrors("PDF", [s]);
    await s.ctx.close();
  }

  // --- El rol no se da a una columna con más de 100 ------------------------------------------------------------------
  if (only.includes("rol")) {
    L.scenario("rol: «Programa del curso» no se da a una columna con más de 100 tarjetas");
    await seed({ sessions: 1, others: 101 });
    const s = await L.session();
    const { page } = s;
    await openBoard(page);
    const otra = L.colLoc(page, "Otra");
    await otra.getByRole("button", { name: "Opciones de columna" }).click();
    await page.getByRole("menuitemradio", { name: "Programa del curso (PDF)" }).click();
    L.check("ROL: avisa con el motivo", await toastWith(page, "La columna «Otra» tiene 101 tareas y una columna «Programa del curso» admite como mucho 100 sesiones. Mueve o archiva alguna antes de darle ese rol."));
    await sleep(500);
    L.eq("ROL: el rol no cambia", (await L.q(`SELECT role FROM "Column" WHERE id=$1`, [OTRA]))[0].role, "NONE");
    await L.eqEventually("ROL: ni en el tablero (sin «Publicar programa»)", async () => otra.getByRole("button", { name: "Publicar programa (PDF)" }).count(), 0);
    L.assertNoErrors("ROL", [s]);
    await s.ctx.close();
  }

  // --- En inglés ------------------------------------------------------------------------------------------------------
  if (only.includes("en")) {
    L.scenario("en: los textos del tope y de la versión, en inglés");
    await seed({ sessions: 100 });
    await L.q(`UPDATE "User" SET locale='EN' WHERE id=$1`, [two.id]);
    try {
      const s = await L.session({ email: L.USER2, viewport: { width: 390, height: 844 }, mobile: true });
      const { page } = s;
      await page.goto(`${L.BASE}/p/${PID}`);
      await programCol(page).waitFor({ timeout: 15000 });
      await sleep(500);
      L.eq("EN: el «+» explica el tope", await plus(page).getAttribute("title"), "The column “Programa” holds at most 100 sessions.");
      L.eq("EN: y el contador", await badge(page).getAttribute("title"), "Sessions: 100 of at most 100");
      await openPublish(page);
      const today = await appToday(page);
      L.check("EN: la casilla de guardar", await dlg(page).getByLabel(`Also save to Documentation as a new version (“Programme – ${today}_vN.pdf”)`).isChecked());
      await publish(page, true);
      L.eq("EN: la versión guardada", (await dlg(page).getByRole("status").innerText()).replace(/\s+/g, " "), `Saved to Documentation as “Programme – ${today}_v1.pdf” (programme version 1). Open Documentation`);
      L.check("EN: el diálogo cabe en 390 px", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.screenshot({ path: `${SHOTS}/r51-programa-en.png` });
      L.assertNoErrors("EN", [s]);
      await s.ctx.close();
    } finally {
      await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [two.id]);
    }
  }
} finally {
  // El proyecto de prueba no se queda (las demás suites entran en el primer proyecto).
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [PID]);
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
