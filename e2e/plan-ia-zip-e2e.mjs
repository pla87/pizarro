// Ronda 52: plan de trabajo para IA, adjuntos, ritmo por columna, botones de columnas vacías y salida por los enlaces del pie.
//  - zip: «Descargar adjuntos» en el paso 2 del plan (ZIP «adjuntos/NN-titulo/…» con los adjuntos de las tareas, mismo
//    formato y topes que el de la release); el texto cita cada adjunto por su ruta dentro del ZIP (también la imagen pegada
//    en la descripción), sin enlace a Pizarro (la IA no puede abrirlo); solo el .md va a Documentación; la ruta del ZIP de
//    la release sigue igual.
//  - en: con la app en inglés, la carpeta raíz del ZIP y las rutas del texto son «attachments/NN-title/…» (una tarea sin
//    letras, «NN-task»); el servidor admite las dos raíces, con la misma forma estricta, y no deja mezclarlas.
//  - ritmo: las tareas fijas «cada dos» cuentan los planes guardados en SU columna (guardar en una no adelanta a las demás),
//    mientras la versión del documento (_vN) sigue siendo del proyecto.
//  - vacias: «Publicar programa», «Ver lista», «Resumen de presupuesto» y «PDF de la semana» se desactivan sin tarjetas
//    (botón y menú de la columna), con el motivo («No hay tarjetas en «Semana»» bajo el botón; «… en esta columna» en el menú); la lista sin subtareas, también, con su
//    motivo.
//  - salir: con el texto del paso 2 cambiado, un enlace del pie («tus plantillas») pide confirmar como cerrar; sin cambios
//    navega directo. En el plan y en la release.
// Misma base y servidor que tablero-e2e.mjs (el servidor y este script comparten UPLOAD_DIR; por defecto ../uploads):
//   cd e2e && BASE=http://localhost:3272 DATABASE_URL=$DBURL node plan-ia-zip-e2e.mjs   # PART=zip,en,ritmo,vacias,salir
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "./qa/lib.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "zip,en,ritmo,vacias,salir").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "r52-plan-"));
const UPLOADS = path.resolve(process.env.UPLOAD_DIR || path.join(import.meta.dirname, "..", "uploads"));
fs.mkdirSync(UPLOADS, { recursive: true });

