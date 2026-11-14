// Plantilla «Curso o máster» y columna «Programa» (rol PROGRAM): crear un proyecto con la plantilla desde «Nuevo
// proyecto», crear sesiones con el tipo «Sesión» (título y descripción automáticos), «Publicar programa (PDF)» con el
// responsable, descargarlo y comprobar su contenido con pdftotext, la copia «Programa – fecha_v1.pdf» en Documentación,
// el PDF en inglés, el aviso cuando no cabe en Documentación y el rol con su icono y explicación en el menú de la
// columna. Misma base y servidor que board-e2e.mjs (necesita `pdftotext`, de poppler-utils):
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r50-curso-e2e.mjs      # PART=tpl,pdf,en,full,role
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "tpl,pdf,en,full,role").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "r50-curso-"));
const PROJECT = "Máster R50";

const pdfText = (file) => execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
const appToday = (page) => page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: document.documentElement.dataset.tz || undefined }).format(new Date()));

await L.prepareUsers();
const [adm] = await L.q(`SELECT id, name FROM "User" WHERE email=$1`, [L.ADMIN]);
// «Plantillas» en «Nuevo proyecto» es de administradores: la sesión se abre como miembro (sin el segundo paso) y pasa a admin.
const asAdmin = (on) => L.q(`UPDATE "User" SET role=$1 WHERE email=$2`, [on ? "ADMIN" : "MEMBER", L.ADMIN]);
await L.q(`DELETE FROM "Project" WHERE name=$1`, [PROJECT]);

const s = await L.session({ viewport: { width: 1600, height: 950 } });
const { page } = s;
let projectId = null;
let programId = null;
const dlg = () => page.locator("[role=dialog]").filter({ hasText: /Publicar programa|Publish programme/ }).first();
const programCol = () => L.colLoc(page, "Programa");

/** Abre «Publicar programa (PDF)» desde el botón de la columna (o desde su menú) y espera el diálogo. */
async function openPublish(viaMenu = false, english = false) {
  if (viaMenu) {
    await programCol().getByRole("button", { name: english ? "Column options" : "Opciones de columna" }).click();
    await page.getByRole("menuitem", { name: english ? "Publish programme (PDF)" : "Publicar programa (PDF)" }).click();
  } else {
    await programCol().getByRole("button", { name: "Publicar programa (PDF)" }).click();
  }
  await dlg().waitFor();
  await sleep(300);
}

/** Pulsa «Publicar», espera el resultado y descarga el PDF con «Descargar». Devuelve su texto. */
async function publishAndDownload(file, english = false) {
  await dlg().getByRole("button", { name: english ? "Publish" : "Publicar", exact: true }).click();
  await dlg().locator("[data-program-ready]").waitFor({ timeout: 30000 });
  const [download] = await Promise.all([page.waitForEvent("download"), dlg().getByRole("link", { name: english ? "Download" : "Descargar" }).click()]);
  const out = path.join(TMP, file);
  await download.saveAs(out);
  return { text: pdfText(out), filename: download.suggestedFilename(), bytes: fs.statSync(out).size };
}

