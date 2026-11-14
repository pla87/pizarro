// Ronda 49 (infraestructura): formularios de administración y de Mi perfil sin red (aviso «Sin conexión: no se ha
// guardado» en vez de la pantalla «Algo ha fallado», sin perder lo escrito), deshacer «Enviar a la papelera» de un
// documento sin red, IP del cliente que no se falsea con X-Real-IP / X-Forwarded-For sin proxy delante (TRUST_PROXY) y
// páginas legales pintadas en el servidor. Misma base y servidor que board-e2e.mjs (arrancado con `next start`, sin
// TRUST_PROXY):
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r49-infra-e2e.mjs
import os from "node:os";
import * as L from "./qa/lib.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "admin,profile,docs,ip,legal").split(",");

const OFFLINE = "Sin conexión: no se ha guardado";
const BANNER = "Sin conexión. Lo que cambies no se guardará hasta que vuelva.";
const CRASH = "Algo ha fallado";
const NEW_EMAIL = "r49-offline@example.com";

await L.prepareUsers();
await L.cleanBoard();
await L.q(`DELETE FROM "User" WHERE email=$1`, [NEW_EMAIL]);
const p = await L.project();

/** Texto visible de la página (sin esperar). */
const bodyText = (page) => page.evaluate(() => document.body.innerText);

