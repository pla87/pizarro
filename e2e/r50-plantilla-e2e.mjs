// «Aplicar plantilla» en Ajustes del proyecto → Tablero: «Añadir lo que falte» (resumen antes de aplicar, no toca lo que
// hay) y «Cambiar a esta plantilla» (emparejar columnas y tipos con la sugerencia puesta, resumen, aplicar); otra persona
// con el tablero abierto lo ve en vivo; «Deshacer el cambio de plantilla» lo deja como estaba; nada con tareas se borra;
// quien no gestiona el proyecto no ve la sección; en móvil el asistente cabe. Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r50-plantilla-e2e.mjs   # PART=add,replace,perm,mobile
import os from "node:os";
import * as L from "./qa/lib.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "add,replace,perm,mobile").split(",");

await L.prepareUsers();
const PID = "r50_tpl_project";
const NAME = "Zeta plantilla r50";

/** Proyecto privado de las dos personas de prueba: columnas, un tipo propio, etiquetas y tareas (una archivada). */
async function seed() {
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [PID]);
  const users = await L.q(`SELECT id FROM "User" WHERE email IN ($1,$2)`, [L.ADMIN, L.USER2]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,true,$3,999999,NOW())`, [PID, NAME, users[0].id]);
  for (const u of users) await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [PID, u.id]);
  const cols = [["r50c_pend", "Pendiente", false], ["r50c_curso", "En curso", false], ["r50c_hecho", "Hecho", true], ["r50c_vacia", "Vacía", false]];
  for (const [i, [id, name, done]] of cols.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,"isDone") VALUES ($1,$2,$3,$4,$5)`, [id, PID, name, (i + 1) * 1000, done]);
  await L.q(`INSERT INTO "TaskKind"(id,name,color,position,"projectId") VALUES ('r50k_viejo','Viejo tipo','#64748b',1000,$1)`, [PID]);
  await L.q(`INSERT INTO "Label"(id,"projectId",name,color) VALUES ('r50l_usada',$1,'Usada','#ef4444'),('r50l_suelta',$1,'Suelta','#0ea5e9')`, [PID]);
  const tasks = [
    ["r50t_1", "Uno r50", "r50c_pend", "kind_funcionalidad"], ["r50t_2", "Dos r50", "r50c_pend", "r50k_viejo"], ["r50t_3", "Tres r50", "r50c_pend", "kind_funcionalidad"],
    ["r50t_4", "Cuatro r50", "r50c_curso", "r50k_viejo"], ["r50t_5", "Cinco r50", "r50c_curso", "kind_funcionalidad"],
    ["r50t_6", "Seis r50", "r50c_hecho", "kind_funcionalidad"], ["r50t_7", "Siete r50", "r50c_hecho", "kind_funcionalidad"],
  ];
  for (const [i, [id, title, col, kind]] of tasks.entries()) {
    await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`, [id, PID, col, title, kind, (i + 1) * 1024, users[0].id]);
  }
  await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"archivedAt","updatedAt") VALUES ('r50t_8',$1,'r50c_curso','Archivada r50','kind_funcionalidad',99999,NOW(),NOW())`, [PID]);
  await L.q(`INSERT INTO "TaskLabel"("taskId","labelId") VALUES ('r50t_1','r50l_usada')`);
  await L.q(`DELETE FROM "ProjectTemplateChange" WHERE "projectId"=$1`, [PID]);
}

/** Estado comparable del proyecto: columnas (id, nombre, rol, orden), tareas (columna, posición, tipo), tipos, etiquetas. */
async function snapshot() {
  return {
    columns: await L.q(`SELECT id,name,role,"isDone" FROM "Column" WHERE "projectId"=$1 ORDER BY position`, [PID]),
    tasks: await L.q(`SELECT id,"columnId",position,"kindId" FROM "Task" WHERE "projectId"=$1 ORDER BY id`, [PID]),
    kinds: (await L.q(`SELECT name FROM "TaskKind" WHERE "projectId"=$1 ORDER BY position`, [PID])).map((r) => r.name),
    labels: (await L.q(`SELECT name FROM "Label" WHERE "projectId"=$1 ORDER BY name`, [PID])).map((r) => r.name),
    hidden: (await L.q(`SELECT "kindId" FROM "ProjectHiddenKind" WHERE "projectId"=$1 ORDER BY "kindId"`, [PID])).map((r) => r.kindId),
  };
}
const columnNames = async () => (await L.q(`SELECT name FROM "Column" WHERE "projectId"=$1 ORDER BY position`, [PID])).map((r) => r.name);
const taskCount = async () => Number((await L.q(`SELECT count(*) n FROM "Task" WHERE "projectId"=$1`, [PID]))[0].n);

