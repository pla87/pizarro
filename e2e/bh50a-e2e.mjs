// Caza de bugs 50a (selección arrastrada, aplicar plantilla y curso): en el paso 2 de «Cambiar a esta plantilla», un tipo
// general que la plantilla va a ocultar dice «Ocultar (la plantilla no lo usa)» y no «Conservar» (como el resumen, que
// dice «Se ocultará»), y uno oculto con tareas, «Conservar (volverá a verse)», en español y en inglés; y una tarea
// archivada de una columna que el cambio une a otra sale en «Archivadas» como de esa columna y vuelve a ella al
// recuperarla (antes: «columna borrada» y a la primera columna). Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh50a-e2e.mjs      # PART=paso2,en,archivada
import os from "node:os";
import * as L from "./qa/lib.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "paso2,en,archivada").split(",");

await L.prepareUsers();
// El límite de cambios de plantilla (5 por proyecto cada 10 minutos) cuenta en la memoria del servidor por id de
// proyecto: cada escenario usa un proyecto con un id nuevo, para poder repetir la suite seguida sin gastarlo.
const PID_PREFIX = "bh50a_project";
let PID = PID_PREFIX;
let seeds = 0;
const NAME = "Zeta bh50a";
const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);

/**
 * Proyecto privado: «Pendiente», «Revisión» (con una archivada), «Hecho» y «Vacía»; un tipo propio; «Corrección» visible
 * sin tareas y «Respuesta» oculta con una tarea.
 */
async function seed() {
  await L.q(`DELETE FROM "Project" WHERE id LIKE $1`, [`${PID_PREFIX}%`]);
  PID = `${PID_PREFIX}_${Date.now().toString(36)}_${++seeds}`;
  const users = await L.q(`SELECT id FROM "User" WHERE email IN ($1,$2)`, [L.ADMIN, L.USER2]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,true,$3,999997,NOW())`, [PID, NAME, adm.id]);
  for (const u of users) await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [PID, u.id]);
  const cols = [["bh50a_pend", "Pendiente", false], ["bh50a_rev", "Revisión", false], ["bh50a_hecho", "Hecho", true], ["bh50a_vacia", "Vacía", false]];
  for (const [i, [id, name, done]] of cols.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,"isDone") VALUES ($1,$2,$3,$4,$5)`, [id, PID, name, (i + 1) * 1000, done]);
  await L.q(`INSERT INTO "TaskKind"(id,name,color,position,"projectId") VALUES ('bh50a_k','Tipo propio','#64748b',1000,$1)`, [PID]);
  await L.q(`INSERT INTO "ProjectHiddenKind"("projectId","kindId") VALUES ($1,'kind_respuesta')`, [PID]);
  const tasks = [
    ["bh50a_t1", "Uno bh50a", "bh50a_pend", "kind_funcionalidad"], ["bh50a_t2", "Dos bh50a", "bh50a_rev", "bh50a_k"],
    ["bh50a_t3", "Tres bh50a", "bh50a_hecho", "kind_respuesta"],
  ];
  for (const [i, [id, title, col, kind]] of tasks.entries()) {
    await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`, [id, PID, col, title, kind, (i + 1) * 1024, adm.id]);
  }
  await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"archivedAt","archivedFromColumnId","updatedAt") VALUES ('bh50a_arch',$1,'bh50a_rev','Archivada bh50a','kind_funcionalidad',99999,NOW(),'bh50a_rev',NOW())`, [PID]);
  await L.q(`DELETE FROM "ProjectTemplateChange" WHERE "projectId"=$1`, [PID]);
}

async function settings(page) {
  await page.goto(`${L.BASE}/p/${PID}/settings?tab=tablero`);
  await page.locator("[data-apply-template]").waitFor({ timeout: 15000 });
  await sleep(300);
}
/** Abre el asistente, elige la plantilla y «Cambiar a esta plantilla», y va al paso 2. */
async function toStep2(page, { open, template, mode, next }) {
  await page.getByRole("button", { name: open }).click();
  const dlg = page.getByRole("dialog").filter({ has: page.locator("[data-step]") }).first();
  await dlg.getByRole("radio", { name: template }).check();
  await dlg.getByRole("radio", { name: mode }).check();
  await dlg.getByRole("button", { name: next }).click();
  await dlg.locator("[data-step='2']").waitFor({ timeout: 10000 });
  return dlg;
}
const kindSelect = (dlg, name) => dlg.locator(`[data-match-kind="${name}"] select`);
const columnSelect = (dlg, name) => dlg.locator(`[data-match-column="${name}"] select`);
const selectedText = (loc) => loc.evaluate((el) => el.options[el.selectedIndex].text);

