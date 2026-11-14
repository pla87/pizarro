// Ronda 51: columna «Plan de trabajo para IA» (rol AI_PLAN) y botones de acción de las columnas especiales. El botón
// «Generar plan de trabajo», el diálogo en dos pasos (tareas con las fijas «Siempre en el plan» y su cadencia; cabecera y
// pie de serie para Claude Code, de la persona y del proyecto), el texto generado (contexto, tareas en orden con tipo,
// etiquetas, fechas, subtareas, enlaces y adjuntos), Copiar todo, .md, .txt, cerrar con cambios, «Guardar en
// Documentación» («Plan de trabajo – fecha_vN.md», N sube) con y sin mover las tareas, el editor con barra, el panel de
// fijas, el rol en el menú, las plantillas en Mi perfil y en los ajustes del proyecto, el ejemplo «Preparación de un
// curso» con su columna de plan, todo en inglés a 390 px en modo oscuro, y el mismo aspecto del botón de acción en todas
// las columnas especiales (claro, oscuro y móvil). Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r51-plan-e2e.mjs   # PART=buttons,plan,move,tpl,rich,fixed,role,settings,curso,en
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "buttons,plan,move,tpl,rich,fixed,role,settings,curso,en").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "r51-plan-"));

await L.prepareUsers();
const PID = "r51_project";
const NAME = "Web r51";
const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const COLS = [
  ["r51_pend", "Pendiente", "NONE"], ["r51_plan", "Plan IA", "AI_PLAN"], ["r51_curso", "En curso", "NONE"], ["r51_salto", "Salto", "NEXT_RELEASE"],
  ["r51_prog", "Temario", "PROGRAM"], ["r51_sem", "Semana", "WEEKLY_PLAN"], ["r51_lista", "Lista", "CHECKLIST"], ["r51_agenda", "Agenda", "AGENDA"],
  ["r51_entrega", "Entrega", "DELIVERY"], ["r51_presu", "Presupuesto", "BUDGET"],
];
const ACTION = {
  NEXT_RELEASE: "Generar Release", AI_PLAN: "Generar plan de trabajo", PROGRAM: "Publicar programa (PDF)", WEEKLY_PLAN: "PDF de la semana",
  CHECKLIST: "Ver lista", AGENDA: "Exportar a calendario (.ics)", DELIVERY: "Resumen para el cliente (PDF)", BUDGET: "Resumen de presupuesto",
};