const settings = async (page) => {
  await page.goto(`${L.BASE}/p/${PID}/settings?tab=tablero`);
  await page.locator("[data-apply-template]").waitFor({ timeout: 15000 });
  await sleep(300);
};
const wizard = (page) => page.getByRole("dialog").filter({ hasText: "Aplicar plantilla" }).first();
async function openWizard(page, template, mode) {
  await page.getByRole("button", { name: "Aplicar plantilla…" }).click();
  const dlg = wizard(page);
  await dlg.getByRole("radio", { name: new RegExp(`^${template}`) }).check();
  await dlg.getByRole("radio", { name: new RegExp(`^${mode}`) }).check();
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  return dlg;
}
const summaryText = (dlg) => dlg.locator("[data-summary]").innerText();
/** Sin desbordamiento horizontal (la página o el diálogo más anchos que la pantalla). */
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function undoFromSettings(page) {
  await page.getByRole("button", { name: "Deshacer el cambio de plantilla" }).click();
  await page.getByRole("dialog").filter({ hasText: "Deshacer el cambio de plantilla" }).last().getByRole("button", { name: "Deshacer", exact: true }).click();
}

// --- Añadir lo que falte ----------------------------------------------------------------------------------------------
if (only.includes("add")) {
  L.scenario("add: «Añadir lo que falte» enseña lo que se añadirá, no toca lo que hay y se deshace");
  await seed();
  const before = await snapshot();
  const s = await L.session();
  const { page } = s;
  await settings(page);
  L.check("ADD: la sección «Aplicar plantilla» está en la pestaña Tablero", await page.getByRole("heading", { name: "Aplicar plantilla" }).isVisible());
  const dlg = await openWizard(page, "Familia y casa", "Añadir lo que falte");
  await dlg.locator("[data-step='3']").waitFor({ timeout: 10000 });
  const text = await summaryText(dlg);
  L.check("ADD: el resumen dice qué columnas se añadirán (Hecho ya está)", /Se añadirán 4 columnas/.test(text) && /Por hacer, Compras, Citas, Rutinas de la semana/.test(text), text);
  L.check("ADD: y los tipos y la etiqueta que faltan", /Se añadirán 3 tipos de tarea/.test(text) && /Se añadirá 1 etiqueta/.test(text), text);
  L.check("ADD: avisa de que se podrá deshacer", (await dlg.innerText()).includes("Deshacer el cambio de plantilla"));
  await page.screenshot({ path: `${SHOTS}/r50-plantilla-add.png` });
  await dlg.getByRole("button", { name: "Aplicar", exact: true }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  const after = await snapshot();
  L.eq("ADD: las columnas de antes siguen igual y las nuevas van al final", after.columns.slice(0, 4), before.columns);
  L.eq("ADD: columnas nuevas", after.columns.slice(4).map((c) => c.name), ["Por hacer", "Compras", "Citas", "Rutinas de la semana"]);
  L.eq("ADD: ninguna tarea cambia", after.tasks, before.tasks);
  L.eq("ADD: no se oculta ningún tipo general", after.hidden, before.hidden);
  L.eq("ADD: etiquetas (la suelta sigue)", after.labels, ["Suelta", "Urgente", "Usada"]);
  await page.locator("[data-template-undo]").waitFor({ timeout: 10000 });
  L.check("ADD: aparece «Deshacer el cambio de plantilla»", await page.getByRole("button", { name: "Deshacer el cambio de plantilla" }).isVisible());
  await undoFromSettings(page);
  await L.eqEventually("ADD: deshacer lo deja como estaba", snapshot, before, { timeout: 10000 });
  await page.locator("[data-template-undo]").waitFor({ state: "detached", timeout: 10000 });
  L.assertNoErrors("ADD", [s]);
  await s.ctx.close();
}

// --- Cambiar de plantilla -----------------------------------------------------------------------------------------------
if (only.includes("replace")) {
  L.scenario("replace: emparejar, resumen, aplicar (en vivo para otra persona) y deshacer");
  await seed();
  const before = await snapshot();
  const total = await taskCount();
  // Otra persona con el tablero del proyecto abierto.
  const other = await L.session({ email: L.USER2 });
  await other.page.goto(`${L.BASE}/p/${PID}`);
  await L.colLoc(other.page, "Pendiente").waitFor({ timeout: 15000 });
  await L.liveOpen(other.page);

  const s = await L.session();
  const { page } = s;
  await settings(page);
  const dlg = await openWizard(page, "Equipo de software", "Cambiar a esta plantilla");
  await dlg.locator("[data-step='2']").waitFor({ timeout: 10000 });
  const sel = (attr, name) => dlg.locator(`[${attr}="${name}"] select`);
  const label = (loc) => loc.evaluate((el) => el.options[el.selectedIndex].text);
  L.eq("REPLACE: «En curso» se empareja con «En curso» por el nombre", await label(sel("data-match-column", "En curso")), "En curso");
  L.eq("REPLACE: «Hecho» con «Hecho» (rol En producción)", (await label(sel("data-match-column", "Hecho"))).startsWith("Hecho"), true);
  L.eq("REPLACE: «Pendiente» (con tareas, sin pareja) se conserva", await sel("data-match-column", "Pendiente").inputValue(), "keep");
  L.eq("REPLACE: «Vacía» se propone quitar", await sel("data-match-column", "Vacía").inputValue(), "drop");
  L.eq("REPLACE: «Viejo tipo» (con tareas) se conserva", await sel("data-match-kind", "Viejo tipo").inputValue(), "keep");
  // Las tareas de «Pendiente» pasan a «En curso» y las de «Viejo tipo», a «Mejora».
  await sel("data-match-column", "Pendiente").selectOption({ label: "En curso" });
  await sel("data-match-kind", "Viejo tipo").selectOption({ label: "Mejora" });
  // Pedir que se quite una columna con tareas no se ofrece.
  L.eq("REPLACE: una columna con tareas no tiene «Quitar»", await sel("data-match-column", "Hecho").locator("option[value=drop]").count(), 0);
  await page.screenshot({ path: `${SHOTS}/r50-plantilla-match.png` });
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  await dlg.locator("[data-step='3']").waitFor();
  const text = await summaryText(dlg);
  L.check("REPLACE: el resumen cuenta las tareas que se mueven", /Se moverán 3 tareas a otra columna/.test(text), text);
  L.check("REPLACE: las columnas que se añaden", /Se añadirán 4 columnas/.test(text) && /Ideas, Por hacer, Revisión, Siguiente release/.test(text), text);
  L.check("REPLACE: las que se quitan por quedar vacías", /Se quitarán 2 columnas que se quedan vacías/.test(text) && /Pendiente, Vacía/.test(text), text);
  L.check("REPLACE: tipos y etiquetas", /Cambiarán de tipo 2 tareas/.test(text) && /Se quitará 1 tipo propio/.test(text) && /Se quitará 1 etiqueta sin uso/.test(text), text);
  await page.screenshot({ path: `${SHOTS}/r50-plantilla-summary.png` });
  await dlg.getByRole("button", { name: "Aplicar", exact: true }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });

  L.eq("REPLACE: columnas en el orden de la plantilla", await columnNames(), ["Ideas", "Por hacer", "En curso", "Revisión", "Siguiente release", "Hecho"]);
  L.eq("REPLACE: no se pierde ninguna tarea", await taskCount(), total);
  const cols = await L.q(`SELECT c.name, count(t.id)::int n FROM "Column" c LEFT JOIN "Task" t ON t."columnId"=c.id WHERE c."projectId"=$1 GROUP BY c.name, c.position ORDER BY c.position`, [PID]);
  L.eq("REPLACE: «En curso» (la misma columna) tiene sus tareas, la archivada y las de «Pendiente»", cols.find((c) => c.name === "En curso").n, 6);
  L.eq("REPLACE: «Hecho» tiene ahora el rol de la plantilla", (await L.q(`SELECT role FROM "Column" WHERE id='r50c_hecho'`))[0].role, "IN_PRODUCTION");
  L.eq("REPLACE: tipos propios", (await snapshot()).kinds, ["Mejora"]);
  L.eq("REPLACE: etiquetas (la usada se queda, la suelta se va)", (await snapshot()).labels, ["Bloqueado", "Urgente", "Usada"]);
  // La otra persona lo ve sin recargar.
  await L.colLoc(other.page, "Siguiente release").waitFor({ timeout: 15000 }).then(() => L.check("REPLACE: la otra persona ve las columnas nuevas en vivo", true), (e) => L.check("REPLACE: la otra persona ve las columnas nuevas en vivo", false, String(e).slice(0, 200)));
  L.check("REPLACE: y ya no ve «Pendiente»", await L.waitFor(async () => (await other.page.locator('[aria-label="Pendiente"]').count()) === 0));
  await other.page.screenshot({ path: `${SHOTS}/r50-plantilla-live.png` });

  // Deshacer.
  await page.locator("[data-template-undo]").waitFor({ timeout: 10000 });
  await undoFromSettings(page);
  await L.eqEventually("REPLACE: deshacer devuelve columnas, tareas, tipos y etiquetas", snapshot, before, { timeout: 10000 });
  await L.colLoc(other.page, "Pendiente").waitFor({ timeout: 15000 }).then(() => L.check("REPLACE: la otra persona ve el deshacer en vivo", true), () => L.check("REPLACE: la otra persona ve el deshacer en vivo", false));
  L.assertNoErrors("REPLACE", [s, other]);
  await s.ctx.close();
  await other.ctx.close();
}