// --- Administración → Usuarios: crear un usuario sin red ------------------------------------------------------------
if (only.includes("admin")) {
  L.scenario("admin: «Nuevo usuario» sin red");
  // Entra como miembro (sin el segundo paso obligatorio de los administradores) y pasa a administrador ya dentro.
  const s = await L.session();
  const { page, ctx } = s;
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE email=$1`, [L.ADMIN]);
  try {
    await page.goto(`${L.BASE}/admin/users`);
    await page.getByRole("button", { name: "Nuevo usuario" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre").fill("Persona sin red");
    await dialog.getByLabel("Email").fill(NEW_EMAIL);
    const pass = dialog.locator("#u-pass");
    if (await pass.count()) await pass.fill("una-clave-larga-123");
    await ctx.setOffline(true);
    await dialog.getByRole("button", { name: "Crear usuario" }).click();
    await L.eqEventually("ADMIN: sale el aviso «Sin conexión: no se ha guardado»", async () => (await bodyText(page)).includes(OFFLINE), true, { timeout: 10000 });
    const text = await bodyText(page);
    L.check("ADMIN: no sale la pantalla «Algo ha fallado»", !text.includes(CRASH));
    L.check("ADMIN: aparece el aviso fijo de sin conexión", text.includes(BANNER));
    L.eq("ADMIN: el diálogo sigue abierto con lo escrito", await dialog.getByLabel("Email").inputValue(), NEW_EMAIL);
    L.eq("ADMIN: no se ha creado nada", (await L.q(`SELECT count(*)::int n FROM "User" WHERE email=$1`, [NEW_EMAIL]))[0].n, 0);
    await page.screenshot({ path: `${SHOTS}/r49-admin-sin-red.png` });
    // Vuelve la red: el aviso fijo se va solo y el mismo formulario guarda.
    await ctx.setOffline(false);
    await L.eqEventually("ADMIN: al volver la red se quita el aviso fijo", async () => (await bodyText(page)).includes(BANNER), false, { timeout: 15000 });
    await dialog.getByRole("button", { name: "Crear usuario" }).click();
    await L.eqEventually("ADMIN: con red, el usuario se crea", async () => (await L.q(`SELECT count(*)::int n FROM "User" WHERE email=$1`, [NEW_EMAIL]))[0].n, 1, { timeout: 10000 });
    L.check("ADMIN: nunca «Algo ha fallado»", !(await bodyText(page)).includes(CRASH));
    L.assertNoErrors("ADMIN", [{ errors: s.errors.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/i.test(e)) }]);
  } finally {
    await L.q(`UPDATE "User" SET role='MEMBER' WHERE email=$1`, [L.ADMIN]);
    await L.q(`DELETE FROM "User" WHERE email=$1`, [NEW_EMAIL]);
    await ctx.close();
  }
}

// --- Mi perfil: guardar el nombre sin red ---------------------------------------------------------------------------
if (only.includes("profile")) {
  L.scenario("profile: guardar el perfil sin red");
  const s = await L.session();
  const { page, ctx } = s;
  const [before] = await L.q(`SELECT name FROM "User" WHERE email=$1`, [L.ADMIN]);
  await page.goto(`${L.BASE}/settings`);
  const name = page.locator("#pf-name");
  await name.waitFor({ timeout: 20000 });
  await name.fill("Nombre sin red");
  await ctx.setOffline(true);
  await page.locator("form").filter({ has: name }).getByRole("button", { name: "Guardar", exact: true }).click();
  await L.eqEventually("PROFILE: «Sin conexión: no se ha guardado»", async () => (await bodyText(page)).includes(OFFLINE), true, { timeout: 10000 });
  L.check("PROFILE: no sale «Algo ha fallado»", !(await bodyText(page)).includes(CRASH));
  L.eq("PROFILE: lo escrito sigue ahí", await name.inputValue(), "Nombre sin red");
  L.eq("PROFILE: el nombre no ha cambiado", (await L.q(`SELECT name FROM "User" WHERE email=$1`, [L.ADMIN]))[0].name, before.name);
  await ctx.setOffline(false);
  await ctx.close();
}

// --- Documentos: deshacer «Enviar a la papelera» sin red -------------------------------------------------------------
if (only.includes("docs")) {
  L.scenario("docs: deshacer la papelera sin red");
  const [admin] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1 AND name LIKE 'r49-%'`, [p.id]);
  const s = await L.session();
  const { page, ctx } = s;
  await page.goto(`${L.BASE}/p/${p.id}/docs`);
  // El campo de subida solo funciona cuando React ha hidratado la página: con la máquina cargada, un fichero elegido
  // antes se pierde (una persona no llega a elegirlo tan rápido). Se espera a que acabe de cargar y, si aun así no
  // llega, se vuelve a elegir (como mucho tres veces).
  await page.waitForLoadState("networkidle").catch(() => {});
  const uploaded = async () => (await L.q(`SELECT count(*)::int n FROM "ProjectDocument" WHERE "projectId"=$1 AND name='r49-nota.txt' AND "deletedAt" IS NULL`, [p.id]))[0].n;
  for (let i = 0; i < 3 && (await uploaded()) === 0; i++) {
    await page.locator('input[type=file]').first().setInputFiles({ name: "r49-nota.txt", mimeType: "text/plain", buffer: Buffer.from("hola") });
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && (await uploaded()) === 0) await L.sleep(250);
  }
  await L.eqEventually("DOCS: el documento se sube", async () => (await L.q(`SELECT count(*)::int n FROM "ProjectDocument" WHERE "projectId"=$1 AND name='r49-nota.txt' AND "deletedAt" IS NULL`, [p.id]))[0].n, 1, { timeout: 15000 });
  const trash = page.getByRole("button", { name: "Enviar «r49-nota.txt» a la papelera" });
  await trash.waitFor({ timeout: 10000 });
  await trash.click();
  const undo = page.getByRole("button", { name: "Deshacer" }).last();
  await undo.waitFor({ timeout: 10000 });
  await ctx.setOffline(true);
  await undo.click();
  await L.eqEventually("DOCS: deshacer sin red avisa «Sin conexión: no se ha guardado»", async () => (await bodyText(page)).includes(OFFLINE), true, { timeout: 10000 });
  L.check("DOCS: no sale «Algo ha fallado»", !(await bodyText(page)).includes(CRASH));
  L.check("DOCS: sin promesas rechazadas sin atender", !s.errors.some((e) => /Unhandled|uncaught/i.test(e)), s.errors.join(" | "));
  await ctx.setOffline(false);
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1 AND name LIKE 'r49-%'`, [p.id]);
  void admin;
  await ctx.close();
}

// --- IP del cliente: sin proxy delante, X-Real-IP y X-Forwarded-For no cuentan ----------------------------------------
if (only.includes("ip")) {
  L.scenario("ip: X-Real-IP / X-Forwarded-For falsas sin TRUST_PROXY");
  const b = await L.getBrowser();
  const ctx = await b.newContext({ locale: "es-ES", extraHTTPHeaders: { "x-real-ip": "203.0.113.66", "x-forwarded-for": "203.0.113.66", "x-pz-peer-ip": "203.0.113.66" } });
  const page = await ctx.newPage();
  const since = await L.dbNow();
  await L.login(page, L.ADMIN);
  const [sess] = await L.q(`SELECT s.ip FROM "Session" s JOIN "User" u ON u.id=s."userId" WHERE u.email=$1 AND s."createdAt">=$2 ORDER BY s."createdAt" DESC LIMIT 1`, [L.ADMIN, since]);
  L.check("IP: la sesión guarda la IP de la conexión, no la de las cabeceras", !!sess && !String(sess.ip).includes("203.0.113.66") && /^(127\.0\.0\.1|::1)$/.test(String(sess.ip)), String(sess?.ip));
  // El registro se guarda por tandas (cada 3 s): se espera a que aparezca el acceso.
  const loginLogs = () => L.q(`SELECT ip FROM "AppLog" WHERE "createdAt">=($1::timestamptz AT TIME ZONE 'UTC') AND action='auth.login'`, [since]);
  await L.waitFor(async () => (await loginLogs()).length > 0, { timeout: 10000 }).catch(() => {});
  const rows = await loginLogs();
  L.check("IP: el registro del acceso tampoco lleva la IP inventada", rows.length > 0 && rows.every((r) => !String(r.ip).includes("203.0.113.66")), JSON.stringify(rows.map((r) => r.ip)));
  await ctx.close();
}

// --- Páginas legales: el Markdown llega pintado y sin el código de react-markdown --------------------------------------
if (only.includes("legal")) {
  L.scenario("legal: privacidad, condiciones y licencia pintadas en el servidor");
  const b = await L.getBrowser();
  // Sin JavaScript: lo que se ve es el HTML del servidor.
  const ctx = await b.newContext({ locale: "es-ES", javaScriptEnabled: false });
  const page = await ctx.newPage();
  for (const [path, testid] of [["/privacy", "legal-privacy"], ["/terms", "legal-terms"], ["/licencia", "license"]]) {
    await page.goto(L.BASE + path);
    const box = page.locator(`[data-testid=${testid}] .prose-md`).first();
    L.check(`LEGAL ${path}: el texto llega ya pintado (encabezados y párrafos)`, (await box.locator("h1, h2, h3, p").count()) > 2);
    const html = await page.content();
    L.check(`LEGAL ${path}: sin el Markdown del navegador`, !/components_ui_Markdown|react-markdown/.test(html));
  }
  await ctx.close();
  // Con JavaScript: sin errores.
  const s = await L.getBrowser().then((br) => br.newContext({ locale: "es-ES" }));
  const pg = await s.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(e.message));
  await pg.goto(L.BASE + "/privacy");
  await sleep(500);
  L.eq("LEGAL: /privacy sin errores de página", errors, []);
  await s.close();
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
