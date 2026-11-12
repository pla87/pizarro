// Instalación desde cero con `npm start` (sin SEED_ADMIN_* y con la base vacía), recorrida como lo haría una persona:
// el código del asistente sale en la terminal, el asistente no se reinicia al cambiar de idioma, el acceso sale en el
// idioma elegido, el segundo paso obligatorio del admin tiene un solo «Atrás», Administración → Ajustes → Instalación,
// el email de prueba con el buzón de pruebas, invitar en otro idioma y reenviar la invitación, el idioma tras /reset,
// cambiar de idioma en «Mi perfil» sin desmontar la página y «Documentos de Google» sin Google configurado.
//
// Borra y crea la base de DATABASE_URL (solo nombres pz_*) y arranca su propio `npm start` en el puerto de BASE (debe
// estar libre; compila antes con next build + postbuild + build:boot). No usa la base de la QA.
//   cd e2e && BASE=http://localhost:3317 DATABASE_URL=postgresql://…/pz_install APP_DIR=$PWD/.. node install-e2e.mjs
import { spawn, execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import * as L from "./qa/lib.mjs";

const APP_DIR = process.env.APP_DIR || path.resolve(L.HERE, "..", "..");
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const DB = L.DATABASE_URL;
const dbName = new URL(DB).pathname.slice(1);
if (!/^pz_/.test(dbName)) throw new Error(`Por seguridad solo se usan bases pz_* (es «${dbName}»)`);
const outbox = mkdtempSync(path.join(os.tmpdir(), "pz-install-outbox-"));
const warnLog = path.join(outbox, "..", `pz-install-warnings-${process.pid}.log`);
const ADMIN_EMAIL = "fundadora@example.com";
const ADMIN_PASSWORD = "una-clave-larga-1";
const INVITED = "invitada@example.com";
const SETUP_TOKEN = "token-de-reserva-e2e";

// --- Base vacía y `npm start` sin administrador por variables ---------------------------------------------------------
{
  const u = new URL(DB); u.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: u.toString() }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: APP_DIR, env: { ...process.env, DATABASE_URL: DB }, stdio: "pipe" });
}
let out = "";
const port = new URL(L.BASE).port || "80";
const env = {
  ...process.env, DATABASE_URL: DB, PORT: port, APP_URL: L.BASE,
  // Vacías: el .env no las pisa (Node no sobrescribe variables ya definidas) y el seed no crea ningún administrador.
  SEED_ADMIN_EMAIL: "", SEED_ADMIN_PASSWORD: "", SEED_ADMIN_NAME: "",
  MAIL_OUTBOX_DIR: outbox, MAIL_OUTBOX_IN_PRODUCTION: "1",
  // De reserva, por si el código no sale en la terminal (el fallo se anota igualmente): así se sigue con el resto.
  SETUP_TOKEN: SETUP_TOKEN,
  GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", APP_TIMEZONE: "",
  // Anota cualquier aviso de Node (p. ej. DeprecationWarning) con su pila.
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(path.join(L.HERE, "..", "warn-hook.mjs")).href}`.trim(), WARN_LOG: warnLog,
};
const server = spawn("npm", ["start"], { cwd: APP_DIR, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
server.stdout.on("data", (d) => (out += d));
server.stderr.on("data", (d) => (out += d));
const stop = () => { try { process.kill(-server.pid, "SIGTERM"); } catch { /* ya parado */ } };
process.on("exit", stop);
const ready = await L.waitFor(async () => (await fetch(L.BASE + "/api/health")).ok, { timeout: 90000, step: 500 });
if (!ready) { console.log(out); throw new Error("el servidor no arranca"); }

/** Emails del buzón de pruebas para `to`, del más antiguo al más reciente. */
const mails = (to) => readdirSync(outbox).filter((f) => f.endsWith(".json")).sort()
  .map((f) => JSON.parse(readFileSync(path.join(outbox, f), "utf8"))).filter((m) => m.to === to);
const tokenOf = (m) => /\/reset\/([A-Za-z0-9_-]+)/.exec(m?.text ?? "")?.[1] ?? "";
/** Código TOTP (RFC 6238) de una clave base32, como el de una app de autenticación. */
function totp(secret, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}
const browser = await L.getBrowser();
const newPage = async (locale = "es-ES") => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, locale });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error" && !/React DevTools/.test(m.text())) errors.push("console.error: " + m.text().slice(0, 300)); });
  return { ctx, page, errors };
};
const lang = (page) => page.evaluate(() => document.documentElement.lang);
const labelOf = (page, id) => page.locator(`label[for="${id}"]`).first().innerText().catch(() => "");
/** Un tramo del recorrido: si algo lanza, se anota como fallo y se sigue con el siguiente. */
async function part(label, fn) {
  try {
    await fn();
  } catch (err) {
    L.check(`${label}: el recorrido no se interrumpe`, false, String(err?.message ?? err).split("\n")[0]);
  }
}
let exampleProject, firstToken, secondToken, inv;

// --- 1. `npm start` hace las tareas de arranque ------------------------------------------------------------------------
L.scenario("arranque con npm start en una instalación nueva");
const code = /introduce el código: ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(out)?.[1];
L.check("ARR: el código del asistente sale en la terminal de npm start", !!code, out.slice(0, 500));
L.eq("ARR: se registra system.boot", (await L.q(`SELECT count(*)::int n FROM "AppLog" WHERE action='system.boot'`))[0].n, 1);
L.check("ARR: plantillas de proyecto de serie creadas", (await L.q(`SELECT count(*)::int n FROM "ProjectTemplate"`))[0].n > 0);
L.check("ARR: historial de versiones sincronizado", (await L.q(`SELECT count(*)::int n FROM "AppVersionLog"`))[0].n > 0);
L.eq("ARR: ningún usuario (lo crea el asistente)", (await L.q(`SELECT count(*)::int n FROM "User"`))[0].n, 0);

// --- 2. Asistente: cambiar de idioma no lo reinicia ---------------------------------------------------------------------
L.scenario("asistente /setup");
const w = await newPage();
await part("SETUP", async () => {
await w.page.goto(L.BASE + "/");
await w.page.waitForURL(/\/setup$/, { timeout: 15000 });
L.check("SETUP: el paso 1 dice que el código está en la terminal de npm start", /terminal donde ejecutaste npm start/.test(await w.page.locator("form").first().innerText()));
await w.page.fill("#setup-code", code ?? SETUP_TOKEN);
await w.page.getByRole("button", { name: "Continuar" }).click();
await w.page.locator("#setup-org").waitFor({ timeout: 15000 });
await w.page.fill("#setup-org", "Acme");
await w.page.selectOption("#setup-tz", "Europe/Lisbon");
await w.page.selectOption("#setup-lang", "en");
await L.waitFor(() => w.page.getByText(/^Step \d of 5$/).isVisible(), { timeout: 15000 });
const kept = await w.page.locator("#setup-org").isVisible();
L.check("SETUP: al elegir inglés sigue en el paso 2 (no vuelve al paso 1)", kept && (await w.page.getByText("Step 2 of 5").isVisible()), await w.page.locator("main").innerText());
if (kept) {
  L.eq("SETUP: conserva el nombre de la organización", await w.page.inputValue("#setup-org"), "Acme");
  L.eq("SETUP: conserva la zona horaria", await w.page.inputValue("#setup-tz"), "Europe/Lisbon");
  await w.page.selectOption("#setup-lang", "es");
  await L.waitFor(() => w.page.getByText(/^Paso \d de 5$/).isVisible(), { timeout: 15000 });
  L.check("SETUP: y al volver a español, también", (await w.page.getByText("Paso 2 de 5").isVisible()) && (await w.page.inputValue("#setup-org")) === "Acme");
  await w.page.selectOption("#setup-lang", "en");
  await w.page.getByText("Step 2 of 5").waitFor({ timeout: 15000 });
} else {
  // Ha vuelto al paso 1 y ha perdido lo escrito: se rehace para poder seguir con el resto del recorrido.
  await w.page.fill("#setup-code", code ?? SETUP_TOKEN);
  await w.page.getByRole("button", { name: "Continue" }).click();
  await w.page.locator("#setup-org").waitFor({ timeout: 15000 });
  await w.page.fill("#setup-org", "Acme");
  await w.page.selectOption("#setup-tz", "Europe/Lisbon");
}
await w.page.getByRole("button", { name: "Continue" }).click();
await w.page.fill("#setup-name", "Fundadora");
await w.page.fill("#setup-email", ADMIN_EMAIL);
await w.page.fill("#setup-password", ADMIN_PASSWORD);
await w.page.getByRole("button", { name: "Continue" }).click();
await w.page.locator("#setup-finish").click();
await w.page.getByText("All done").waitFor({ timeout: 20000 });
[exampleProject] = await L.q(`SELECT id, name, description FROM "Project" ORDER BY "createdAt" LIMIT 1`);
L.eq("SETUP: el proyecto de ejemplo, en el idioma de la instalación", exampleProject?.name, "Example project");
L.check("SETUP: su descripción no habla del «seed»", exampleProject && !/seed/i.test(exampleProject.description), exampleProject?.description);
await w.page.getByRole("link", { name: "Go to sign in" }).click();
await w.page.locator("#password").waitFor({ timeout: 15000 });
L.eq("SETUP→LOGIN: el acceso sale entero en inglés (atributo lang)", await lang(w.page), "en");
L.eq("SETUP→LOGIN: también los textos del formulario (componente de cliente)", await labelOf(w.page, "password"), "Password");
L.check("SETUP: sin errores de consola", w.errors.length === 0, w.errors.join(" | "));
});

// --- 15. Segundo paso obligatorio del admin: un solo botón para volver -------------------------------------------------
L.scenario("verificación en dos pasos obligatoria del admin");
await part("2FA", async () => {
await w.page.fill("#email", ADMIN_EMAIL);
await w.page.fill("#password", ADMIN_PASSWORD);
await w.page.click("button[type=submit]");
await w.page.waitForURL(/\/login\/verify/, { timeout: 20000 });
const backs = () => w.page.getByRole("button", { name: "Back", exact: true }).count();
L.eq("2FA: al elegir método, un solo «Back»", await backs(), 1);
await w.page.getByRole("button", { name: "Authenticator app" }).click();
await w.page.locator('[data-testid="totp-secret"]').waitFor({ timeout: 15000 });
L.eq("2FA: con el código QR, un solo «Back» (antes salían «Atrás» y «Volver» seguidos)", await backs(), 1);
await w.page.getByRole("button", { name: "Back", exact: true }).first().click();
await w.page.getByRole("button", { name: "Authenticator app" }).waitFor({ timeout: 10000 });
L.eq("2FA: de vuelta a elegir método, otra vez un solo «Back»", await backs(), 1);
await w.page.getByRole("button", { name: "Authenticator app" }).click();
const secret = await w.page.locator('[data-testid="totp-secret"]').innerText();
await w.page.fill("#enroll-code", totp(secret));
// Con email disponible, el alta de la app pide también el código enviado al email (el último que ha llegado).
if (await w.page.locator("#enroll-email-code").isVisible().catch(() => false)) {
  const sent = await L.waitFor(() => mails(ADMIN_EMAIL).map((m) => /\b(\d{3} ?\d{3})\b/.exec(m.text)?.[1]).filter(Boolean).at(-1), { timeout: 10000 });
  await w.page.fill("#enroll-email-code", String(sent ?? "").replace(/\s/g, ""));
}
await w.page.getByRole("button", { name: "Enable" }).click();
await w.page.locator('[data-testid="recovery-codes"]').waitFor({ timeout: 15000 });
await w.page.getByLabel("I have saved the codes").check();
await w.page.getByRole("button", { name: "Log in" }).click();
await w.page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20000 });
L.check("2FA: activada, entra en la app", !/\/login/.test(new URL(w.page.url()).pathname), w.page.url());
});

// --- 3. Administración → Ajustes → Instalación --------------------------------------------------------------------------
L.scenario("Administración → Ajustes → Instalación");
await part("INST", async () => {
await w.page.goto(L.BASE + "/admin/settings");
const inst = w.page.locator("section#instalacion");
await inst.waitFor({ timeout: 15000 });
L.eq("INST: muestra el nombre elegido en el asistente", await w.page.inputValue("#instance-org"), "Acme");
L.eq("INST: y el idioma", await w.page.inputValue("#instance-locale"), "en");
L.eq("INST: y la zona horaria", await w.page.inputValue("#instance-tz"), "Europe/Lisbon");
await w.page.fill("#instance-org", "Acme Iberia");
await w.page.selectOption("#instance-locale", "es");
await w.page.selectOption("#instance-tz", "Atlantic/Canary");
await inst.getByRole("button", { name: "Save" }).click();
await L.eqEventually("INST: guardado en la base", async () => Object.fromEntries((await L.q(`SELECT key, value FROM "AppState" WHERE key LIKE 'instance.%' ORDER BY key`)).map((r) => [r.key, r.value])),
  { "instance.locale": "es", "instance.orgName": "Acme Iberia", "instance.timeZone": "Atlantic/Canary" });
await w.page.locator("section#instalacion").waitFor({ timeout: 15000 }); // la página se recarga con la zona nueva
await L.waitFor(async () => (await w.page.evaluate(() => document.documentElement.dataset.tz)) === "Atlantic/Canary", { timeout: 10000 });
L.eq("INST: el navegador ya usa la zona nueva (data-tz)", await w.page.evaluate(() => document.documentElement.dataset.tz), "Atlantic/Canary");
L.check("INST: el título lleva el nombre nuevo", (await w.page.title()).includes("Acme Iberia"), await w.page.title());
await L.waitFor(async () => (await L.q(`SELECT count(*)::int n FROM "AppLog" WHERE action='settings.saveInstallationSettings'`))[0].n > 0, { timeout: 10000 });
L.eq("INST: queda en el registro de actividad", (await L.q(`SELECT message FROM "AppLog" WHERE action='settings.saveInstallationSettings' ORDER BY "createdAt" DESC LIMIT 1`))[0]?.message, "Cambió los ajustes de la instalación");
{
  const anon = await newPage("en-GB");
  await anon.page.goto(L.BASE + "/login");
  L.eq("INST: sin sesión, el acceso sale en el idioma por defecto nuevo", await lang(anon.page), "es");
  await anon.ctx.close();
}
});

// --- 5. Email de prueba con el buzón de pruebas y nada guardado ---------------------------------------------------------
L.scenario("Avisos por email: email de prueba");
await part("MAIL", async () => {
await w.page.goto(L.BASE + "/admin/settings");
const mailSection = w.page.locator("section#avisos-email");
const testBtn = mailSection.getByRole("button", { name: "Send test email" });
L.check("MAIL: sin tocar nada, «Send test email» está activo (buzón de pruebas)", await testBtn.isEnabled());
const before = mails(ADMIN_EMAIL).length;
await testBtn.click();
L.check("MAIL: el email de prueba llega", await L.waitFor(() => mails(ADMIN_EMAIL).length > before, { timeout: 15000 }));
await mailSection.getByRole("radio", { name: /Company email service/ }).click();
L.check("MAIL: con un cambio sin guardar, desactivado y dice por qué", (await testBtn.isDisabled()) && (await mailSection.getByText("Save your changes before sending the test.").isVisible().catch(() => false)));
await mailSection.getByRole("radio", { name: /Gmail/ }).click();
L.check("MAIL: deshecho el cambio, otra vez activo", await testBtn.isEnabled());
});

// --- 4 y 6. Invitar en otro idioma y reenviar la invitación -------------------------------------------------------------
L.scenario("Usuarios: idioma al invitar y «Reenviar invitación»");
await part("USR", async () => {
await w.page.goto(L.BASE + "/admin/users");
await w.page.getByRole("button", { name: "New user" }).click();
await w.page.locator("#u-name").waitFor({ timeout: 10000 });
const hasLocale = await w.page.locator("#u-locale").isVisible();
L.check("USR: «Nuevo usuario» tiene selector de idioma", hasLocale);
if (hasLocale) L.eq("USR: y propone el idioma de la instalación", await w.page.inputValue("#u-locale"), "ES");
await w.page.fill("#u-name", "Invitada Uno");
await w.page.fill("#u-email", INVITED);
if (hasLocale) await w.page.selectOption("#u-locale", "EN");
await w.page.getByRole("button", { name: "Create user" }).click();
await L.waitFor(() => mails(INVITED).length === 1, { timeout: 15000 });
firstToken = tokenOf(mails(INVITED)[0]);
// Sin selector, el idioma se pone a mano para poder seguir con el resto del recorrido.
if (!hasLocale) await L.q(`UPDATE "User" SET locale='EN' WHERE email=$1`, [INVITED]);
L.eq("USR: la cuenta se crea con el idioma elegido", (await L.q(`SELECT locale FROM "User" WHERE email=$1`, [INVITED]))[0]?.locale, "EN");
L.eq("USR: y la invitación sale en ese idioma", mails(INVITED)[0]?.subject, "You've been invited to Pizarro");
const row = w.page.locator("li").filter({ hasText: INVITED });
await row.getByText("Invitation pending").waitFor({ timeout: 15000 });
L.check("USR: la fila dice «Invitation pending»", await row.getByText("Invitation pending").isVisible());
await row.getByRole("button", { name: "Resend invitation to Invitada Uno" }).click();
await L.waitFor(() => mails(INVITED).length === 2, { timeout: 15000 });
secondToken = tokenOf(mails(INVITED)[1]);
L.check("USR: «Reenviar invitación» manda un enlace nuevo", !!secondToken && secondToken !== firstToken);
L.check("USR: la admin no tiene botón de reenviar (ya ha entrado)", (await w.page.getByRole("button", { name: "Resend invitation to Fundadora" }).count()) === 0);
});

// --- 7. Del enlace de la invitación (inglés) al acceso (instalación en español) ------------------------------------------
L.scenario("idioma tras /reset");
inv = await newPage();
await part("RESET", async () => {
// Sin «Reenviar invitación» se usa la primera invitación.
secondToken ||= firstToken || tokenOf(mails(INVITED).at(-1));
await inv.page.goto(`${L.BASE}/reset/${firstToken}`);
L.check("RESET: el enlace anterior ya no vale", await inv.page.getByText("Enlace no válido").isVisible().catch(() => false), await inv.page.locator("body").innerText());
await inv.page.goto(`${L.BASE}/reset/${secondToken}`);
await inv.page.locator("#rs-new").waitFor({ timeout: 15000 });
L.eq("RESET: la página sale en el idioma de la persona invitada", await lang(inv.page), "en");
await inv.page.fill("#rs-new", "otra-clave-larga-2");
await inv.page.fill("#rs-repeat", "otra-clave-larga-2");
await inv.page.locator("form button[type=submit]").click();
await inv.page.getByRole("link", { name: "Log in" }).click();
await inv.page.locator("#password").waitFor({ timeout: 15000 });
L.eq("RESET→LOGIN: el acceso, en el idioma de la instalación", await lang(inv.page), "es");
L.eq("RESET→LOGIN: también los textos del formulario (antes se quedaban en inglés)", await labelOf(inv.page, "password"), "Contraseña");
});

// --- 2. «Mi perfil»: cambiar de idioma no borra lo que no se ha guardado -------------------------------------------------
L.scenario("Mi perfil: cambio de idioma");
await part("PERFIL", async () => {
await inv.page.goto(L.BASE + "/login");
await inv.page.locator("#email").waitFor({ timeout: 15000 });
await inv.page.fill("#email", INVITED);
await inv.page.fill("#password", "otra-clave-larga-2");
await inv.page.click("button[type=submit]");
await inv.page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20000 });
await inv.page.goto(L.BASE + "/settings?tab=preferencias");
await inv.page.getByRole("radio", { name: "Español" }).waitFor({ timeout: 15000 });
// Marca en el DOM: si React desmonta la página al cambiar de idioma, el nodo marcado deja de estar en el documento.
const mark = () => inv.page.evaluate(() => { window.__pzMark = document.querySelector("[role=radiogroup]")?.closest("section"); window.__pzMark?.setAttribute("data-pz-mark", "1"); });
const stillMounted = () => inv.page.evaluate(() => !!window.__pzMark && document.contains(window.__pzMark));
await mark();
await inv.page.getByRole("radio", { name: "Español" }).click();
await L.waitFor(async () => (await lang(inv.page)) === "es" && (await inv.page.getByText("Preferencias").first().isVisible().catch(() => false)), { timeout: 15000 });
L.check("PERFIL: la interfaz pasa a español", await inv.page.getByRole("heading", { name: "Mi perfil" }).isVisible().catch(() => false));
L.check("PERFIL: la página no se desmonta al cambiar de idioma (antes se perdía todo lo no guardado)", await stillMounted());
await inv.page.getByRole("radio", { name: "English" }).click();
await L.waitFor(async () => (await lang(inv.page)) === "en" && (await inv.page.getByRole("heading", { name: "My profile" }).isVisible().catch(() => false)), { timeout: 15000 });
L.check("PERFIL: y al volver a inglés, tampoco", await stillMounted());
L.check("PERFIL: sin errores de consola", inv.errors.length === 0, inv.errors.join(" | "));
});
await inv.ctx.close();

// --- 11. Sin Google configurado no se ofrece «Nuevo Doc» -----------------------------------------------------------------
L.scenario("detalle de una tarea sin Google");
await part("GOOGLE", async () => {
await w.page.goto(`${L.BASE}/p/${exampleProject.id}`);
const card = w.page.locator("[data-task-card]").first();
await card.waitFor({ timeout: 20000 });
await L.sleep(500); // hidratación
await card.click();
await w.page.getByRole("dialog").getByText("Subtasks").first().waitFor({ timeout: 15000 }).catch(() => {});
await w.page.getByRole("dialog").getByText("Attachments").first().waitFor({ timeout: 15000 });
L.eq("GOOGLE: sin Google configurado no sale «Google Docs» ni «New Doc»", await w.page.getByRole("dialog").getByRole("button", { name: /New Doc|New Sheet/ }).count(), 0);
await w.page.screenshot({ path: `${SHOTS}/install-detalle-sin-google.png` });
});
L.check("ADMIN: sin errores de consola", w.errors.length === 0, w.errors.join(" | "));
await w.ctx.close();

// --- 22. Avisos de Node durante todo el recorrido ------------------------------------------------------------------------
L.scenario("avisos de Node");
let warnings = "";
try { warnings = readFileSync(warnLog, "utf8"); } catch { /* ninguno */ }
L.check("WARN: ningún DeprecationWarning de pg (client.query con otra en curso)", !/already executing a query/.test(warnings), warnings.slice(0, 1500));
if (warnings) L.note("WARN: otros avisos de Node", warnings.slice(0, 1500));

await L.closeBrowser(); await L.closeDb();
stop();
rmSync(outbox, { recursive: true, force: true });
rmSync(warnLog, { force: true });
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
