// «Aplicar plantilla» en Ajustes del proyecto → Tablero, en tres tandas (antes tres suites; juntas, un solo servidor):
//
// - Ronda 50 (add, replace, perm, mobile): «Añadir lo que falte» (resumen antes de aplicar, no toca lo que hay) y
//   «Cambiar a esta plantilla» (emparejar columnas y tipos con la sugerencia puesta, resumen, aplicar); otra persona con
//   el tablero abierto lo ve en vivo; «Deshacer el cambio de plantilla» lo deja como estaba; nada con tareas se borra;
//   quien no gestiona el proyecto no ve la sección; en móvil el asistente cabe.
// - Ronda 51 (estilo, fijas, generales, limite): la plantilla elegida en el paso 1 se lee en claro y en oscuro (contraste
//   del nombre sobre su fondo, también en las de serie y en las demás tarjetas de opción de la app); el resumen de
//   «Cambiar a esta plantilla» dice qué tareas fijas pasan a normales; «Añadir lo que falte» vuelve a mostrar los tipos
//   generales ocultos que usa la plantilla (y el deshacer los oculta); y el límite de cambios por proyecto avisa con un
//   mensaje claro.
// - Caza de bugs 50a (paso2, en, archivada): en el paso 2 de «Cambiar a esta plantilla», un tipo general que la plantilla
//   va a ocultar dice «Ocultar (la plantilla no lo usa)» y no «Conservar» (como el resumen, que dice «Se ocultará»), y uno
//   oculto con tareas, «Conservar (volverá a verse)», en español y en inglés; y una tarea archivada de una columna que el
//   cambio une a otra sale en «Archivadas» como de esa columna y vuelve a ella al recuperarla (antes: «columna borrada» y
//   a la primera columna).
//
// Límite de «Aplicar plantilla» (en la memoria del servidor): 5 cambios (aplicar o deshacer) por proyecto cada 10 minutos
// y 20 por persona y hora. Cada escenario usa un proyecto con un id nuevo, así que la suite se puede repetir seguida con el
// mismo servidor; el administrador gasta 8 cambios por pasada (add 2, replace 2, generales 2, paso2 1, archivada 1) y la
// segunda persona, 5 (limite): dos pasadas por hora caben. Misma base y servidor que tablero-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node plantillas-aplicar-e2e.mjs
//   # PART=add,replace,perm,mobile,estilo,fijas,generales,limite,paso2,en,archivada
import os from "node:os";
import * as L from "./qa/lib.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const PARTS = ["add", "replace", "perm", "mobile", "estilo", "fijas", "generales", "limite", "paso2", "en", "archivada"];
const only = (process.env.PART || PARTS.join(",")).split(",");
const unknown = only.filter((p) => !PARTS.includes(p));
if (unknown.length) throw new Error(`PART desconocida: ${unknown.join(",")} (son ${PARTS.join(",")})`);

await L.prepareUsers();
const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const [usr2] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.USER2]);
// Prefijos de los proyectos de la suite: se borran al empezar cada escenario que los usa y al terminar.
const PREFIXES = ["r50_tpl_project", "r51_tpl_", "bh50a_project"];
const RUN = Date.now().toString(36);
let seeds = 0;
/** Id nuevo de proyecto (el límite por proyecto cuenta por id: así una pasada no gasta el de la siguiente). */
const freshId = (prefix) => `${prefix}_${RUN}_${++seeds}`;

// --- Comunes ------------------------------------------------------------------------------------------------------------
async function settings(page, id) {
  await page.goto(`${L.BASE}/p/${id}/settings?tab=tablero`);
  await page.locator("[data-apply-template]").waitFor({ timeout: 15000 });
  await sleep(300);
}
const wizard = (page) => page.getByRole("dialog").filter({ has: page.locator("[data-step]") }).first();
async function openWizard(page, template, mode) {
  await page.getByRole("button", { name: "Aplicar plantilla…" }).click();
  const dlg = wizard(page);
  await dlg.getByRole("radio", { name: new RegExp(`^${template}`) }).check();
  await dlg.getByRole("radio", { name: new RegExp(`^${mode}`) }).check();
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  return dlg;
}
/** Abre el asistente, elige la plantilla y el modo, y va al paso 2 (con los textos dados: también en inglés). */
async function toStep2(page, { open, template, mode, next }) {
  await page.getByRole("button", { name: open }).click();
  const dlg = wizard(page);
  await dlg.getByRole("radio", { name: template }).check();
  await dlg.getByRole("radio", { name: mode }).check();
  await dlg.getByRole("button", { name: next }).click();
  await dlg.locator("[data-step='2']").waitFor({ timeout: 10000 });
  return dlg;
}
const summaryText = (dlg) => dlg.locator("[data-summary]").innerText();
const kindSelect = (dlg, name) => dlg.locator(`[data-match-kind="${name}"] select`);
const columnSelect = (dlg, name) => dlg.locator(`[data-match-column="${name}"] select`);
const selectedText = (loc) => loc.evaluate((el) => el.options[el.selectedIndex].text);
/** Sin desbordamiento horizontal (la página o el diálogo más anchos que la pantalla). */
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function undoFromSettings(page) {
  await page.getByRole("button", { name: "Deshacer el cambio de plantilla" }).click();
  await page.getByRole("dialog").filter({ hasText: "Deshacer el cambio de plantilla" }).last().getByRole("button", { name: "Deshacer", exact: true }).click();
}
const hiddenKinds = async (id) => (await L.q(`SELECT "kindId" FROM "ProjectHiddenKind" WHERE "projectId"=$1 ORDER BY "kindId"`, [id])).map((r) => r.kindId);

