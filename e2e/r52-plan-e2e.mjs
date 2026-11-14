// Ronda 52: plan de trabajo para IA, adjuntos, ritmo por columna, botones de columnas vacías y salida por los enlaces del pie.
//  - zip: «Descargar adjuntos» en el paso 2 del plan (ZIP «adjuntos/NN-titulo/…» con los adjuntos de las tareas, mismo
//    formato y topes que el de la release); el texto cita cada adjunto por su ruta dentro del ZIP (también la imagen pegada
//    en la descripción) y su enlace a Pizarro; solo el .md va a Documentación; la ruta del ZIP de la release sigue igual.
//  - ritmo: las tareas fijas «cada dos» cuentan los planes guardados en SU columna (guardar en una no adelanta a las demás),
//    mientras la versión del documento (_vN) sigue siendo del proyecto.
//  - vacias: «Publicar programa», «Exportar a calendario», «Resumen para el cliente», «Ver lista», «Resumen de presupuesto»
//    y «PDF de la semana» se desactivan sin tarjetas (botón y menú de la columna), con el título «No hay tarjetas en esta
//    columna»; el .ics sin fechas y la lista sin subtareas, también, con su motivo.
//  - salir: con el texto del paso 2 cambiado, un enlace del pie («tus plantillas») pide confirmar como cerrar; sin cambios
//    navega directo. En el plan y en la release.
// Misma base y servidor que board-e2e.mjs (el servidor y este script comparten UPLOAD_DIR; por defecto ../uploads):
//   cd e2e && BASE=http://localhost:3272 DATABASE_URL=$DBURL node r52-plan-e2e.mjs   # PART=zip,ritmo,vacias,salir
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "./qa/lib.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "zip,ritmo,vacias,salir").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "r52-plan-"));
const UPLOADS = path.resolve(process.env.UPLOAD_DIR || path.join(import.meta.dirname, "..", "uploads"));
fs.mkdirSync(UPLOADS, { recursive: true });

await L.prepareUsers();
const PID = "r52_project";
const NAME = "Web r52";
const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const COLS = [
  ["r52_a", "Plan A", "AI_PLAN"], ["r52_b", "Plan B", "AI_PLAN"], ["r52_salto", "Salto", "NEXT_RELEASE"], ["r52_prog", "Temario", "PROGRAM"],
  ["r52_sem", "Semana", "WEEKLY_PLAN"], ["r52_lista", "Lista", "CHECKLIST"], ["r52_agenda", "Agenda", "AGENDA"], ["r52_entrega", "Entrega", "DELIVERY"],
  ["r52_presu", "Presupuesto", "BUDGET"],
];
const IMG = Buffer.from("R52-IMAGEN-FALSA-PARA-EL-ZIP");
const DOC = Buffer.from("R52 documento de texto\n");
const FILES = new Map(); // ficheros que se han escrito en UPLOADS (para borrarlos)