/** Proyecto privado con una columna de cada rol especial, cuatro tareas en «Plan IA» (dos fijas, una cada dos planes) y una en «Salto». */
async function seed() {
  await L.q(`DELETE FROM "Project" WHERE id=$1 OR name=$2`, [PID, NAME]);
  await L.q(`DELETE FROM "ReleaseTemplate" WHERE "userId"=$1 AND kind IN ('PLAN_HEADER','PLAN_FOOTER')`, [adm.id]);
  await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN', locale='ES' WHERE id=$1`, [adm.id]);
  const users = await L.q(`SELECT id FROM "User" WHERE email IN ($1,$2)`, [L.ADMIN, L.USER2]);
  await L.q(`INSERT INTO "Project"(id,name,description,"isPrivate","privateOwnerId",position,"taskFields","updatedAt") VALUES ($1,$2,'Tienda en línea con Next.js.',true,$3,999996,'{priority,startDate,cost}',NOW())`, [PID, NAME, adm.id]);
  for (const u of users) await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [PID, u.id]);
  for (const [i, [id, name, role]] of COLS.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,role) VALUES ($1,$2,$3,$4,$5)`, [id, PID, name, (i + 1) * 1000, role]);
  await L.q(`INSERT INTO "Label"(id,"projectId",name,color) VALUES ('r51_lab','${PID}','Backend','#0ea5e9')`);
  const tasks = [
    ["r51_t1", "Arreglar el login r51", "kind_correccion", 1024, false, 1, "Falla al entrar con Google.\n\n## Pasos\n\n1. Abrir /login\n2. Entrar", "2026-12-31", "ALTA"],
    ["r51_t2", "Añadir pruebas r51", "kind_funcionalidad", 2048, false, 1, "", null, null],
    ["r51_f1", "Revisar estilo r51", "kind_funcionalidad", 3072, true, 1, "Siempre: lenguaje claro.", null, null],
    ["r51_f2", "Actualizar dependencias r51", "kind_funcionalidad", 4096, true, 2, "", null, null],
  ];
  for (const [id, title, kind, pos, ever, every, desc, due, prio] of tasks) {
    await L.q(
      `INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,evergreen,"evergreenEvery",description,"dueDate",priority,"createdById","updatedAt") VALUES ($1,$2,'r51_plan',$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [id, PID, title, kind, pos, ever, every, desc, due, prio, adm.id],
    );
  }
  await L.q(`INSERT INTO "TaskLabel"("taskId","labelId") VALUES ('r51_t1','r51_lab')`);
  await L.q(`INSERT INTO "Subtask"(id,"taskId",title,done,position) VALUES ('r51_s1','r51_t1','Reproducir',true,1000),('r51_s2','r51_t1','Corregir y probar',false,2000)`);
  await L.q(`INSERT INTO "TaskAttachment"(id,"taskId","originalName","mimeType","isImage",size) VALUES ('r51_a1','r51_t1','error.log','text/plain',false,10)`);
  await L.q(`UPDATE "Task" SET "blockedById"='r51_t1' WHERE id='r51_t2'`);
  await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"updatedAt") VALUES ('r51_rel','${PID}','r51_salto','Release r51','kind_funcionalidad',1024,NOW())`);
}

const planCol = (page, name = "Plan IA") => L.colLoc(page, name);
async function openBoard(page) {
  await page.goto(`${L.BASE}/p/${PID}`);
  await planCol(page).waitFor({ timeout: 20000 });
  await sleep(500);
}
const planDialog = (page) => page.locator("[role=dialog]").filter({ hasText: /Generar plan de trabajo|Generate work plan/ }).first();
/** Abre el diálogo desde el botón de la columna y espera a que lleguen las plantillas y la versión. */
async function openPlan(page, col = "Plan IA", label = "Generar plan de trabajo") {
  await planCol(page, col).getByRole("button", { name: label }).click();
  const dlg = planDialog(page);
  await dlg.locator("[data-plan-step=select]").waitFor({ timeout: 10000 });
  await sleep(1200);
  return dlg;
}
async function toStep2(dlg, n, english = false) {
  await dlg.getByRole("button", { name: new RegExp(english ? `Generate with ${n} task` : `Generar con ${n} tarea`) }).click();
  await dlg.locator("[data-plan-step=edit]").waitFor({ timeout: 15000 });
  await sleep(300);
}
const planText = (dlg) => dlg.getByRole("textbox", { name: /Texto del plan de trabajo|Work plan text/ }).inputValue();
async function download(page, dlg, ext) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), dlg.getByRole("button", { name: `.${ext}`, exact: true }).click()]);
  const file = path.join(TMP, `plan-${Date.now()}.${ext}`);
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), text: fs.readFileSync(file, "utf8") };
}
const appToday = (page) => page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: document.documentElement.dataset.tz || undefined }).format(new Date()));
const docs = () => L.q(`SELECT id,name,kind,"mimeType" FROM "ProjectDocument" WHERE "projectId"=$1 AND "deletedAt" IS NULL ORDER BY "createdAt"`, [PID]);

// --- Botones de acción con el mismo aspecto ------------------------------------------------------------------------------
if (only.includes("buttons")) {
  L.scenario("buttons: las columnas especiales tienen su botón de acción, todos con el aspecto de «Generar Release»");
  await seed();
  for (const scheme of ["light", "dark"]) {
    const s = await L.session({ viewport: { width: 2400, height: 950 } });
    const { page } = s;
    await page.emulateMedia({ colorScheme: scheme });
    await openBoard(page);
    const styles = [];
    for (const [, name, role] of COLS) {
      const btn = L.colLoc(page, name).locator("[data-column-action] button").first();
      if (role === "NONE") {
        L.eq(`BTN ${scheme}: «${name}» (sin rol) no tiene botón`, await L.colLoc(page, name).locator("[data-column-action]").count(), 0);
        continue;
      }
      L.check(`BTN ${scheme}: «${name}» muestra «${ACTION[role]}»`, (await btn.innerText()).includes(ACTION[role]), await btn.innerText().catch(() => ""));
      styles.push([name, await btn.evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color, c.borderTopColor, c.borderRadius, c.fontWeight, Math.round(el.getBoundingClientRect().height)].join(" "); })]);
    }
    const ref = styles.find(([n]) => n === "Salto")[1];
    for (const [name, st] of styles) L.eq(`BTN ${scheme}: «${name}» con el mismo aspecto que «Generar Release»`, st, ref);
    await page.screenshot({ path: `${SHOTS}/r51-botones-${scheme}.png` });
    L.assertNoErrors(`BTN ${scheme}`, [s]);
    await s.ctx.close();
  }
  // Móvil: la columna visible lleva su botón a todo el ancho, igual que la de la release.
  const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = s;
  await page.goto(`${L.BASE}/p/${PID}`);
  await page.locator("button").filter({ hasText: /^Temario/ }).first().waitFor({ timeout: 20000 });
  const mobileStyle = async (tab) => {
    await page.locator("button").filter({ hasText: new RegExp(`^${tab}`) }).first().tap();
    await sleep(500);
    const btn = page.locator("[data-column-action] button").filter({ visible: true }).first();
    return btn.evaluate((el) => { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return [c.backgroundColor, Math.round(r.height), r.width > window.innerWidth * 0.8].join(" "); });
  };
  const rel = await mobileStyle("Salto");
  L.eq("BTN móvil: «Publicar programa (PDF)» igual que «Generar Release», a todo el ancho", await mobileStyle("Temario"), rel);
  L.eq("BTN móvil: «Generar plan de trabajo», igual", await mobileStyle("Plan IA"), rel);
  L.check("BTN móvil: sin scroll horizontal", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: `${SHOTS}/r51-botones-movil.png` });
  // «PDF de la semana» abre sus dos opciones.
  await page.locator("button").filter({ hasText: /^Semana/ }).first().tap();
  await sleep(400);
  await page.getByRole("button", { name: "PDF de la semana" }).filter({ visible: true }).first().tap();
  L.check("BTN móvil: «PDF de la semana» ofrece por día y por persona", (await page.getByRole("menuitem", { name: "PDF de la semana (por día)" }).count()) === 1 && (await page.getByRole("menuitem", { name: "PDF de la semana (por persona)" }).count()) === 1);
  await page.keyboard.press("Escape");
  L.assertNoErrors("BTN móvil", [s]);
  await s.ctx.close();
}

// --- Generar, copiar, descargar y guardar --------------------------------------------------------------------------------
let firstSaved = null;
if (only.includes("plan")) {
  L.scenario("plan: generar el plan, copiarlo, descargarlo y guardarlo en Documentación");
  await seed();
  const s = await L.session();
  const { page, ctx } = s;
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  await openBoard(page);
  L.eq("PLAN: el panel «Siempre en el plan» cuenta las dos fijas", (await planCol(page).getByRole("button", { name: /Siempre en el plan/ }).innerText()).replace(/\s+/g, " ").trim(), "Siempre en el plan 2");
  const dlg = await openPlan(page);
  const rows = dlg.locator("ul li");
  L.eq("PLAN: paso 1 con las tareas de la columna en orden (las fijas al final)", (await rows.allInnerTexts()).map((t) => t.split("\n").pop().replace(/fija.*$/, "").trim()).length, 4);
  const checked = await rows.evaluateAll((els) => els.map((li) => [li.innerText.includes("r51") ? li.innerText.match(/[^\n]*r51/)[0].trim() : "", li.querySelector("input").checked]));
  L.eq("PLAN: todas marcadas salvo la fija de «cada dos» (al plan 1 no le toca)", checked.map(([, c]) => c), [true, true, true, false]);
  L.check("PLAN: las fijas dicen «fija» y su cadencia", (await rows.nth(3).innerText()).includes("fija · Cada dos · en el siguiente"), await rows.nth(3).innerText());
  L.eq("PLAN: cabecera y pie de serie por defecto (sin plantillas propias)", [await dlg.locator("#plan-header option:checked").innerText(), await dlg.locator("#plan-footer option:checked").innerText()], ["Claude Code (de serie)", "Entrega (de serie)"]);
  await page.screenshot({ path: `${SHOTS}/r51-plan-paso1.png` });
  await toStep2(dlg, 3);
  const text = await planText(dlg);
  const today = await appToday(page);
  for (const piece of [
    `# Plan de trabajo – ${NAME}`, "## Instrucciones para la IA", "Claude Code", "## Contexto del proyecto", `- **Proyecto:** [${NAME}](<${L.BASE}/p/${PID}>)`, "- **Columna:** Plan IA",
    "Tienda en línea con Next.js.", "- **Tareas:** 3", "### 1. Arreglar el login r51", "- **Tipo:** Corrección", "- **Prioridad:** Alta", "- **Etiquetas:** Backend",
    "- **Fecha límite:** 2026-12-31", `- **Tarea en Pizarro:** [abrir](<${L.BASE}/p/${PID}?task=r51_t1>)`, `- **Adjuntos:** [error.log](<${L.BASE}/api/attachments/r51_a1>)`,
    "#### Pasos", "- [x] Reproducir", "- [ ] Corregir y probar", "### 2. Añadir pruebas r51", "- **Depende de:** la tarea 1 («Arreglar el login r51»)",
    "### 3. Revisar estilo r51", "- _Tarea fija: entra en todos los planes._", "## Entrega",
  ]) L.check(`PLAN: el texto incluye «${piece.slice(0, 70)}»`, text.includes(piece), text.slice(0, 200));
  L.check("PLAN: la fija que no toca no entra", !text.includes("Actualizar dependencias r51"));
  L.check("PLAN: las tareas en el orden de la columna", text.indexOf("### 1.") < text.indexOf("### 2.") && text.indexOf("### 2.") < text.indexOf("### 3."));
  L.check("PLAN: dice el nombre con el que se guardará", (await dlg.innerText()).includes(`Se guardará como «Plan de trabajo – ${today}_v1.md».`));
  await page.screenshot({ path: `${SHOTS}/r51-plan-paso2.png` });

  await dlg.getByRole("button", { name: "Copiar todo" }).click();
  await sleep(300);
  L.eq("PLAN: «Copiar todo» copia el texto", await page.evaluate(() => navigator.clipboard.readText()), text);
  const md = await download(page, dlg, "md");
  L.eq("PLAN: .md con su nombre y el texto", [md.name, md.text], [`Plan de trabajo - ${today}_v1.md`, text]);
  const txt = await download(page, dlg, "txt");
  L.eq("PLAN: .txt con su nombre y el texto", [txt.name, txt.text], [`Plan de trabajo - ${today}_v1.txt`, text]);

  // Cambiar la cabecera en el paso 2 la sustituye en el texto; quitar el pie lo quita.
  await dlg.locator("#plan-footer").selectOption("");
  await sleep(200);
  L.check("PLAN: sin pie, el texto ya no lleva «## Entrega»", !(await planText(dlg)).includes("## Entrega"));
  await dlg.locator("#plan-footer").selectOption({ label: "Entrega (de serie)" });

  // Con el texto cambiado, cerrar pregunta antes.
  const edited = (await planText(dlg)).replace("Añadir pruebas r51", "Añadir pruebas de extremo a extremo r51");
  await dlg.getByRole("textbox", { name: "Texto del plan de trabajo" }).fill(edited);
  await page.keyboard.press("Escape");
  const ask = page.getByRole("dialog").filter({ hasText: "Cambios sin guardar" });
  await ask.waitFor({ timeout: 5000 });
  L.check("PLAN: al cerrar con cambios pregunta", (await ask.innerText()).includes("Has cambiado el texto del plan"));
  await ask.getByRole("button", { name: "Seguir editando" }).click();
  await sleep(300);
  L.eq("PLAN: «Seguir editando» conserva el texto", await planText(dlg), edited);

  await dlg.getByRole("button", { name: "Guardar en Documentación" }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  const saved = await docs();
  L.eq("PLAN: un documento Markdown «Plan de trabajo – fecha_v1.md»", saved.map((d) => [d.name, d.kind, d.mimeType]), [[`Plan de trabajo – ${today}_v1.md`, "MARKDOWN", "text/markdown"]]);
  firstSaved = saved[0];
  L.check("PLAN: el aviso dice dónde se ha guardado", await page.getByText(`Guardado en Documentación como «Plan de trabajo – ${today}_v1.md».`).first().isVisible().catch(() => false));
  const [{ columnId }] = await L.q(`SELECT "columnId" FROM "Task" WHERE id='r51_t1'`);
  L.eq("PLAN: por defecto las tareas no se mueven", columnId, "r51_plan");
  const content = await page.request.get(`${L.BASE}/api/documents/${firstSaved.id}`).then((r) => r.text());
  L.eq("PLAN: el documento guarda el texto editado", content, edited);
  // «Abrir Documentación» del aviso lleva al documento.
  await page.getByRole("button", { name: "Abrir Documentación" }).first().click();
  await page.waitForURL(new RegExp(`/p/${PID}/docs\\?doc=${firstSaved.id}`), { timeout: 10000 });
  L.check("PLAN: «Abrir Documentación» abre el plan guardado", page.url().includes(firstSaved.id));
  L.assertNoErrors("PLAN", [s]);
  await s.ctx.close();
}