// --- Ronda 50: proyecto, estado y escenarios -----------------------------------------------------------------------------
const R50_PREFIX = "r50_tpl_project";
let R50 = R50_PREFIX;

/** Proyecto privado de las dos personas de prueba: columnas, un tipo propio, etiquetas y tareas (una archivada). */
async function seedR50() {
  await L.q(`DELETE FROM "Project" WHERE id LIKE $1`, [`${R50_PREFIX}%`]);
  R50 = freshId(R50_PREFIX);
  const users = await L.q(`SELECT id FROM "User" WHERE email IN ($1,$2)`, [L.ADMIN, L.USER2]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,true,$3,999999,NOW())`, [R50, "Zeta plantilla r50", adm.id]);
  for (const u of users) await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [R50, u.id]);
  const cols = [["r50c_pend", "Pendiente", false], ["r50c_curso", "En curso", false], ["r50c_hecho", "Hecho", true], ["r50c_vacia", "Vacía", false]];
  for (const [i, [id, name, done]] of cols.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,"isDone") VALUES ($1,$2,$3,$4,$5)`, [id, R50, name, (i + 1) * 1000, done]);
  await L.q(`INSERT INTO "TaskKind"(id,name,color,position,"projectId") VALUES ('r50k_viejo','Viejo tipo','#64748b',1000,$1)`, [R50]);
  await L.q(`INSERT INTO "Label"(id,"projectId",name,color) VALUES ('r50l_usada',$1,'Usada','#ef4444'),('r50l_suelta',$1,'Suelta','#0ea5e9')`, [R50]);
  const tasks = [
    ["r50t_1", "Uno r50", "r50c_pend", "kind_funcionalidad"], ["r50t_2", "Dos r50", "r50c_pend", "r50k_viejo"], ["r50t_3", "Tres r50", "r50c_pend", "kind_funcionalidad"],
    ["r50t_4", "Cuatro r50", "r50c_curso", "r50k_viejo"], ["r50t_5", "Cinco r50", "r50c_curso", "kind_funcionalidad"],
    ["r50t_6", "Seis r50", "r50c_hecho", "kind_funcionalidad"], ["r50t_7", "Siete r50", "r50c_hecho", "kind_funcionalidad"],
  ];
  for (const [i, [id, title, col, kind]] of tasks.entries()) {
    await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`, [id, R50, col, title, kind, (i + 1) * 1024, adm.id]);
  }
  await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"archivedAt","updatedAt") VALUES ('r50t_8',$1,'r50c_curso','Archivada r50','kind_funcionalidad',99999,NOW(),NOW())`, [R50]);
  await L.q(`INSERT INTO "TaskLabel"("taskId","labelId") VALUES ('r50t_1','r50l_usada')`);
  await L.q(`DELETE FROM "ProjectTemplateChange" WHERE "projectId"=$1`, [R50]);
}

/** Estado comparable del proyecto: columnas (id, nombre, rol, orden), tareas (columna, posición, tipo), tipos, etiquetas. */
async function snapshot() {
  return {
    columns: await L.q(`SELECT id,name,role,"isDone" FROM "Column" WHERE "projectId"=$1 ORDER BY position`, [R50]),
    tasks: await L.q(`SELECT id,"columnId",position,"kindId" FROM "Task" WHERE "projectId"=$1 ORDER BY id`, [R50]),
    kinds: (await L.q(`SELECT name FROM "TaskKind" WHERE "projectId"=$1 ORDER BY position`, [R50])).map((r) => r.name),
    labels: (await L.q(`SELECT name FROM "Label" WHERE "projectId"=$1 ORDER BY name`, [R50])).map((r) => r.name),
    hidden: await hiddenKinds(R50),
  };
}
const columnNames = async () => (await L.q(`SELECT name FROM "Column" WHERE "projectId"=$1 ORDER BY position`, [R50])).map((r) => r.name);
const taskCount = async () => Number((await L.q(`SELECT count(*) n FROM "Task" WHERE "projectId"=$1`, [R50]))[0].n);