await asAdmin(true);
try {
  // --- Crear el proyecto con la plantilla ----------------------------------------------------------------------------
  if (only.includes("tpl")) {
    L.scenario("tpl: «Nuevo proyecto» con la plantilla «Curso o máster»");
    await L.reload(page);
    await page.locator("aside").first().locator("button[aria-haspopup]").first().click();
    await page.getByRole("menuitem", { name: "Nuevo proyecto" }).click();
    const nd = page.locator("[role=dialog]").filter({ has: page.locator("#project-name") });
    await nd.waitFor();
    await L.waitFor(async () => (await nd.locator("#project-start optgroup[label=Plantillas] option", { hasText: "Curso o máster" }).count()) === 1, { timeout: 8000 });
    const options = await nd.locator("#project-start option").allTextContents();
    L.check("TPL: la plantilla «Curso o máster» y el ejemplo «Preparación de un curso», con nombres distintos", options.filter((o) => o === "Curso o máster").length === 1 && options.includes("Preparación de un curso"), JSON.stringify(options));
    await nd.locator("#project-start").selectOption({ label: "Curso o máster" });
    const help = await nd.locator("#project-start-help").innerText();
    L.check("TPL: la línea de ayuda describe la plantilla", /Preparar un curso o máster/.test(help), help);
    await nd.locator("#project-name").fill(PROJECT);
    await nd.getByRole("button", { name: "Crear", exact: true }).click();
    await page.waitForURL(/\/p\/[^/]+\/settings/, { timeout: 15000 });
    [{ id: projectId }] = await L.q(`SELECT id FROM "Project" WHERE name=$1`, [PROJECT]);
    const cols = await L.q(`SELECT name, role, "isDone", id FROM "Column" WHERE "projectId"=$1 ORDER BY position`, [projectId]);
    L.eq("TPL: columnas de la plantilla, con «Programa» como columna PROGRAM", cols.map((c) => [c.name, c.role, c.isDone]), [
      ["Ideas", "NONE", false], ["Materiales", "NONE", false], ["Ejercicios", "NONE", false], ["Exámenes", "NONE", false],
      ["Programa", "PROGRAM", false], ["Seguimiento de alumnos", "NONE", false], ["Hecho", "NONE", true],
    ]);
    programId = cols.find((c) => c.role === "PROGRAM").id;
    const kinds = await L.q(`SELECT name FROM "TaskKind" WHERE "projectId"=$1 ORDER BY position`, [projectId]);
    L.eq("TPL: tipos de la plantilla", kinds.map((k) => k.name), ["Sesión", "Preparar material", "Preparar ejercicio", "Preparar examen", "Revisar perfil de alumno", "Corregir", "Tutoría"]);
    const [proj] = await L.q(`SELECT "taskFields" FROM "Project" WHERE id=$1`, [projectId]);
    L.eq("TPL: activa la fecha de inicio (sesiones de varios días)", proj.taskFields, ["startDate"]);
    L.eq("TPL: sin tarjetas", Number((await L.q(`SELECT count(*) n FROM "Task" WHERE "projectId"=$1`, [projectId]))[0].n), 0);
    // Las personas del equipo como miembros (para asignar las sesiones), como hace prepareUsers con el resto de proyectos.
    await L.q(`INSERT INTO "ProjectMember"("projectId","userId") SELECT $1, id FROM "User" ON CONFLICT DO NOTHING`, [projectId]);
    await page.goto(`${L.BASE}/p/${projectId}`);
    await programCol().waitFor({ timeout: 15000 });
    L.check("TPL: la columna «Programa» muestra «Publicar programa (PDF)»", await programCol().getByRole("button", { name: "Publicar programa (PDF)" }).isVisible());
    L.eq("TPL: las demás columnas no", await page.getByRole("button", { name: "Publicar programa (PDF)" }).count(), 1);
  }

  // --- Sesiones y PDF --------------------------------------------------------------------------------------------------
  if (only.includes("pdf") && projectId) {
    L.scenario("pdf: crear sesiones con el tipo «Sesión» y publicar el programa");
    // Dos sesiones desde «+» de la columna: el tipo rellena el título y el comienzo de la descripción.
    const addSession = async (title, due) => {
      await programCol().getByRole("button", { name: "Añadir tarea en Programa" }).click();
      const nt = U.dialog(page);
      await nt.waitFor();
      await sleep(300);
      await nt.getByRole("radio", { name: "Preparar material" }).click();
      L.eq(`PDF: «Preparar material» pone su título automático (${title})`, await nt.getByRole("textbox", { name: "Título", exact: true }).inputValue(), "Material:");
      await nt.getByRole("radio", { name: "Sesión" }).click();
      L.eq(`PDF: «Sesión» pone su título automático (${title})`, await nt.getByRole("textbox", { name: "Título", exact: true }).inputValue(), "Sesión:");
      await nt.getByRole("textbox", { name: "Título", exact: true }).fill(title);
      await nt.getByLabel("Fecha límite (opcional)").fill(due);
      await nt.getByLabel("Asignada a (opcional)").selectOption(adm.id);
      await nt.getByRole("button", { name: "Crear tarea" }).click();
      await nt.waitFor({ state: "detached", timeout: 10000 });
      await L.cardLoc(page, title).waitFor({ timeout: 10000 });
    };
    await addSession("Sesión: Presentación R50", "2027-01-12");
    await addSession("Sesión: Fundamentos R50", "2027-01-19");
    const first = await L.dbTask("Sesión: Presentación R50");
    L.check("PDF: la descripción empieza con la estructura del tipo «Sesión»", /^\*\*Objetivos:\*\*/.test(first.description) && /\*\*Lecturas y materiales:\*\*/.test(first.description), first.description);
    L.eq("PDF: las sesiones quedan en «Programa» con su fecha y responsable", [first.columnName, first.dueDate.toISOString().slice(0, 10), first.assigneeId], ["Programa", "2027-01-12", adm.id]);
    // Una tercera de varios días, con Markdown, y una archivada (no sale).
    const [kind] = await L.q(`SELECT id FROM "TaskKind" WHERE "projectId"=$1 AND name='Sesión'`, [projectId]);
    await L.q(
      `INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,description,"startDate","dueDate","updatedAt") VALUES
        ('r50_taller',$1,$2,'Sesión: Taller R50',$3,999999,$4,'2027-01-25','2027-01-27',NOW()),
        ('r50_arch',$1,$2,'Sesión archivada R50',$3,1,'',NULL,NULL,NOW())`,
      [projectId, programId, kind.id, "## Plan del taller\n\n1. Caso práctico\n2. **Entrega** final\n\n> Trae el portátil."],
    );
    await L.q(`UPDATE "Task" SET "archivedAt"=NOW() WHERE id='r50_arch'`);
    await L.reload(page).catch(() => {});
    await programCol().waitFor();
    await L.cardLoc(page, "Sesión: Taller R50").waitFor({ timeout: 10000 });

    await openPublish();
    const today = await appToday(page);
    // Cada publicación guardada es una versión nueva: la primera, _v1 (antes de publicar el diálogo dice «_vN»).
    const docName = `Programa – ${today}_v1.pdf`;
    L.check("PDF: el diálogo cuenta las sesiones y ofrece guardar en Documentación como versión nueva", (await dlg().innerText()).includes("las 3 sesiones de «Programa»") && (await dlg().getByLabel(`Guardar también en Documentación como una versión nueva («Programa – ${today}_vN.pdf»)`).isChecked()));
    await dlg().getByLabel("Incluir el responsable de cada sesión (profesor)").check();
    await page.screenshot({ path: `${SHOTS}/r50-programa-dialogo.png` });
    const { text, filename, bytes } = await publishAndDownload("programa.pdf");
    L.check("PDF: se descarga un PDF con nombre «programa-…»", /^programa-master-r50-\d{4}-\d{2}-\d{2}\.pdf$/.test(filename) && bytes > 1000, filename);
    for (const s of ["PROGRAMA DEL CURSO", PROJECT, "3 sesiones", "Sesión 1: Presentación R50", "martes, 12 de enero de 2027", `Responsable: ${adm.name}`, "Objetivos:", "Sesión 2: Fundamentos R50", "martes, 19 de enero de 2027", "Sesión 3: Taller R50", "25 de enero de 2027 – 27 de enero de 2027", "Plan del taller", "Caso práctico", "Entrega final", "Trae el portátil."]) {
      L.check(`PDF: el texto incluye «${s}»`, text.includes(s), text.slice(0, 300));
    }
    L.check("PDF: las sesiones salen en el orden de la columna", text.indexOf("Sesión 1:") < text.indexOf("Sesión 2:") && text.indexOf("Sesión 2:") < text.indexOf("Sesión 3:"));
    L.check("PDF: la sesión archivada no sale", !text.includes("archivada"));
    L.check("PDF: el Markdown no se ve en bruto", !/\*\*|##/.test(text));
    const saved = await dlg().getByRole("status").innerText();
    L.check("PDF: el diálogo confirma la copia en Documentación y su versión", saved.includes(`Guardado en Documentación como «${docName}» (versión 1 del programa)`), saved);
    await page.screenshot({ path: `${SHOTS}/r50-programa-listo.png` });
    const docs = await L.q(`SELECT id, name, kind, size, "mimeType" FROM "ProjectDocument" WHERE "projectId"=$1 AND "deletedAt" IS NULL`, [projectId]);
    L.eq("PDF: un documento PDF «Programa – fecha_v1.pdf» del mismo tamaño", docs.map((d) => [d.name, d.kind, d.mimeType, d.size]), [[docName, "PDF", "application/pdf", bytes]]);
    await dlg().getByRole("link", { name: "Abrir Documentación" }).click();
    await page.waitForURL(new RegExp(`/p/${projectId}/docs\\?doc=${docs[0]?.id}`), { timeout: 10000 });
    await L.waitFor(async () => (await page.locator("body").innerText()).includes(docName), { timeout: 10000 });
    L.check("PDF: «Abrir Documentación» abre el documento guardado", (await page.locator("body").innerText()).includes(docName));
    await page.screenshot({ path: `${SHOTS}/r50-programa-documentacion.png` });

    // Vista previa (GET): se ve sin guardar otra copia.
    await page.goto(`${L.BASE}/p/${projectId}`);
    await programCol().waitFor();
    await openPublish(true);
    const href = await dlg().getByRole("link", { name: "Vista previa sin guardar" }).getAttribute("href");
    const res = await page.request.get(L.BASE + href);
    L.eq("PDF: la vista previa es un PDF en línea", [res.status(), res.headers()["content-type"], /^inline/.test(res.headers()["content-disposition"] ?? "")], [200, "application/pdf", true]);
    L.eq("PDF: la vista previa no guarda nada", Number((await L.q(`SELECT count(*) n FROM "ProjectDocument" WHERE "projectId"=$1`, [projectId]))[0].n), 1);
    await dlg().getByRole("button", { name: "Cancelar" }).click();
  }

  // --- En inglés -------------------------------------------------------------------------------------------------------
  if (only.includes("en") && projectId) {
    L.scenario("en: el programa en inglés, sin guardar en Documentación");
    await L.q(`UPDATE "User" SET locale='EN' WHERE id=$1`, [adm.id]);
    try {
      await page.goto(`${L.BASE}/p/${projectId}`);
      await programCol().waitFor({ timeout: 15000 });
      await openPublish(true, true);
      await dlg().getByLabel(/^Also save to Documentation as/).uncheck();
      const { text, filename } = await publishAndDownload("programme.pdf", true);
      L.check("EN: nombre del archivo en inglés", /^programme-master-r50-/.test(filename), filename);
      for (const s of ["COURSE PROGRAMME", "3 sessions", "Session 1: Presentación R50", "Tuesday, 12 January 2027", "25 January 2027 – 27 January 2027"]) {
        L.check(`EN: el texto incluye «${s}»`, text.includes(s), text.slice(0, 300));
      }
      L.check("EN: sin responsable si no se pide", !text.includes(adm.name) || !text.includes("Assignee:"));
      L.eq("EN: sin «Also save…» no se guarda otra copia", Number((await L.q(`SELECT count(*) n FROM "ProjectDocument" WHERE "projectId"=$1`, [projectId]))[0].n), 1);
      L.eq("EN: el diálogo no dice que se haya guardado", await dlg().getByRole("status").count(), 0);
      await dlg().getByRole("button", { name: "Close" }).first().click();
    } finally {
      await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [adm.id]);
    }
  }

  // --- Documentación llena -------------------------------------------------------------------------------------------
  if (only.includes("full") && projectId) {
    L.scenario("full: si no cabe en Documentación, se descarga igual y dice por qué");
    await L.q(
      `INSERT INTO "ProjectDocument"(id,"projectId",name,"mimeType",size,kind,"createdById","updatedAt")
       SELECT 'r50doc' || g, $1, 'relleno ' || g || '.txt', 'text/plain', 1, 'TEXT', $2, NOW() FROM generate_series(1, 200) g`,
      [projectId, adm.id],
    );
    try {
      await page.goto(`${L.BASE}/p/${projectId}`);
      await programCol().waitFor({ timeout: 15000 });
      await openPublish();
      const { text } = await publishAndDownload("programa-lleno.pdf");
      L.check("FULL: el PDF se descarga igualmente", text.includes("Sesión 1:"));
      const alert = await dlg().getByRole("alert").innerText();
      L.check("FULL: avisa de que no se ha guardado y por qué", /No se ha guardado en Documentación: .*máximo de 200 archivos/.test(alert), alert);
      L.eq("FULL: no se añade el documento", Number((await L.q(`SELECT count(*) n FROM "ProjectDocument" WHERE "projectId"=$1 AND name LIKE 'Programa%'`, [projectId]))[0].n), 1);
      await page.screenshot({ path: `${SHOTS}/r50-programa-lleno.png` });
      await dlg().getByRole("button", { name: "Cerrar" }).first().click();
    } finally {
      await L.q(`DELETE FROM "ProjectDocument" WHERE id LIKE 'r50doc%'`);
    }
  }

  // --- El rol en el menú de la columna ----------------------------------------------------------------------------------
  if (only.includes("role") && projectId) {
    L.scenario("role: «Programa del curso (PDF)» en el selector de rol, con icono y explicación");
    await page.goto(`${L.BASE}/p/${projectId}`);
    const ideas = L.colLoc(page, "Ideas");
    await ideas.waitFor({ timeout: 15000 });
    await ideas.getByRole("button", { name: "Opciones de columna" }).click();
    const item = page.getByRole("menuitemradio", { name: "Programa del curso (PDF)" });
    L.eq("ROLE: la opción tiene icono y explicación", [await item.locator("svg").count(), await item.getAttribute("title")], [1, "Cada tarjeta es una sesión del curso: publica el programa en PDF."]);
    L.eq("ROLE: todas las opciones de rol llevan icono y explicación", await page.getByRole("menuitemradio").evaluateAll((els) => els.every((e) => e.querySelector("svg") && e.title)), true);
    await page.screenshot({ path: `${SHOTS}/r50-rol-programa.png` });
    await item.click();
    await L.eqEventually("ROLE: el rol se repite: «Ideas» también publica su programa", async () => ideas.getByRole("button", { name: "Publicar programa (PDF)" }).count(), 1);
    await L.eqEventually("ROLE: «Programa» lo conserva (dos columnas PROGRAM)", async () => (await L.q(`SELECT count(*) n FROM "Column" WHERE "projectId"=$1 AND role='PROGRAM'`, [projectId]))[0].n, "2");
    await ideas.getByRole("button", { name: "Opciones de columna" }).click();
    await page.getByRole("menuitemradio", { name: "Sin rol" }).click();
    await L.eqEventually("ROLE: «Sin rol» quita el botón", async () => ideas.getByRole("button", { name: "Publicar programa (PDF)" }).count(), 0);
  }
  L.assertNoErrors("R50", [s]);
} finally {
  await asAdmin(false);
  await s.ctx.close();
  // El proyecto de prueba no se queda: las demás suites entran en el primer proyecto y esperan sus columnas.
  await L.q(`DELETE FROM "Project" WHERE name=$1`, [PROJECT]);
}

fs.rmSync(TMP, { recursive: true, force: true });
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
