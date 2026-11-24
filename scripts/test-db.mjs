// Tests de integración contra PostgreSQL real: `npm run test:db`.
// Crea una base de datos plantilla con nombre único en el servidor indicado y le aplica las migraciones una vez; de ella
// saca una copia por cada tanda en paralelo (CREATE DATABASE … TEMPLATE …) y reparte entre ellas los ficheros de
// tests/db/*.test.ts: cada tanda toma el siguiente fichero pendiente (los más grandes primero) y lo pasa en su base, uno
// detrás de otro. Al terminar borra todas las bases (también si fallan o se interrumpe con Ctrl+C).
// Nunca toca la base de datos original: solo se usa su servidor y credenciales.
//
//   npm run test:db                                   todas, en 3 bases a la vez
//   npm run test:db -- tests/db/x.test.ts [otro…]     solo esos ficheros
//   npm run test:db -- --jobs 1                       en serie, en una sola base (o TEST_DB_JOBS=1)
//   npm run test:db -- --verbose                      la salida completa de cada fichero, también si pasa
//   npm run test:db -- --shuffle                      los ficheros en orden al azar (dice la semilla; la PR lo usa siempre)
//   npm run test:db -- --shuffle=1234                 el mismo orden que una pasada anterior con esa semilla
//   npm run test:db -- tests/db/x.test.ts --test-name-pattern="deshacer"   (lo que empiece por --test- va a node --test)
//
// Un fichero que pasa de 10 minutos falla solo (--test-timeout cuenta por fichero, no por prueba; se cambia pasando otro). Con Ctrl+C se enseña qué
// ficheros estaban en marcha y lo que llevaban escrito.
//
// Cada fichero corre en su propio proceso (como con node --test): las variables de entorno que cambia una prueba
// (TRUST_PROXY, APP_URL, SMTP_*, UPLOAD_DIR…) no llegan a las demás. Lo que comparten las tandas es el servidor de
// PostgreSQL (cada una con su base: los bloqueos consultivos y pg_stat_activity se miran por base) y la máquina. Un
// fichero que no pueda ir a la vez que otros va en SERIAL: se pasa al final, solo.
//
// Servidor: TEST_DATABASE_URL o, si no existe, DATABASE_URL (del entorno o de .env). El nombre de la
// base de la URL se ignora. El usuario necesita permiso CREATEDB.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import pg from "pg";

// La CLI de Prisma con el mismo Node (sin npx: en Windows es un .cmd que spawn no encuentra sin shell).
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js");

if (existsSync(".env")) process.loadEnvFile(".env"); // no pisa variables ya definidas

const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!base) {
  console.error("Falta TEST_DATABASE_URL (o DATABASE_URL): servidor PostgreSQL donde crear la base de pruebas.");
  process.exit(1);
}

/** Ficheros que no pueden pasar a la vez que otros: van al final, de uno en uno. */
const SERIAL = [];

// --- Opciones -------------------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
let jobs = Number(process.env.TEST_DB_JOBS) || 3;
let verbose = false;
/** Semilla del orden al azar (--shuffle); null: el orden de siempre (los más grandes primero). */
let seed = null;
const picked = [];
const nodeTestArgs = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--jobs" || a === "-j") jobs = Number(args[++i]);
  else if (a.startsWith("--jobs=")) jobs = Number(a.slice(7));
  else if (a === "--verbose" || a === "-v") verbose = true;
  else if (a === "--shuffle") seed = randomBytes(4).readUInt32BE(0);
  else if (a.startsWith("--shuffle=")) seed = /^\d+$/.test(a.slice(10)) ? Number(a.slice(10)) : NaN;
  else if (a.startsWith("--test-")) nodeTestArgs.push(a);
  else if (a.startsWith("-")) {
    console.error(`Opción desconocida: ${a}. Uso: npm run test:db -- [ficheros…] [--jobs N] [--verbose] [--shuffle[=semilla]] [--test-…]`);
    process.exit(1);
  } else picked.push(a);
}
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16) {
  console.error("--jobs (o TEST_DB_JOBS) debe ser un número entre 1 y 16.");
  process.exit(1);
}
if (seed !== null && !(Number.isInteger(seed) && seed <= 0xffffffff)) {
  console.error("--shuffle=N necesita un entero entre 0 y 4294967295.");
  process.exit(1);
}
for (const f of picked) {
  if (!existsSync(f)) {
    console.error(`No existe ${f}.`);
    process.exit(1);
  }
}

