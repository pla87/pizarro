// Ronda 56 (auditoría de escritorio y móvil): (1) ningún error de hidratación (#418) en las páginas principales, con el
// navegador en Europe/Madrid y es-ES o en America/New_York y en-US y el servidor en UTC, ni tras un proxy que reescribe los
// emails del HTML (como la «Email Address Obfuscation» de Cloudflare, que daba el #418 en Mi perfil y Administración →
// Usuarios); (2) pestañas con alias (`?tab=plantillas`) y aviso de una desconocida; (3) informe semanal: el destinatario se
// elige por nombre y a un miembro no se le enseña el email de otro; (4) calendario: vencidas en rojo, «N vencidas de antes de
// este mes» y, en el móvil, «Ir a hoy» en el aviso (sin vencidas, se baja solo hasta hoy); (5) Mis tareas: singular/plural y borde rojo solo en las vencidas; (6) Usuarios
// a 393 px con menú «⋯», indicador de desplazamiento en las pestañas y pie del menú lateral entero; (7) theme-color con el
// tema elegido; (8) accesibilidad: «Ver como lista» con aria-pressed, «Abrir menú» con aria-expanded, fondo inert con un
// modal abierto (también diálogo dentro de diálogo, y los avisos emergentes siguen fuera) y nombres de los controles (axe);
// (9) «Informar de un error o enviar una sugerencia» (PART=feedback, va primero): en una build no oficial, sin botón y con la
// nota en Historial de versiones; en una oficial (compilada con OFFICIAL_BUILD=1, RELEASE_VERSION=<versión de package.json>
// y GIT_SHA=<commit>, ver src/lib/bug-report-core.ts), el botón junto a «Cerrar sesión» (también en el móvil, donde cierra
// el menú), el diálogo con la captura de la página sin el diálogo (con la CSP de la app), el formulario de GitHub con lo
// escrito y, con una versión publicada más nueva en la caché del aviso, el botón desactivado. El envío por email lo prueba
// tests/db/feedback.test.ts (aquí FEEDBACK_EMAIL está vacía y no hay SMTP: sale el camino de GitHub).
// Misma base y servidor que tablero-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node interfaz-auditoria-e2e.mjs   # PART=feedback,hyd,tabs,informe,cal,mis,movil,tema,a11y
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import * as L from "./qa/lib.mjs";
const { sleep, COL } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "feedback,hyd,tabs,informe,cal,mis,movil,tema,a11y").split(",");
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

await L.prepareUsers();
await L.cleanBoard();
const p = await L.project();
const [admin] = await L.q(`SELECT id, name FROM "User" WHERE email=$1`, [L.ADMIN]);
const [user2] = await L.q(`SELECT id, name, email FROM "User" WHERE email=$1`, [L.USER2]);
await L.q(`UPDATE "User" SET locale='ES', theme='SYSTEM' WHERE id IN ($1,$2)`, [admin.id, user2.id]);
const asAdmin = () => L.q(`UPDATE "User" SET role='ADMIN' WHERE id=$1`, [admin.id]);
const asMember = () => L.q(`UPDATE "User" SET role='MEMBER' WHERE id=$1`, [admin.id]);
const appToday = (page) => page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: document.documentElement.dataset.tz || undefined }).format(new Date()));
const HYDRATION = /#418|#419|#422|#423|#425|hydrat/i;

/** Sesión con zona horaria y idioma del navegador propios (L.session no los fija). Entra como miembro: el administrador pide 2FA. */
async function sessionTz({ timezoneId = "Europe/Madrid", locale = "es-ES", mobile = false, email = L.ADMIN, colorScheme, proxyEmails = false } = {}) {
  const b = await L.getBrowser();
  const ctx = await b.newContext({ timezoneId, locale, colorScheme, ...(mobile ? { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }) });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text().slice(0, 300)); });
  if (proxyEmails) {
    // Como la «Email Address Obfuscation» de Cloudflare: fuera de <script>, cada email del texto pasa a un enlace codificado
    // (sin respetar <!--email_off-->: así se ve que tampoco hace falta).
    await page.route("**/*", async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const resp = await route.fetch();
      const body = (await resp.text()).split(/(<script[\s\S]*?<\/script>)/).map((part, i) => (i % 2 ? part : part.replace(/>([^<]*?)[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (_, pre) => `>${pre}<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="00">[email&#160;protected]</a>`))).join("");
      await route.fulfill({ response: resp, body });
    });
  }
  await L.login(page, email);
  return { ctx, page, errors };
}
const hydrationErrors = (s) => s.errors.filter((e) => HYDRATION.test(e));

