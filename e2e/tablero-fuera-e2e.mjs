// Columna «Compartir fuera» (rol NONE con su fila ColumnShare): un administrador la activa en Ajustes del proyecto →
// Tablero; «Rol de la columna › Compartir fuera» pone al pie «Generar web», el aviso de lo que se publica y el selector
// de caducidad (7 días / 1 mes / 3 meses); «Generar web» abre el diálogo con la dirección (copiar, «Enviar por email» con
// mailto:) y la marca de la cabecera pasa a «activo»; «Actualizar web» y el botón del enlace vuelven a enseñar la misma
// dirección, también a otra persona del proyecto. Desde fuera, sin cuenta: la página (sin scripts, noindex,
// no-referrer, no-store), marcar como hecha (va arriba de «Hecho» y el tablero abierto lo ve sin recargar), cambiar la
// fecha, comentar (firmado «<columna> (fuera)») y descargar un adjunto (attachment). Ctrl+Z en la app deshace lo de
// fuera. Sin la dirección recuperable, «Crear un enlace nuevo» (con confirmación). «Revocar enlace» deja la dirección en
// «ha caducado»; apagar la función la quita del menú. Crea y borra su proyecto (`fuera68_*`). Misma base y servidor que
// tablero-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node tablero-fuera-e2e.mjs   # PART=activar,rol,generar,fuera,nuevo,revocar,apagar
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "activar,rol,generar,fuera,nuevo,revocar,apagar").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fuera68-"));

const P = "fuera68_proj";
const COL = { back: "fuera68_c_back", share: "fuera68_c_share", done: "fuera68_c_done" };
const SHARE_COL = "Proveedor F68";
const T = { a: "Revisar planos F68", b: "Pedir material F68" };

async function cleanup() {
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [P]);
}
await L.prepareUsers();
await cleanup();
const [adm] = await L.q(`SELECT * FROM "User" WHERE email=$1`, [L.ADMIN]);
const [usr2] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.USER2]);
await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [adm.id]);
await L.q(`INSERT INTO "Project"(id,name,description,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,'Fuera 68','',true,$2,999970,NOW())`, [P, adm.id]);
await L.q(`INSERT INTO "Column"(id,"projectId",name,position,"isDone") VALUES ($1,$4,'Backlog',1000,false),($2,$4,$5,2000,false),($3,$4,'Hecho',3000,true)`, [COL.back, COL.share, COL.done, P, SHARE_COL]);
// La segunda persona también es del proyecto: ve la dirección con el botón del enlace aunque no la haya generado.
await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2),($1,$3)`, [P, adm.id, usr2.id]);
const [kind] = await L.q(`SELECT id FROM "TaskKind" WHERE "projectId" IS NULL ORDER BY position LIMIT 1`);
let seq = 0;
async function seed(columnId, title) {
  const id = `fuera68_t${++seq}`;
  await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,description,"kindId",position,"createdById","updatedAt") VALUES ($1,$2,$3,$4,'Detalles **importantes**',$5,$6,$7,NOW())`, [id, P, columnId, title, kind.id, seq * 1024, adm.id]);
  return id;
}
const taskA = await seed(COL.share, T.a);
await seed(COL.share, T.b);
// Un adjunto (no imagen) en la primera, con su fichero en la carpeta de subidas del servidor (el servidor y este script
// comparten UPLOAD_DIR; por defecto ../uploads, como plan-ia-zip-e2e.mjs).
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(import.meta.dirname, "..", "uploads"));
const attId = "fuera68att1";
await L.q(`INSERT INTO "TaskAttachment"(id,"taskId","originalName","mimeType","isImage",size) VALUES ($1,$2,'presupuesto-f68.txt','text/plain',false,9)`, [attId, taskA]);
let attFile = null;
try {
  fs.mkdirSync(uploadDir, { recursive: true });
  attFile = path.join(uploadDir, `${attId}.bin`);
  fs.writeFileSync(attFile, "f68-datos");
} catch { attFile = null; }