// --- Añadir lo que falte ----------------------------------------------------------------------------------------------
if (only.includes("add")) {
  L.scenario("add: «Añadir lo que falte» enseña lo que se añadirá, no toca lo que hay y se deshace");
  await seedR50();
  const before = await snapshot();
  const s = await L.session();
  const { page } = s;
  await settings(page, R50);
  L.check("ADD: la sección «Aplicar plantilla» está en la pestaña Tablero", await page.getByRole("heading", { name: "Aplicar plantilla" }).isVisible());
  const dlg = await openWizard(page, "Casa y familia", "Añadir lo que falte");
  await dlg.locator("[data-step='3']").waitFor({ timeout: 10000 });
  const text = await summaryText(dlg);
  L.check("ADD: el resumen dice qué columnas se añadirán (Hecho ya está)", /Se añadirán 6 columnas/.test(text) && /Por hacer, Esta semana, Esperando, Lista de la compra, Citas, Rutinas/.test(text), text);
  L.check("ADD: y los tipos y las etiquetas que faltan", /Se añadirán 6 tipos de tarea/.test(text) && /Se añadirán 4 etiquetas/.test(text), text);
  L.check("ADD: avisa de que se podrá deshacer", (await dlg.innerText()).includes("Deshacer el cambio de plantilla"));
  await page.screenshot({ path: `${SHOTS}/r50-plantilla-add.png` });
  await dlg.getByRole("button", { name: "Aplicar", exact: true }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  const after = await snapshot();
  L.eq("ADD: las columnas de antes siguen igual y las nuevas van al final", after.columns.slice(0, 4), before.columns);
  L.eq("ADD: columnas nuevas", after.columns.slice(4).map((c) => c.name), ["Por hacer", "Esta semana", "Esperando", "Lista de la compra", "Citas", "Rutinas"]);
  L.eq("ADD: ninguna tarea cambia", after.tasks, before.tasks);
  L.eq("ADD: no se oculta ningún tipo general", after.hidden, before.hidden);
  L.eq("ADD: etiquetas (la suelta sigue)", after.labels, ["Persona 1", "Persona 2", "Suelta", "Toda la familia", "Urgente", "Usada"]);
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
  await seedR50();
  const before = await snapshot();
  const total = await taskCount();
  // Otra persona con el tablero del proyecto abierto.
  const other = await L.session({ email: L.USER2 });
  await other.page.goto(`${L.BASE}/p/${R50}`);
  await L.colLoc(other.page, "Pendiente").waitFor({ timeout: 15000 });
  await L.liveOpen(other.page);

  const s = await L.session();
  const { page } = s;
  await settings(page, R50);
  const dlg = await openWizard(page, "Trabajo y clientes", "Cambiar a esta plantilla");
  await dlg.locator("[data-step='2']").waitFor({ timeout: 10000 });
  L.eq("REPLACE: «En curso» se empareja con «En curso» por el nombre", await selectedText(columnSelect(dlg, "En curso")), "En curso");
  L.eq("REPLACE: «Hecho» con «Hecho»", (await selectedText(columnSelect(dlg, "Hecho"))).startsWith("Hecho"), true);
  L.eq("REPLACE: «Pendiente» con «Pendiente» por el nombre", await selectedText(columnSelect(dlg, "Pendiente")), "Pendiente");
  L.eq("REPLACE: «Vacía» se propone quitar", await columnSelect(dlg, "Vacía").inputValue(), "drop");
  L.eq("REPLACE: «Viejo tipo» (con tareas) se conserva", await kindSelect(dlg, "Viejo tipo").inputValue(), "keep");
  // Las tareas de «Pendiente» pasan a «En curso» y las de «Viejo tipo», a «Encargo».
  await columnSelect(dlg, "Pendiente").selectOption({ label: "En curso" });
  await kindSelect(dlg, "Viejo tipo").selectOption({ label: "Encargo" });
  // Pedir que se quite una columna con tareas no se ofrece.
  L.eq("REPLACE: una columna con tareas no tiene «Quitar»", await columnSelect(dlg, "Hecho").locator("option[value=drop]").count(), 0);
  await page.screenshot({ path: `${SHOTS}/r50-plantilla-match.png` });
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  await dlg.locator("[data-step='3']").waitFor();
  const text = await summaryText(dlg);
  L.check("REPLACE: el resumen cuenta las tareas que se mueven", /Se moverán 3 tareas a otra columna/.test(text), text);
  L.check("REPLACE: las columnas que se añaden", /Se añadirán 4 columnas/.test(text) && /Pendiente, Esperando, Revisión, Tareas periódicas/.test(text), text);
  L.check("REPLACE: las que se quitan por quedar vacías", /Se quitarán 2 columnas que se quedan vacías/.test(text) && /Pendiente, Vacía/.test(text), text);
  L.check("REPLACE: tipos y etiquetas", /Cambiarán de tipo 2 tareas/.test(text) && /Se quitará 1 tipo propio/.test(text) && /Se quitará 1 etiqueta sin uso/.test(text), text);
  await page.screenshot({ path: `${SHOTS}/r50-plantilla-summary.png` });
  await dlg.getByRole("button", { name: "Aplicar", exact: true }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });

  L.eq("REPLACE: columnas en el orden de la plantilla", await columnNames(), ["Pendiente", "En curso", "Esperando", "Revisión", "Tareas periódicas", "Hecho"]);
  L.eq("REPLACE: no se pierde ninguna tarea", await taskCount(), total);
  const cols = await L.q(`SELECT c.name, count(t.id)::int n FROM "Column" c LEFT JOIN "Task" t ON t."columnId"=c.id WHERE c."projectId"=$1 GROUP BY c.name, c.position ORDER BY c.position`, [R50]);
  L.eq("REPLACE: «En curso» (la misma columna) tiene sus tareas, la archivada y las de «Pendiente»", cols.find((c) => c.name === "En curso").n, 6);
  L.eq("REPLACE: «Esperando» trae el rol de la plantilla", (await L.q(`SELECT role FROM "Column" WHERE "projectId"=$1 AND name='Esperando'`, [R50]))[0]?.role, "WAITING");
  L.eq("REPLACE: «Hecho» es la misma columna, aún terminada", (await L.q(`SELECT "isDone" FROM "Column" WHERE id='r50c_hecho'`))[0]?.isDone, true);
  L.eq("REPLACE: tipos propios", (await snapshot()).kinds, ["Encargo", "Propuesta o presupuesto", "Reunión", "Incidencia", "Facturación", "Contenido o campaña", "Tarea interna"]);
  L.eq("REPLACE: etiquetas (la usada se queda, la suelta se va)", (await snapshot()).labels, ["Bloqueado", "En garantía", "Reabierto", "Usada"]);
  // La otra persona lo ve sin recargar.
  await L.colLoc(other.page, "Esperando").waitFor({ timeout: 15000 }).then(() => L.check("REPLACE: la otra persona ve las columnas nuevas en vivo", true), (e) => L.check("REPLACE: la otra persona ve las columnas nuevas en vivo", false, String(e).slice(0, 200)));
  L.check("REPLACE: y ya no ve «Vacía»", await L.waitFor(async () => (await other.page.locator('[aria-label="Vacía"]').count()) === 0));
  await other.page.screenshot({ path: `${SHOTS}/r50-plantilla-live.png` });

  // Deshacer.
  await page.locator("[data-template-undo]").waitFor({ timeout: 10000 });
  await undoFromSettings(page);
  await L.eqEventually("REPLACE: deshacer devuelve columnas, tareas, tipos y etiquetas", snapshot, before, { timeout: 10000 });
  await L.colLoc(other.page, "Vacía").waitFor({ timeout: 15000 }).then(() => L.check("REPLACE: la otra persona ve el deshacer en vivo", true), () => L.check("REPLACE: la otra persona ve el deshacer en vivo", false));
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
  await seedR50();
  const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = s;
  await settings(page, R50);
  const dlg = await openWizard(page, "Eventos y viajes", "Cambiar a esta plantilla");
  await dlg.locator("[data-step='2']").waitFor({ timeout: 10000 });
  L.check("MOBILE: paso 2 sin desbordamiento horizontal", await fits(page));
  const box = await columnSelect(dlg, "Pendiente").boundingBox();
  L.check("MOBILE: los desplegables caben en la pantalla", box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  await page.screenshot({ path: `${SHOTS}/r50-plantilla-mobile.png` });
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  await dlg.locator("[data-step='3']").waitFor();
  L.check("MOBILE: resumen sin desbordamiento", await fits(page));
  await page.keyboard.press("Escape");
  L.assertNoErrors("MOBILE", [s]);
  await s.ctx.close();
}

// --- Ronda 51: proyecto y medida del contraste ---------------------------------------------------------------------------
const R51_PREFIX = "r51_tpl_project";
let R51 = R51_PREFIX;

/**
 * Proyecto privado de `owner` con un id nuevo: «Pendiente», «Para publicar» (release, con tres tareas fijas) y «Hecho»;
 * generales ocultos opcionales. Devuelve su id (el de «estilo», «fijas» y «generales» queda además en R51).
 */
async function seedR51({ prefix = R51_PREFIX, owner = adm.id, hidden = [] } = {}) {
  await L.q(`DELETE FROM "Project" WHERE id LIKE $1`, [`${prefix}%`]);
  const id = freshId(prefix);
  if (prefix === R51_PREFIX) R51 = id;
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,true,$3,999996,NOW())`, [id, `Zeta ${id}`, owner]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [id, owner]);
  const cols = [[`${id}_pend`, "Pendiente", false, "NONE"], [`${id}_rel`, "Para publicar", false, "NEXT_RELEASE"], [`${id}_hecho`, "Hecho", true, "NONE"]];
  for (const [i, [cid, name, done, role]] of cols.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,"isDone",role) VALUES ($1,$2,$3,$4,$5,$6)`, [cid, id, name, (i + 1) * 1000, done, role]);
  const tasks = [["Normal r51", `${id}_pend`, false], ["Fija uno r51", `${id}_rel`, true], ["Fija dos r51", `${id}_rel`, true], ["Fija tres r51", `${id}_rel`, true]];
  for (const [i, [title, col, ev]] of tasks.entries()) {
    await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,evergreen,"createdById","updatedAt") VALUES ($1,$2,$3,$4,'kind_funcionalidad',$5,$6,$7,NOW())`, [`${id}_t${i}`, id, col, title, (i + 1) * 1024, ev, owner]);
  }
  for (const kindId of hidden) await L.q(`INSERT INTO "ProjectHiddenKind"("projectId","kindId") VALUES ($1,$2)`, [id, kindId]);
  await L.q(`DELETE FROM "ProjectTemplateChange" WHERE "projectId"=$1`, [id]);
  return id;
}

/**
 * Contraste WCAG entre el texto de `el` y el fondo que tiene detrás (los fondos semitransparentes de sus antepasados,
 * compuestos sobre el de la página). Los colores pueden venir en oklch: un lienzo los convierte a sRGB.
 */
function contrastOf(el) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 1, 1);
  const chain = [];
  for (let n = el; n; n = n.parentElement) chain.unshift(n);
  for (const n of chain) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") { ctx.fillStyle = bg; ctx.fillRect(0, 0, 1, 1); }
  }
  const [br, bgc, bb] = ctx.getImageData(0, 0, 1, 1).data;
  ctx.fillStyle = getComputedStyle(el).color;
  ctx.fillRect(0, 0, 1, 1);
  const [fr, fg, fb] = ctx.getImageData(0, 0, 1, 1).data;
  const lum = (r, g, b) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [a, b] = [lum(fr, fg, fb), lum(br, bgc, bb)];
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}

/** Elige cada plantilla del paso 1 y mide el contraste de su nombre ya elegida; devuelve [{name, ratio, bg}]. */
async function measureChoices(dlg) {
  const out = [];
  const cards = dlg.locator("[data-template-choice]");
  for (let i = 0; i < (await cards.count()); i++) {
    const card = cards.nth(i);
    await card.locator("input[type=radio]").check();
    await sleep(120); // transición de colores
    const name = card.locator("[data-template-name]");
    out.push({ name: (await name.innerText()).trim(), ratio: await name.evaluate(contrastOf) });
  }
  return out;
}

// --- Estilo de la opción elegida --------------------------------------------------------------------------------------
if (only.includes("estilo")) {
  L.scenario("estilo: la plantilla elegida se lee en claro y en oscuro (también las de serie)");
  await seedR51();
  const s = await L.session();
  const { page } = s;
  // Las plantillas propias solo las ven los administradores: se sube el rol tras entrar (sin el 2FA de admin).
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id=$1`, [adm.id]);
  try {
    for (const scheme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await settings(page, R51);
      L.eq(`ESTILO ${scheme}: la página está en modo ${scheme === "dark" ? "oscuro" : "claro"}`, await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches), scheme === "dark");
      await page.getByRole("button", { name: "Aplicar plantilla…" }).click();
      const dlg = wizard(page);
      await dlg.locator("[data-template-choice]").first().waitFor({ timeout: 10000 });
      const builtins = await dlg.locator("fieldset").filter({ hasText: "Plantillas de serie" }).locator("[data-template-choice]").count();
      L.check(`ESTILO ${scheme}: hay plantillas de serie de la instalación`, builtins > 0, String(builtins));
      const all = await measureChoices(dlg);
      const bad = all.filter((x) => !x.name || x.ratio < 4.5);
      L.check(`ESTILO ${scheme}: el nombre de cada plantilla elegida tiene contraste suficiente (≥ 4,5)`, bad.length === 0, JSON.stringify(bad.length ? bad : all.slice(0, 3)));
      const course = all.find((x) => /^Curso o charla/.test(x.name));
      L.check(`ESTILO ${scheme}: la plantilla de serie «Curso o charla» tiene nombre visible`, !!course && course.ratio >= 4.5, JSON.stringify(course ?? all.map((x) => x.name)));
      if (scheme === "dark") {
        // Control: con las clases de antes (fondo claro sin variante oscura), la medida sí detecta el nombre ilegible.
        const card = dlg.locator("[data-template-choice]").first();
        const old = await card.evaluate((el) => { const c = el.className; el.className = "flex items-start gap-2 rounded-md border border-brand-500 bg-brand-50 p-2 text-sm"; return c; });
        const ratio = await card.locator("[data-template-name]").evaluate(contrastOf);
        await card.evaluate((el, c) => { el.className = c; }, old);
        L.check("ESTILO dark: (control) con el estilo antiguo el nombre no se leía", ratio < 2, String(ratio));
      }
      // La captura, con una de serie elegida (la de la captura del fallo).
      if (course) await dlg.locator("[data-template-choice]").filter({ hasText: /^Curso o charla/ }).locator("input").check();
      await page.screenshot({ path: `${SHOTS}/r51-plantilla-${scheme}.png` });
      await page.keyboard.press("Escape");
      await dlg.waitFor({ state: "detached", timeout: 5000 });
    }
    // Las demás tarjetas de opción usan el mismo estilo: idioma, edición, tema y tarjetas en Mi perfil → Preferencias.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${L.BASE}/settings?tab=preferencias`);
    const themeCard = page.getByRole("button", { name: "Oscuro", exact: true });
    await themeCard.waitFor({ timeout: 15000 });
    const pressed = page.locator("button.choice-card[aria-pressed=true], button.choice-card[aria-checked=true]");
    L.check("ESTILO: Mi perfil usa las tarjetas de opción comunes", (await pressed.count()) > 0);
    const ratios = [];
    for (let i = 0; i < (await pressed.count()); i++) ratios.push(await pressed.nth(i).evaluate(contrastOf));
    L.check("ESTILO: las tarjetas elegidas de Mi perfil se leen en oscuro", ratios.every((r) => r >= 4.5), JSON.stringify(ratios));
    await page.screenshot({ path: `${SHOTS}/r51-opciones-dark.png` });
  } finally {
    await L.q(`UPDATE "User" SET role='MEMBER' WHERE id=$1`, [adm.id]);
  }
  L.assertNoErrors("ESTILO", [s]);
  await s.ctx.close();
}