// --- (9) Informar de un error o enviar una sugerencia ----------------------------------------------------------------------
// Va antes que el resto: la última versión conocida se memoriza un minuto en el servidor, y aquí se fija antes de pedir
// ninguna página (como recién consultada, para que el servidor no pregunte a GitHub).
if (only.includes("feedback")) {
  L.scenario("feedback: botón junto a «Cerrar sesión», diálogo con captura, GitHub con lo escrito y desactivado sin la última versión");
  const NAME = "Informar de un error o enviar una sugerencia";
  const OUTDATED = "Actualiza a la última versión para informar de un error o enviar una sugerencia";
  const version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  const setLatest = (latest) => L.q(`INSERT INTO "AppState"(key,value,"updatedAt") VALUES ('updateCheck',$1,NOW()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ checkedAt: Date.now(), latest, url: null })]);
  await setLatest(version);
  await asMember();
  const s = await L.session();
  const footerBug = s.page.locator("aside").first().getByRole("button", { name: NAME });
  if ((await footerBug.count()) === 0) {
    await L.goto(s.page, `${L.BASE}/changelog`);
    await s.page.getByRole("heading", { name: "Historial de versiones" }).waitFor();
    L.check("FEEDBACK (build no oficial): sin botón y con la nota en Historial de versiones",
      (await s.page.locator("[data-feedback-button]").count()) === 0 && (await s.page.getByText("solo se atienden en versiones oficiales sin modificar").count()) === 1);
    L.note("FEEDBACK: build no oficial; el resto de esta parte necesita una compilada como oficial (ver la cabecera)");
  } else {
    // Junto a «Cerrar sesión», en la misma fila del pie del menú.
    const sameRow = await footerBug.evaluate((b, name) => {
      const row = b.parentElement;
      return !!row && [...row.querySelectorAll("button")].some((x) => x.getAttribute("aria-label") === "Cerrar sesión") && b.getAttribute("title") === name;
    }, NAME);
    L.check("FEEDBACK: el botón está al lado de «Cerrar sesión», con nombre y title", sameRow);
    // Un tablero con algo que se vea detrás del diálogo.
    await L.seedTasks(COL.backlog, ["Tarjeta para la captura r61"], {});
    await L.reload(s.page);
    await footerBug.click();
    const dlg = s.page.getByRole("dialog", { name: NAME });
    await dlg.waitFor();
    L.check("FEEDBACK: sin email en la instalación, el diálogo ofrece GitHub y avisa de que es público",
      (await dlg.getByText("Esta instalación no puede enviarlo por email").count()) === 1 && (await dlg.getByText("La incidencia es pública").count()) === 1);
    L.eq("FEEDBACK: enseña los datos técnicos", (await dlg.locator("dl dt").allInnerTexts()).join("|"), "Versión|Commit|Instalación|Navegador y sistema|Idioma");
    await dlg.getByLabel("¿Qué ha pasado?").fill("Al mover una tarjeta se queda gris");
    const gh = dlg.getByRole("link", { name: "Continuar en GitHub" });
    const bugUrl = new URL(await gh.getAttribute("href"));
    L.eq("FEEDBACK: GitHub con el formulario de errores, lo escrito y los datos técnicos",
      [bugUrl.pathname, bugUrl.searchParams.get("template"), bugUrl.searchParams.get("actual"), bugUrl.searchParams.get("version"), bugUrl.searchParams.get("install")],
      ["/pla87/pizarro/issues/new", "bug_report.yml", "Al mover una tarjeta se queda gris", version, "Docker Compose"]);
    await dlg.getByLabel("Enviar una sugerencia").check();
    await dlg.getByLabel("¿Qué te gustaría?").fill("Vista por semanas");
    const ideaUrl = new URL(await gh.getAttribute("href"));
    L.eq("FEEDBACK: una sugerencia va a su formulario", [ideaUrl.searchParams.get("template"), ideaUrl.searchParams.get("idea")], ["suggestion.yml", "Vista por semanas"]);
    // Captura: de la página sin el diálogo ni su fondo oscuro, reducida y en JPEG.
    await dlg.getByLabel("Incluir una captura de la pantalla").check();
    const preview = dlg.locator("img[data-feedback-preview]");
    await preview.waitFor({ timeout: 30000 });
    const shot = await preview.evaluate(async (img) => {
      await img.decode();
      // Tamaño: el que enseña el diálogo («123 KB», «1,2 MB»; la CSP no deja leer el blob: con fetch, connect-src 'self').
      const label = [...img.parentElement.querySelectorAll("span")].map((x) => x.textContent).find((x) => /\d\s*(KB|MB|B)$/.test(x ?? "")) ?? "";
      const [, num, unit] = /([\d.,]+)\s*(KB|MB|B)$/.exec(label) ?? [];
      const blob = { size: Math.round(Number((num ?? "0").replace(/\./g, "").replace(",", ".")) * (unit === "MB" ? 1024 * 1024 : unit === "KB" ? 1024 : 1)) };
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const px = (x, y) => Array.from(ctx.getImageData(Math.round((x * c.width) / innerWidth), Math.round((y * c.height) / innerHeight), 1, 1).data).slice(0, 3);
      // El menú lateral (blanco con el tema claro), que con el fondo del diálogo saldría oscurecido.
      return { size: blob.size, w: img.naturalWidth, side: px(200, innerHeight / 2) };
    });
    // Que es un JPEG lo dicen la descarga (.jpg, abajo) y capture.ts; el servidor lo comprueba por su firma (tests/db).
    L.check("FEEDBACK: la captura mide 1600 px de ancho como mucho y menos de 1,5 MB", shot.w <= 1600 && shot.w >= 1000 && shot.size > 0 && shot.size <= 1.5 * 1024 * 1024, JSON.stringify(shot));
    L.check("FEEDBACK: la captura no lleva el fondo oscuro del diálogo (el menú lateral sale claro)", shot.side.every((v) => v > 225), JSON.stringify(shot.side));
    L.check("FEEDBACK: aviso de que la captura puede tener datos de su trabajo", (await dlg.getByText("La captura puede contener datos de tu trabajo").count()) === 1);
    const dl = dlg.getByRole("link", { name: "Descargar la captura" });
    L.eq("FEEDBACK: «Descargar la captura» es un .jpg", [await dl.getAttribute("download"), (await dl.getAttribute("href")).startsWith("blob:")], ["captura-pizarro.jpg", true]);
    const [download] = await Promise.all([s.page.waitForEvent("download"), dl.click()]);
    L.eq("FEEDBACK: … y se descarga con ese nombre", download.suggestedFilename(), "captura-pizarro.jpg");
    await dlg.getByRole("button", { name: "Quitar la captura" }).click();
    L.eq("FEEDBACK: «Quitar la captura» la quita", [await preview.count(), await dlg.getByLabel("Incluir una captura de la pantalla").isChecked()], [0, false]);
    await dlg.getByRole("button", { name: "Cancelar" }).click();
    await dlg.waitFor({ state: "detached" });
    // Historial de versiones abre el mismo diálogo.
    await L.goto(s.page, `${L.BASE}/changelog`);
    await s.page.getByRole("main").getByRole("button", { name: "Informar de un error" }).click();
    await dlg.waitFor();
    L.check("FEEDBACK: Historial de versiones abre el mismo diálogo", await dlg.isVisible());
    await s.page.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached" });
    // Móvil: el botón está en el pie del menú; al pulsarlo se cierra el menú (la captura es de la página).
    const m = await L.session({ viewport: { width: 393, height: 852 }, mobile: true });
    await m.page.getByRole("button", { name: "Abrir menú" }).click();
    const drawer = m.page.getByRole("dialog", { name: "Menú" });
    await drawer.waitFor();
    const mBug = drawer.getByRole("button", { name: NAME });
    const box = await mBug.boundingBox();
    L.check("MÓVIL feedback: el botón se ve en el pie del menú", !!box && box.y + box.height <= 852, JSON.stringify(box));
    await mBug.click();
    const mdlg = m.page.getByRole("dialog", { name: NAME });
    await mdlg.waitFor();
    L.eq("MÓVIL feedback: el menú se cierra al abrir el diálogo", await drawer.count(), 0);
    await mdlg.getByLabel("Incluir una captura de la pantalla").check();
    await mdlg.locator("img[data-feedback-preview]").waitFor({ timeout: 30000 });
    const mw = await mdlg.locator("img[data-feedback-preview]").evaluate((img) => img.naturalWidth);
    L.check("MÓVIL feedback: captura a la resolución de la pantalla (≤ 1600 px)", mw >= 393 && mw <= 1600, String(mw));
    await m.page.keyboard.press("Escape");
    // Con una versión publicada más nueva: desactivado, con el motivo en el title y, a un administrador, «Cómo actualizar».
    await setLatest("999.0.0");
    await asAdmin();
    await L.goto(s.page, `${L.BASE}/p/${p.id}`);
    const disabled = await L.waitFor(async () => {
      await L.reload(s.page);
      return (await footerBug.getAttribute("aria-disabled")) === "true";
    }, { timeout: 90000, step: 5000 });
    L.check("FEEDBACK: sin la última versión, el botón sale desactivado (aria-disabled)", !!disabled);
    L.eq("FEEDBACK: … con el motivo en el title", await footerBug.getAttribute("title"), OUTDATED);
    // aria-disabled: Playwright no lo da por «enabled», pero el botón sigue respondiendo (explica el motivo).
    await footerBug.click({ force: true });
    await s.page.getByText(OUTDATED, { exact: true }).first().waitFor();
    L.check("FEEDBACK: al pulsarlo no se abre el diálogo y el aviso ofrece «Cómo actualizar» al administrador",
      (await s.page.getByRole("dialog", { name: NAME }).count()) === 0 && (await s.page.getByRole("button", { name: "Cómo actualizar" }).count()) >= 1);
    await asMember();
    await setLatest(version);
    L.assertNoErrors("FEEDBACK", [s, m]);
    await m.ctx.close();
  }
  await s.ctx.close();
  await L.cleanBoard();
}

// --- (1) Hidratación ----------------------------------------------------------------------------------------------------
if (only.includes("hyd")) {
  L.scenario("hyd: sin errores de hidratación en las páginas principales (zonas e idiomas distintos, y tras un proxy que reescribe emails)");
  const [task] = await L.seedTasks(COL.backlog, ["Hidratación r56"], {});
  await L.q(`UPDATE "Task" SET "dueDate"=NOW() - interval '3 days' WHERE id=$1`, [task]);
  // Sesiones con actividad de madrugada en UTC (otro día en Madrid) y un texto legal con email, como en una instalación real.
  await L.q(`INSERT INTO "AppState"(key,value,"updatedAt") VALUES ('google.publicContactEmail','privacidad@example.com',NOW()) ON CONFLICT (key) DO NOTHING`);
  const pages = (admin) => [
    "/", `/p/${p.id}`, `/p/${p.id}?task=${task}`, `/p/${p.id}/releases`, `/p/${p.id}/docs`,
    `/p/${p.id}/settings?tab=tablero`, `/p/${p.id}/settings?tab=releases`, `/p/${p.id}/settings?tab=informes`,
    "/settings", "/settings?tab=preferencias", "/settings?tab=plantillas", "/settings?tab=avisos",
    "/my-tasks", "/calendar", "/notifications", "/changelog",
    ...(admin ? ["/admin/users", "/admin/projects", "/admin/templates", "/admin/backups", "/admin/logs", "/admin/legal", "/admin/settings", "/admin/integrations", "/admin/license", `/p/${p.id}/settings?tab=general`, `/p/${p.id}/settings?tab=adjuntos`] : []),
  ];
  const runs = [
    { label: "escritorio Madrid es-ES", opts: {} },
    { label: "móvil Madrid es-ES", opts: { mobile: true } },
    { label: "escritorio Nueva York en-US", opts: { timezoneId: "America/New_York", locale: "en-US" } },
    // Con la interfaz en inglés las fechas salen como en EE. UU. y con AM/PM: el servidor y el navegador deben coincidir.
    { label: "escritorio Nueva York en-US, interfaz en inglés", opts: { timezoneId: "America/New_York", locale: "en-US" }, ui: "EN" },
    { label: "escritorio tras proxy de emails", opts: { proxyEmails: true } },
    { label: "móvil tras proxy de emails", opts: { mobile: true, proxyEmails: true } },
  ];
  for (const { label, opts, ui } of runs) {
    await L.q(`UPDATE "User" SET locale=$2 WHERE id=$1`, [admin.id, ui ?? "ES"]);
    await asMember();
    const s = await sessionTz(opts);
    await asAdmin();
    await L.q(`UPDATE "Session" SET "lastSeenAt"=date_trunc('day', NOW() AT TIME ZONE 'UTC') + interval '23 hours 33 minutes' - interval '1 day' WHERE "userId"=$1`, [admin.id]);
    const bad = [];
    for (const path of pages(true)) {
      s.errors.length = 0;
      await L.goto(s.page, L.BASE + path);
      await s.page.waitForLoadState("load");
      await sleep(700);
      const h = hydrationErrors(s);
      if (h.length) bad.push(`${path}: ${h[0]}`);
    }
    L.eq(`HYD ${label}: ninguna página con error de hidratación`, bad, []);
    if (opts.proxyEmails) {
      await L.goto(s.page, L.BASE + "/admin/users");
      L.check(`HYD ${label}: el email se sigue viendo entero en Usuarios`, (await s.page.locator("li[data-user-row]").first().innerText()).includes("@example.com"));
    }
    await s.ctx.close();
  }
  await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [admin.id]);
  // Sin sesión: acceso y páginas legales.
  for (const proxyEmails of [false, true]) {
    const b = await L.getBrowser();
    const ctx = await b.newContext({ timezoneId: "Europe/Madrid", locale: "es-ES" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    if (proxyEmails) {
      await page.route("**/*", async (route) => {
        if (route.request().resourceType() !== "document") return route.continue();
        const resp = await route.fetch();
        const body = (await resp.text()).split(/(<script[\s\S]*?<\/script>)/).map((part, i) => (i % 2 ? part : part.replace(/>([^<]*?)[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (_, pre) => `>${pre}<a class="__cf_email__">[email protected]</a>`))).join("");
        await route.fulfill({ response: resp, body });
      });
    }
    for (const path of ["/login", "/privacy", "/terms", "/licencia"]) await page.goto(L.BASE + path).then(() => sleep(600));
    L.eq(`HYD sin sesión${proxyEmails ? " tras proxy" : ""}: acceso y páginas legales sin error de hidratación`, errors.filter((e) => HYDRATION.test(e)), []);
    await ctx.close();
  }
  await asMember();
}

// --- (2) Pestañas -----------------------------------------------------------------------------------------------------
if (only.includes("tabs")) {
  L.scenario("tabs: alias de las pestañas y aviso de una desconocida");
  await asMember();
  const s = await L.session();
  const { page } = s;
  const current = (label) => page.getByRole("navigation", { name: label }).locator('[aria-current="page"]').innerText();
  await asAdmin();
  await L.goto(page, `${L.BASE}/p/${p.id}/settings?tab=plantillas`);
  await page.waitForURL(/tab=releases/);
  L.eq("TABS: ?tab=plantillas abre «Plantillas» (y la dirección pasa a su id)", [await current("Secciones del proyecto"), new URL(page.url()).searchParams.get("tab")], ["Plantillas", "releases"]);
  L.eq("TABS: sin aviso con un alias", await page.getByTestId("unknown-tab").count(), 0);
  await L.goto(page, `${L.BASE}/p/${p.id}/settings?tab=Board`);
  await page.waitForURL(/tab=tablero/);
  L.eq("TABS: en inglés y con mayúsculas (?tab=Board) también", await current("Secciones del proyecto"), "Tablero");
  // Con ancla: la dirección pasa a su id en el cliente y el ancla se conserva (el redirect del servidor la perdía).
  await L.goto(page, `${L.BASE}/p/${p.id}/settings?tab=board#labels`);
  await page.waitForURL(/tab=tablero/);
  L.eq("TABS: ?tab=board#labels → ?tab=tablero#labels (conserva el ancla)", [await current("Secciones del proyecto"), new URL(page.url()).hash], ["Tablero", "#labels"]);
  await L.goto(page, `${L.BASE}/p/${p.id}/settings?tab=inventada`);
  L.eq("TABS: una desconocida abre la primera y lo avisa", [await current("Secciones del proyecto"), await page.getByTestId("unknown-tab").innerText()], ["General", "No hay ninguna sección «inventada»: se muestra «General»."]);
  await asMember();
  await L.goto(page, `${L.BASE}/p/${p.id}/settings?tab=general`);
  L.eq("TABS: quien no gestiona el proyecto, con ?tab=general: se dice que es de gestión", await page.getByTestId("unknown-tab").innerText(), "«General» solo la ve quien gestiona el proyecto: se muestra «Tablero».");
  await L.goto(page, `${L.BASE}/settings?tab=notificaciones`);
  await page.waitForURL(/tab=avisos/);
  L.eq("TABS: Mi perfil, ?tab=notificaciones → «Avisos»", await current("Secciones del perfil"), "Avisos");
  await L.goto(page, `${L.BASE}/settings?tab=xyz`);
  L.eq("TABS: Mi perfil, desconocida → «Cuenta» con aviso", [await current("Secciones del perfil"), await page.getByTestId("unknown-tab").count()], ["Cuenta", 1]);
  L.assertNoErrors("TABS", [s]);
  await s.ctx.close();
}

// --- (3) Informe semanal ---------------------------------------------------------------------------------------------
if (only.includes("informe")) {
  L.scenario("informe: destinatario por nombre; un miembro no ve el email de otro");
  await L.q(`DELETE FROM "ReportSchedule" WHERE "projectId"=$1`, [p.id]);
  await L.q(`INSERT INTO "ReportSchedule"("projectId",enabled,recipient,weekday,hour,"createdById","updatedAt") VALUES ($1,true,'externo.r56@example.com',1,8,$2,NOW())`, [p.id, admin.id]);
  await asMember();
  const s = await L.session();
  const { page } = s;
  await L.goto(page, `${L.BASE}/p/${p.id}/settings?tab=informes`);
  const sel = page.locator("#rs-recipient");
  await sel.waitFor();
  const options = await sel.locator("option").allInnerTexts();
  L.check("INFORME: las personas salen por su nombre", options.includes(user2.name) && options.some((o) => o.includes("(tú)")), JSON.stringify(options));
  const html = await page.content();
  L.check("INFORME: en la página no está el email de la otra persona ni el externo entero", !html.includes(user2.email) && !html.includes("externo.r56@example.com"));
  L.check("INFORME: el externo sale enmascarado", options.some((o) => /^Dirección externa: e\*+@example\.com$/.test(o)), JSON.stringify(options));
  L.eq("INFORME: un miembro no tiene «Otra dirección…»", options.includes("Otra dirección…"), false);
  await sel.selectOption({ label: user2.name });
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.getByText("Informe semanal guardado").first().waitFor({ timeout: 10000 });
  L.eq("INFORME: guardado con el email de la persona elegida", (await L.q(`SELECT recipient FROM "ReportSchedule" WHERE "projectId"=$1`, [p.id]))[0].recipient, user2.email);
  await asAdmin();
  await L.reload(page).catch(() => {});
  await L.goto(page, `${L.BASE}/p/${p.id}/settings?tab=informes`);
  await sel.selectOption({ label: "Otra dirección…" });
  await page.getByTestId("rs-email").fill("fuera.r56@example.com");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.getByText("Informe semanal guardado").first().waitFor({ timeout: 10000 });
  L.eq("INFORME: un administrador pone una dirección externa", (await L.q(`SELECT recipient FROM "ReportSchedule" WHERE "projectId"=$1`, [p.id]))[0].recipient, "fuera.r56@example.com");
  L.assertNoErrors("INFORME", [s]);
  await s.ctx.close();
  await asMember();
  await L.q(`DELETE FROM "ReportSchedule" WHERE "projectId"=$1`, [p.id]);
}

// --- (4) Calendario ---------------------------------------------------------------------------------------------------
if (only.includes("cal")) {
  L.scenario("cal: vencidas en rojo, «N vencidas de antes de este mes», «Ir a hoy» y el móvil baja hasta hoy sin vencidas");
  await L.cleanBoard();
  await asMember();
  const s = await L.session();
  const today = await appToday(s.page);
  const day = (d) => `${today.slice(0, 8)}${String(d).padStart(2, "0")}`;
  // Una vencida de hace dos meses, otra de este mes (ya pasada) y una tarea por día de este mes (lista larga en el móvil).
  const [old] = await L.seedTasks(COL.backlog, ["Vencida antigua r56"]);
  const past = new Date(`${today}T12:00:00Z`); past.setUTCMonth(past.getUTCMonth() - 2);
  await L.q(`UPDATE "Task" SET "dueDate"=$2 WHERE id=$1`, [old, past.toISOString().slice(0, 10)]);
  const daily = await L.seedTasks(COL.backlog, Array.from({ length: 28 }, (_, i) => `Día ${i + 1} r56`));
  for (const [i, id] of daily.entries()) await L.q(`UPDATE "Task" SET "dueDate"=$2 WHERE id=$1`, [id, day(i + 1)]);
  await L.goto(s.page, `${L.BASE}/calendar`);
  const box = s.page.getByTestId("cal-overdue");
  await box.waitFor({ timeout: 15000 });
  L.eq("CAL: «1 vencida de antes de este mes»", (await box.locator("summary").innerText()).trim(), "1 vencida de antes de este mes");
  await box.locator("summary").click();
  L.eq("CAL: al abrirlo, la tarea y su enlace", await box.getByRole("link", { name: /Vencida antigua r56/ }).count(), 1);
  const dueDay = Number(today.slice(8));
  if (dueDay > 1) {
    const chip = s.page.locator(`[data-day="${day(1)}"] [data-chip]`).first();
    const red = await chip.evaluate((el) => getComputedStyle(el).borderLeftColor);
    const mine = await s.page.evaluate(() => { const d = document.createElement("div"); d.className = "bg-red-600"; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; });
    L.eq("CAL: una vencida del mes lleva el borde del mismo rojo que «Mis tareas»", [await chip.getAttribute("data-overdue"), red], ["true", mine]);
  }
  L.eq("CAL: las de hoy en adelante no van en rojo", await s.page.locator(`[data-day="${today}"] [data-chip][data-overdue]`).count(), 0);
  await s.ctx.close();
  const m = await L.session({ viewport: { width: 393, height: 852 }, mobile: true });
  await L.goto(m.page, `${L.BASE}/calendar`);
  const todayRow = m.page.locator(`[data-mobile-day="${today}"]`);
  await todayRow.waitFor({ timeout: 15000 });
  await sleep(600);
  const rowTop = () => todayRow.evaluate((el) => el.getBoundingClientRect().top - el.closest("main").getBoundingClientRect().top);
  // Hacia final de mes puede no quedar página por debajo de hoy: entonces basta con haber bajado todo lo posible.
  const atEnd = () => todayRow.evaluate((el) => { const main = el.closest("main"); return main.scrollTop + main.clientHeight >= main.scrollHeight - 2; });
  // Con vencidas de antes no baja solo (su aviso, arriba, quedaría fuera de la vista): el aviso se ve y lleva «Ir a hoy».
  const mBox = m.page.getByTestId("cal-overdue");
  const boxTop = await mBox.evaluate((el) => el.getBoundingClientRect().top - el.closest("main").getBoundingClientRect().top);
  L.check("CAL móvil: con vencidas de antes, el aviso queda a la vista (no baja solo hasta hoy)", boxTop >= -2 && boxTop < 400, `top=${boxTop}`);
  await m.page.screenshot({ path: `${SHOTS}/r56-cal-movil.png` });
  await m.page.getByTestId("cal-go-today").click();
  await sleep(300);
  if (dueDay > 3) {
    const top = await rowTop();
    L.check("CAL móvil: «Ir a hoy» deja hoy arriba", top >= -2 && (top < 120 || (await atEnd())), `top=${top}`);
    // Sin vencidas de antes, al abrir el mes sí baja solo hasta hoy.
    await L.q(`UPDATE "Task" SET "dueDate"=$2 WHERE id=$1`, [old, today]);
    await L.goto(m.page, `${L.BASE}/calendar`);
    await todayRow.waitFor({ timeout: 15000 });
    await sleep(600);
    L.eq("CAL móvil: sin vencidas de antes no hay aviso", await m.page.getByTestId("cal-overdue").count(), 0);
    const top2 = await rowTop();
    L.check("CAL móvil: sin vencidas de antes, al abrir el mes hoy queda arriba", top2 >= -2 && (top2 < 120 || (await atEnd())), `top=${top2}`);
  } else L.note("CAL móvil: hoy es de los primeros días del mes, no hay nada que bajar");
  L.assertNoErrors("CAL", [m]);
  await m.ctx.close();
  await L.cleanBoard();
}

// --- (5) Mis tareas ---------------------------------------------------------------------------------------------------
if (only.includes("mis")) {
  L.scenario("mis: singular y plural; el borde rojo solo en las vencidas");
  await L.cleanBoard();
  await asMember();
  const [one] = await L.seedTasks(COL.backlog, ["Más adelante roja r56"]);
  await L.q(`UPDATE "Task" SET "assigneeId"=$2, color='#ef4444', "dueDate"=CURRENT_DATE + 40 WHERE id=$1`, [one, admin.id]);
  const s = await L.session();
  await L.goto(s.page, `${L.BASE}/my-tasks`);
  await s.page.getByText("1 tarea en todos tus proyectos.").waitFor({ timeout: 15000 });
  L.check("MIS: «1 tarea en todos tus proyectos.» (sin «tarea(s)»)", !(await s.page.content()).includes("tarea(s)"));
  const row = s.page.locator("li", { hasText: "Más adelante roja r56" });
  L.eq("MIS: una de «Más adelante» con color rojo no se marca como vencida (su color va en un punto)", [await row.getAttribute("data-overdue"), await row.locator("[data-task-color]").count()], [null, 1]);
  const [late] = await L.seedTasks(COL.backlog, ["Vencida r56"]);
  await L.q(`UPDATE "Task" SET "assigneeId"=$2, "dueDate"=CURRENT_DATE - 5 WHERE id=$1`, [late, admin.id]);
  await L.goto(s.page, `${L.BASE}/my-tasks`);
  await s.page.getByText("2 tareas en todos tus proyectos.").waitFor({ timeout: 15000 });
  L.eq("MIS: la vencida sí lleva el borde rojo", await s.page.locator("li[data-overdue]", { hasText: "Vencida r56" }).count(), 1);
  L.assertNoErrors("MIS", [s]);
  await s.ctx.close();
  await L.cleanBoard();
}

// --- (6) Móvil: Usuarios, pestañas y pie del menú ----------------------------------------------------------------------
if (only.includes("movil")) {
  L.scenario("movil: Usuarios a 393 px, indicador en las pestañas y pie del menú lateral");
  await asMember();
  await L.q(`UPDATE "User" SET "twoFactorMethod"=NULL WHERE id=$1`, [user2.id]);
  const m = await L.session({ viewport: { width: 393, height: 852 }, mobile: true });
  await asAdmin();
  await L.goto(m.page, `${L.BASE}/admin/users`);
  const row = m.page.locator(`li[data-user-row="${user2.id}"]`);
  await row.waitFor({ timeout: 15000 });
  const nameW = await row.locator("div.min-w-0.flex-1").first().evaluate((el) => el.getBoundingClientRect().width);
  L.check("MÓVIL Usuarios: el nombre y el email tienen sitio", nameW > 150, `ancho=${nameW}`);
  L.eq("MÓVIL Usuarios: sin iconos sueltos en la fila (van en «⋯»)", await row.getByRole("button", { name: `Editar ${user2.name}` }).count(), 0);
  await row.getByRole("button", { name: `Acciones de ${user2.name}` }).click();
  const items = await m.page.getByRole("menuitem").allInnerTexts();
  L.check("MÓVIL Usuarios: el menú tiene Editar, Forzar cambio de contraseña y Borrar", ["Editar", "Forzar cambio de contraseña", "Borrar"].every((x) => items.some((i) => i.trim() === x)), JSON.stringify(items));
  await m.page.getByRole("menuitem", { name: "Editar" }).click();
  await m.page.getByRole("dialog", { name: "Editar usuario" }).waitFor();
  await m.page.keyboard.press("Escape");
  const rowRight = await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  L.check("MÓVIL Usuarios: la fila no se sale", rowRight);
  await m.page.screenshot({ path: `${SHOTS}/r56-usuarios-393.png` });
  // Pestañas de Administración: hay más a la derecha y se indica; al llegar al final, a la izquierda.
  const nav = m.page.getByRole("navigation", { name: "Administración" });
  const hints = () => m.page.locator("[data-scroll-hint]").evaluateAll((els) => els.map((e) => e.dataset.scrollHint));
  L.eq("MÓVIL pestañas: con más a la derecha, indicador a la derecha", await hints(), ["right"]);
  await nav.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await L.eqEventually("MÓVIL pestañas: al final, solo el de la izquierda", hints, ["left"]);
  // Escritorio: igual que antes (iconos en la fila, sin «⋯»).
  await asMember();
  const d = await L.session();
  await asAdmin();
  await L.goto(d.page, `${L.BASE}/admin/users`);
  const drow = d.page.locator(`li[data-user-row="${user2.id}"]`);
  await drow.waitFor({ timeout: 15000 });
  L.eq("ESCRITORIO Usuarios: iconos en la fila y sin «⋯»", [await drow.getByRole("button", { name: `Editar ${user2.name}` }).isVisible(), await drow.getByRole("button", { name: `Acciones de ${user2.name}` }).isVisible()], [true, false]);
  L.eq("ESCRITORIO pestañas: caben, sin indicador", await d.page.locator("[data-scroll-hint]").count(), 0);
  await d.ctx.close();
  // Pie del menú lateral, entero dentro de la pantalla.
  await L.goto(m.page, `${L.BASE}/p/${p.id}`);
  await L.board(m.page);
  await m.page.getByRole("button", { name: "Abrir menú" }).click();
  const drawer = m.page.getByRole("dialog", { name: "Menú" });
  await drawer.waitFor();
  const vh = await m.page.evaluate(() => window.innerHeight);
  const logout = await drawer.getByRole("button", { name: "Cerrar sesión" }).boundingBox();
  const version = await drawer.getByRole("link", { name: /^v\d/ }).boundingBox();
  L.check("MÓVIL menú: el pie (nombre, versión y salir) se ve entero, con margen", logout.y + logout.height <= vh - 8 && version.y + version.height <= vh - 8, JSON.stringify({ vh, logout, version }));
  await m.page.screenshot({ path: `${SHOTS}/r56-menu-pie.png` });
  L.assertNoErrors("MÓVIL", [m]);
  await m.ctx.close();
  await asMember();
}

// --- (7) theme-color ---------------------------------------------------------------------------------------------------
if (only.includes("tema")) {
  L.scenario("tema: la barra de estado sigue al tema elegido en Pizarro, no al del sistema");
  await asMember();
  await L.q(`UPDATE "User" SET theme='DARK' WHERE id=$1`, [admin.id]);
  const s = await sessionTz({ colorScheme: "light" });
  const metas = () => s.page.locator('meta[name="theme-color"]').evaluateAll((els) => els.map((e) => e.content));
  const active = () => s.page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].find((m) => !m.media || matchMedia(m.media).matches)?.content);
  L.eq("TEMA: sistema claro y Pizarro oscuro → barra oscura", await active(), "#020617");
  await L.goto(s.page, `${L.BASE}/settings?tab=preferencias`);
  await s.page.getByRole("button", { name: "Claro", exact: true }).click();
  await L.eqEventually("TEMA: al elegir «Claro», cambia al momento", active, "#f8fafc");
  await s.page.getByRole("button", { name: "Oscuro", exact: true }).click();
  await L.eqEventually("TEMA: al elegir «Oscuro», cambia al momento", active, "#020617");
  await s.page.getByRole("button", { name: "Sistema", exact: true }).click();
  await L.eqEventually("TEMA: con «Sistema», los dos colores con su media", metas, ["#f8fafc", "#020617"]);
  await L.eqEventually("TEMA: … y vale el del sistema (claro)", active, "#f8fafc");
  L.assertNoErrors("TEMA", [s]);
  await s.ctx.close();
  await L.q(`UPDATE "User" SET theme='SYSTEM' WHERE id=$1`, [admin.id]);
}