// --- Segunda versión, moviendo las tareas ---------------------------------------------------------------------------------
if (only.includes("move")) {
  L.scenario("move: la segunda versión es _v2 y, si se pide, las tareas pasan a otra columna (las fijas no)");
  if (!firstSaved) await seed();
  const s = await L.session();
  const { page } = s;
  await openBoard(page);
  const dlg = await openPlan(page);
  const n = await dlg.locator("ul li input:checked").count();
  await toStep2(dlg, n);
  const before = (await docs()).length;
  const today = await appToday(page);
  L.check("MOVE: mover está desactivado por defecto", !(await dlg.getByLabel("Al guardar, mover las tareas a").isChecked()));
  L.eq("MOVE: el destino por defecto es la columna siguiente", await dlg.getByLabel("Columna a la que se mueven las tareas").locator("option:checked").innerText(), "En curso");
  await dlg.getByLabel("Al guardar, mover las tareas a").check();
  L.check("MOVE: dice la versión siguiente", (await dlg.innerText()).includes(`_v${before + 1}.md`));
  await dlg.getByRole("button", { name: "Guardar en Documentación" }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  const after = await docs();
  L.eq("MOVE: se guarda como la versión siguiente", after.at(-1).name, `Plan de trabajo – ${today}_v${before + 1}.md`);
  await L.eqEventually("MOVE: las tareas normales pasan a «En curso»", async () => (await L.q(`SELECT id FROM "Task" WHERE "columnId"='r51_curso' ORDER BY position`)).map((r) => r.id), ["r51_t1", "r51_t2"]);
  L.eq("MOVE: las fijas se quedan en el plan", (await L.q(`SELECT id, evergreen FROM "Task" WHERE "columnId"='r51_plan' ORDER BY position`)).map((r) => [r.id, r.evergreen]), [["r51_f1", true], ["r51_f2", true]]);
  await L.cardLoc(page, "Arreglar el login r51").waitFor({ timeout: 10000 });
  L.check("MOVE: el tablero las muestra en «En curso»", (await L.colLoc(page, "En curso").innerText()).includes("Arreglar el login r51"));
  L.assertNoErrors("MOVE", [s]);
  await s.ctx.close();
}

// --- Plantillas de la persona y del proyecto -----------------------------------------------------------------------------
if (only.includes("tpl")) {
  L.scenario("tpl: la cabecera de la persona y el pie del proyecto van por defecto; cambiar a la de serie la sustituye");
  await seed();
  await L.q(`INSERT INTO "ReleaseTemplate"(id,"userId",kind,name,content,position) VALUES ('r51_uh',$1,'PLAN_HEADER','Mi cabecera r51','## Mis reglas\n\nUsa pnpm y TypeScript estricto.',1)`, [adm.id]);
  await L.q(`INSERT INTO "ProjectReleaseTemplate"(id,"projectId",kind,name,content,position) VALUES ('r51_pf',$1,'PLAN_FOOTER','Pie del repo r51','Abre un PR contra main.',1)`, [PID]);
  await L.q(`INSERT INTO "ReleaseTemplate"(id,"userId",kind,name,content,position) VALUES ('r51_rh',$1,'HEADER','Cabecera de release r51','Release',1) ON CONFLICT DO NOTHING`, [adm.id]);
  try {
    const s = await L.session();
    const { page } = s;
    await openBoard(page);
    const dlg = await openPlan(page);
    L.eq("TPL: por defecto, la cabecera de la persona y el pie del proyecto", [await dlg.locator("#plan-header option:checked").innerText(), await dlg.locator("#plan-footer option:checked").innerText()], ["Mi cabecera r51", "Pie del repo r51"]);
    const groups = await dlg.locator("#plan-header optgroup").evaluateAll((els) => els.map((g) => g.label));
    L.eq("TPL: grupos «Tuyas», «Del proyecto» y «De serie»", groups, ["Tuyas", "De serie"]);
    L.check("TPL: las cabeceras de release no salen en el plan", !(await dlg.locator("#plan-header").innerText()).includes("Cabecera de release r51"));
    await toStep2(dlg, 3);
    let text = await planText(dlg);
    L.check("TPL: el texto lleva la cabecera y el pie elegidos", text.includes("Usa pnpm y TypeScript estricto.") && text.trim().endsWith("Abre un PR contra main."), text.slice(-80));
    await dlg.locator("#plan-header").selectOption({ label: "Claude Code (de serie)" });
    await sleep(200);
    text = await planText(dlg);
    L.check("TPL: cambiar a la de serie la sustituye en el texto", text.includes("## Instrucciones para la IA") && !text.includes("Usa pnpm"));
    await dlg.getByRole("button", { name: "Cancelar" }).or(dlg.getByRole("button", { name: "Cerrar" })).first().click().catch(() => page.keyboard.press("Escape"));
    await page.keyboard.press("Escape");
    L.assertNoErrors("TPL", [s]);
    await s.ctx.close();
  } finally {
    await L.q(`DELETE FROM "ReleaseTemplate" WHERE id IN ('r51_uh','r51_rh')`);
  }
}

// --- Editor con barra de formato -----------------------------------------------------------------------------------------
if (only.includes("rich")) {
  L.scenario("rich: con «Con barra de formato» el paso 2 usa el editor con barra y se guarda igual");
  await seed();
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG' WHERE id=$1`, [adm.id]);
  try {
    const s = await L.session();
    const { page } = s;
    await openBoard(page);
    const dlg = await openPlan(page);
    await dlg.getByRole("button", { name: /Generar con 3 tarea/ }).click();
    await dlg.locator("[data-plan-editor=rich] .ProseMirror").waitFor({ timeout: 15000 });
    L.check("RICH: el plan se ve con formato (secciones como títulos)", (await dlg.locator("[data-plan-editor=rich] .ProseMirror h2").first().innerText()).includes("Instrucciones para la IA"));
    L.eq("RICH: sin pestañas Editar / Vista previa", await dlg.getByRole("tab").count(), 0);
    await dlg.locator("[data-plan-editor=rich] .ProseMirror h3", { hasText: "Arreglar el login r51" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" (urgente)");
    const md = await download(page, dlg, "md");
    L.check("RICH: el .md lleva el cambio y sigue siendo Markdown (lo no tocado, tal cual)", md.text.includes("### 1. Arreglar el login r51 (urgente)") && md.text.includes("- [x] Reproducir") && md.text.startsWith(`# Plan de trabajo – ${NAME}`), md.text.slice(0, 300));
    await dlg.getByRole("button", { name: "Guardar en Documentación" }).click();
    await dlg.waitFor({ state: "detached", timeout: 15000 });
    L.eq("RICH: guardado en Documentación", (await docs()).length, 1);
    L.assertNoErrors("RICH", [s]);
    await s.ctx.close();
  } finally {
    await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN' WHERE id=$1`, [adm.id]);
  }
}

// --- Panel de fijas, nueva tarea fija y detalle -----------------------------------------------------------------------------
if (only.includes("fixed")) {
  L.scenario("fixed: «Siempre en el plan»: añadir una fija desde el panel, la marca en el detalle y la cadencia");
  await seed();
  const s = await L.session();
  const { page } = s;
  await openBoard(page);
  const toggle = planCol(page).getByRole("button", { name: /Siempre en el plan/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await sleep(300);
  const panel = planCol(page).locator('[id^="evergreen-"]');
  L.eq("FIXED: el panel abierto muestra las dos fijas", await panel.locator("[role=button]").count(), 2);
  L.eq("FIXED: la cadencia habla de planes", await panel.getByTestId("evergreen-every").first().getAttribute("title"), "Incluir en todos los planes");
  await panel.getByTestId("evergreen-every").first().click();
  await L.eqEventually("FIXED: pulsar la cadencia la cambia a cada dos planes", async () => (await L.q(`SELECT "evergreenEvery" FROM "Task" WHERE id='r51_f1'`))[0].evergreenEvery, 2);
  await panel.getByRole("button", { name: "Añadir" }).click();
  const nt = U.dialog(page);
  await nt.waitFor();
  await sleep(300);
  L.check("FIXED: «Nueva tarea» desde el panel viene marcada «Siempre en el plan (fija)»", await nt.getByLabel("Siempre en el plan (fija)").isChecked());
  await nt.getByRole("textbox", { name: "Título", exact: true }).fill("Nueva fija r51");
  await nt.getByRole("button", { name: "Crear tarea" }).click();
  await nt.waitFor({ state: "detached", timeout: 10000 });
  await L.eqEventually("FIXED: se crea fija en la columna del plan", async () => JSON.stringify((await L.q(`SELECT "columnId", evergreen FROM "Task" WHERE title='Nueva fija r51'`))[0] ?? null), JSON.stringify({ columnId: "r51_plan", evergreen: true }));
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/r51-fijas.png` });
  // Por el título (en el centro está el interruptor de cadencia).
  await panel.locator("[role=button]").filter({ hasText: "Revisar estilo r51" }).click({ position: { x: 20, y: 12 } });
  const td = U.dialog(page);
  await td.waitFor();
  await sleep(400);
  L.check("FIXED: el detalle de una fija del plan dice «Siempre en el plan (fija)» marcada", await td.getByLabel("Siempre en el plan (fija)").isChecked());
  await td.getByLabel("Siempre en el plan (fija)").uncheck();
  await L.eqEventually("FIXED: desmarcarla la vuelve normal", async () => (await L.q(`SELECT evergreen FROM "Task" WHERE id='r51_f1'`))[0].evergreen, false);
  await page.keyboard.press("Escape");
  await sleep(300);
  // Llevar una tarjeta al panel la hace fija de esa columna (y no de la release).
  L.assertNoErrors("FIXED", [s]);
  await s.ctx.close();
}

// --- El rol en el menú de la columna --------------------------------------------------------------------------------------
if (only.includes("role")) {
  L.scenario("role: «Plan de trabajo para IA» en el selector de rol, con icono y explicación; se repite");
  await seed();
  const s = await L.session();
  const { page } = s;
  await openBoard(page);
  const pend = L.colLoc(page, "Pendiente");
  await pend.getByRole("button", { name: "Opciones de columna" }).click();
  const item = page.getByRole("menuitemradio", { name: "Plan de trabajo para IA" });
  L.eq("ROLE: la opción tiene icono y explicación", [await item.locator("svg").count(), await item.getAttribute("title")], [1, "Sus tarjetas forman un plan de trabajo en Markdown para una IA (botón «Generar plan de trabajo»)."]);
  await page.screenshot({ path: `${SHOTS}/r51-rol.png` });
  await item.click();
  await L.eqEventually("ROLE: «Pendiente» pasa a tener «Generar plan de trabajo»", async () => pend.getByRole("button", { name: "Generar plan de trabajo" }).count(), 1);
  L.eq("ROLE: vacía, el botón está desactivado", await pend.getByRole("button", { name: "Generar plan de trabajo" }).isDisabled(), true);
  await L.eqEventually("ROLE: dos columnas con el rol", async () => (await L.q(`SELECT count(*) n FROM "Column" WHERE "projectId"=$1 AND role='AI_PLAN'`, [PID]))[0].n, "2");
  L.eq("ROLE: «Plan IA» conserva sus fijas", Number((await L.q(`SELECT count(*) n FROM "Task" WHERE "columnId"='r51_plan' AND evergreen`))[0].n), 2);
  // Quitar el rol a «Plan IA»: sus fijas pasan a normales y el botón desaparece.
  await planCol(page).getByRole("button", { name: "Opciones de columna" }).click();
  await page.getByRole("menuitemradio", { name: "Sin rol" }).click();
  await L.eqEventually("ROLE: sin rol, sin botón", async () => planCol(page).getByRole("button", { name: "Generar plan de trabajo" }).count(), 0);
  await L.eqEventually("ROLE: y sus fijas pasan a normales", async () => Number((await L.q(`SELECT count(*) n FROM "Task" WHERE "columnId"='r51_plan' AND evergreen`))[0].n), 0);
  L.assertNoErrors("ROLE", [s]);
  await s.ctx.close();
}

// --- Plantillas en Mi perfil y en los ajustes del proyecto ----------------------------------------------------------------
if (only.includes("settings")) {
  L.scenario("settings: plantillas del plan en Mi perfil (empiezan con la de serie) y en los ajustes del proyecto");
  await seed();
  const s = await L.session();
  const { page } = s;
  await page.goto(`${L.BASE}/settings?tab=plantillas`);
  const section = page.locator("section#plan");
  await section.waitFor({ timeout: 15000 });
  L.check("SET: Mi perfil → Plantillas tiene «Plantillas del plan de trabajo para IA»", (await section.innerText()).includes("Plantillas del plan de trabajo para IA"));
  await section.getByRole("button", { name: "Añadir cabecera" }).click();
  const form = section.getByRole("group", { name: "Nueva cabecera" });
  await form.waitFor();
  L.eq("SET: una cabecera nueva empieza con el nombre y el texto de serie", await form.getByRole("textbox", { name: "Nombre" }).inputValue(), "Instrucciones para la IA");
  L.check("SET: …con el texto para Claude Code", (await form.locator("textarea").inputValue()).includes("Claude Code"));
  await form.getByRole("textbox", { name: "Nombre" }).fill("Cabecera e2e r51");
  await form.getByRole("button", { name: "Guardar" }).click();
  await L.eqEventually("SET: se guarda como cabecera del plan", async () => JSON.stringify((await L.q(`SELECT kind FROM "ReleaseTemplate" WHERE "userId"=$1 AND name='Cabecera e2e r51'`, [adm.id]))[0] ?? null), JSON.stringify({ kind: "PLAN_HEADER" }));
  await page.screenshot({ path: `${SHOTS}/r51-mi-perfil.png` });
  await page.goto(`${L.BASE}/p/${PID}/settings?tab=releases`);
  const proj = page.locator("section#plan");
  await proj.waitFor({ timeout: 15000 });
  L.check("SET: los ajustes del proyecto tienen las plantillas del plan", (await proj.innerText()).includes("Plantillas del plan de trabajo para IA del proyecto"));
  L.check("SET: la pestaña se llama «Plantillas»", (await page.getByRole("tab", { name: "Plantillas" }).or(page.getByRole("link", { name: "Plantillas" })).count()) > 0);
  await proj.getByRole("button", { name: "Añadir pie" }).click();
  const pform = proj.getByRole("group", { name: "Nuevo pie" });
  await pform.getByRole("textbox", { name: "Nombre" }).fill("Pie e2e r51");
  await pform.getByRole("button", { name: "Guardar" }).click();
  await L.eqEventually("SET: se guarda como pie del plan del proyecto", async () => JSON.stringify((await L.q(`SELECT kind FROM "ProjectReleaseTemplate" WHERE "projectId"=$1 AND name='Pie e2e r51'`, [PID]))[0] ?? null), JSON.stringify({ kind: "PLAN_FOOTER" }));
  await L.q(`DELETE FROM "ReleaseTemplate" WHERE "userId"=$1 AND name='Cabecera e2e r51'`, [adm.id]);
  L.assertNoErrors("SET", [s]);
  await s.ctx.close();
}

// --- El ejemplo «Preparación de un curso» -------------------------------------------------------------------------------
if (only.includes("curso")) {
  L.scenario("curso: el ejemplo trae «Ejercicios y exámenes», «Plan de trabajo para IA» con una fija y sin «Hecho»");
  const COURSE = "Curso r51";
  await L.q(`DELETE FROM "Project" WHERE name=$1`, [COURSE]);
  const s = await L.session();
  const { page } = s;
  try {
    await page.locator("aside").first().locator("button[aria-haspopup]").first().click();
    await page.getByRole("menuitem", { name: "Nuevo proyecto" }).click();
    const nd = page.locator("[role=dialog]").filter({ has: page.locator("#project-name") });
    await nd.waitFor();
    await L.waitFor(async () => (await nd.locator("#project-start option", { hasText: "Preparación de un curso" }).count()) === 1, { timeout: 8000 });
    await nd.locator("#project-start").selectOption({ label: "Preparación de un curso" });
    await nd.locator("#project-name").fill(COURSE);
    await nd.getByRole("button", { name: "Crear", exact: true }).click();
    await L.waitFor(async () => (await L.q(`SELECT 1 FROM "Project" WHERE name=$1`, [COURSE])).length === 1, { timeout: 15000 });
    const [{ id }] = await L.q(`SELECT id FROM "Project" WHERE name=$1`, [COURSE]);
    const cols = await L.q(`SELECT name, role, "isDone" FROM "Column" WHERE "projectId"=$1 ORDER BY position`, [id]);
    L.eq("CURSO: columnas", cols.map((c) => [c.name, c.role, c.isDone]), [
      ["Ideas", "NONE", false], ["Materiales", "NONE", false], ["Ejercicios y exámenes", "NONE", false],
      ["Plan de trabajo para IA", "AI_PLAN", false], ["Programa", "PROGRAM", false], ["Seguimiento de alumnos", "NONE", false],
    ]);
    await page.goto(`${L.BASE}/p/${id}`);
    const col = L.colLoc(page, "Plan de trabajo para IA");
    await col.waitFor({ timeout: 15000 });
    L.eq("CURSO: la columna del plan tiene su botón y una fija", [await col.getByRole("button", { name: "Generar plan de trabajo" }).count(), (await col.getByRole("button", { name: /Siempre en el plan/ }).innerText()).replace(/\s+/g, " ").trim()], [1, "Siempre en el plan 1"]);
    L.check("CURSO: el examen de muestra está en «Ejercicios y exámenes»", (await L.colLoc(page, "Ejercicios y exámenes").innerText()).includes("Examen: Parcial del módulo 1"));
    const dlg = await openPlan(page, "Plan de trabajo para IA");
    await toStep2(dlg, 2);
    const text = await planText(dlg);
    L.check("CURSO: el plan lleva el encargo y la fija", text.includes("### 1. Ejercicio: Casos prácticos del módulo 1") && text.includes("### 2. Material: Revisar el estilo de lo entregado") && text.includes("**Notas para el agente:** prepara también la solución."), text.slice(0, 400));
    await page.screenshot({ path: `${SHOTS}/r51-curso.png` });
    L.assertNoErrors("CURSO", [s]);
  } finally {
    await s.ctx.close();
    await L.q(`DELETE FROM "Project" WHERE name=$1`, [COURSE]);
  }
}

// --- En inglés, móvil y modo oscuro -------------------------------------------------------------------------------------
if (only.includes("en")) {
  L.scenario("en: todo en inglés a 390 px en modo oscuro");
  await seed();
  await L.q(`UPDATE "User" SET locale='EN' WHERE id=$1`, [adm.id]);
  await L.q(`INSERT INTO "ProjectDocument"(id,"projectId",name,"mimeType",size,kind,"updatedAt") VALUES ('r51_doc','${PID}','Plan de trabajo – 2026-01-01_v4.md','text/markdown',1,'MARKDOWN',NOW())`);
  try {
    const s = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
    const { page } = s;
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${L.BASE}/p/${PID}`);
    await page.locator("button").filter({ hasText: /^Plan IA/ }).first().tap();
    await sleep(500);
    await page.getByRole("button", { name: "Generate work plan" }).filter({ visible: true }).first().tap();
    const dlg = planDialog(page);
    await dlg.locator("[data-plan-step=select]").waitFor({ timeout: 10000 });
    await sleep(1200);
    L.eq("EN: cabecera y pie de serie en inglés", [await dlg.locator("#plan-header option:checked").innerText(), await dlg.locator("#plan-footer option:checked").innerText()], ["Claude Code (built-in)", "Delivery (built-in)"]);
    L.check("EN: el diálogo cabe en 390 px", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: `${SHOTS}/r51-en-paso1.png` });
    await toStep2(dlg, 3, true);
    const text = await planText(dlg);
    for (const piece of ["# Work plan – Web r51", "## Instructions for the AI", "## Project context", "- **Type:** Bug fix", "- **Due date:** 2026-12-31", "**Checklist (acceptance criteria):**", "- **Depends on:** task 1", "## Delivery"]) {
      L.check(`EN: el texto incluye «${piece}»`, text.includes(piece), text.slice(0, 200));
    }
    const today = await appToday(page);
    L.check("EN: se guardará como la v5 (tras la v4 importada), con el nombre en inglés", (await dlg.innerText()).includes(`Work plan – ${today}_v5.md`));
    await page.screenshot({ path: `${SHOTS}/r51-en-paso2.png` });
    await dlg.getByRole("button", { name: "Save to Documentation" }).tap();
    await dlg.waitFor({ state: "detached", timeout: 15000 });
    L.eq("EN: guardado como «Work plan – fecha_v5.md»", (await docs()).map((d) => d.name).includes(`Work plan – ${today}_v5.md`), true);
    L.assertNoErrors("EN", [s]);
    await s.ctx.close();
  } finally {
    await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [adm.id]);
  }
}

await L.q(`DELETE FROM "Project" WHERE id=$1`, [PID]);
fs.rmSync(TMP, { recursive: true, force: true });
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