/** Proyecto privado con las columnas de arriba; `tasks`: [id, columna, título, descripción, fija, cada]. */
async function seed(tasks = []) {
  await L.q(`DELETE FROM "Project" WHERE id=$1 OR name=$2`, [PID, NAME]);
  await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN', locale='ES' WHERE id=$1`, [adm.id]);
  const users = await L.q(`SELECT id FROM "User" WHERE email IN ($1,$2)`, [L.ADMIN, L.USER2]);
  await L.q(`INSERT INTO "Project"(id,name,description,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,'Tienda en línea.',true,$3,999990,NOW())`, [PID, NAME, adm.id]);
  for (const u of users) await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [PID, u.id]);
  for (const [i, [id, name, role]] of COLS.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,role) VALUES ($1,$2,$3,$4,$5)`, [id, PID, name, (i + 1) * 1000, role]);
  for (const [i, [id, col, title, desc, fixed, every]] of tasks.entries()) {
    await L.q(
      `INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,description,evergreen,"evergreenEvery","createdById","updatedAt") VALUES ($1,$2,$3,$4,'kind_funcionalidad',$5,$6,$7,$8,$9,NOW())`,
      [id, PID, col, title, (i + 1) * 1024, desc ?? "", !!fixed, every ?? 1, adm.id],
    );
  }
}
/** Adjunto con su fichero en disco (los ids de adjunto son alfanuméricos). */
async function attach(id, taskId, name, isImage, data) {
  await L.q(`INSERT INTO "TaskAttachment"(id,"taskId","originalName","mimeType","isImage",size) VALUES ($1,$2,$3,$4,$5,$6)`, [id, taskId, name, isImage ? "image/png" : "text/plain", isImage, data.length]);
  const file = path.join(UPLOADS, isImage ? `${id}.webp` : `${id}.bin`);
  fs.writeFileSync(file, data);
  FILES.set(id, file);
}
async function openBoard(page) {
  await page.goto(`${L.BASE}/p/${PID}`);
  await L.colLoc(page, "Plan A").waitFor({ timeout: 20000 });
  await L.liveOpen(page);
  await sleep(500);
}
const planDialog = (page) => page.locator("[role=dialog]").filter({ hasText: /Generar plan de trabajo|Generate work plan/ }).first();
async function openPlan(page, col = "Plan A") {
  await L.colLoc(page, col).getByRole("button", { name: "Generar plan de trabajo" }).click();
  const dlg = planDialog(page);
  await dlg.locator("[data-plan-step=select]").waitFor({ timeout: 10000 });
  await sleep(1200);
  return dlg;
}
async function toStep2(dlg, n) {
  await dlg.getByRole("button", { name: new RegExp(`Generar con ${n} tarea`) }).click();
  await dlg.locator("[data-plan-step=edit]").waitFor({ timeout: 15000 });
  await sleep(300);
}
const planText = (dlg) => dlg.getByRole("textbox", { name: "Texto del plan de trabajo" }).inputValue();
const appToday = (page) => page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: document.documentElement.dataset.tz || undefined }).format(new Date()));
const docs = () => L.q(`SELECT id,name,kind,"mimeType" FROM "ProjectDocument" WHERE "projectId"=$1 AND "deletedAt" IS NULL ORDER BY "createdAt"`, [PID]);
const checkedRows = (dlg) => dlg.locator("ul li").evaluateAll((els) => els.map((li) => [li.innerText.split("\n")[0].trim(), li.querySelector("input").checked]));
const unzipList = (file) => execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }).split("\n").filter(Boolean).sort();

// --- ZIP de adjuntos del plan ------------------------------------------------------------------------------------------------
if (only.includes("zip")) {
  L.scenario("zip: el plan lleva «Descargar adjuntos» y cita las rutas del ZIP");
  await seed([
    ["r52_t1", "r52_a", "Arreglar el login: ¡Ñandú!", "Falla así: ![captura](/api/attachments/r52img1) y esto ![ajena](/api/attachments/zzzzzz)", false],
    ["r52_t2", "r52_a", "Sin adjuntos", "", false],
    ["r52_t3", "r52_a", "Con un registro", "", false],
  ]);
  await attach("r52img1", "r52_t1", "Plano final.png", true, IMG);
  await attach("r52doc1", "r52_t1", "notas.txt", false, DOC);
  await attach("r52doc2", "r52_t3", "registro.txt", false, DOC);
  const s = await L.session();
  const { page } = s;
  await openBoard(page);
  const dlg = await openPlan(page);
  await toStep2(dlg, 3);
  const text = await planText(dlg);
  const f1 = "adjuntos/01-arreglar-el-login-nandu";
  L.check("ZIP: el texto cita la imagen por su ruta en el ZIP", text.includes(`\`${f1}/Plano_final.webp\``), text.slice(text.indexOf("### 1."), text.indexOf("### 2.")));
  L.check("ZIP: …y el documento de la tarea 1 y el de la 3 (con su número en el plan)", text.includes(`\`${f1}/notas.txt\``) && text.includes("`adjuntos/03-con-un-registro/registro.txt`"));
  L.check("ZIP: cada ruta lleva detrás el enlace a Pizarro", text.includes(`([Plano final.png en Pizarro](<${L.BASE}/api/attachments/r52img1>))`));
  L.check("ZIP: la imagen pegada en la descripción apunta a la misma ruta del ZIP", text.includes(`![captura](${f1}/Plano_final.webp)`));
  L.check("ZIP: una imagen que no es adjunto del plan queda con su enlace absoluto", text.includes(`![ajena](${L.BASE}/api/attachments/zzzzzz)`));
  L.check("ZIP: el contexto explica el ZIP «adjuntos/…» (3 archivos)", text.includes("- **Adjuntos:** 3 archivo(s) en el ZIP «adjuntos/…» que va con este plan"));
  L.check("ZIP: la cabecera de serie también", text.includes("van en el ZIP «adjuntos/…» que acompaña a este plan"));
  const btn = dlg.getByRole("button", { name: "Descargar adjuntos (3)" });
  L.check("ZIP: botón «Descargar adjuntos (3)» en el paso 2", await btn.isVisible());
  const today = await appToday(page);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), btn.click()]);
  const zip = path.join(TMP, "plan.zip");
  await dl.saveAs(zip);
  L.eq("ZIP: nombre del fichero (fecha, versión y proyecto)", dl.suggestedFilename(), `plan-${today}-v1-Web_r52-adjuntos.zip`);
  L.eq("ZIP: contiene exactamente las rutas citadas, con carpetas por tarea", unzipList(zip), [`${f1}/Plano_final.webp`, `${f1}/notas.txt`, "adjuntos/03-con-un-registro/registro.txt"]);
  L.check("ZIP: el contenido es el del adjunto", execFileSync("unzip", ["-p", zip, `${f1}/Plano_final.webp`]).equals(IMG));
  await page.screenshot({ path: `${SHOTS}/r52-zip-paso2.png` });

  // La ruta es la misma que la de la release: ni mezcla de formatos ni tareas ajenas; la de la release sigue con códigos.
  // Con la API de peticiones (no fetch de la página): los 400 esperados no cuentan como errores de consola.
  const post = async (items, query = "?plan=1", who = page) => {
    const r = await who.request.post(`${L.BASE}/api/projects/${PID}/release-attachments${query}`, { data: { items }, headers: { origin: L.BASE } });
    return { status: r.status(), body: query === "?plan=1" && r.ok() ? await r.json() : null };
  };
  L.eq("ZIP: mezclar código y carpeta se rechaza (400)", (await post([{ taskId: "r52_t1", code: "F1" }, { taskId: "r52_t3", folder: "adjuntos/03-x" }])).status, 400);
  L.eq("ZIP: una carpeta con «..» se rechaza (400)", (await post([{ taskId: "r52_t1", folder: "adjuntos/../x" }])).status, 400);
  L.eq("ZIP: una carpeta sin número se rechaza (400)", (await post([{ taskId: "r52_t1", folder: "adjuntos/x" }])).status, 400);
  L.eq("ZIP: una tarea que no es del proyecto, 404", (await post([{ taskId: "no_existe", folder: "adjuntos/01-x" }])).status, 404);
  const rel = await post([{ taskId: "r52_t1", code: "F1" }]);
  L.check("ZIP: con códigos (release) sigue funcionando, un paquete", rel.status === 200 && rel.body.parts.length === 1, JSON.stringify(rel));
  const relZip = await page.evaluate(async (url) => {
    const r = await fetch(`${url}?part=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [{ taskId: "r52_t1", code: "F1" }] }) });
    return { status: r.status, disp: r.headers.get("content-disposition"), n: (await r.arrayBuffer()).byteLength };
  }, `/api/projects/${PID}/release-attachments`);
  L.check("ZIP: el de la release, con nombre de release", relZip.status === 200 && /release-.*-adjuntos\.zip/.test(relZip.disp ?? ""), JSON.stringify(relZip));
  // Una persona sin acceso al proyecto no obtiene nada.
  const outsider = await L.session({ email: L.USER2 });
  await L.q(`DELETE FROM "ProjectMember" WHERE "projectId"=$1 AND "userId"=(SELECT id FROM "User" WHERE email=$2)`, [PID, L.USER2]);
  await outsider.page.goto(`${L.BASE}/settings`);
  await outsider.page.waitForLoadState("networkidle");
  await sleep(500);
  const out = (await post([{ taskId: "r52_t1", folder: "adjuntos/01-x" }], "?plan=1", outsider.page)).status;
  L.eq("ZIP: sin acceso al proyecto privado, 404", out, 404);
  await outsider.ctx.close();

  // Solo el .md va a Documentación (los adjuntos ya están en las tareas: guardarlos otra vez duplicaría espacio y cuota).
  await dlg.getByRole("button", { name: "Guardar en Documentación" }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  L.eq("ZIP: Documentación recibe solo el Markdown del plan", (await docs()).map((d) => [d.name, d.kind]), [[`Plan de trabajo – ${today}_v1.md`, "MARKDOWN"]]);
  L.assertNoErrors("ZIP", [s]);
  await s.ctx.close();
}

// --- Ritmo por columna -------------------------------------------------------------------------------------------------------
if (only.includes("ritmo")) {
  L.scenario("ritmo: guardar un plan en una columna no adelanta a las demás");
  await seed([
    ["r52_a1", "r52_a", "Normal A", "", false], ["r52_a2", "r52_a", "Fija A cada dos", "", true, 2],
    ["r52_b1", "r52_b", "Normal B", "", false], ["r52_b2", "r52_b", "Fija B cada dos", "", true, 2],
  ]);
  const s = await L.session();
  const { page } = s;
  await openBoard(page);
  const today = await appToday(page);
  let dlg = await openPlan(page, "Plan A");
  L.eq("RITMO: en el primer plan de A la fija «cada dos» no entra", (await checkedRows(dlg)).map(([, c]) => c), [true, false]);
  L.check("RITMO: y dice que le toca en el siguiente", (await dlg.locator("ul li").nth(1).innerText()).includes("Cada dos · en el siguiente"));
  await toStep2(dlg, 1);
  await dlg.getByRole("button", { name: "Guardar en Documentación" }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  L.eq("RITMO: la columna A cuenta 1 plan y B ninguno", (await L.q(`SELECT id,"planCount" FROM "Column" WHERE id IN ('r52_a','r52_b') ORDER BY id`)).map((c) => [c.id, c.planCount]), [["r52_a", 1], ["r52_b", 0]]);
  // B sigue en su primer plan: su fija «cada dos» NO entra (con el contador del proyecto, que ya iba por 2, sí entraba).
  dlg = await openPlan(page, "Plan B");
  L.eq("RITMO: en el primer plan de B la fija sigue sin entrar", (await checkedRows(dlg)).map(([, c]) => c), [true, false]);
  await toStep2(dlg, 1);
  L.check("RITMO: «Se guardará como» la v2 (versión por proyecto)", (await dlg.innerText()).includes(`Plan de trabajo – ${today}_v2.md`));
  await dlg.getByRole("button", { name: "Guardar en Documentación" }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  L.eq("RITMO: tras guardar en B, ambas columnas llevan 1 y los documentos son v1 y v2", [(await L.q(`SELECT "planCount" FROM "Column" WHERE id IN ('r52_a','r52_b') ORDER BY id`)).map((c) => c.planCount), (await docs()).map((d) => d.name.slice(-6))], [[1, 1], ["_v1.md", "_v2.md"]]);
  // El segundo plan de A sí incluye la fija «cada dos».
  dlg = await openPlan(page, "Plan A");
  L.eq("RITMO: en el segundo plan de A la fija entra", (await checkedRows(dlg)).map(([, c]) => c), [true, true]);
  await dlg.getByRole("button", { name: "Cancelar" }).click();
  L.assertNoErrors("RITMO", [s]);
  await s.ctx.close();
}

// --- Botones con la columna vacía ---------------------------------------------------------------------------------------------
if (only.includes("vacias")) {
  L.scenario("vacias: las columnas especiales sin tarjetas desactivan su botón y su opción del menú");
  await seed();
  const s = await L.session({ viewport: { width: 2600, height: 950 } });
  const { page } = s;
  await openBoard(page);
  const EMPTY = "No hay tarjetas en esta columna";
  const LABEL = { Temario: "Publicar programa (PDF)", Semana: "PDF de la semana", Lista: "Ver lista", Agenda: "Exportar a calendario (.ics)", Entrega: "Resumen para el cliente (PDF)", Presupuesto: "Resumen de presupuesto", Salto: "Generar Release", "Plan A": "Generar plan de trabajo" };
  const state = async (col) => {
    const b = L.colLoc(page, col).locator("[data-column-action] button").first();
    return [await b.isDisabled(), await b.getAttribute("title")];
  };
  for (const [col, label] of Object.entries(LABEL)) {
    L.check(`VACIAS: «${col}» tiene su botón «${label}»`, (await L.colLoc(page, col).locator("[data-column-action] button").first().innerText()).includes(label));
    L.eq(`VACIAS: «${col}» vacía: botón desactivado con su título`, await state(col), [true, EMPTY]);
  }
  /** Estado de las opciones del menú de la columna (… → opciones): [desactivada, título]. */
  const menuItems = async (col, names) => {
    await L.colLoc(page, col).getByRole("button", { name: "Opciones de columna" }).click();
    const out = [];
    for (const n of names) {
      const it = page.getByRole("menuitem", { name: n, exact: true });
      out.push([n, await it.isDisabled(), await it.getAttribute("title")]);
    }
    await page.keyboard.press("Escape");
    await sleep(200);
    return out;
  };
  for (const [col, names] of Object.entries({
    Temario: ["Publicar programa (PDF)"], Semana: ["PDF de la semana (por día)", "PDF de la semana (por persona)"], Lista: ["Ver lista"], Agenda: ["Exportar a calendario (.ics)"],
    Entrega: ["Resumen para el cliente (PDF)"], Presupuesto: ["Resumen de presupuesto"], "Plan A": ["Generar plan de trabajo"],
  })) L.eq(`VACIAS: «${col}» vacía: su opción del menú también`, await menuItems(col, names), names.map((n) => [n, true, EMPTY]));
  await page.screenshot({ path: `${SHOTS}/r52-vacias.png` });

  // Con una tarjeta se activan (el .ics y la lista piden además fecha límite o subtareas).
  const add = (id, col, title, extra = "") => L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"createdById","updatedAt"${extra ? ",\"dueDate\"" : ""}) VALUES ($1,$2,$3,$4,'kind_funcionalidad',1024,$5,NOW()${extra ? `,'${extra}'` : ""})`, [id, PID, col, title, adm.id]);
  for (const [id, col, title] of [["r52_v1", "r52_prog", "Sesión"], ["r52_v2", "r52_sem", "Lunes"], ["r52_v3", "r52_entrega", "Entregable"], ["r52_v4", "r52_presu", "Partida"], ["r52_v5", "r52_a", "Plan"]]) await add(id, col, title);
  await add("r52_ag1", "r52_agenda", "Sin fecha");
  await add("r52_li1", "r52_lista", "Sin subtareas");
  await page.reload();
  await L.colLoc(page, "Plan A").waitFor({ timeout: 20000 });
  await sleep(600);
  for (const col of ["Temario", "Semana", "Entrega", "Presupuesto", "Plan A"]) L.eq(`VACIAS: «${col}» con una tarjeta se activa`, (await state(col))[0], false);
  L.eq("VACIAS: «Agenda» con tarjetas sin fecha límite sigue desactivada, con su motivo", await state("Agenda"), [true, "Ninguna tarjeta tiene fecha límite"]);
  L.eq("VACIAS: «Lista» con tarjetas sin subtareas sigue desactivada, con su motivo", await state("Lista"), [true, "Ninguna tarjeta tiene subtareas"]);
  L.eq("VACIAS: y su opción del menú también", (await menuItems("Agenda", ["Exportar a calendario (.ics)"]))[0].slice(1), [true, "Ninguna tarjeta tiene fecha límite"]);
  await L.q(`UPDATE "Task" SET "dueDate"='2026-12-31' WHERE id='r52_ag1'`);
  await L.q(`INSERT INTO "Subtask"(id,"taskId",title,done,position) VALUES ('r52_su1','r52_li1','Paso',false,1000)`);
  await page.reload();
  await L.colLoc(page, "Plan A").waitFor({ timeout: 20000 });
  await sleep(600);
  L.eq("VACIAS: «Agenda» con una tarjeta con fecha se activa", (await state("Agenda"))[0], false);
  L.eq("VACIAS: «Lista» con una tarjeta con subtareas se activa", (await state("Lista"))[0], false);
  L.eq("VACIAS: y sus opciones del menú", [(await menuItems("Agenda", ["Exportar a calendario (.ics)"]))[0][1], (await menuItems("Lista", ["Ver lista"]))[0][1]], [false, false]);
  // «Ver lista» abre su diálogo.
  await L.colLoc(page, "Lista").getByRole("button", { name: "Ver lista" }).click();
  L.check("VACIAS: «Ver lista» abre la lista con su subtarea", await page.getByRole("dialog").getByText("Paso", { exact: true }).first().waitFor({ timeout: 8000 }).then(() => true, () => false));
  await page.keyboard.press("Escape");
  L.assertNoErrors("VACIAS", [s]);
  await s.ctx.close();
}

// --- Salir por los enlaces del pie ---------------------------------------------------------------------------------------------
if (only.includes("salir")) {
  L.scenario("salir: con el texto cambiado, un enlace del pie pide confirmar; sin cambios navega directo");
  await seed([["r52_s1", "r52_a", "Tarea del plan", "", false], ["r52_s2", "r52_salto", "Tarea de la release", "", false]]);
  const s = await L.session();
  const { page } = s;
  await openBoard(page);
  const ask = () => page.getByRole("dialog").filter({ hasText: "Cambios sin guardar" });
  const link = (dlg) => dlg.locator("[data-template-source]").getByRole("link", { name: "tus plantillas" });
  for (const kind of ["plan", "release"]) {
    const isPlan = kind === "plan";
    const open = async () => {
      if (isPlan) return openPlan(page, "Plan A");
      await L.colLoc(page, "Salto").getByRole("button", { name: "Generar Release" }).click();
      const d = page.locator("[role=dialog]").filter({ hasText: "Generar release" }).first();
      await d.getByRole("button", { name: /Generar con 1 tarea/ }).waitFor({ timeout: 10000 });
      await sleep(800);
      return d;
    };
    const toEdit = async (d) => {
      await d.getByRole("button", { name: /Generar con 1 tarea/ }).click();
      await d.getByRole("textbox", { name: isPlan ? "Texto del plan de trabajo" : "Contenido de la release" }).waitFor({ timeout: 15000 });
      await sleep(300);
    };
    const box = (d) => d.getByRole("textbox", { name: isPlan ? "Texto del plan de trabajo" : "Contenido de la release" });
    let d = await open();
    await toEdit(d);
    L.check(`SALIR ${kind}: el paso 2 muestra el aviso con los enlaces de las plantillas`, await link(d).isVisible());
    // Sin cambios: navega directamente a Mi perfil → Plantillas.
    await link(d).click();
    await page.waitForURL(/\/settings\?tab=plantillas/, { timeout: 15000 });
    L.check(`SALIR ${kind}: sin cambios no pregunta y navega`, page.url().includes("/settings?tab=plantillas") && (await ask().count()) === 0);
    await openBoard(page);
    // Con el texto cambiado: pregunta; «Seguir editando» se queda con el texto; «Descartar cambios» navega.
    d = await open();
    await toEdit(d);
    const edited = `${await box(d).inputValue()}\nCambio de r52`;
    await box(d).fill(edited);
    await link(d).click();
    await ask().waitFor({ timeout: 5000 });
    L.check(`SALIR ${kind}: con el texto cambiado pregunta antes de salir`, (await ask().innerText()).includes(isPlan ? "Has cambiado el texto del plan" : "Has cambiado el texto de la release"));
    await ask().getByRole("button", { name: "Seguir editando" }).click();
    await sleep(400);
    L.check(`SALIR ${kind}: «Seguir editando» se queda en el tablero con el texto`, page.url().includes(`/p/${PID}`) && (await box(d).inputValue()) === edited);
    // Un clic con Ctrl (nueva pestaña) no deja la página y no pregunta.
    const [popup] = await Promise.all([page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null), link(d).click({ modifiers: ["Control"] })]);
    await sleep(400);
    L.check(`SALIR ${kind}: Ctrl+clic no pregunta ni deja el tablero`, (await ask().count()) === 0 && page.url().includes(`/p/${PID}`));
    if (popup) await popup.close();
    await link(d).click();
    await ask().waitFor({ timeout: 5000 });
    await page.screenshot({ path: `${SHOTS}/r52-salir-${kind}.png` });
    await ask().getByRole("button", { name: "Descartar cambios" }).click();
    await page.waitForURL(/\/settings\?tab=plantillas/, { timeout: 15000 });
    L.check(`SALIR ${kind}: «Descartar cambios» sale por el enlace`, page.url().includes("/settings?tab=plantillas"));
    await openBoard(page);
    // Cambiar solo la cabecera no cuenta como cambio del texto.
    d = await open();
    await toEdit(d);
    await d.locator(isPlan ? "#plan-header" : "#rel-header").selectOption({ label: "Ninguna" });
    await sleep(300);
    await link(d).click();
    await page.waitForURL(/\/settings\?tab=plantillas/, { timeout: 15000 });
    L.check(`SALIR ${kind}: cambiar la cabecera no pide confirmación`, (await ask().count()) === 0);
    await openBoard(page);
  }
  L.assertNoErrors("SALIR", [s]);
  await s.ctx.close();
}

await L.q(`DELETE FROM "Project" WHERE id=$1`, [PID]);
for (const f of FILES.values()) fs.rmSync(f, { force: true });
fs.rmSync(TMP, { recursive: true, force: true });
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