// --- Tareas fijas en el resumen ----------------------------------------------------------------------------------------
if (only.includes("fijas")) {
  L.scenario("fijas: el resumen dice qué tareas fijas pasan a normales al perder su columna de release");
  await seedR51();
  const s = await L.session();
  const { page } = s;
  await settings(page, R51);
  const dlg = await openWizard(page, "Casa y familia", "Cambiar a esta plantilla");
  await dlg.locator("[data-step='2']").waitFor({ timeout: 10000 });
  const relSelect = columnSelect(dlg, "Para publicar");
  // Sin pareja se conserva con su rol (la plantilla no tiene release): siguen fijas y el resumen no dice nada.
  L.eq("FIJAS: «Para publicar» se conserva", await relSelect.inputValue(), "keep");
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  await dlg.locator("[data-step='3']").waitFor();
  L.check("FIJAS: conservada con su rol, el resumen no habla de tareas fijas", !/fija/.test(await summaryText(dlg)), await summaryText(dlg));
  await dlg.getByRole("button", { name: "Atrás" }).click();
  await relSelect.selectOption({ label: "Por hacer" });
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  await dlg.locator("[data-step='3']").waitFor();
  const text = await summaryText(dlg);
  L.check("FIJAS: pasada a una columna sin rol, «3 tareas fijas pasarán a ser normales» con sus nombres", /3 tareas fijas pasarán a ser normales/.test(text) && /Fija uno r51, Fija dos r51, Fija tres r51/.test(text), text);
  await page.screenshot({ path: `${SHOTS}/r51-plantilla-fijas.png` });
  await page.keyboard.press("Escape");
  L.eq("FIJAS: sin aplicar, siguen fijas", Number((await L.q(`SELECT count(*) n FROM "Task" WHERE "projectId"=$1 AND evergreen`, [R51]))[0].n), 3);
  L.assertNoErrors("FIJAS", [s]);
  await s.ctx.close();
}

