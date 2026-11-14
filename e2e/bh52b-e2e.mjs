// Caza de bugs 52 (segunda tanda de arreglos pequeños): (1) «Reintentar» del ZIP de adjuntos del plan vuelve a poner el botón
// «Descargar adjuntos» ocupado y desactivado; (2) un enlace `?doc=` a un documento de la papelera o que no existe avisa («Ese
// documento está en la papelera» / «ya no está en la Documentación») y no revela documentos de otros proyectos; (3) los
// botones de columnas especiales sin tarjetas usan aria-disabled (no `disabled`) y, al tocarlos, muestran su motivo como
// aviso, también las opciones de su menú; (4) en «Cómo se envían los emails» el nombre accesible de cada opción es su título y
// la descripción va en aria-describedby. Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3276 DATABASE_URL=$DBURL node bh52b-e2e.mjs      # PART=zip,doc,columnas,mail
import fs from "node:fs";
import path from "node:path";
import * as L from "./qa/lib.mjs";
const UPLOADS = path.resolve(process.env.UPLOAD_DIR || path.join(import.meta.dirname, "..", "uploads"));
const { sleep } = L;
const only = (process.env.PART || "zip,doc,columnas,mail").split(",");

await L.prepareUsers();
const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN', locale='ES' WHERE id=$1`, [adm.id]);

const PID = "bh52b_project";
const OTHER = "bh52b_other";
const COLS = [["bh52b_plan", "Plan A", "AI_PLAN"], ["bh52b_salto", "Salto", "NEXT_RELEASE"], ["bh52b_sem", "Semana", "WEEKLY_PLAN"], ["bh52b_lista", "Lista", "CHECKLIST"]];

/** Proyecto privado con columnas especiales y, si se pide, una tarjeta con adjuntos en el plan. */
async function seed({ withTask = false } = {}) {
  for (const id of [PID, OTHER]) await L.q(`DELETE FROM "Project" WHERE id=$1`, [id]);
  for (const [id, name] of [[PID, "Web bh52b"], [OTHER, "Otro bh52b"]]) {
    await L.q(`INSERT INTO "Project"(id,name,description,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,'',true,$3,999990,NOW())`, [id, name, adm.id]);
    await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [id, adm.id]);
  }
  for (const [i, [id, name, role]] of COLS.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,role) VALUES ($1,$2,$3,$4,$5)`, [id, PID, name, (i + 1) * 1000, role]);
  if (withTask) {
    await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,description,"createdById","updatedAt") VALUES ('bh52b_t1',$1,'bh52b_plan','Tarea con adjunto','kind_funcionalidad',1024,'',$2,NOW())`, [PID, adm.id]);
    fs.mkdirSync(UPLOADS, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS, "bh52battach.bin"), "notas");
    await L.q(`INSERT INTO "TaskAttachment"(id,"taskId","originalName","mimeType","isImage",size) VALUES ('bh52battach','bh52b_t1','notas.txt','text/plain',false,5)`);
  }
}
const doc = (id, projectId, name, deleted) => L.q(
  `INSERT INTO "ProjectDocument"(id,"projectId",name,"mimeType",size,kind,"createdById","deletedAt","deletedById","updatedAt") VALUES ($1,$2,$3,'text/plain',5,'TEXT',$4,$5,$6,NOW())`,
  [id, projectId, name, adm.id, deleted ? new Date() : null, deleted ? adm.id : null],
);

// --- «Reintentar» del ZIP de adjuntos ----------------------------------------------------------------------------------------
if (only.includes("zip")) {
  L.scenario("zip: «Reintentar» pone el botón «Descargar adjuntos» ocupado y desactivado");
  await seed({ withTask: true });
  const s = await L.session();
  const { page } = s;
  await page.goto(`${L.BASE}/p/${PID}`);
  await L.colLoc(page, "Plan A").waitFor({ timeout: 20000 });
  await L.liveOpen(page);
  await sleep(500);
  await L.colLoc(page, "Plan A").getByRole("button", { name: "Generar plan de trabajo" }).click();
  const dlg = page.locator("[role=dialog]").filter({ hasText: /Generar plan de trabajo/ }).first();
  await dlg.locator("[data-plan-step=select]").waitFor({ timeout: 10000 });
  await sleep(1200);
  await dlg.getByRole("button", { name: /Generar con 1 tarea/ }).click();
  await dlg.locator("[data-plan-step=edit]").waitFor({ timeout: 15000 });
  const btn = dlg.getByRole("button", { name: "Descargar adjuntos (1)" });
  await btn.waitFor({ timeout: 10000 });
  // Primer paquete: 409 (los adjuntos cambiaron). Al reintentar, el paquete tarda: se ve el estado ocupado.
  let parts = 0;
  await page.route("**/release-attachments?part=*", async (route) => {
    parts++;
    if (parts === 1) return route.fulfill({ status: 409, contentType: "text/plain", body: "Los adjuntos han cambiado mientras se descargaban." });
    await sleep(2500);
    return route.continue();
  });
  await btn.click();
  const retry = page.getByRole("button", { name: "Reintentar" });
  await retry.waitFor({ timeout: 10000 });
  L.check("ZIP: tras el 409 el botón vuelve a estar activo", await btn.isEnabled());
  await retry.click();
  await L.checkEventually("ZIP: al reintentar el botón queda desactivado", () => btn.isDisabled(), { timeout: 3000 });
  L.check("ZIP: …y con el indicador de carga", (await btn.locator("svg.animate-spin").count()) === 1);
  await L.checkEventually("ZIP: al terminar el reintento vuelve a estar activo", () => btn.isEnabled(), { timeout: 15000 });
  L.check("ZIP: sin errores de página (el 409 simulado sale en la consola)", !s.errors.some((e) => e.startsWith("pageerror")), s.errors.join(" | "));
  await s.ctx.close();
}