// --- Paso 2 coherente con el resumen ------------------------------------------------------------------------------------
if (only.includes("paso2")) {
  L.scenario("paso2: un tipo general que la plantilla oculta no dice «Conservar»");
  await seed();
  const s = await L.session();
  const { page } = s;
  await settings(page);
  const dlg = await toStep2(page, { open: "Aplicar plantilla…", template: /^Preparación de un curso/, mode: /^Cambiar a esta plantilla/, next: "Siguiente" });
  L.eq("PASO2: «Corrección» (general, sin tareas, la plantilla los oculta todos) dice que se ocultará", await selectedText(kindSelect(dlg, "Corrección")), "Ocultar (la plantilla no lo usa)");
  L.eq("PASO2: con su valor de siempre («keep»)", await kindSelect(dlg, "Corrección").inputValue(), "keep");
  L.eq("PASO2: «Respuesta» (oculta, con una tarea) dice que volverá a verse", await selectedText(kindSelect(dlg, "Respuesta")), "Conservar (volverá a verse)");
  L.eq("PASO2: «Funcionalidad» (con tareas) se conserva tal cual", await selectedText(kindSelect(dlg, "Funcionalidad")), "Conservar");
  L.eq("PASO2: el tipo propio, también", await selectedText(kindSelect(dlg, "Tipo propio")), "Conservar");
  await page.screenshot({ path: `${SHOTS}/bh50a-paso2.png` });
  // Las tareas de «Funcionalidad» pasan a «Sesión»: entonces también se oculta (lo dice el resumen), y su opción de
  // conservar sigue diciendo lo que pasaría si se conservara (tiene tareas: se queda visible).
  await kindSelect(dlg, "Funcionalidad").selectOption({ label: "Sesión" });
  L.eq("PASO2: «Conservar» de un tipo con tareas no cambia al elegir otro destino", await kindSelect(dlg, "Funcionalidad").locator("option[value=keep]").innerText(), "Conservar");
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  await dlg.locator("[data-step='3']").waitFor();
  const summary = await dlg.locator("[data-summary]").innerText();
  L.check("PASO2: el resumen oculta «Corrección» y «Funcionalidad»", /Se ocultarán 2 tipos generales\s*\n\s*Funcionalidad, Corrección/.test(summary), summary);
  L.check("PASO2: y vuelve a verse «Respuesta»", /Volverá a verse 1 tipo general\s*\n\s*Respuesta/.test(summary), summary);
  // Atrás: con «Conservar» en «Funcionalidad» solo se oculta «Corrección».
  await dlg.getByRole("button", { name: "Atrás" }).click();
  await kindSelect(dlg, "Funcionalidad").selectOption("keep");
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  const summary2 = await dlg.locator("[data-summary]").innerText();
  L.check("PASO2: con «Conservar», solo «Corrección»", /Se ocultará 1 tipo general\s*\n\s*Corrección/.test(summary2), summary2);
  await dlg.getByRole("button", { name: "Aplicar", exact: true }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  const hidden = (await L.q(`SELECT "kindId" FROM "ProjectHiddenKind" WHERE "projectId"=$1 ORDER BY "kindId"`, [PID])).map((r) => r.kindId);
  L.eq("PASO2: al aplicar, «Corrección» queda oculta y «Respuesta» visible", hidden, ["kind_correccion"]);
  L.assertNoErrors("PASO2", [s]);
  await s.ctx.close();
}

// --- En inglés, en modo oscuro y en el móvil ---------------------------------------------------------------------------
if (only.includes("en")) {
  L.scenario("en: lo mismo en inglés (390 px, modo oscuro)");
  await seed();
  await L.q(`UPDATE "User" SET locale='EN' WHERE id=$1`, [adm.id]);
  try {
    const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
    const { page } = s;
    await page.emulateMedia({ colorScheme: "dark" });
    await settings(page);
    const dlg = await toStep2(page, { open: "Apply template…", template: /^Course preparation/, mode: /^Switch to this template/, next: "Next" });
    L.eq("EN: «Bug fix» dice que se ocultará", await selectedText(kindSelect(dlg, "Bug fix")), "Hide (the template doesn't use it)");
    L.eq("EN: «Reply» dice que volverá a verse", await selectedText(kindSelect(dlg, "Reply")), "Keep (it will be shown again)");
    L.eq("EN: «Feature» se conserva", await selectedText(kindSelect(dlg, "Feature")), "Keep");
    L.check("EN: el paso 2 cabe en 390 px", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: `${SHOTS}/bh50a-paso2-en.png` });
    await dlg.getByRole("button", { name: "Next" }).click();
    const summary = await dlg.locator("[data-summary]").innerText();
    L.check("EN: el resumen dice lo mismo", /1 general type will be hidden\s*\n\s*Bug fix/.test(summary) && /1 general type will be shown again\s*\n\s*Reply/.test(summary), summary);
    L.assertNoErrors("EN", [s]);
    await s.ctx.close();
  } finally {
    await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [adm.id]);
  }
}