// --- Añadir lo que falte: generales ocultos ----------------------------------------------------------------------------
if (only.includes("generales")) {
  L.scenario("generales: «Añadir lo que falte» vuelve a mostrar los tipos generales ocultos que usa la plantilla");
  await seedR51({ hidden: ["kind_correccion", "kind_respuesta"] });
  const s = await L.session();
  const { page } = s;
  await settings(page, R51);
  await page.getByRole("button", { name: "Aplicar plantilla…" }).click();
  L.check("GENERALES: la opción lo dice antes de elegirla", (await wizard(page).innerText()).includes("vuelve a mostrar los tipos generales que usa la plantilla"));
  await page.keyboard.press("Escape");
  const dlg = await openWizard(page, "Vibecoding", "Añadir lo que falte");
  await dlg.locator("[data-step='3']").waitFor({ timeout: 10000 });
  const text = await summaryText(dlg);
  // «Vibecoding» usa todos los tipos generales: vuelven los dos ocultos.
  L.check("GENERALES: el resumen dice que vuelven a verse «Corrección» y «Respuesta»", /Volverán a verse 2 tipos generales/.test(text) && /Corrección/.test(text) && /Respuesta/.test(text), text);
  await page.screenshot({ path: `${SHOTS}/r51-plantilla-generales.png` });
  await dlg.getByRole("button", { name: "Aplicar", exact: true }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  L.eq("GENERALES: ya no queda ninguno oculto", await hiddenKinds(R51), []);
  await page.locator("[data-template-undo]").waitFor({ timeout: 10000 });
  await undoFromSettings(page);
  await L.eqEventually("GENERALES: el deshacer los vuelve a ocultar", () => hiddenKinds(R51), ["kind_correccion", "kind_respuesta"], { timeout: 10000 });
  L.assertNoErrors("GENERALES", [s]);
  await s.ctx.close();
}

// --- Límite de cambios por proyecto ------------------------------------------------------------------------------------
if (only.includes("limite")) {
  L.scenario("limite: tras 5 cambios de plantilla en 10 minutos, el sexto avisa y no cambia nada");
  // Con la segunda persona y un proyecto propio: no gasta los cambios del administrador que usan los demás escenarios.
  const rateId = await seedR51({ prefix: "r51_tpl_rate", owner: usr2.id });
  const s = await L.session({ email: L.USER2 });
  const { page } = s;
  await settings(page, rateId);
  for (let i = 0; i < 5; i++) {
    if (i % 2 === 0) {
      const dlg = await openWizard(page, "Vibecoding", "Añadir lo que falte");
      await dlg.locator("[data-step='3']").waitFor({ timeout: 10000 });
      await dlg.getByRole("button", { name: "Aplicar", exact: true }).click();
      await dlg.waitFor({ state: "detached", timeout: 15000 });
      await page.locator("[data-template-undo]").waitFor({ timeout: 10000 });
    } else {
      await undoFromSettings(page);
      await page.locator("[data-template-undo]").waitFor({ state: "detached", timeout: 10000 });
    }
  }
  L.eq("LIMITE: tras 5 cambios queda uno por deshacer", Number((await L.q(`SELECT count(*) n FROM "ProjectTemplateChange" WHERE "projectId"=$1`, [rateId]))[0].n), 1);
  await undoFromSettings(page);
  const toast = page.getByText(/Este proyecto ya ha cambiado de plantilla 5 veces en los últimos 10 minutos\. Vuelve a intentarlo dentro de \d+ min\./);
  L.check("LIMITE: el sexto avisa con un mensaje claro", await toast.first().waitFor({ timeout: 10000 }).then(() => true, () => false));
  await page.screenshot({ path: `${SHOTS}/r51-plantilla-limite.png` });
  L.eq("LIMITE: y no se ha deshecho", Number((await L.q(`SELECT count(*) n FROM "ProjectTemplateChange" WHERE "projectId"=$1`, [rateId]))[0].n), 1);
  L.check("LIMITE: el aviso es un error esperado (sin errores de consola)", s.errors.length === 0, s.errors.join(" | "));
  await s.ctx.close();
}

// --- Caza de bugs 50a: proyecto ----------------------------------------------------------------------------------------
const BH50A_PREFIX = "bh50a_project";
let BH50A = BH50A_PREFIX;

/**
 * Proyecto privado: «Pendiente», «Revisión» (con una archivada), «Hecho» y «Vacía»; un tipo propio; «Corrección» visible
 * sin tareas y «Respuesta» oculta con una tarea.
 */
async function seedBh50a() {
  await L.q(`DELETE FROM "Project" WHERE id LIKE $1`, [`${BH50A_PREFIX}%`]);
  BH50A = freshId(BH50A_PREFIX);
  const users = await L.q(`SELECT id FROM "User" WHERE email IN ($1,$2)`, [L.ADMIN, L.USER2]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,true,$3,999997,NOW())`, [BH50A, "Zeta bh50a", adm.id]);
  for (const u of users) await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [BH50A, u.id]);
  const cols = [["bh50a_pend", "Pendiente", false], ["bh50a_rev", "Revisión", false], ["bh50a_hecho", "Hecho", true], ["bh50a_vacia", "Vacía", false]];
  for (const [i, [id, name, done]] of cols.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,"isDone") VALUES ($1,$2,$3,$4,$5)`, [id, BH50A, name, (i + 1) * 1000, done]);
  await L.q(`INSERT INTO "TaskKind"(id,name,color,position,"projectId") VALUES ('bh50a_k','Tipo propio','#64748b',1000,$1)`, [BH50A]);
  await L.q(`INSERT INTO "ProjectHiddenKind"("projectId","kindId") VALUES ($1,'kind_respuesta')`, [BH50A]);
  const tasks = [
    ["bh50a_t1", "Uno bh50a", "bh50a_pend", "kind_funcionalidad"], ["bh50a_t2", "Dos bh50a", "bh50a_rev", "bh50a_k"],
    ["bh50a_t3", "Tres bh50a", "bh50a_hecho", "kind_respuesta"],
  ];
  for (const [i, [id, title, col, kind]] of tasks.entries()) {
    await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`, [id, BH50A, col, title, kind, (i + 1) * 1024, adm.id]);
  }
  await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"archivedAt","archivedFromColumnId","updatedAt") VALUES ('bh50a_arch',$1,'bh50a_rev','Archivada bh50a','kind_funcionalidad',99999,NOW(),'bh50a_rev',NOW())`, [BH50A]);
  await L.q(`DELETE FROM "ProjectTemplateChange" WHERE "projectId"=$1`, [BH50A]);
}