const shareRow = async () => (await L.q(`SELECT "tokenHash","tokenEnc","expiryDays","revokedAt","columnId" FROM "ColumnShare" WHERE "projectId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, [P]))[0];
const taskCol = async (id) => (await L.q(`SELECT "columnId" FROM "Task" WHERE id=$1`, [id]))[0]?.columnId;
const shareCol = (page) => L.colLoc(page, SHARE_COL);
async function openBoard(page) {
  await L.goto(page, `${L.BASE}/p/${P}`);
  await shareCol(page).waitFor({ state: "attached", timeout: 20000 });
  await sleep(500);
}
async function roleMenu(page) {
  await shareCol(page).getByRole("button", { name: "Opciones de columna" }).click();
  await page.getByRole("menuitem", { name: /^Rol de la columna/ }).click();
}
async function settingsToggle(page) {
  await L.goto(page, `${L.BASE}/p/${P}/settings?tab=tablero`);
  const box = page.getByTestId("share-out-toggle");
  await box.waitFor({ timeout: 20000 });
  return box;
}

const sessions = [];
let url = null;
try {
  const s = await L.session({ viewport: { width: 1500, height: 900 } });
  sessions.push(s);
  const { page } = s;
  // prepareUsers deja a todos como MEMBER: para el interruptor de Ajustes hace falta un administrador. Se le sube con la
  // sesión ya abierta (como cuentas-borrar-e2e): un administrador que inicia sesión pasa por la verificación en dos pasos.
  // Se devuelve a MEMBER al final.
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id=$1`, [adm.id]);

  if (only.includes("activar")) {
    L.scenario("activar: Ajustes del proyecto → Tablero, solo administradores");
    await openBoard(page);
    await roleMenu(page);
    L.eq("ACTIVAR: apagada, el submenú no la ofrece", await page.getByRole("menuitemradio", { name: "Compartir fuera" }).count(), 0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const box = await settingsToggle(page);
    L.eq("ACTIVAR: apagada por defecto", await box.isChecked(), false);
    // La casilla es controlada (se marca cuando responde el servidor): un clic y se espera a la base, no check().
    await box.click();
    await L.eqEventually("ACTIVAR: el proyecto la tiene activada", async () => (await L.q(`SELECT "shareOutEnabled" FROM "Project" WHERE id=$1`, [P]))[0].shareOutEnabled, true);
    await L.eqEventually("ACTIVAR: la casilla queda marcada", () => box.isChecked(), true);
  }

  if (only.includes("rol")) {
    L.scenario("rol: «Rol de la columna › Compartir fuera» y el pie de la columna");
    await L.q(`UPDATE "Project" SET "shareOutEnabled"=true WHERE id=$1`, [P]);
    await openBoard(page);
    await roleMenu(page);
    const item = page.getByRole("menuitemradio", { name: "Compartir fuera" });
    L.eq("ROL: la opción sale, sin marcar", await item.getAttribute("aria-checked"), "false");
    await item.click();
    await shareCol(page).locator("[data-share-footer]").waitFor({ timeout: 10000 });
    L.check("ROL: queda la fila (rol NONE)", !!(await shareRow())?.columnId);
    const footer = shareCol(page).locator("[data-share-footer]");
    L.eq("ROL: botón «Generar web»", (await footer.locator("[data-share-generate]").innerText()).trim(), "Generar web");
    L.check("ROL: el aviso corto de lo que se publica", (await footer.innerText()).includes("Se publica todo el contenido de las tareas."));
    const expiry = footer.locator("[data-share-expiry]");
    L.eq("ROL: caducidad por defecto «1 mes»", (await expiry.innerText()).trim(), "Caduca tras 1 mes sin uso");
    await expiry.click();
    await L.eqEventually("ROL: rota a «3 meses» (90 días)", async () => [(await expiry.innerText()).trim(), (await shareRow()).expiryDays], ["Caduca tras 3 meses sin uso", 90]);
    await expiry.click();
    await L.eqEventually("ROL: y a «7 días»", async () => (await shareRow()).expiryDays, 7);
    await expiry.click();
    await L.eqEventually("ROL: y vuelve a «1 mes»", async () => (await shareRow()).expiryDays, 30);
    L.eq("ROL: marca de la cabecera «sin generar»", await shareCol(page).locator("[data-share-badge]").getAttribute("data-share-badge"), "none");
    await page.screenshot({ path: `${SHOTS}/fuera68-pie.png` });
  }

  if (only.includes("generar")) {
    L.scenario("generar: diálogo con la dirección, copiar y «Enviar por email»");
    await openBoard(page);
    await shareCol(page).locator("[data-share-generate]").click();
    const d = U.dialog(page);
    await d.waitFor();
    const link = d.locator("[data-share-url]");
    await link.waitFor();
    url = (await link.innerText()).trim();
    L.check("GENERAR: la dirección es /x/<token>", /\/x\/[A-Za-z0-9_-]{43}$/.test(url), url);
    L.eq("GENERAR: la dirección no sale en las capturas", await link.getAttribute("data-pz-no-capture"), "");
    const mail = await d.getByRole("link", { name: "Enviar por email" }).getAttribute("href");
    L.check("GENERAR: «Enviar por email» es un mailto: con asunto y la dirección", mail.startsWith("mailto:?subject=") && decodeURIComponent(mail).includes(url), mail.slice(0, 120));
    L.check("GENERAR: dice hasta cuándo vale", (await d.innerText()).includes("Vale hasta el"));
    const row = await shareRow();
    const token = url.split("/x/")[1];
    L.check("GENERAR: en la base, la huella y el token cifrado (nunca en claro)", !!row.tokenHash && !url.includes(row.tokenHash) && !row.tokenHash.includes(token) && /^v2\./.test(row.tokenEnc ?? "") && !row.tokenEnc.includes(token));
    await page.screenshot({ path: `${SHOTS}/fuera68-dialogo.png` });
    await d.getByRole("button", { name: "Cerrar" }).last().click();
    await L.eqEventually("GENERAR: la marca de la cabecera pasa a activo", async () => shareCol(page).locator("[data-share-badge]").getAttribute("data-share-badge"), "active");
    L.eq("GENERAR: el botón pasa a «Actualizar web»", (await shareCol(page).locator("[data-share-generate]").innerText()).trim(), "Actualizar web");
    // «Actualizar web» vuelve a abrir el diálogo con la misma dirección.
    await shareCol(page).locator("[data-share-generate]").click();
    const again = U.dialog(page).locator("[data-share-url]");
    await again.waitFor();
    L.eq("GENERAR: «Actualizar web» enseña la misma dirección", (await again.innerText()).trim(), url);
    await U.dialog(page).getByRole("button", { name: "Cerrar" }).last().click();
    // Otra persona del proyecto la ve con el botón del enlace (no la generó ella).
    const other = await L.session({ email: L.USER2 });
    sessions.push(other);
    await openBoard(other.page);
    await shareCol(other.page).getByRole("button", { name: "Enlace de la web" }).click();
    const theirs = U.dialog(other.page).locator("[data-share-url]");
    await theirs.waitFor();
    L.eq("GENERAR: otra persona del proyecto ve la misma dirección", (await theirs.innerText()).trim(), url);
    const tokenLogs = await L.q(`SELECT 1 FROM "AppLog" WHERE "projectId"=$1 AND (strpos(message,$2)>0 OR strpos(COALESCE(details::text,''),$2)>0)`, [P, token]);
    L.eq("GENERAR: ningún registro lleva el token", tokenLogs.length, 0);
    await other.ctx.close();
    sessions.splice(sessions.indexOf(other), 1);
  }

  if (only.includes("fuera") && url) {
    L.scenario("fuera: la página sin cuenta, marcar como hecha, fecha, comentario y adjunto; el tablero lo ve y Ctrl+Z lo deshace");
    await openBoard(page);
    await L.liveOpen(page);
    const b = await L.getBrowser();
    const octx = await b.newContext({ locale: "es-ES", acceptDownloads: true });
    const op = await octx.newPage();
    const resp = await op.goto(url);
    const h = resp.headers();
    L.eq("FUERA: cabeceras", [resp.status(), h["x-robots-tag"], h["referrer-policy"], /^no-store\b/.test(h["cache-control"] ?? "")], [200, "noindex, nofollow, noarchive", "no-referrer", true]);
    const html = await op.content();
    L.check("FUERA: sin scripts y con noindex", !/<script/i.test(html) && html.includes('name="robots" content="noindex,nofollow"'));
    L.check("FUERA: las dos tareas, sin la columna «Backlog»", html.includes(T.a) && html.includes(T.b) && !html.includes("Backlog"));
    // Marcar como hecha.
    await op.locator(`#t-${taskA}`).getByRole("button", { name: "Marcar como hecha" }).click();
    await op.waitForURL(/\?m=done/);
    L.check("FUERA: aviso «Tarea marcada como hecha.»", (await op.content()).includes("Tarea marcada como hecha."));
    await L.eqEventually("FUERA: la tarea está en «Hecho»", () => taskCol(taskA), COL.done);
    await L.checkEventually("VIVO: el tablero abierto la ve en «Hecho» sin recargar", async () => {
      const n = await L.colLoc(page, "Hecho").locator("[data-task-card]").filter({ hasText: T.a }).count();
      return [n === 1, `${n}`];
    }, { timeout: 15000 });
    // Deshacer desde la app (quien generó la web, sin responsable en la tarea).
    await U.undoKey(page, "Control+z");
    await L.eqEventually("DESHACER: Ctrl+Z la devuelve a su columna", () => taskCol(taskA), COL.share);
    // Fecha y comentario.
    const card = op.locator(`#t-${taskA}`);
    await op.goto(url);
    await card.locator('input[name="due"]').fill("2026-12-03");
    await card.getByRole("button", { name: "Cambiar fecha" }).click();
    await op.waitForURL(/\?m=due/);
    await L.eqEventually("FUERA: fecha cambiada", async () => (await L.q(`SELECT to_char("dueDate",'YYYY-MM-DD') d FROM "Task" WHERE id=$1`, [taskA]))[0].d, "2026-12-03");
    await card.locator('textarea[name="body"]').fill("Listo para revisar, F68");
    await card.getByRole("button", { name: "Comentar" }).click();
    await op.waitForURL(/\?m=comment/);
    const [c] = await L.q(`SELECT "authorId","authorName",body FROM "TaskComment" WHERE "taskId"=$1`, [taskA]);
    L.eq("FUERA: comentario firmado «<columna> (fuera)»", [c?.authorId ?? null, c?.authorName, c?.body], [null, `${SHARE_COL} (fuera)`, "Listo para revisar, F68"]);
    L.check("FUERA: el comentario sale en la página", (await op.content()).includes("Listo para revisar, F68"));
    const hist = await L.q(`SELECT "userName" FROM "TaskEvent" WHERE "taskId"=$1 ORDER BY "createdAt"`, [taskA]);
    L.check("FUERA: el historial lo firma la columna (fuera)", hist.length > 0 && hist.every((e) => e.userName === `${SHARE_COL} (fuera)`), hist.map((e) => e.userName).join(" | "));
    // Lo de fuera (shareOut.done/due/comment) va con «/x/…»; lo de la app (generar, el enlace…), con la página del tablero.
    const logs = await L.q(`SELECT path FROM "AppLog" WHERE action IN ('shareOut.done','shareOut.due','shareOut.comment') AND "projectId"=$1`, [P]);
    const all = await L.q(`SELECT action,path,message,details FROM "AppLog" WHERE "projectId"=$1`, [P]);
    L.check("LOGS: con «/x/…», nunca el token", logs.length > 0 && logs.every((l) => l.path === "/x/…") && !JSON.stringify(all).includes(url.split("/x/")[1]));
    // Adjunto.
    if (attFile) {
      const [dl] = await Promise.all([op.waitForEvent("download", { timeout: 15000 }), card.getByRole("link", { name: "presupuesto-f68.txt" }).click()]);
      L.eq("FUERA: el adjunto se descarga con su nombre", dl.suggestedFilename(), "presupuesto-f68.txt");
    } else L.note("FUERA: sin acceso a la carpeta de subidas: no se prueba la descarga");
    const foreign = await op.request.get(`${url}/a/no-es-de-aqui`);
    L.eq("FUERA: un adjunto ajeno da 404", foreign.status(), 404);
    await op.screenshot({ path: `${SHOTS}/fuera68-pagina.png`, fullPage: true });
    await octx.close();
  }

  if (only.includes("nuevo") && url) {
    L.scenario("nuevo: sin la dirección recuperable, «Crear un enlace nuevo» con confirmación");
    // Como si la clave de cifrado hubiese cambiado sin rotarla (o el enlace fuese de una versión anterior).
    await L.q(`UPDATE "ColumnShare" SET "tokenEnc"=NULL WHERE "projectId"=$1`, [P]);
    await openBoard(page);
    await shareCol(page).getByRole("button", { name: "Enlace de la web" }).click();
    const d = U.dialog(page);
    await d.locator("[data-share-lost]").waitFor();
    L.eq("NUEVO: sin dirección en el diálogo", await d.locator("[data-share-url]").count(), 0);
    await d.locator("[data-share-fresh]").click();
    const ask = page.getByRole("dialog").filter({ hasText: "¿Crear uno nuevo?" });
    await ask.waitFor();
    L.eq("NUEVO: pide confirmación y no cambia nada aún", (await shareRow()).tokenEnc, null);
    await ask.getByRole("button", { name: "Crear un enlace nuevo" }).click();
    const fresh = d.locator("[data-share-url]");
    await fresh.waitFor();
    const next = (await fresh.innerText()).trim();
    L.check("NUEVO: otra dirección", next !== url && /\/x\/[A-Za-z0-9_-]{43}$/.test(next), next);
    const old = await fetch(url);
    L.eq("NUEVO: la anterior dice «ha caducado» (410)", old.status, 410);
    url = next;
    await d.getByRole("button", { name: "Cerrar" }).last().click();
  }

  if (only.includes("revocar") && url) {
    L.scenario("revocar: la dirección dice «ha caducado»");
    await openBoard(page);
    await shareCol(page).getByRole("button", { name: "Enlace de la web" }).click();
    const d = U.dialog(page);
    await d.getByRole("button", { name: "Revocar enlace" }).click();
    await page.getByRole("dialog").filter({ hasText: "¿Revocarlo?" }).getByRole("button", { name: "Revocar enlace" }).click();
    await L.checkEventually("REVOCAR: revocado en la base", async () => [!!(await shareRow()).revokedAt, ""]);
    const r = await fetch(url);
    L.eq("REVOCAR: 410 con el aviso de «ya no está disponible»", [r.status, (await r.text()).includes("Esta lista de tareas ya no está disponible. Contacta con la persona que te ha dado el enlace.")], [410, true]);
    await L.eqEventually("REVOCAR: la cabecera ya no dice activo", async () => shareCol(page).locator("[data-share-badge]").getAttribute("data-share-badge"), "ended");
    // Revocado, no caducado.
    L.check("REVOCAR: la marca dice «Enlace revocado por <nombre> el <fecha>»", (await shareCol(page).locator("[data-share-badge]").getAttribute("title"))?.startsWith("Compartir fuera: Enlace revocado por "));
  }

  if (only.includes("apagar")) {
    L.scenario("apagar: la función deja de ofrecerse y sus enlaces de funcionar");
    const box = await settingsToggle(page);
    if (!(await box.isChecked())) {
      await box.click();
      await L.eqEventually("APAGAR: encendida antes de apagarla", () => box.isChecked(), true);
    }
    await sleep(500);
    await box.click();
    // Antes de preguntar, pide al servidor cuántos enlaces funcionan: la pregunta llega tras esa vuelta (o se apaga sin ella).
    const confirm = page.getByRole("dialog").filter({ hasText: "Apagar «Compartir fuera»" });
    const enabledNow = async () => (await L.q(`SELECT "shareOutEnabled" FROM "Project" WHERE id=$1`, [P]))[0].shareOutEnabled;
    await L.waitFor(async () => (await confirm.count()) > 0 || !(await enabledNow()), { timeout: 10000 });
    if (await confirm.count()) await confirm.getByRole("button", { name: "Apagar" }).click();
    await L.eqEventually("APAGAR: apagada en el proyecto", async () => (await L.q(`SELECT "shareOutEnabled" FROM "Project" WHERE id=$1`, [P]))[0].shareOutEnabled, false);
    await openBoard(page);
    L.eq("APAGAR: sin pie en la columna", await shareCol(page).locator("[data-share-footer]").count(), 0);
    await roleMenu(page);
    L.eq("APAGAR: el submenú ya no la ofrece", await page.getByRole("menuitemradio", { name: "Compartir fuera" }).count(), 0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  L.assertNoErrors("Compartir fuera", sessions);
} catch (err) {
  L.check("la suite terminó sin excepción", false, err.stack || String(err));
} finally {
  await L.q(`UPDATE "User" SET role='MEMBER' WHERE id=$1`, [adm.id]).catch(() => {});
  for (const x of sessions) await x.ctx.close().catch(() => {});
  await cleanup();
  if (attFile) fs.rmSync(attFile, { force: true });
}

fs.rmSync(TMP, { recursive: true, force: true });
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
