// Caza de bugs 51c (release, programa del curso y panel de fijas en el móvil): con más de 500 tareas marcadas «Generar
// release» se desactiva con su motivo (antes salía el error de zod en inglés, «Too big: expected array…»), y con más de
// 200 tareas con adjuntos lo hacen «Marcar como desplegado» y la descarga de adjuntos; el «+» flotante del móvil con la
// columna «Programa del curso» a 100 sesiones ya no abre «Nueva tarea» (el servidor la rechazaba al crear): se ve
// desactivado y dice por qué; y el «+» flotante ya no tapa la barra «Siempre en la release» / «Siempre en el plan» al pie
// de la columna (ni la lista del panel abierto). Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh51c-e2e.mjs      # PART=release,adjuntos,flotante,panel
import os from "node:os";
import * as L from "./qa/lib.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "release,adjuntos,flotante,panel").split(",");

await L.prepareUsers();
const PID = "bh51c_project";
const NAME = "Zeta bh51c";
const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const [two] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.USER2]);

/** Proyecto privado con las columnas `cols` ([id, nombre, rol]) y las dos personas como miembros. */
async function seed(cols) {
  await L.q(`DELETE FROM "Project" WHERE id=$1 OR name=$2`, [PID, NAME]);
  await L.q(`UPDATE "User" SET locale='ES' WHERE id IN ($1,$2)`, [adm.id, two.id]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,true,$3,999994,NOW())`, [PID, NAME, adm.id]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2),($1,$3)`, [PID, adm.id, two.id]);
  for (const [i, [id, name, role]] of cols.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,role) VALUES ($1,$2,$3,$4,$5)`, [id, PID, name, (i + 1) * 1000, role]);
}
/** `n` tarjetas al final de la columna («prefijo 1», «prefijo 2»…); `fixed`: fijas. */
async function addTasks(columnId, n, prefix, { fixed = false, from = 0 } = {}) {
  await L.q(
    `INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,evergreen,"createdById","updatedAt")
     SELECT $1 || '_' || g, $2, $3, $4 || ' ' || g, 'kind_funcionalidad', g * 1024, $5, $6, NOW() FROM generate_series($7::int + 1, $7::int + $8::int) g`,
    [`${columnId}_${fixed ? "f" : "t"}`, PID, columnId, prefix, fixed, adm.id, from, n],
  );
}
const toastWith = (page, text) => L.waitFor(async () => (await page.getByText(text, { exact: true }).count()) > 0, { timeout: 8000 });
const releaseDialog = (page) => page.locator("[role=dialog]").filter({ hasText: /Generar release|Generate release/ }).first();
async function openBoard(page, col) {
  await page.goto(`${L.BASE}/p/${PID}`);
  await L.colLoc(page, col).waitFor({ state: "attached", timeout: 20000 });
  await L.liveOpen(page);
  await sleep(500);
}
/** Las dos cajas se solapan (con `margin` px de holgura). */
const overlap = (a, b, margin = 0) => a.x < b.x + b.width - margin && b.x < a.x + a.width - margin && a.y < b.y + b.height - margin && b.y < a.y + a.height - margin;

// --- Más de 500 tareas en la release ---------------------------------------------------------------------------------------
if (only.includes("release")) {
  L.scenario("release: con más de 500 tareas marcadas, «Generar» se desactiva y dice por qué (también en inglés)");
  await seed([["bh51c_r", "Salto", "NEXT_RELEASE"], ["bh51c_o", "Otra", "NONE"]]);
  await addTasks("bh51c_r", 501, "Tarea");
  const s = await L.session();
  const { page } = s;
  await openBoard(page, "Salto");
  await L.colLoc(page, "Salto").getByRole("button", { name: "Generar Release" }).click();
  const dlg = releaseDialog(page);
  const gen = dlg.getByRole("button", { name: /^\s*Generar con \d+ tarea/ });
  await gen.waitFor({ timeout: 10000 });
  await sleep(800);
  L.eq("REL: con 501 marcadas, «Generar» desactivado", await gen.isDisabled(), true);
  L.eq("REL: con el motivo", (await dlg.getByRole("alert").innerText()).trim(), "Una release admite como mucho 500 tareas: quita alguna de la selección.");
  await page.screenshot({ path: `${SHOTS}/bh51c-release-501.png` });
  await dlg.getByRole("checkbox").first().uncheck();
  L.eq("REL: con 500, se puede generar", await gen.isDisabled(), false);
  L.eq("REL: y el aviso desaparece", await dlg.getByRole("alert").count(), 0);
  await gen.click();
  await dlg.getByRole("button", { name: "Cambiar tareas" }).waitFor({ timeout: 20000 });
  L.check("REL: el texto de la release lleva la última tarea", (await dlg.getByRole("textbox", { name: "Contenido de la release" }).evaluate((el) => el.value ?? el.innerText)).includes("Tarea 501"));
  L.eq("REL: «Marcar como desplegado» disponible", await dlg.getByRole("button", { name: "Marcar como desplegado" }).isDisabled(), false);
  L.eq("REL: sin aviso de adjuntos", await dlg.getByRole("alert").count(), 0);
  await page.keyboard.press("Escape");
  L.assertNoErrors("REL", [s]);
  await s.ctx.close();

  await L.q(`UPDATE "User" SET locale='EN' WHERE id=$1`, [two.id]);
  const e = await L.session({ email: L.USER2 });
  await openBoard(e.page, "Salto");
  await L.colLoc(e.page, "Salto").getByRole("button", { name: "Generate Release" }).click();
  const en = releaseDialog(e.page);
  await en.getByRole("alert").waitFor({ timeout: 10000 });
  L.eq("REL: en inglés, el mismo motivo traducido", (await en.getByRole("alert").innerText()).trim(), "A release holds at most 500 tasks: remove some from the selection.");
  L.eq("REL: y «Generate» desactivado", await en.getByRole("button", { name: /^\s*Generate with \d+ task/ }).isDisabled(), true);
  L.assertNoErrors("REL EN", [e]);
  await e.ctx.close();
  await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [two.id]);
}

// --- Más de 200 tareas con adjuntos --------------------------------------------------------------------------------------
if (only.includes("adjuntos")) {
  L.scenario("adjuntos: con más de 200 tareas con adjuntos, «Marcar como desplegado» y la descarga se desactivan con su motivo");
  await seed([["bh51c_r", "Salto", "NEXT_RELEASE"], ["bh51c_p", "En producción", "IN_PRODUCTION"]]);
  await addTasks("bh51c_r", 201, "Con adjunto");
  // Una fila de adjunto por tarea (sin fichero: el diálogo solo cuenta las tareas que tienen).
  await L.q(`INSERT INTO "TaskAttachment"(id,"taskId","originalName","isImage","mimeType",size) SELECT 'bh51c_att_' || id, id, 'nota.pdf', false, 'application/pdf', 10 FROM "Task" WHERE "columnId"='bh51c_r'`);
  const s = await L.session();
  const { page } = s;
  await openBoard(page, "Salto");
  await L.colLoc(page, "Salto").getByRole("button", { name: "Generar Release" }).click();
  const dlg = releaseDialog(page);
  const gen = dlg.getByRole("button", { name: /^\s*Generar con \d+ tarea/ });
  await gen.waitFor({ timeout: 10000 });
  await sleep(800);
  L.eq("ADJ: 201 tareas sí se pueden generar", await gen.isDisabled(), false);
  await gen.click();
  const deploy = dlg.getByRole("button", { name: "Marcar como desplegado" });
  await deploy.waitFor({ timeout: 20000 });
  await sleep(300);
  L.eq("ADJ: «Marcar como desplegado» desactivado", await deploy.isDisabled(), true);
  L.eq("ADJ: con el motivo", (await dlg.getByRole("alert").innerText()).trim(), "Una release admite como mucho 200 tareas con adjuntos: quita alguna de la selección.");
  L.eq("ADJ: la descarga de adjuntos, también", await dlg.getByRole("button", { name: /Descargar adjuntos \(201\)/ }).isDisabled(), true);
  await page.screenshot({ path: `${SHOTS}/bh51c-adjuntos-201.png` });
  // Volver y quitar una: con 200, se puede desplegar.
  await dlg.getByRole("button", { name: "Cambiar tareas" }).click();
  await dlg.getByRole("checkbox").first().waitFor();
  await dlg.getByRole("checkbox").first().uncheck();
  await gen.click();
  await deploy.waitFor({ timeout: 20000 });
  await sleep(300);
  L.eq("ADJ: con 200, «Marcar como desplegado» disponible", await deploy.isDisabled(), false);
  L.eq("ADJ: y sin aviso", await dlg.getByRole("alert").count(), 0);
  await page.keyboard.press("Escape");
  L.assertNoErrors("ADJ", [s]);
  await s.ctx.close();
}

// --- «+» flotante con el programa lleno ------------------------------------------------------------------------------------
if (only.includes("flotante")) {
  L.scenario("flotante: con «Programa del curso» a 100 sesiones, el «+» flotante del móvil no abre «Nueva tarea» y dice por qué");
  await seed([["bh51c_prog", "Programa", "PROGRAM"], ["bh51c_o", "Otra", "NONE"]]);
  await addTasks("bh51c_prog", 100, "Sesión");
  const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = s;
  await openBoard(page, "Programa");
  const fab = page.getByRole("button", { name: "Nueva tarea o captura" });
  const header = L.colLoc(page, "Programa").getByRole("button", { name: "Añadir tarea en Programa" });
  const newTask = page.locator("[role=dialog]").filter({ hasText: "Nueva tarea" });
  L.eq("FAB: el «+» de la cabecera, desactivado", await header.isDisabled(), true);
  L.eq("FAB: el flotante se anuncia desactivado", await fab.getAttribute("aria-disabled"), "true");
  L.eq("FAB: con el mismo motivo que el de la cabecera", await fab.getAttribute("title"), await header.getAttribute("title"));
  await page.screenshot({ path: `${SHOTS}/bh51c-flotante-lleno.png` });
  // aria-disabled (y no disabled): sigue respondiendo al toque para decir por qué. Playwright no toca lo que se anuncia
  // desactivado si no se le fuerza.
  await fab.tap({ force: true });
  L.check("FAB: tocarlo dice por qué", await toastWith(page, "La columna «Programa» admite como mucho 100 sesiones."));
  await sleep(500);
  L.eq("FAB: y no abre «Nueva tarea»", await newTask.count(), 0);
  // En otra columna, el «+» vuelve a abrir «Nueva tarea» en ella.
  await page.getByRole("button", { name: /^Otra/ }).first().tap();
  await sleep(500);
  L.eq("FAB: en «Otra» no está desactivado", await fab.getAttribute("aria-disabled"), null);
  await fab.tap();
  await newTask.first().waitFor({ timeout: 10000 });
  L.eq("FAB: abre «Nueva tarea» en «Otra»", await newTask.first().locator("select").first().evaluate((el) => el.selectedOptions[0]?.textContent?.trim()), "Otra");
  await page.keyboard.press("Escape");
  await newTask.first().waitFor({ state: "detached" });
  // Al bajar del tope (otra persona archiva una sesión), el «+» del programa vuelve a funcionar.
  await page.getByRole("button", { name: /^Programa/ }).first().tap();
  await sleep(400);
  await L.q(`UPDATE "Task" SET "archivedAt"=NOW() WHERE id='bh51c_prog_t_100'`);
  await page.reload();
  await L.colLoc(page, "Programa").waitFor({ state: "attached", timeout: 20000 });
  await sleep(800);
  L.eq("FAB: con 99 sesiones, ya no está desactivado", await fab.getAttribute("aria-disabled"), null);
  await fab.tap();
  await newTask.first().waitFor({ timeout: 10000 });
  L.check("FAB: y abre «Nueva tarea»", (await newTask.count()) > 0);
  await page.keyboard.press("Escape");
  L.assertNoErrors("FAB", [s]);
  await s.ctx.close();
}

// --- Panel de fijas y botones flotantes en el móvil -------------------------------------------------------------------------
if (only.includes("panel")) {
  L.scenario("panel: el «+» flotante (ni «Crear varias tareas») ya no tapa la barra «Siempre en la release» / «… en el plan»");
  await seed([["bh51c_r", "Salto", "NEXT_RELEASE"], ["bh51c_plan", "Plan", "AI_PLAN"], ["bh51c_o", "Otra", "NONE"]]);
  for (const c of ["bh51c_r", "bh51c_plan", "bh51c_o"]) await addTasks(c, 30, "Tarea");
  for (const c of ["bh51c_r", "bh51c_plan"]) await addTasks(c, 2, "Fija", { fixed: true, from: 100 });
  const box = async (loc) => {
    const b = await loc.boundingBox();
    return b && { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  };
  for (const [width, label] of [[390, "390"], [360, "360"]]) {
    const s = await L.session({ viewport: { width, height: 844 }, mobile: true });
    const { page } = s;
    await openBoard(page, "Salto");
    const fab = await box(page.getByRole("button", { name: "Nueva tarea o captura" }));
    const bulk = await box(page.getByRole("button", { name: "Crear varias tareas" }));
    for (const [col, text] of [["Salto", "Siempre en la release"], ["Plan", "Siempre en el plan"]]) {
      if (col !== "Salto") {
        await page.getByRole("button", { name: new RegExp(`^${col}`) }).first().tap();
        await sleep(500);
      }
      const column = L.colLoc(page, col);
      const toggle = column.locator("button[aria-controls^=evergreen]");
      const bar = await box(toggle);
      L.eq(`PANEL ${label}: la barra de «${col}» dice «${text} 2»`, (await toggle.innerText()).replace(/\s+/g, " ").trim(), `${text} 2`);
      L.check(`PANEL ${label}: el «+» flotante no tapa la barra de «${col}»`, !overlap(bar, fab), JSON.stringify({ bar, fab }));
      L.check(`PANEL ${label}: «Crear varias tareas» tampoco`, !overlap(bar, bulk), JSON.stringify({ bar, bulk }));
      L.check(`PANEL ${label}: la columna «${col}» acaba por encima del «+»`, (await box(column)).y + (await box(column)).height <= fab.y, JSON.stringify({ column: await box(column), fab }));
      // Desplegado: las filas y «Añadir» quedan fuera de los dos botones.
      await toggle.tap();
      await column.locator("[id^=evergreen-] [role=button]").first().waitFor();
      await sleep(300);
      const rows = [...(await column.locator("[id^=evergreen-] [role=button]").all()), column.getByRole("button", { name: "Añadir", exact: true })];
      const covered = [];
      for (const r of rows) {
        const b = await box(r);
        if (overlap(b, fab) || overlap(b, bulk)) covered.push(b);
      }
      L.eq(`PANEL ${label}: desplegado, ni las fijas ni «Añadir» de «${col}» quedan debajo de los botones`, covered, []);
      if (col === "Salto" && width === 390) await page.screenshot({ path: `${SHOTS}/bh51c-panel-abierto.png` });
      await toggle.tap();
      await sleep(300);
    }
    // Una columna sin panel sigue hasta abajo (su lista deja sitio a los botones con el relleno del final).
    await page.getByRole("button", { name: /^Otra/ }).first().tap();
    await sleep(500);
    const otra = await box(L.colLoc(page, "Otra"));
    L.check(`PANEL ${label}: «Otra» (sin panel) sigue llegando hasta abajo`, otra.y + otra.height > fab.y + fab.height, JSON.stringify({ otra, fab }));
    L.assertNoErrors(`PANEL ${label}`, [s]);
    await s.ctx.close();
  }
  // Tableta (varias columnas a la vez): las columnas con panel miden lo mismo que las demás y la barra ocupa todo el ancho.
  const s = await L.session({ viewport: { width: 820, height: 844 }, mobile: true });
  const { page } = s;
  await openBoard(page, "Salto");
  const [salto, otra] = [await box(L.colLoc(page, "Salto")), await box(L.colLoc(page, "Otra"))];
  L.eq("PANEL 820: «Salto» mide lo mismo que «Otra»", salto.height, otra.height);
  L.eq("PANEL 820: la barra ocupa todo el ancho de la columna", (await box(L.colLoc(page, "Salto").locator("button[aria-controls^=evergreen]"))).width, salto.width);
  L.assertNoErrors("PANEL 820", [s]);
  await s.ctx.close();
}

await L.q(`DELETE FROM "Project" WHERE id=$1`, [PID]);
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