// --- Enlace ?doc= a un documento que ya no está --------------------------------------------------------------------------------
if (only.includes("doc")) {
  L.scenario("doc: ?doc= a un documento de la papelera, inexistente o de otro proyecto avisa");
  await seed();
  await doc("bh52bdocok", PID, "vivo.txt", false);
  await doc("bh52bdoctrash", PID, "borrado.txt", true);
  await doc("bh52bdocother", OTHER, "ajeno.txt", false);
  await doc("bh52bdocothertrash", OTHER, "ajeno-borrado.txt", true);
  const s = await L.session();
  const { page } = s;
  const open = async (id) => {
    await page.goto(`${L.BASE}/p/${PID}/docs${id ? `?doc=${id}` : ""}`);
    await page.getByRole("heading", { name: /Documentación/ }).first().waitFor({ timeout: 15000 });
    await sleep(1200);
  };
  const body = () => page.locator("body").innerText();
  await open("bh52bdoctrash");
  L.check("DOC: en la papelera → «Ese documento está en la papelera»", (await body()).includes("Ese documento está en la papelera"));
  await open("nada");
  L.check("DOC: inexistente → «Ese documento ya no está en la Documentación»", (await body()).includes("Ese documento ya no está en la Documentación"));
  await open("bh52bdocother");
  const other = await body();
  L.check("DOC: de otro proyecto → el mismo aviso de «ya no está», sin nombrar nada", other.includes("Ese documento ya no está en la Documentación") && !other.includes("ajeno"));
  await open("bh52bdocothertrash");
  const otherTrash = await body();
  L.check("DOC: de la papelera de otro proyecto → «ya no está» (no revela que está en una papelera)", otherTrash.includes("Ese documento ya no está en la Documentación") && !otherTrash.includes("papelera "));
  await open("bh52bdocok");
  const ok = await body();
  L.check("DOC: uno vivo se abre y no avisa", !ok.includes("Ese documento") && (await page.locator("[role=dialog]").count()) > 0);
  await open(null);
  L.check("DOC: sin ?doc= no hay aviso", !(await body()).includes("Ese documento"));
  L.check("DOC: sin errores de página (el 404 es del fichero del documento de pruebas, que no existe en disco)", !s.errors.some((e) => e.startsWith("pageerror")), s.errors.join(" | "));
  await s.ctx.close();
}