const all = picked.length ? picked : readdirSync("tests/db").filter((f) => f.endsWith(".test.ts")).sort().map((f) => `tests/db/${f}`);
// Los más grandes primero (aproximan a los más lentos): así ninguna tanda se queda al final con uno largo.
const size = (f) => statSync(f).size;
const parallel = all.filter((f) => !SERIAL.includes(f)).sort((a, b) => size(b) - size(a));
// --shuffle: los ficheros de una tanda comparten base, así que otro orden destapa pruebas que dependen de lo que dejó
// (o no dejó) un fichero anterior. Fisher-Yates con un generador sencillo (mulberry32) para repetir el orden con la semilla.
if (seed !== null) {
  let t = seed;
  const rand = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = parallel.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [parallel[i], parallel[j]] = [parallel[j], parallel[i]];
  }
}
const serial = all.filter((f) => SERIAL.includes(f));
jobs = Math.max(1, Math.min(jobs, parallel.length || 1));
// Un fichero colgado falla solo, con su nombre y su salida, en vez de dejar la tanda parada (se cambia con --test-timeout=…).
const timeoutArg = nodeTestArgs.some((a) => a.startsWith("--test-timeout")) ? [] : ["--test-timeout=600000"];

// --- Bases de datos --------------------------------------------------------------------------------------------------

const newName = () => `pizarro_test_${randomBytes(6).toString("hex")}`;
const withDb = (name) => {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
};
const adminUrl = withDb("postgres"); // conexión de mantenimiento para CREATE/DROP DATABASE

const admin = async (sql, params) => {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
};

/** Bases creadas que aún no se han borrado. */
const created = [];
let dropping = Promise.resolve();
/**
 * Borra las bases creadas y las que hayan creado las pruebas con su nombre como prefijo (backup-restore, start-migrate).
 * Se puede llamar más de una vez: cada llamada borra lo que se haya creado desde la anterior (una copia que terminaba de
 * crearse al pulsar Ctrl+C) y espera a las que estén en curso.
 */
function dropAll() {
  dropping = dropping.then(async () => {
    const gone = [];
    while (created.length) {
      const name = created.shift();
      try {
        const extra = await admin("SELECT datname FROM pg_database WHERE starts_with(datname, $1)", [`${name}_`]);
        for (const { datname } of extra.rows) await admin(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
        await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        gone.push(name);
      } catch (err) {
        console.error(`No se pudo eliminar ${name}: ${err.message}`);
      }
    }
    if (gone.length) console.log(`Bases de pruebas eliminadas: ${gone.join(", ")}.`);
  });
  return dropping;
}

/** Copia de la plantilla. Justo después de migrar puede quedar un instante alguna conexión a ella (55006): se reintenta. */
async function copyOf(template) {
  const name = newName();
  for (let attempt = 0; ; attempt++) {
    try {
      await admin(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
      created.push(name);
      return name;
    } catch (err) {
      if (err.code !== "55006" || attempt >= 20 || interrupted) throw err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

// --- Procesos --------------------------------------------------------------------------------------------------------

/** Procesos en marcha, con lo que llevan escrito: si se interrumpe, se enseña en qué fichero estaba cada uno. */
const children = new Map();

/** Lanza un proceso; devuelve su código y su salida (stdout y stderr juntos). */
const run = (label, cmd, cmdArgs, env) =>
  new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
    const state = { label, started: performance.now(), out: "" };
    children.set(child, state);
    for (const s of [child.stdout, child.stderr]) s.on("data", (d) => (state.out += d));
    child.on("close", (code, signal) => {
      children.delete(child);
      resolve({ code: code ?? (signal ? 1 : 0), out: state.out });
    });
    child.on("error", (err) => {
      children.delete(child);
      resolve({ code: 1, out: `${state.out}${err.stack ?? err}\n` });
    });
  });

const TAIL_LINES = 40;
/** Lo que estaba en marcha y las últimas líneas de su salida (sin esto, una prueba colgada no dejaría ni su nombre). */
function reportRunning() {
  if (!children.size) return;
  process.stderr.write("En marcha al interrumpir:\n");
  for (const { label, started, out } of children.values()) {
    const lines = out.trimEnd().split("\n");
    const tail = lines.length > TAIL_LINES ? ["…", ...lines.slice(-TAIL_LINES)] : lines;
    process.stderr.write(`\n── ${label} (${secs(performance.now() - started)}) ${"─".repeat(Math.max(3, 90 - label.length))}\n${tail.join("\n")}\n`);
  }
  process.stderr.write("\n");
}

// Ctrl+C (o SIGTERM): se enseña lo que estaba en marcha, se paran los procesos y el programa principal termina por su
// cuenta (deja de lanzar ficheros y copias, y su `finally` borra las bases, también la que estuviera creándose). Un
// segundo Ctrl+C no espera a los procesos.
let interrupted = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (interrupted) {
      for (const c of children.keys()) c.kill("SIGKILL");
      void dropAll().finally(() => process.exit(130));
      return;
    }
    interrupted = true;
    console.error(`\nInterrumpido (${sig}): parando las pruebas y borrando las bases…`);
    reportRunning();
    for (const c of children.keys()) c.kill("SIGTERM");
    // Por si un proceso no atiende a SIGTERM.
    setTimeout(() => { for (const c of children.keys()) c.kill("SIGKILL"); }, 5000).unref();
  });
}

