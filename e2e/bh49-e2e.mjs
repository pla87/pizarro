// Caza de bugs 49: la copia de una tarea (Ctrl al soltar en otra columna) con una imagen en la descripción apunta a SU
// adjunto (borrar el de la original no la rompe); cambiar la fecha de una tarea en el calendario sin red vuelve atrás
// con «Sin conexión: no se ha guardado» (antes el chip se quedaba en el día nuevo sin guardarse); y, sin red, el
// interruptor de borradores de «Mi perfil» y «Borrar release» avisan y no se quedan a medias; y en «Nueva tarea» recuperada
// de un borrador, el día de «Repetir» sigue a la fecha límite si no se eligió a mano. Misma base y servidor que
// board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh49-e2e.mjs      # PART=dupimg,cal,drafts,reldel,repdraft
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep, COL } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "dupimg,cal,drafts,reldel,repdraft").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bh49-"));

const OFFLINE = "Sin conexión: no se ha guardado";
const CRASH = "Algo ha fallado";
const bodyText = (page) => page.evaluate(() => document.body.innerText);
/** Errores de consola salvo los de la red cortada a propósito. */
const realErrors = (s) => ({ errors: s.errors.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::|NetworkError/i.test(e)) });

// PNG válido (sharp lo convierte en WebP al subirlo).
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x % 256; raw[o + 1] = y % 256; raw[o + 2] = 40; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG = path.join(TMP, "plano.png");
fs.writeFileSync(PNG, makePng(320, 200));