// --- Permisos -----------------------------------------------------------------------------------------------------------
if (only.includes("perm")) {
  L.scenario("perm: en un proyecto de equipo, un miembro sin rol de admin no ve «Aplicar plantilla»");
  const p = await L.project();
  const s = await L.session({ email: L.USER2 });
  await s.page.goto(`${L.BASE}/p/${p.id}/settings?tab=tablero`);
  await s.page.getByRole("heading", { name: "Etiquetas" }).waitFor({ timeout: 15000 });
  L.eq("PERM: no hay sección «Aplicar plantilla»", await s.page.locator("[data-apply-template]").count(), 0);
  L.assertNoErrors("PERM", [s]);
  await s.ctx.close();
}

// --- Móvil --------------------------------------------------------------------------------------------------------------
if (only.includes("mobile")) {
  L.scenario("mobile: el asistente cabe en 390 px");
  await seed();
  const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = s;
  await settings(page);
  const dlg = await openWizard(page, "Empresa y clientes", "Cambiar a esta plantilla");
  await dlg.locator("[data-step='2']").waitFor({ timeout: 10000 });
  L.check("MOBILE: paso 2 sin desbordamiento horizontal", await fits(page));
  const box = await dlg.locator("[data-match-column='Pendiente'] select").boundingBox();
  L.check("MOBILE: los desplegables caben en la pantalla", box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  await page.screenshot({ path: `${SHOTS}/r50-plantilla-mobile.png` });
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  await dlg.locator("[data-step='3']").waitFor();
  L.check("MOBILE: resumen sin desbordamiento", await fits(page));
  await page.keyboard.press("Escape");
  L.assertNoErrors("MOBILE", [s]);
  await s.ctx.close();
}

// El proyecto de la suite no se queda en la base (las demás suites usan el primero).
await L.q(`DELETE FROM "Project" WHERE id=$1`, [PID]);
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