const envFor = (dbName) => ({
  DATABASE_URL: withDb(dbName),
  NODE_ENV: "test",
  SESSION_SECRET: process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32 ? process.env.SESSION_SECRET : "x".repeat(48),
  // La cookie de sesión sin prefijo __Host- ni Secure (no hay HTTPS) y sin correo ni WhatsApp reales.
  COOKIE_SECURE: "false",
  // Las pruebas llaman a las rutas sin servidor HTTP y fijan la IP con X-Real-IP, como haría el proxy.
  TRUST_PROXY: "1",
  SMTP_HOST: "",
  SMTP_FROM: "",
  MAIL_OUTBOX_DIR: "",
  WHATSAPP_TOKEN: "",
  PIZARRO_DB_TESTS: "1",
  // Algunas pruebas (enlaces absolutos, Origin de las peticiones) necesitan una URL pública aunque no haya .env.
  APP_URL: process.env.APP_URL || "http://localhost:3000",
});

const totals = { files: 0, tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
const failed = [];
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** Pasa un fichero en una base y muestra su resultado de una vez (sin mezclarse con lo que imprimen las otras tandas). */
async function runFile(file, dbName) {
  const started = performance.now();
  const { code, out } = await run(
    file,
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "--import", "./tests/db/register.mjs", "--test", "--test-concurrency=1", "--test-reporter=spec", "--test-force-exit", ...timeoutArg, ...nodeTestArgs, file],
    envFor(dbName),
  );
  if (interrupted) return;
  const count = (k) => Number(out.match(new RegExp(`^ℹ ${k} (\\d+)$`, "m"))?.[1] ?? 0);
  const n = { tests: count("tests"), pass: count("pass"), fail: count("fail"), cancelled: count("cancelled"), skipped: count("skipped"), todo: count("todo") };
  totals.files++;
  for (const k of Object.keys(n)) totals[k] += n[k];
  const ok = code === 0;
  if (!ok) failed.push(file);
  const line = `${ok ? "✔" : "✖"} ${file}  ${n.pass}/${n.tests}${n.fail ? `, ${n.fail} fallan` : ""}${n.cancelled ? `, ${n.cancelled} canceladas` : ""}  (${secs(performance.now() - started)})`;
  if (ok && !verbose) console.log(line);
  else process.stdout.write(`\n── ${file} ${"─".repeat(Math.max(3, 100 - file.length))}\n${out.trimEnd()}\n${line}\n\n`);
}

// --- Principal -------------------------------------------------------------------------------------------------------

let code = 1;
const t0 = performance.now();
try {
  const template = newName();
  await admin(`CREATE DATABASE "${template}"`);
  created.push(template);
  const migrated = await run("prisma migrate deploy", process.execPath, [PRISMA_CLI, "migrate", "deploy"], envFor(template));
  if (migrated.code !== 0 && !interrupted) {
    process.stderr.write(migrated.out);
    throw new Error("prisma migrate deploy falló en la base plantilla");
  }
  const dbs = [];
  for (let i = 0; i < jobs && !interrupted; i++) dbs.push(await copyOf(template));
  if (!interrupted) console.log(`${all.length} ficheros en ${jobs} ${jobs === 1 ? "base" : "bases a la vez"} (plantilla ${template}, migrada en ${secs(performance.now() - t0)})${seed !== null ? `; orden al azar con semilla ${seed}` : ""}.`);

  const queue = [...parallel];
  await Promise.all(dbs.map(async (db) => {
    for (let file; !interrupted && (file = queue.shift()); ) await runFile(file, db);
  }));
  for (const file of serial) if (!interrupted) await runFile(file, dbs[0]);

  if (!interrupted) {
    const parts = [`${totals.pass} pasan`, `${totals.fail} fallan`];
    if (totals.cancelled) parts.push(`${totals.cancelled} canceladas`);
    if (totals.skipped) parts.push(`${totals.skipped} omitidas`);
    if (totals.todo) parts.push(`${totals.todo} pendientes`);
    console.log(`\n${totals.files} ficheros, ${totals.tests} pruebas: ${parts.join(", ")}. ${secs(performance.now() - t0)} en total.`);
    if (failed.length && seed !== null) console.log(`Orden al azar: repítelo con npm run test:db -- --shuffle=${seed}`);
    if (failed.length) console.log(`Fallan:\n${failed.map((f) => `  ${f}`).join("\n")}`);
    code = failed.length || totals.files < all.length ? 1 : 0;
  }
} catch (err) {
  console.error(err);
} finally {
  await dropAll();
}
process.exit(interrupted ? 130 : code);