// --- Archivada de una columna que se une a otra ------------------------------------------------------------------------
if (only.includes("archivada")) {
  L.scenario("archivada: la archivada de una columna unida a otra vuelve a esa");
  await seed();
  const s = await L.session();
  const { page } = s;
  await settings(page);
  const dlg = await toStep2(page, { open: "Aplicar plantilla…", template: /^Preparación de un curso/, mode: /^Cambiar a esta plantilla/, next: "Siguiente" });
  // «Pendiente» y «Revisión» pasan a «Materiales» (la 2.ª de la plantilla): «Revisión», con la archivada, se une a
  // «Pendiente» y se quita; la primera columna pasa a ser «Ideas», nueva.
  await columnSelect(dlg, "Pendiente").selectOption({ label: "Materiales" });
  await columnSelect(dlg, "Revisión").selectOption({ label: "Materiales" });
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  await dlg.locator("[data-step='3']").waitFor();
  await dlg.getByRole("button", { name: "Aplicar", exact: true }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  L.eq("ARCH: «Revisión» se ha quitado", Number((await L.q(`SELECT count(*) n FROM "Column" WHERE id='bh50a_rev'`))[0].n), 0);
  await page.goto(`${L.BASE}/p/${PID}`);
  await L.colLoc(page, "Materiales").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Archivadas" }).first().click();
  const arch = page.getByRole("dialog").filter({ hasText: "Tareas archivadas" });
  await arch.getByText("Archivada bh50a").waitFor({ timeout: 10000 });
  const row = arch.locator("li").filter({ hasText: "Archivada bh50a" });
  L.check("ARCH: «Archivadas» dice de qué columna es (no «columna borrada»)", (await row.innerText()).includes("de «Materiales»"), await row.innerText());
  await row.getByRole("button", { name: "Recuperar" }).click();
  await L.waitFor(async () => (await L.q(`SELECT "archivedAt" FROM "Task" WHERE id='bh50a_arch'`))[0].archivedAt === null, { timeout: 10000 });
  L.eq("ARCH: al recuperarla vuelve a «Materiales» (no a «Ideas», la primera)", (await L.q(`SELECT c.name FROM "Task" t JOIN "Column" c ON c.id=t."columnId" WHERE t.id='bh50a_arch'`))[0].name, "Materiales");
  // El aviso sale cuando llega la respuesta, que puede ser un poco después de que la base ya lo tenga: se espera.
  L.check("ARCH: el aviso dice «Materiales»", await page.getByText("Tarea recuperada en «Materiales»").first().waitFor({ timeout: 5000 }).then(() => true, () => false));
  L.assertNoErrors("ARCH", [s]);
  await s.ctx.close();
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