// --- Columnas especiales vacías: aria-disabled y motivo como aviso ---------------------------------------------------------------
if (only.includes("columnas")) {
  L.scenario("columnas: el botón vacío usa aria-disabled y al tocarlo avisa del motivo (botón y menú)");
  await seed();
  const s = await L.session({ viewport: { width: 2600, height: 950 } });
  const { page } = s;
  await page.goto(`${L.BASE}/p/${PID}`);
  await L.colLoc(page, "Plan A").waitFor({ timeout: 20000 });
  await L.liveOpen(page);
  await sleep(800);
  const EMPTY = "No hay tarjetas en esta columna";
  for (const [col, label] of [["Plan A", "Generar plan de trabajo"], ["Salto", "Generar Release"], ["Semana", "PDF de la semana"]]) {
    const b = L.colLoc(page, col).locator("[data-column-action] button").first();
    L.check(`COLUMNAS: «${col}»: aria-disabled y sin el atributo disabled`, (await b.getAttribute("aria-disabled")) === "true" && !(await b.evaluate((e) => e.hasAttribute("disabled"))));
    L.check(`COLUMNAS: «${col}»: sigue en el orden de tabulación (se puede enfocar)`, await b.evaluate((e) => { e.focus(); return document.activeElement === e; }));
    await b.click({ force: true }); // Playwright no pulsa lo que está aria-disabled si no se fuerza
    await L.checkEventually(`COLUMNAS: «${col}» («${label}»): al tocarlo sale el motivo como aviso`, async () => (await page.locator("[role=alert]").allInnerTexts()).join(" ").includes(EMPTY), { timeout: 4000 });
    await sleep(300);
  }
  L.check("COLUMNAS: tocar el botón vacío no abre ningún diálogo", (await page.locator("[role=dialog]").count()) === 0);
  // Opciones del menú de la columna.
  await L.colLoc(page, "Plan A").getByRole("button", { name: "Opciones de columna" }).click();
  const item = page.getByRole("menuitem", { name: "Generar plan de trabajo", exact: true });
  L.check("COLUMNAS: la opción del menú usa aria-disabled", (await item.getAttribute("aria-disabled")) === "true" && !(await item.evaluate((e) => e.hasAttribute("disabled"))));
  await item.click({ force: true });
  await L.checkEventually("COLUMNAS: tocar la opción del menú muestra el motivo", async () => (await page.locator("[role=alert]").allInnerTexts()).join(" ").includes(EMPTY), { timeout: 4000 });
  L.check("COLUMNAS: …y no abre el diálogo", (await page.locator("[role=dialog]").count()) === 0);
  // «Ver lista» sin subtareas: el motivo es otro.
  await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,description,"createdById","updatedAt") VALUES ('bh52b_l1',$1,'bh52b_lista','Sin subtareas','kind_funcionalidad',1024,'',$2,NOW())`, [PID, adm.id]);
  await page.reload();
  await L.colLoc(page, "Lista").waitFor({ timeout: 20000 });
  await sleep(1000);
  const lista = L.colLoc(page, "Lista").locator("[data-column-action] button").first();
  L.check("COLUMNAS: «Ver lista» sin subtareas: aria-disabled", (await lista.getAttribute("aria-disabled")) === "true");
  await lista.click({ force: true });
  await L.checkEventually("COLUMNAS: …y avisa «Ninguna tarjeta tiene subtareas»", async () => (await page.locator("[role=alert]").allInnerTexts()).join(" ").includes("Ninguna tarjeta tiene subtareas"), { timeout: 4000 });
  // Con tarjetas el botón funciona.
  await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,description,"createdById","updatedAt") VALUES ('bh52b_p1',$1,'bh52b_plan','Una tarjeta','kind_funcionalidad',1024,'',$2,NOW())`, [PID, adm.id]);
  await page.reload();
  await L.colLoc(page, "Plan A").waitFor({ timeout: 20000 });
  await sleep(1000);
  const plan = L.colLoc(page, "Plan A").locator("[data-column-action] button").first();
  L.check("COLUMNAS: con tarjetas el botón no es aria-disabled", (await plan.getAttribute("aria-disabled")) === null);
  await plan.click();
  L.check("COLUMNAS: …y abre el plan", await page.locator("[role=dialog]").filter({ hasText: /Generar plan de trabajo/ }).first().isVisible());
  L.assertNoErrors("columnas", [s]);
  await s.ctx.close();
}

// --- Lector de pantalla en «Cómo se envían los emails» -------------------------------------------------------------------------
if (only.includes("mail")) {
  L.scenario("mail: cada opción se llama por su título y la descripción va en aria-describedby");
  const s = await L.session();
  const { page } = s;
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id=$1`, [adm.id]); // tras entrar: el administrador pide 2FA al iniciar sesión
  try {
    await page.goto(`${L.BASE}/admin/settings`);
    const group = page.getByRole("radiogroup", { name: "Cómo se envían los emails" });
    await group.waitFor({ timeout: 15000 });
    const radios = group.locator("[role=radio]");
    L.eq("MAIL: dos opciones", await radios.count(), 2);
    const info = await radios.evaluateAll((els) => els.map((el) => {
      const text = (attr) => (el.getAttribute(attr) ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
      return { label: text("aria-labelledby"), desc: text("aria-describedby"), full: el.textContent.trim() };
    }));
    L.eq("MAIL: nombres por aria-labelledby (solo el título)", info.map((i) => i.label), ["Gmail de un administrador (uso familiar)", "Servicio de correo de la empresa"]);
    L.check("MAIL: la descripción va en aria-describedby", info[0].desc.startsWith("Gratis y sencillo") && info[1].desc.startsWith("Servidor SMTP profesional"), JSON.stringify(info));
    L.check("MAIL: el contenido visible sigue siendo título + descripción", info.every((i) => i.full.includes(i.label) && i.full.includes(i.desc)));
    L.check("MAIL: se localiza por su nombre accesible (solo el título)", (await group.getByRole("radio", { name: "Servicio de correo de la empresa", exact: true }).count()) === 1);
    L.assertNoErrors("mail", [s]);
  } finally {
    await L.q(`UPDATE "User" SET role='MEMBER' WHERE id=$1`, [adm.id]);
    await s.ctx.close();
  }
}

await L.q(`DELETE FROM "Project" WHERE id IN ($1,$2)`, [PID, OTHER]);
fs.rmSync(path.join(UPLOADS, "bh52battach.bin"), { force: true });
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
