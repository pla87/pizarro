// Arranque del contenedor, paso de migraciones (scripts/migrate.mjs) con el Prisma CLI y PostgreSQL de verdad: una
// migración fallida (P3009) que va entera entre BEGIN; y COMMIT; se marca como revertida y se vuelve a aplicar una sola
// vez; una antigua (sin transacción) no. Cada caso en una base propia (pizarro_test_<base de las pruebas>_<n>), que se
// borra al terminar, con una carpeta de migraciones de prueba en un migrador falso (migrator/ con el node_modules del
// proyecto), como el de la imagen.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import pg from "pg";

const base = process.env.DATABASE_URL ?? "";
const baseName = new URL(base).pathname.slice(1);
if (!/^pizarro_test_[0-9a-f]+$/.test(baseName)) throw new Error("Solo con `npm run test:db` (base pizarro_test_*).");
const withDb = (name: string) => {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
};

async function admin(sql: string, url = withDb("postgres")): Promise<pg.QueryResult> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

const root = mkdtempSync(join(tmpdir(), "pz-migrate-db-"));
const created: string[] = [];
after(async () => {
  rmSync(root, { recursive: true, force: true });
  for (const name of created) await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
});

/** Base nueva y carpeta de trabajo con migrator/ (node_modules del proyecto, prisma.config.ts y las migraciones dadas). */
async function setup(name: string, migrations: Record<string, string>): Promise<{ dir: string; url: string }> {
  const dbName = `${baseName}_${name}`;
  await admin(`CREATE DATABASE "${dbName}"`);
  created.push(dbName);
  const dir = join(root, name);
  const migrator = join(dir, "migrator");
  mkdirSync(join(migrator, "prisma", "migrations"), { recursive: true });
  symlinkSync(resolve("node_modules"), join(migrator, "node_modules"));
  copyFileSync("prisma.config.ts", join(migrator, "prisma.config.ts"));
  writeFileSync(join(migrator, "prisma", "schema.prisma"), 'datasource db {\n  provider = "postgresql"\n}\n');
  writeFileSync(join(migrator, "prisma", "migrations", "migration_lock.toml"), 'provider = "postgresql"\n');
  for (const [m, sql] of Object.entries(migrations)) {
    mkdirSync(join(migrator, "prisma", "migrations", m));
    writeFileSync(join(migrator, "prisma", "migrations", m, "migration.sql"), sql);
  }
  return { dir, url: withDb(dbName) };
}

function start(dir: string, url: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url };
  for (const k of Object.keys(env)) if (k.startsWith("RAILWAY_")) delete env[k];
  const child = spawn(process.execPath, [resolve("scripts/migrate.mjs"), "--wait", "5"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
  child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
  return new Promise((r) => child.on("close", (status) => r({ status, stdout, stderr })));
}

const rowsOf = async (url: string, name: string) =>
  (await admin(`SELECT finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '${name}' ORDER BY started_at`, url)).rows as { finished_at: Date | null; rolled_back_at: Date | null }[];
const tableExists = async (url: string, table: string) => (await admin(`SELECT to_regclass('public."${table}"') AS t`, url)).rows[0].t !== null;

const INIT = { "20260101000000_init": 'CREATE TABLE "Permiso" (id int);\n' };
/** Falla mientras "Permiso" esté vacía (división por cero): un fallo pasajero que se arregla insertando una fila. */
const UNTIL_ROW = '-- Prueba\nBEGIN;\nCREATE TABLE "Nueva" (id int);\nSELECT 1 / (SELECT count(*) FROM "Permiso");\nCOMMIT;\n';

test("migrate.mjs + Prisma: una migración en una transacción que falló se marca como revertida y se aplica al arrancar otra vez", async () => {
  const name = "20270101000000_nueva";
  const { dir, url } = await setup("retry", { ...INIT, [name]: UNTIL_ROW });
  const first = await start(dir, url);
  assert.equal(first.status, 1, first.stdout + first.stderr);
  // La transacción se deshizo entera: nada de la migración quedó aplicado.
  assert.equal(await tableExists(url, "Nueva"), false);
  assert.equal((await rowsOf(url, name)).length, 1);
  // Arreglada la causa (p. ej. el disco lleno), el arranque siguiente la vuelve a aplicar sola.
  await admin('INSERT INTO "Permiso" VALUES (1)', url);
  const second = await start(dir, url);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.match(second.stdout, /La migración 20270101000000_nueva falló en un arranque anterior, pero va entera en una transacción/);
  assert.match(second.stdout, /se ha aplicado bien al reintentarla/);
  assert.match(second.stdout, /Base de datos al día \(migraciones: [\d,]+ s; con un reintento\)/);
  // La salida de Prisma (P3009) se ve tal cual, pero sin la ayuda para resolverlo a mano.
  assert.doesNotMatch(second.stderr, /falló a medias/);
  // Las líneas informativas de Prisma salen por stdout, no por stderr.
  assert.match(second.stdout, /Loaded Prisma config/);
  assert.doesNotMatch(second.stderr, /Loaded Prisma config|Prisma schema loaded/);
  assert.equal(await tableExists(url, "Nueva"), true);
  const rows = await rowsOf(url, name);
  assert.equal(rows.length, 2);
  assert.ok(rows[0]!.rolled_back_at && !rows[0]!.finished_at);
  assert.ok(rows[1]!.finished_at && !rows[1]!.rolled_back_at);
});

test("migrate.mjs + Prisma: si vuelve a fallar al reintentarla, se explica qué hacer y no se reintenta en cada arranque", async () => {
  const name = "20270101000000_nueva";
  const { dir, url } = await setup("again", { ...INIT, [name]: UNTIL_ROW });
  assert.equal((await start(dir, url)).status, 1);
  const second = await start(dir, url);
  assert.equal(second.status, 1);
  assert.match(second.stdout, /Se marca como revertida y se vuelve a aplicar \(solo esta vez\)/);
  assert.match(second.stderr, /ha vuelto a fallar al reintentarla/);
  assert.match(second.stderr, /migrate resolve --rolled-back 20270101000000_nueva/);
  const third = await start(dir, url);
  assert.equal(third.status, 1);
  assert.match(third.stdout, /no se reintenta sola: 20270101000000_nueva ya se volvió a aplicar una vez y falló de nuevo/);
  assert.match(third.stderr, /falló a medias \(P3009\): 20270101000000_nueva/);
  // Una sola fila revertida (la del reintento): el tercer arranque no la ha vuelto a marcar.
  const rows = await rowsOf(url, name);
  assert.equal(rows.filter((r) => r.rolled_back_at).length, 1);
  assert.equal(rows.length, 2);
});

test("migrate.mjs + Prisma: una migración antigua (sin BEGIN;/COMMIT;) que falló no se reintenta sola", async () => {
  const name = "20261120000000_vieja";
  const { dir, url } = await setup("old", { ...INIT, [name]: 'CREATE TABLE "Vieja" (id int);\nSELECT 1 / (SELECT count(*) FROM "Permiso");\n' });
  assert.equal((await start(dir, url)).status, 1);
  await admin('INSERT INTO "Permiso" VALUES (1)', url);
  const second = await start(dir, url);
  assert.equal(second.status, 1);
  assert.match(second.stdout, /no se reintenta sola: 20261120000000_vieja es de las antiguas/);
  assert.match(second.stderr, /falló a medias \(P3009\): 20261120000000_vieja/);
  assert.equal((await rowsOf(url, name)).filter((r) => r.rolled_back_at).length, 0);
});