await L.prepareUsers();
await L.cleanBoard();
const p = await L.project();
const attachmentsOf = (title) => L.q(`SELECT a.id FROM "TaskAttachment" a JOIN "Task" t ON t.id=a."taskId" WHERE t.title=$1 ORDER BY a."createdAt"`, [title]);
const appToday = (page) => page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: document.documentElement.dataset.tz || undefined }).format(new Date()));
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// --- Copia a otra columna con una imagen en la descripción ----------------------------------------------------------
if (only.includes("dupimg")) {
  L.scenario("dupimg: la imagen de la descripción de la copia es la de su propio adjunto");
  await L.cleanBoard();
  const TITLE = "Con plano bh49";
  const [orig] = await L.seedTasks(COL.backlog, [TITLE]);
  await L.seedTasks(COL.doing, ["Destino bh49"]);
  const s = await L.session({ viewport: { width: 1400, height: 900 } });
  const { page } = s;
  await U.openTask(page, TITLE);
  await U.dialog(page).locator("input[type=file]:not([capture])").first().setInputFiles(PNG);
  await L.waitFor(async () => (await attachmentsOf(TITLE)).length === 1, { timeout: 15000 });
  await U.closeDialog(page);
  const [img] = await attachmentsOf(TITLE);
  // La imagen en la descripción (Markdown), como la escribe quien la enlaza.
  await L.q(`UPDATE "Task" SET description=$2 WHERE id=$1`, [orig, `Mira el plano:\n\n![plano](/api/attachments/${img.id})`]);
  await L.reload(page);

  // Ctrl al soltar en «En progreso»: se copia la tarea.
  const src = await L.cardLoc(page, TITLE).boundingBox();
  const tb = await L.cardLoc(page, "Destino bh49").boundingBox();
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(src.x + src.width / 2 + 8, src.y + src.height / 2 + 8, { steps: 4 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height - 4, { steps: 25 });
  await sleep(150);
  await page.keyboard.down("Control");
  await page.mouse.move(tb.x + tb.width / 2 + 1, tb.y + tb.height - 3, { steps: 2 });
  await sleep(150);
  await page.mouse.up();
  await page.keyboard.up("Control");
  const COPY = `${TITLE} (copia)`;
  await L.waitFor(async () => (await attachmentsOf(COPY)).length === 1, { timeout: 10000 });
  const [copied] = await attachmentsOf(COPY);
  const copyDesc = (await L.dbTask(COPY)).description;
  L.eq("DUPIMG: la descripción de la copia apunta a su propio adjunto", copyDesc, `Mira el plano:\n\n![plano](/api/attachments/${copied.id})`);
  L.eq("DUPIMG: la de la original no cambia", (await L.dbTask(TITLE)).description, `Mira el plano:\n\n![plano](/api/attachments/${img.id})`);

  // Borrar el adjunto de la original: la imagen de la copia se sigue viendo.
  await U.openTask(page, TITLE);
  await U.dialog(page).getByRole("button", { name: "Borrar adjunto" }).first().click({ force: true });
  await L.eqEventually("DUPIMG: la original se queda sin adjunto", async () => (await attachmentsOf(TITLE)).length, 0);
  await U.closeDialog(page);
  await U.openTask(page, COPY);
  const pic = U.dialog(page).locator(`img[alt="plano"]`).first();
  await pic.waitFor({ timeout: 8000 });
  await L.waitFor(() => pic.evaluate((el) => el.complete && el.naturalWidth > 0).catch(() => false), { timeout: 8000 });
  L.check("DUPIMG: tras borrar el adjunto de la original, la imagen de la descripción de la copia se carga", await pic.evaluate((el) => el.complete && el.naturalWidth > 0));
  await page.screenshot({ path: `${SHOTS}/bh49-dupimg.png` });
  await U.closeDialog(page);
  L.assertNoErrors("DUPIMG", [s]);
  await s.ctx.close();
}

// --- Calendario: cambiar la fecha sin red ---------------------------------------------------------------------------
if (only.includes("cal")) {
  L.scenario("cal: mover una tarea en el calendario sin red");
  await L.cleanBoard();
  const s = await L.session();
  const { page, ctx } = s;
  const today = await appToday(page);
  // Un día que cae en la misma semana visible del mes en curso o del siguiente: el calendario se abre en el mes de la tarea.
  const due = addDays(today, 3);
  const [id] = await L.seedTasks(COL.backlog, ["Fecha sin red bh49"]);
  await L.q(`UPDATE "Task" SET "dueDate"=$2 WHERE id=$1`, [id, due]);
  const month = due.slice(0, 7);
  await page.goto(`${L.BASE}/calendar${month === today.slice(0, 7) ? "" : `?month=${month}`}`);
  const chip = page.locator(`[data-chip="${id}"]`);
  await chip.waitFor({ timeout: 15000 });
  const dayOf = () => chip.evaluate((el) => el.closest("[data-day]")?.getAttribute("data-day") ?? null);
  const before = await dayOf();
  await ctx.setOffline(true);
  await chip.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await L.eqEventually("CAL: sin red sale «Sin conexión: no se ha guardado»", async () => (await bodyText(page)).includes(OFFLINE), true, { timeout: 10000 });
  L.eq("CAL: el chip vuelve a su día", await dayOf(), before);
  L.eq("CAL: la fecha no ha cambiado", (await L.dbTask("Fecha sin red bh49")).dueDate.toISOString().slice(0, 10), due);
  L.check("CAL: nunca «Algo ha fallado»", !(await bodyText(page)).includes(CRASH));
  await page.screenshot({ path: `${SHOTS}/bh49-cal-sin-red.png` });
  await ctx.setOffline(false);
  await sleep(1500);
  await chip.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await L.eqEventually("CAL: con red se guarda", async () => (await L.dbTask("Fecha sin red bh49")).dueDate.toISOString().slice(0, 10), addDays(due, 1), { timeout: 10000 });
  L.assertNoErrors("CAL", [realErrors(s)]);
  await s.ctx.close();
}

// --- Mi perfil: «Borrar los borradores al cerrar sesión» sin red ----------------------------------------------------
if (only.includes("drafts")) {
  L.scenario("drafts: el interruptor de borradores sin red");
  await L.q(`UPDATE "User" SET "clearDraftsOnLogout"=false WHERE email=$1`, [L.ADMIN]);
  const s = await L.session();
  const { page, ctx } = s;
  await page.goto(`${L.BASE}/settings?tab=preferencias`);
  const toggle = page.getByRole("checkbox", { name: /borradores/i }).first();
  await toggle.waitFor({ timeout: 20000 });
  L.eq("DRAFTS: empieza desactivado", await toggle.isChecked(), false);
  await ctx.setOffline(true);
  await toggle.click();
  await L.eqEventually("DRAFTS: sin red sale «Sin conexión: no se ha guardado»", async () => (await bodyText(page)).includes(OFFLINE), true, { timeout: 10000 });
  L.eq("DRAFTS: el interruptor vuelve a como estaba", await toggle.isChecked(), false);
  L.eq("DRAFTS: no se ha guardado", (await L.q(`SELECT "clearDraftsOnLogout" v FROM "User" WHERE email=$1`, [L.ADMIN]))[0].v, false);
  await ctx.setOffline(false);
  await sleep(1500);
  await toggle.click();
  await L.eqEventually("DRAFTS: con red se guarda", async () => (await L.q(`SELECT "clearDraftsOnLogout" v FROM "User" WHERE email=$1`, [L.ADMIN]))[0].v, true, { timeout: 10000 });
  await L.q(`UPDATE "User" SET "clearDraftsOnLogout"=false WHERE email=$1`, [L.ADMIN]);
  L.assertNoErrors("DRAFTS", [realErrors(s)]);
  await s.ctx.close();
}

// --- Releases: «Borrar release» sin red -----------------------------------------------------------------------------
if (only.includes("reldel")) {
  L.scenario("reldel: borrar una release sin red");
  await L.cleanBoard();
  const [admin] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
  await L.q(`INSERT INTO "Release"(id,"projectId",number,title,content,"createdById","deployedAt") VALUES ('bh49_rel',$1,1,'Release bh49','# Notas',$2,NOW())`, [p.id, admin.id]);
  const s = await L.session();
  const { page, ctx } = s;
  await page.goto(`${L.BASE}/p/${p.id}/releases`);
  await page.getByText("Release bh49").first().waitFor({ timeout: 20000 });
  const del = page.getByRole("button", { name: "Borrar release" }).first();
  if (!(await del.isVisible())) await page.getByText("Release bh49").first().click();
  await del.click();
  const confirmDlg = page.locator("[role=dialog]").filter({ hasText: "Release bh49" });
  await confirmDlg.waitFor();
  await ctx.setOffline(true);
  await confirmDlg.getByRole("button", { name: "Borrar", exact: true }).click();
  await L.eqEventually("RELDEL: sin red sale «Sin conexión: no se ha guardado»", async () => (await bodyText(page)).includes(OFFLINE), true, { timeout: 10000 });
  L.check("RELDEL: el botón no se queda ocupado", await del.isEnabled());
  L.eq("RELDEL: la release sigue", (await L.q(`SELECT count(*)::int n FROM "Release" WHERE id='bh49_rel'`))[0].n, 1);
  await ctx.setOffline(false);
  await sleep(1500);
  await del.click();
  await page.locator("[role=dialog]").filter({ hasText: "Release bh49" }).getByRole("button", { name: "Borrar", exact: true }).click();
  await L.eqEventually("RELDEL: con red se borra", async () => (await L.q(`SELECT count(*)::int n FROM "Release" WHERE id='bh49_rel'`))[0].n, 0, { timeout: 10000 });
  L.assertNoErrors("RELDEL", [realErrors(s)]);
  await s.ctx.close();
}

// --- «Nueva tarea» recuperada de un borrador: el día de «Repetir» sigue a la fecha límite -----------------------------
if (only.includes("repdraft")) {
  L.scenario("repdraft: «Repetir» en un borrador recuperado");
  await L.cleanBoard();
  const s = await L.session();
  const { page } = s;
  const today = await appToday(page);
  const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() || 7;
  // Tras recargar con el borrador a medias, «Nueva tarea» se vuelve a abrir sola con él.
  const open = async () => {
    const dlg = U.dialog(page);
    if (!(await dlg.count())) await page.getByRole("button", { name: "Nueva tarea", exact: true }).first().click();
    await dlg.getByLabel("Repetir", { exact: true }).waitFor();
    return dlg;
  };
  let dlg = await open();
  await dlg.getByRole("textbox", { name: "Título", exact: true }).fill("Borrador que se repite bh49");
  await dlg.getByLabel("Repetir", { exact: true }).selectOption("WEEKLY");
  L.eq("REPDRAFT: sin fecha, el día es el de hoy", Number(await dlg.getByLabel("Día de la semana").inputValue()), weekday(today));
  // Se recarga la página con el diálogo abierto (el borrador se guarda al salir).
  await L.reload(page);
  dlg = await open();
  L.eq("REPDRAFT: el borrador se recupera con «Cada semana»", await dlg.getByLabel("Repetir", { exact: true }).inputValue(), "WEEKLY");
  const due = addDays(today, 2);
  await dlg.getByLabel("Fecha límite (opcional)").fill(due);
  L.eq("REPDRAFT: al poner la fecha límite, el día pasa a ser el de la fecha (no se eligió a mano)", Number(await dlg.getByLabel("Día de la semana").inputValue()), weekday(due));
  // Elegido a mano sí se conserva al recuperar el borrador.
  const picked = weekday(addDays(today, 4));
  await dlg.getByLabel("Día de la semana").selectOption(String(picked));
  await L.reload(page);
  dlg = await open();
  await dlg.getByLabel("Fecha límite (opcional)").fill(addDays(today, 5));
  L.eq("REPDRAFT: un día elegido a mano no cambia al poner otra fecha", Number(await dlg.getByLabel("Día de la semana").inputValue()), picked);
  await page.keyboard.press("Escape");
  L.assertNoErrors("REPDRAFT", [s]);
  await s.ctx.close();
}

fs.rmSync(TMP, { recursive: true, force: true });
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