// --- (8) Accesibilidad -----------------------------------------------------------------------------------------------
if (only.includes("a11y")) {
  L.scenario("a11y: botones de alternar, menú, fondo inert con un modal y nombres accesibles");
  await L.cleanBoard();
  const [acc] = await L.seedTasks(COL.backlog, ["Accesible r56"]);
  await asMember();
  await L.q(`DELETE FROM "Notification" WHERE "userId"=$1`, [admin.id]);
  await L.q(`INSERT INTO "Notification"(id,"userId",excerpt,"taskId","projectId") VALUES ('r56_n1',$1,'r56',$2,$3),('r56_n2',$1,'r56',$2,$3)`, [admin.id, acc, p.id]);
  const s = await L.session();
  const { page } = s;
  const tog = page.locator("[data-view-toggle]:visible");
  L.eq("A11Y: «Ver como lista» sin pulsar en el tablero", [await tog.getAttribute("aria-label"), await tog.getAttribute("aria-pressed")], ["Ver como lista", "false"]);
  await tog.click();
  await L.eqEventually("A11Y: en la lista, el mismo nombre y pulsado", async () => [await tog.getAttribute("aria-label"), await tog.getAttribute("aria-pressed")], ["Ver como lista", "true"]);
  await tog.click();
  L.eq("A11Y: «Avisos» dice cuántos hay sin leer", await page.getByRole("link", { name: /^Avisos\s*2 sin leer$/ }).count(), 1);
  // Modal abierto: lo de debajo queda inert; el aviso emergente no. Diálogo dentro de diálogo.
  await page.getByRole("button", { name: "Nueva tarea" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Nueva tarea" });
  await dlg.waitFor();
  const inertState = () => page.evaluate(() => ({
    main: !!document.querySelector("main")?.closest("[inert]"),
    toasts: !!document.querySelector("body > [aria-live]")?.closest("[inert]"),
    modals: [...document.querySelectorAll("[data-pz-modal]")].map((m) => m.inert),
  }));
  await L.eqEventually("A11Y: con «Nueva tarea» abierta, el tablero queda inert y los avisos no", inertState, { main: true, toasts: false, modals: [false] });
  // El árbol de Chromium (el que leen los lectores de pantalla): lo de debajo ya no está.
  const cdp = await page.context().newCDPSession(page);
  const names = (await cdp.send("Accessibility.getFullAXTree")).nodes.filter((n) => !n.ignored).map((n) => n.name?.value ?? "");
  L.check("A11Y: en el árbol de accesibilidad está el diálogo y no el tablero de debajo", names.includes("Nueva tarea") && !names.some((x) => x.includes("Accesible r56")) && !names.includes("Cerrar sesión"));
  await cdp.detach();
  await dlg.getByRole("textbox", { name: "Título", exact: true }).fill("A medias");
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("dialog", { name: "Descartar la nueva tarea" });
  await confirm.waitFor();
  await L.eqEventually("A11Y: con la confirmación encima, «Nueva tarea» también queda inert", inertState, { main: true, toasts: false, modals: [true, false] });
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await L.eqEventually("A11Y: al cerrar la confirmación, «Nueva tarea» vuelve a funcionar", inertState, { main: true, toasts: false, modals: [false] });
  L.eq("A11Y: … con el foco dentro de ella", await page.evaluate(() => !!document.activeElement?.closest("[data-pz-modal]")), true);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Descartar la nueva tarea" }).getByRole("button", { name: "Descartar" }).click();
  await L.eqEventually("A11Y: sin modales, nada queda inert", async () => page.evaluate(() => document.querySelectorAll("[inert]").length), 0);
  // axe en las páginas principales: ningún botón ni enlace sin nombre.
  await asAdmin();
  const bad = {};
  for (const path of [`/p/${p.id}`, "/settings", "/admin/users", "/my-tasks", "/calendar", `/p/${p.id}/settings?tab=informes`]) {
    await L.goto(page, L.BASE + path);
    await sleep(800);
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["button-name", "link-name", "aria-prohibited-attr", "aria-allowed-attr"] })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`));
    if (v.length) bad[path] = v;
  }
  L.eq("A11Y (axe): sin botones ni enlaces sin nombre ni atributos ARIA de más", bad, {});
  // Móvil: «Abrir menú» con aria-expanded.
  await asMember();
  const m = await L.session({ viewport: { width: 393, height: 852 }, mobile: true });
  const opener = m.page.getByRole("button", { name: "Abrir menú" });
  L.eq("A11Y móvil: «Abrir menú» cerrado", await opener.getAttribute("aria-expanded"), "false");
  await opener.click();
  await m.page.getByRole("dialog", { name: "Menú" }).waitFor();
  L.eq("A11Y móvil: … y abierto", await m.page.locator('button[aria-controls="app-drawer"]').getAttribute("aria-expanded"), "true");
  L.assertNoErrors("A11Y", [s, m]);
  await s.ctx.close();
  await m.ctx.close();
  await L.q(`DELETE FROM "Notification" WHERE "userId"=$1`, [admin.id]);
  await L.cleanBoard();
}

await asMember();
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
