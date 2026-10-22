// Tests de integración contra PostgreSQL real: `npm run test:db`.
// Crea una base de datos efímera con nombre único en el servidor indicado, aplica las migraciones,
// ejecuta tests/db/*.test.ts y la borra al terminar (también si fallan o se interrumpe con Ctrl+C).
// Nunca toca la base de datos original: solo se usa su servidor y credenciales.
//
// Servidor: TEST_DATABASE_URL o, si no existe, DATABASE_URL (del entorno o de .env). El nombre de la
// base de la URL se ignora. El usuario necesita permiso CREATEDB.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import pg from "pg";

if (existsSync(".env")) process.loadEnvFile(".env"); // no pisa variables ya definidas

const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!base) {
  console.error("Falta TEST_DATABASE_URL (o DATABASE_URL): servidor PostgreSQL donde crear la base de pruebas.");
  process.exit(1);
}

const dbName = `pizarro_test_${randomBytes(6).toString("hex")}`;
const withDb = (name) => {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
};
const testUrl = withDb(dbName);
const adminUrl = withDb("postgres"); // conexión de mantenimiento para CREATE/DROP DATABASE

const admin = async (sql) => {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
};

// quiet: la salida solo se muestra si el comando falla (las migraciones son muy verbosas).
const run = (cmd, args, env, quiet = false) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit", env: { ...process.env, ...env } });
    let out = "";
    if (quiet) for (const s of [child.stdout, child.stderr]) s.on("data", (d) => (out += d));
    child.on("close", (code) => {
      if (quiet && code) process.stderr.write(out);
    });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    child.on("error", (err) => {
      console.error(err);
      resolve(1);
    });
  });

let dropped = false;
async function drop() {
  if (dropped) return;
  dropped = true;
  try {
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    console.log(`Base de pruebas ${dbName} eliminada.`);
  } catch (err) {
    console.error(`No se pudo eliminar ${dbName}: ${err.message}`);
  }
}
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => void drop().finally(() => process.exit(130)));
}

let code = 1;
try {
  await admin(`CREATE DATABASE "${dbName}"`);
  console.log(`Base de pruebas ${dbName} creada.`);
  const env = {
    DATABASE_URL: testUrl,
    NODE_ENV: "test",
    SESSION_SECRET: process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32 ? process.env.SESSION_SECRET : "x".repeat(48),
    // La cookie de sesión sin prefijo __Host- ni Secure (no hay HTTPS) y sin correo ni WhatsApp reales.
    COOKIE_SECURE: "false",
    SMTP_HOST: "",
    SMTP_FROM: "",
    MAIL_OUTBOX_DIR: "",
    WHATSAPP_TOKEN: "",
    PIZARRO_DB_TESTS: "1",
  };
  code = await run("npx", ["prisma", "migrate", "deploy"], env, true);
  if (code === 0) {
    code = await run(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", "--import", "./tests/db/register.mjs", "--test", "--test-concurrency=1", "--test-reporter=spec", "--test-force-exit", "tests/db/*.test.ts"],
      env,
    );
  }
} catch (err) {
  console.error(err);
} finally {
  await drop();
}
process.exit(code);
