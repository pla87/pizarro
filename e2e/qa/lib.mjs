// Utilidades compartidas de la suite de regresión de acciones del tablero (Pizarro).
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const pg = require(process.env.PG_PATH || "pg");

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.BASE || "http://localhost:3231";
export const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/pz_qa";
/**
 * Chromium: el de la variable CHROME; si no, el más reciente instalado por Playwright en PLAYWRIGHT_BROWSERS_PATH (o
 * /opt/pw-browsers), carpetas chromium-<revisión>/chrome-linux*\/chrome; si no hay ninguno, undefined y playwright-core
 * usa el suyo (`npx playwright-core install chromium`).
 */
export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  let dirs = [];
  try { dirs = fs.readdirSync(base); } catch { return undefined; }
  const revisions = dirs.map((d) => /^chromium-(\d+)$/.exec(d)).filter(Boolean).sort((a, b) => Number(b[1]) - Number(a[1]));
  for (const [dir] of revisions) {
    let subs = [];
    try { subs = fs.readdirSync(path.join(base, dir)).filter((s) => s.startsWith("chrome-linux")).sort().reverse(); } catch { continue; }
    for (const s of subs) {
      const exe = path.join(base, dir, s, "chrome");
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}
export const CHROME = findChrome();
export const PASSWORD = "cambia-esta-clave";
export const ADMIN = "admin@example.com";
export const USER2 = "qa2@example.com";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- resultados ----------
const T0 = Date.now();
export const results = [];
let currentScenario = "";
export function scenario(name) { currentScenario = name; console.log(`\n== ${name}`); }
export function check(name, ok, detail = "") {
  const pass = !!ok;
  results.push({ scenario: currentScenario, name, pass, detail });
  console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${pass ? "PASS" : "FAIL"}  ${name}${!pass && detail ? `  -> ${detail}` : ""}`);
  return pass;
}
export function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  return check(name, a === e, `esperado ${e}, obtenido ${a}`);
}
/** Hallazgo informativo (no falla la suite): comportamiento actual que conviene vigilar. */
export function note(name, detail = "") {
  results.push({ scenario: currentScenario, name, pass: true, note: true, detail });
  console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] NOTE  ${name}${detail ? `  -> ${detail}` : ""}`);
}
/** Espera hasta que `fn` devuelva algo verdadero (sondeo corto, no pausas fijas). */
export async function waitFor(fn, { timeout = 8000, step = 150 } = {}) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch { /* reintento */ } await sleep(step); }
  return last;
}
/** Como eq, pero reintenta hasta que coincida (estado asíncrono en BD o UI). */
export async function eqEventually(name, fn, expected, opts = {}) {
  const e = JSON.stringify(expected); let a;
  await waitFor(async () => { a = JSON.stringify(await fn()); return a === e; }, opts);
  return check(name, a === e, `esperado ${e}, obtenido ${a}`);
}

/**
 * Como check, pero reintenta hasta que `fn` devuelva algo verdadero (lo que llega después de la respuesta: el tablero tras
 * deshacer, el diálogo que se cierra al responder el servidor, los eventos del historial, que se escriben al final de la
 * acción). `fn` puede devolver [ok, detalle] para el mensaje del fallo.
 */
export async function checkEventually(name, fn, opts = {}) {
  let ok = false, detail = "";
  await waitFor(async () => { const r = await fn(); [ok, detail] = Array.isArray(r) ? r : [r, ""]; return !!ok; }, opts);
  return check(name, ok, typeof detail === "string" ? detail : JSON.stringify(detail));
}

// ---------- base de datos ----------
let client = null;
export async function dbc() {
  if (!client) { client = new pg.Client({ connectionString: DATABASE_URL }); await client.connect(); }
  return client;
}
// Una sola conexión: las consultas van en fila. Lanzadas a la vez (Promise.all con L.q, L.dbTask o L.events) pg avisa
// «Calling client.query() when the client is already executing a query» (deprecado en pg 8, error en pg 9).
let chain = Promise.resolve();
export function q(sql, params = []) {
  const next = chain.then(async () => (await (await dbc()).query(sql, params)).rows);
  chain = next.catch(() => {});
  return next;
}
export async function closeDb() { if (client) { await client.end(); client = null; } }