await L.prepareUsers();
const PID = "r52_project";
const NAME = "Web r52";
const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const COLS = [
  ["r52_a", "Plan A", "AI_PLAN"], ["r52_b", "Plan B", "AI_PLAN"], ["r52_salto", "Salto", "NEXT_RELEASE"], ["r52_prog", "Temario", "PROGRAM"],
  ["r52_sem", "Semana", "WEEKLY_PLAN"], ["r52_lista", "Lista", "CHECKLIST"],
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
const planText = (dlg) => dlg.getByRole("textbox", { name: /Texto del plan de trabajo|Work plan text/ }).inputValue();
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
  // La imagen pegada en la descripción ya va ahí con su ruta: la lista «Adjuntos» de la tarea no la repite.
  L.check("ZIP: la lista de adjuntos de la tarea 1 no repite la imagen de la descripción", !text.includes(`\`${f1}/Plano_final.webp\``) && !text.includes("`Plano_final.webp`"), text.slice(text.indexOf("### 1."), text.indexOf("### 2.")));
  L.check("ZIP: …y cita el documento de la tarea 1 y el de la 3 (con su número en el plan)", text.includes(`- **Adjuntos:** \`${f1}/notas.txt\`\n`) && text.includes("- **Adjuntos:** `adjuntos/03-con-un-registro/registro.txt`\n"), text.slice(text.indexOf("### 1.")));
  L.check("ZIP: sin enlace a Pizarro", !text.includes(L.BASE), text.slice(text.indexOf("### 1."), text.indexOf("### 2.")));
  L.check("ZIP: la imagen pegada en la descripción apunta a la misma ruta del ZIP", text.includes(`![captura](${f1}/Plano_final.webp)`));
  L.check("ZIP: una imagen que no es adjunto del plan se queda en su texto alternativo (sin enlace a Pizarro)", text.includes("y esto ajena") && !text.includes("/api/attachments/zzzzzz"));
  L.check("ZIP: el contexto explica el ZIP «adjuntos/…» (3 archivos)", text.includes("- **Adjuntos:** 3 archivo(s) en el ZIP «adjuntos/…» que va con este plan"));
  L.check("ZIP: el contexto dice cómo usarlo (la cabecera de serie ya no habla del ZIP)", text.includes("(descomprímelo junto a este fichero)") && text.includes("Las imágenes van en WebP.") && !text.includes("que acompaña a este plan"));
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
  // Cada paquete se pide con el vale del plan (GET); sin `name`, el servidor le pone el nombre de release.
  const relZip = await page.request.get(`${L.BASE}/api/projects/${PID}/release-attachments?ticket=${encodeURIComponent(rel.body.ticket)}&part=1&v=${rel.body.v}`);
  const relDisp = relZip.headers()["content-disposition"] ?? "";
  L.check("ZIP: el de la release, con nombre de release", relZip.status() === 200 && /release-.*-adjuntos\.zip/.test(relDisp), `${relZip.status()} ${relDisp}`);
  // El envío directo del ZIP en la respuesta del POST (sin plan ni vale) ya no existe: 400 con un texto, no un ZIP.
  const direct = await page.request.post(`${L.BASE}/api/projects/${PID}/release-attachments?part=1`, { data: { items: [{ taskId: "r52_t1", code: "F1" }] }, headers: { origin: L.BASE } });
  L.check("ZIP: un POST sin ?plan=1 responde 400 y no un ZIP", direct.status() === 400 && !/zip/.test(direct.headers()["content-type"] ?? "") && (await direct.text()).includes("?plan=1"), `${direct.status()} ${direct.headers()["content-type"]}`);
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

// --- ZIP de adjuntos de un plan en inglés --------------------------------------------------------------------------------------
if (only.includes("en")) {
  L.scenario("en: el ZIP de un plan en inglés usa «attachments/» y el texto cita esas rutas");
  await seed([
    ["r52_t1", "r52_a", "Fix the login", "Fails like this: ![shot](/api/attachments/r52img1)", false],
    ["r52_t2", "r52_a", "¿¡!?", "", false],
  ]);
  await attach("r52img1", "r52_t1", "Final plan.png", true, IMG);
  await attach("r52doc1", "r52_t2", "notes.txt", false, DOC);
  await L.q(`UPDATE "User" SET locale='EN' WHERE id=$1`, [adm.id]);
  try {
    const s = await L.session();
    const { page } = s;
    await page.goto(`${L.BASE}/p/${PID}`);
    await L.colLoc(page, "Plan A").waitFor({ timeout: 20000 });
    await L.liveOpen(page);
    await sleep(500);
    await L.colLoc(page, "Plan A").getByRole("button", { name: "Generate work plan" }).click();
    const dlg = planDialog(page);
    await dlg.locator("[data-plan-step=select]").waitFor({ timeout: 10000 });
    await sleep(1200);
    await dlg.getByRole("button", { name: /Generate with 2 task/ }).click();
    await dlg.locator("[data-plan-step=edit]").waitFor({ timeout: 15000 });
    await sleep(300);
    const text = await planText(dlg);
    const f1 = "attachments/01-fix-the-login";
    L.check("EN: la imagen de la descripción no se repite en la lista de adjuntos (sin enlace a Pizarro)", !text.includes(`\`${f1}/Final_plan.webp\``) && !text.includes(L.BASE) && !text.includes("in Pizarro"), text.slice(text.indexOf("### 1.")));
    L.check("EN: una tarea sin letras en el título va en «02-task»", text.includes("- **Attachments:** `attachments/02-task/notes.txt`\n"), text.slice(text.indexOf("### 2.")));
    L.check("EN: la imagen de la descripción apunta a la misma ruta", text.includes(`![shot](${f1}/Final_plan.webp)`));
    L.check("EN: el contexto explica el ZIP «attachments/…»", text.includes("- **Attachments:** 2 file(s) in the “attachments/…” ZIP that goes with this plan"));
    L.check("EN: el contexto dice cómo usarlo (la cabecera de serie ya no habla del ZIP)", text.includes("(unzip it next to this file)") && text.includes("Images are in WebP.") && !text.includes("`attachments/03-task-title/drawing.webp`"));
    L.check("EN: en el plan en inglés no queda ninguna ruta «adjuntos/»", !text.includes("adjuntos"), text);
    const btn = dlg.getByRole("button", { name: "Download attachments (2)" });
    const today = await appToday(page);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), btn.click()]);
    const zip = path.join(TMP, "plan-en.zip");
    await dl.saveAs(zip);
    L.eq("EN: nombre del fichero en inglés", dl.suggestedFilename(), `plan-${today}-v1-Web_r52-attachments.zip`);
    L.eq("EN: el ZIP contiene exactamente las rutas citadas, bajo «attachments/»", unzipList(zip), [`${f1}/Final_plan.webp`, "attachments/02-task/notes.txt"]);
    L.check("EN: el contenido es el del adjunto", execFileSync("unzip", ["-p", zip, `${f1}/Final_plan.webp`]).equals(IMG));

    // El servidor admite las dos raíces (un plan en español abierto en otra pestaña sigue valiendo), igual de estricto con ambas.
    const post = async (items) => (await page.request.post(`${L.BASE}/api/projects/${PID}/release-attachments?plan=1`, { data: { items }, headers: { origin: L.BASE } })).status();
    L.eq("EN: carpeta «attachments/NN-…» aceptada (200)", await post([{ taskId: "r52_t1", folder: "attachments/01-x" }, { taskId: "r52_t2", folder: "attachments/02-task" }]), 200);
    L.eq("EN: carpeta «adjuntos/NN-…» aceptada (200)", await post([{ taskId: "r52_t1", folder: "adjuntos/01-x" }, { taskId: "r52_t2", folder: "adjuntos/02-tarea" }]), 200);
    L.eq("EN: mezclar las dos raíces en un ZIP se rechaza (400)", await post([{ taskId: "r52_t1", folder: "attachments/01-x" }, { taskId: "r52_t2", folder: "adjuntos/02-x" }]), 400);
    for (const bad of ["attachments/../x", "attachments/x", "attachments/01-x/y", "attachments/01-X", "Attachments/01-x", "files/01-x", "attachments/00001-x", "/attachments/01-x"]) {
      L.eq(`EN: «${bad}» se rechaza (400)`, await post([{ taskId: "r52_t1", folder: bad }]), 400);
    }
    L.eq("EN: una tarea que no es del proyecto, 404", await post([{ taskId: "no_existe", folder: "attachments/01-x" }]), 404);
    L.assertNoErrors("EN", [s]);
    await s.ctx.close();
  } finally {
    await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [adm.id]);
  }
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
  const LABEL = { Temario: "Publicar programa (PDF)", Semana: "PDF de la semana", Lista: "Ver lista", Presupuesto: "Resumen de presupuesto", Salto: "Generar release", "Plan A": "Generar plan de trabajo" };
  const state = async (col) => {
    const b = L.colLoc(page, col).locator("[data-column-action] button").first();
    return [await b.isDisabled(), await b.getAttribute("title")];
  };
  for (const [col, label] of Object.entries(LABEL)) {
    L.check(`VACIAS: «${col}» tiene su botón «${label}»`, (await L.colLoc(page, col).locator("[data-column-action] button").first().innerText()).includes(label));
    // Ronda 68: el motivo nombra la columna y se ve bajo el botón (y es su descripción accesible), no solo en el `title`.
    const why = col === "Salto" ? "Añade tarjetas a esta columna para generar la release" : `No hay tarjetas en «${col}»`;
    L.eq(`VACIAS: «${col}» vacía: botón desactivado con su título`, await state(col), [true, why]);
    const btn = L.colLoc(page, col).locator("[data-column-action] button").first();
    L.eq(`VACIAS: «${col}»: el motivo a la vista bajo el botón`, (await L.colLoc(page, col).locator("[data-column-action-reason]").first().innerText()).trim(), why);
    L.eq(`VACIAS: «${col}»: y como descripción accesible`, await btn.evaluate((b) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent ?? null), why);
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
    await page.getByRole("menu").waitFor({ state: "detached", timeout: 5000 });
    return out;
  };
  for (const [col, names] of Object.entries({
    Temario: ["Publicar programa (PDF)"], Semana: ["PDF de la semana (por día)", "PDF de la semana (por persona)"], Lista: ["Ver lista"],
    Presupuesto: ["Resumen de presupuesto"], "Plan A": ["Generar plan de trabajo"],
  })) L.eq(`VACIAS: «${col}» vacía: su opción del menú también`, await menuItems(col, names), names.map((n) => [n, true, EMPTY]));
  await page.screenshot({ path: `${SHOTS}/r52-vacias.png` });

  // Con una tarjeta se activan (la lista pide además subtareas).
  const add = (id, col, title, extra = "") => L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"createdById","updatedAt"${extra ? ",\"dueDate\"" : ""}) VALUES ($1,$2,$3,$4,'kind_funcionalidad',1024,$5,NOW()${extra ? `,'${extra}'` : ""})`, [id, PID, col, title, adm.id]);
  for (const [id, col, title] of [["r52_v1", "r52_prog", "Sesión"], ["r52_v2", "r52_sem", "Lunes"], ["r52_v4", "r52_presu", "Partida"], ["r52_v5", "r52_a", "Plan"]]) await add(id, col, title);
  await add("r52_li1", "r52_lista", "Sin subtareas");
  await page.reload();
  await L.colLoc(page, "Plan A").waitFor({ timeout: 20000 });
  await sleep(600);
  for (const col of ["Temario", "Semana", "Presupuesto", "Plan A"]) L.eq(`VACIAS: «${col}» con una tarjeta se activa`, (await state(col))[0], false);
  L.eq("VACIAS: «Lista» con tarjetas sin subtareas sigue desactivada, con su motivo", await state("Lista"), [true, "Ninguna tarjeta tiene subtareas"]);
  L.eq("VACIAS: y su opción del menú también", (await menuItems("Lista", ["Ver lista"]))[0].slice(1), [true, "Ninguna tarjeta tiene subtareas"]);
  await L.q(`INSERT INTO "Subtask"(id,"taskId",title,done,position) VALUES ('r52_su1','r52_li1','Paso',false,1000)`);
  await page.reload();
  await L.colLoc(page, "Plan A").waitFor({ timeout: 20000 });
  await sleep(600);
  L.eq("VACIAS: «Lista» con una tarjeta con subtareas se activa", (await state("Lista"))[0], false);
  L.eq("VACIAS: y su opción del menú", (await menuItems("Lista", ["Ver lista"]))[0][1], false);
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
      await L.colLoc(page, "Salto").getByRole("button", { name: "Generar release" }).click();
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