// --- Paso 2 coherente con el resumen ------------------------------------------------------------------------------------
if (only.includes("paso2")) {
  L.scenario("paso2: un tipo general que la plantilla oculta no dice «Conservar»");
  await seedBh50a();
  const s = await L.session();
  const { page } = s;
  await settings(page, BH50A);
  const dlg = await toStep2(page, { open: "Aplicar plantilla…", template: /^Curso o charla/, mode: /^Cambiar a esta plantilla/, next: "Siguiente" });
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
  const summary = await summaryText(dlg);
  L.check("PASO2: el resumen oculta «Corrección» y «Funcionalidad»", /Se ocultarán 2 tipos generales\s*\n\s*Funcionalidad, Corrección/.test(summary), summary);
  L.check("PASO2: y vuelve a verse «Respuesta»", /Volverá a verse 1 tipo general\s*\n\s*Respuesta/.test(summary), summary);
  // Atrás: con «Conservar» en «Funcionalidad» solo se oculta «Corrección».
  await dlg.getByRole("button", { name: "Atrás" }).click();
  await kindSelect(dlg, "Funcionalidad").selectOption("keep");
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  const summary2 = await summaryText(dlg);
  L.check("PASO2: con «Conservar», solo «Corrección»", /Se ocultará 1 tipo general\s*\n\s*Corrección/.test(summary2), summary2);
  await dlg.getByRole("button", { name: "Aplicar", exact: true }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  L.eq("PASO2: al aplicar, «Corrección» queda oculta y «Respuesta» visible", await hiddenKinds(BH50A), ["kind_correccion"]);
  L.assertNoErrors("PASO2", [s]);
  await s.ctx.close();
}

// --- En inglés, en modo oscuro y en el móvil ---------------------------------------------------------------------------
if (only.includes("en")) {
  L.scenario("en: lo mismo en inglés (390 px, modo oscuro)");
  await seedBh50a();
  await L.q(`UPDATE "User" SET locale='EN' WHERE id=$1`, [adm.id]);
  try {
    const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
    const { page } = s;
    await page.emulateMedia({ colorScheme: "dark" });
    await settings(page, BH50A);
    const dlg = await toStep2(page, { open: "Apply template…", template: /^Course or talk/, mode: /^Switch to this template/, next: "Next" });
    L.eq("EN: «Bug fix» dice que se ocultará", await selectedText(kindSelect(dlg, "Bug fix")), "Hide (the template doesn't use it)");
    L.eq("EN: «Reply» dice que volverá a verse", await selectedText(kindSelect(dlg, "Reply")), "Keep (it will be shown again)");
    L.eq("EN: «Feature» se conserva", await selectedText(kindSelect(dlg, "Feature")), "Keep");
    L.check("EN: el paso 2 cabe en 390 px", await fits(page));
    await page.screenshot({ path: `${SHOTS}/bh50a-paso2-en.png` });
    await dlg.getByRole("button", { name: "Next" }).click();
    const summary = await summaryText(dlg);
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
  await seedBh50a();
  const s = await L.session();
  const { page } = s;
  await settings(page, BH50A);
  const dlg = await toStep2(page, { open: "Aplicar plantilla…", template: /^Curso o charla/, mode: /^Cambiar a esta plantilla/, next: "Siguiente" });
  // «Pendiente» y «Revisión» pasan a «Materiales» (la 2.ª de la plantilla): «Revisión», con la archivada, se une a
  // «Pendiente» y se quita; la primera columna pasa a ser «Ideas», nueva.
  await columnSelect(dlg, "Pendiente").selectOption({ label: "Materiales" });
  await columnSelect(dlg, "Revisión").selectOption({ label: "Materiales" });
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  await dlg.locator("[data-step='3']").waitFor();
  await dlg.getByRole("button", { name: "Aplicar", exact: true }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  L.eq("ARCH: «Revisión» se ha quitado", Number((await L.q(`SELECT count(*) n FROM "Column" WHERE id='bh50a_rev'`))[0].n), 0);
  await page.goto(`${L.BASE}/p/${BH50A}`);
  await L.colLoc(page, "Materiales").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Archivadas" }).first().click();
  const arch = page.getByRole("dialog").filter({ hasText: "Tareas archivadas" });
  await arch.getByText("Archivada bh50a").waitFor({ timeout: 10000 });
  const row = arch.locator("li").filter({ hasText: "Archivada bh50a" });
  L.check("ARCH: «Archivadas» dice de qué columna es (no «columna borrada»)", (await row.innerText()).includes("de «Materiales»"), await row.innerText());
  await row.getByRole("button", { name: "Restaurar" }).click();
  await L.waitFor(async () => (await L.q(`SELECT "archivedAt" FROM "Task" WHERE id='bh50a_arch'`))[0].archivedAt === null, { timeout: 10000 });
  L.eq("ARCH: al recuperarla vuelve a «Materiales» (no a «Ideas», la primera)", (await L.q(`SELECT c.name FROM "Task" t JOIN "Column" c ON c.id=t."columnId" WHERE t.id='bh50a_arch'`))[0].name, "Materiales");
  // El aviso sale cuando llega la respuesta, que puede ser un poco después de que la base ya lo tenga: se espera.
  L.check("ARCH: el aviso dice «Materiales»", await page.getByText("Tarea restaurada en «Materiales»").first().waitFor({ timeout: 5000 }).then(() => true, () => false));
  L.assertNoErrors("ARCH", [s]);
  await s.ctx.close();
}

// Los proyectos de la suite no se quedan en la base (las demás suites usan el primero).
for (const prefix of PREFIXES) await L.q(`DELETE FROM "Project" WHERE id LIKE $1`, [`${prefix}%`]);
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