/** Evita tocar nada que no sea una base de pruebas. */
function assertSafeDb() {
  const name = new URL(DATABASE_URL).pathname.slice(1);
  if (!/^pz_/.test(name) && process.env.QA_ALLOW_ANY_DB !== "1") throw new Error(`Por seguridad solo se resetean bases pz_* (es «${name}»)`);
  return name;
}
export async function resetDatabase(appDir) {
  const name = assertSafeDb();
  const u = new URL(DATABASE_URL); u.pathname = "/postgres";
  await closeDb();
  const admin = new pg.Client({ connectionString: u.toString() }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  const env = { ...process.env, DATABASE_URL };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: appDir, env, stdio: "pipe" });
  execFileSync("node", ["--env-file-if-exists=.env", "dist/boot.mjs"], { cwd: appDir, env, stdio: "pipe" });
}
let server = null;
export async function startServer(appDir) {
  const port = new URL(BASE).port || "80";
  server = spawn("npm", ["start"], { cwd: appDir, env: { ...process.env, DATABASE_URL, PORT: port, APP_URL: BASE }, stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/login"); if (r.ok) return; } catch { /* aún no */ } await sleep(1000); }
  throw new Error("el servidor no arranca");
}
export function stopServer() { if (server) { try { process.kill(-server.pid, "SIGTERM"); } catch { /* ya parado */ } server = null; } }

/** Usuarios MEMBER (sin 2FA), un segundo usuario y todos como miembros de todos los proyectos. */
export async function prepareUsers() {
  await q(`UPDATE "User" SET role='MEMBER'`);
  const [a] = await q(`SELECT * FROM "User" WHERE email=$1`, [ADMIN]);
  if (!(await q(`SELECT 1 FROM "User" WHERE email=$1`, [USER2])).length) {
    const cols = Object.keys(a).filter((c) => !["id", "email", "name"].includes(c));
    const vals = cols.map((c) => a[c]);
    await q(`INSERT INTO "User" (id,email,name,${cols.map((c) => `"${c}"`).join(",")}) VALUES ('qa_user_2',$1,'Segunda Persona',${cols.map((_, i) => `$${i + 2}`).join(",")})`, [USER2, ...vals]);
  }
  await q(`INSERT INTO "ProjectMember"("projectId","userId") SELECT p.id,u.id FROM "Project" p CROSS JOIN "User" u ON CONFLICT DO NOTHING`);
  // Instalación de pruebas declarada «uso personal»: el recordatorio de licencia (solo admins, tras 7 días) nunca sale.
  await q(`INSERT INTO "AppState"(key,value,"updatedAt") VALUES ('licensePersonalUse','{"personal":true,"date":"2026-01-01"}',NOW()) ON CONFLICT (key) DO NOTHING`);
}
/** Deja el proyecto de ejemplo sin tareas ni releases (cada escenario parte de cero). */
export async function cleanBoard() {
  await q(`DELETE FROM "Release"`);
  await q(`DELETE FROM "Task"`);
  await q(`DELETE FROM "UndoEntry"`);
  await q(`DELETE FROM "Label"`);
  await q(`UPDATE "Column" SET "isDone"=("role"='IN_PRODUCTION' OR "name"='Cerrado')`);
}
export async function project() { return (await q(`SELECT id,name FROM "Project" ORDER BY "createdAt" LIMIT 1`))[0]; }
export async function columnIds() {
  const p = await project();
  const rows = await q(`SELECT id,name FROM "Column" WHERE "projectId"=$1 ORDER BY position`, [p.id]);
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}
export const COL = { backlog: "Backlog", doing: "En progreso", next: "Siguiente salto a producción", prod: "En producción", closed: "Cerrado" };
/** Tareas (títulos) de una columna, ordenadas por posición (solo activas). */
export async function dbOrder(colName) {
  const p = await project();
  return (await q(`SELECT t.title FROM "Task" t JOIN "Column" c ON c.id=t."columnId" WHERE c.name=$1 AND c."projectId"=$2 AND t."archivedAt" IS NULL ORDER BY t.position, t.id`, [colName, p.id])).map((r) => r.title);
}
export async function dbTask(title) {
  return (await q(`SELECT t.*, c.name AS "columnName" FROM "Task" t JOIN "Column" c ON c.id=t."columnId" WHERE t.title=$1 ORDER BY t."createdAt" DESC LIMIT 1`, [title]))[0];
}
export async function taskCount() { return Number((await q(`SELECT count(*) AS n FROM "Task"`))[0].n); }
export async function events(title) {
  return q(`SELECT e.code,e.label FROM "TaskEvent" e JOIN "Task" t ON t.id=e."taskId" WHERE t.title=$1 ORDER BY e."createdAt", e.id`, [title]);
}
export async function undoEntries(kind) {
  return q(`SELECT kind,label,ops FROM "UndoEntry" ${kind ? `WHERE kind='${kind}'` : ""} ORDER BY "createdAt", id`);
}
export async function logs(since, actionLike) {
  return q(`SELECT level,action,message FROM "AppLog" WHERE "createdAt">=($1::timestamptz AT TIME ZONE 'UTC') ${actionLike ? `AND action LIKE '${actionLike}'` : ""} ORDER BY "createdAt", id`, [since]);
}
/** Marca de tiempo del servidor de BD para filtrar logs/eventos posteriores. */
export async function dbNow() { return (await q(`SELECT NOW() AS n`))[0].n; }
/** Crea tareas por SQL en una columna, en el orden dado (position 1024, 2048…). */
export async function seedTasks(colName, titles, extra = {}) {
  const p = await project(); const cols = await columnIds(); const [u] = await q(`SELECT id FROM "User" WHERE email=$1`, [ADMIN]);
  const kind = extra.kindId || "kind_funcionalidad";
  const ids = [];
  const [{ m }] = await q(`SELECT COALESCE(MAX(position),0) AS m FROM "Task" WHERE "columnId"=$1`, [cols[colName]]);
  let pos = Number(m);
  for (const title of titles) {
    pos += 1024;
    const id = "qa" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    await q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`, [id, p.id, cols[colName], title, kind, pos, u.id]);
    ids.push(id);
  }
  return ids;
}

// ---------- navegador ----------
let browser = null;
export async function getBrowser() { return (browser ??= await chromium.launch({ executablePath: CHROME })); }
export async function closeBrowser() { if (browser) { await browser.close(); browser = null; } }
const IGNORED_CONSOLE = [/Download the React DevTools/i];
/** Contexto + página con captura de errores de consola y de página. */
export async function session({ email = ADMIN, viewport = { width: 1500, height: 900 }, mobile = false, init = null } = {}) {
  const b = await getBrowser();
  const ctx = await b.newContext({ viewport, locale: "es-ES", acceptDownloads: true, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await throttle(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error" && !IGNORED_CONSOLE.some((r) => r.test(m.text()))) errors.push("console.error: " + m.text().slice(0, 300)); });
  await login(page, email);
  return { ctx, page, errors };
}
/**
 * CPU frenada (QA_CPU_THROTTLE=4: cuatro veces más lenta, con Emulation.setCPUThrottlingRate de CDP) en las páginas de
 * `session()`: saca a la luz las comprobaciones que no esperan al estado que miran, como con la máquina cargada.
 */
const CPU_THROTTLE = Number(process.env.QA_CPU_THROTTLE || 0);
export async function throttle(page) {
  if (!(CPU_THROTTLE > 1)) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
}
export async function login(page, email) {
  await page.goto(BASE + "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/p\//, { timeout: 20000 });
  await board(page);
}
export async function board(page) {
  await page.locator(`[aria-label="${COL.backlog}"]`).first().waitFor({ timeout: 20000 });
  await sleep(500); // hidratación de React (los atajos se registran al montar)
}
/**
 * Navegación de la página que se repite si la cancela la propia app: Next llama a history.replaceState cada vez que aplica
 * un estado nuevo del router (la respuesta de una acción, un refresco) y, si eso coincide con el arranque de una recarga o
 * de un goto, Chromium cancela la navegación pendiente y Playwright da «net::ERR_ABORTED; maybe frame was detached?»: la
 * página sigue donde estaba. Se vuelve a pedir (como haría quien pulsa F5 otra vez); cualquier otro error, o que tampoco
 * salga a la tercera, falla.
 */
async function navigateRetrying(go) {
  for (let i = 0; ; i++) {
    try {
      return await go();
    } catch (e) {
      if (i >= 2 || !/ERR_ABORTED/.test(String(e?.message))) throw e;
      await sleep(300);
    }
  }
}
export const goto = (page, url, opts) => navigateRetrying(() => page.goto(url, opts));
export async function reload(page) {
  await navigateRetrying(() => page.reload());
  await board(page);
}
/** Espera a que el canal en vivo (SSE) del tablero esté abierto: la raíz del tablero lleva data-live="open" (Board.tsx). */
export async function liveOpen(page, timeout = 10000) {
  await page.locator("[data-live=open]").first().waitFor({ state: "attached", timeout });
}
export function assertNoErrors(label, sessions) {
  const all = sessions.flatMap((s) => s.errors);
  check(`${label}: sin errores de consola ni de página`, all.length === 0, all.slice(0, 3).join(" | "));
}

// ---------- UI del tablero ----------
export const colLoc = (page, name) => page.locator(`[aria-label="${name}"]`).first();
// Coincidencia exacta del título (hasText con cadena sería subcadena sin mayúsculas: «D» casaría con «Funcionalidad»).
export const cardLoc = (page, title) => page.locator(`[data-task-card]`).filter({ has: page.locator("p", { hasText: new RegExp(`^\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) }) }).first();
