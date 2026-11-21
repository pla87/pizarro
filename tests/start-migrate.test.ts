// Arranque del contenedor, paso de migraciones (scripts/migrate.mjs, llamado por scripts/start.sh): espera a que
// PostgreSQL responda (hasta 3 min, sin esperar si ya responde), aplica `prisma migrate deploy` y explica P3009.
// Sin Docker ni base de datos: un PostgreSQL falso (solo el saludo del protocolo) y un `prisma` falso en migrator/.
import assert from "node:assert/strict";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import type { Readable } from "node:stream";
import { join } from "node:path";
import { after, test } from "node:test";

type Mod = {
  failedMigrations: (out: string) => string[];
  p3009Help: (names: string[], env?: Record<string, string | undefined>) => string[];
  transientDbError: (e: unknown) => boolean;
  dbTarget: (url: string | undefined) => string;
  autoResolvePlan: (names: string[], sqlOf: (name: string) => string | null, rows: { migration_name: string; rolled_back_at: Date | null }[] | null) => { ok: boolean; reason?: string };
  isPrismaInfoLine: (line: string) => boolean;
};
// Especificador no literal: el script es .mjs (lo ejecuta node sin compilar) y tsc no tiene sus tipos.
const SCRIPT = new URL("../scripts/migrate.mjs", import.meta.url);
const m = (await import(SCRIPT.href)) as Mod;

// Salida real de `prisma migrate deploy` (Prisma 7) con una migración fallida en _prisma_migrations.
const P3009_OUT = `Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "pizarro", schema "public" at "postgres:5432"

70 migrations found in prisma/migrations

Error: P3009

migrate found failed migrations in the target database, new migrations will not be applied. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve
The \`20261126100000_quitar_indice\` migration started at 2026-11-20 22:42:39.063033 UTC failed
`;

const root = mkdtempSync(join(tmpdir(), "pz-migrate-"));
after(() => rmSync(root, { recursive: true, force: true }));

/** Carpeta de trabajo con migrator/node_modules/.bin/prisma falso: anota que se le llamó, imprime OUT y sale con RC. */
function workdir(name: string, out: string, rc: number): string {
  const dir = join(root, name);
  const bin = join(dir, "migrator", "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(dir, "out.txt"), out);
  writeFileSync(join(bin, "prisma"), `#!/bin/sh\necho "$*" > "${dir}/llamado"\ncat "${dir}/out.txt" >&2\nexit ${rc}\n`);
  chmodSync(join(bin, "prisma"), 0o755);
  return dir;
}

/** PostgreSQL falso: responde al arranque de sesión con AuthenticationOk y ReadyForQuery. */
function fakePg(port = 0): Promise<Server> {
  const srv = createServer((sock) => {
    sock.once("data", () => sock.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49])));
    sock.on("error", () => {});
  });
  return new Promise((resolve) => srv.listen(port, "127.0.0.1", () => resolve(srv)));
}
const portOf = (s: Server) => (s.address() as { port: number }).port;
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

/** Un puerto en el que no escucha nadie (se abre y se cierra). */
async function closedPort(): Promise<number> {
  const s = await fakePg();
  const p = portOf(s);
  await close(s);
  return p;
}

function run(cwd: string, port: number, args: string[] = [], env: Record<string, string> = {}) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: `postgresql://pizarro:secreto@127.0.0.1:${port}/pizarro`, ...env };
  for (const k of Object.keys(childEnv)) if (k.startsWith("RAILWAY_") && !(k in env)) delete childEnv[k];
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(process.execPath, [SCRIPT.pathname, ...args], {
    cwd,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => {
    stdout += c.toString();
  });
  child.stderr.on("data", (c: Buffer) => {
    stderr += c.toString();
  });
  const t0 = Date.now();
  return new Promise<{ status: number | null; stdout: string; stderr: string; ms: number }>((resolve) =>
    child.on("close", (status: number | null) => resolve({ status, stdout, stderr, ms: Date.now() - t0 })),
  );
}

test("migrate.mjs: reconoce P3009 y saca el nombre de la migración", () => {
  assert.deepEqual(m.failedMigrations(P3009_OUT), ["20261126100000_quitar_indice"]);
  assert.deepEqual(m.failedMigrations("Error: P1001\nCan't reach database server"), []);
  assert.deepEqual(m.failedMigrations(`${P3009_OUT}${P3009_OUT}`), ["20261126100000_quitar_indice"]);
});

test("migrate.mjs: la ayuda de P3009 da el comando de Docker Compose o el de Railway", () => {
  const docker = m.p3009Help(["20261126100000_quitar_indice"], {}).join("\n");
  assert.match(docker, /P3009/);
  assert.match(docker, /docker compose run --rm --no-deps -w \/app\/migrator app \.\/node_modules\/\.bin\/prisma migrate resolve --rolled-back 20261126100000_quitar_indice/);
  assert.match(docker, /docs\/INSTALL\.md, sección 8/);
  assert.doesNotMatch(docker, /railway ssh/);
  const railway = m.p3009Help(["20261126100000_quitar_indice"], { RAILWAY_ENVIRONMENT: "production" }).join("\n");
  assert.match(railway, /railway ssh/);
  assert.match(railway, /cd \/app\/migrator && \.\/node_modules\/\.bin\/prisma migrate resolve --rolled-back 20261126100000_quitar_indice/);
  assert.doesNotMatch(railway, /docker compose/);
  // Sin nombre (salida inesperada) se explica igual, con un hueco para el nombre.
  assert.match(m.p3009Help([], {}).join("\n"), /--rolled-back <nombre de la migración>/);
});

test("migrate.mjs: espera ante errores pasajeros, no ante una contraseña mala; el log no lleva credenciales", () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "57P03"]) assert.equal(m.transientDbError({ code }), true, code);
  assert.equal(m.transientDbError(new Error("Connection terminated due to connection timeout")), true);
  assert.equal(m.transientDbError({ code: "28P01", message: "password authentication failed" }), false);
  assert.equal(m.dbTarget("postgresql://u:secreto@postgres:5432/pizarro"), "postgres:5432, base pizarro");
});

test("migrate.mjs: con la base caída reintenta, se rinde al tope con un mensaje en español y no llama a prisma", async () => {
  const dir = workdir("caida", "", 0);
  const r = await run(dir, await closedPort(), ["--wait", "4"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.ms >= 3500, `esperó ${r.ms} ms`);
  assert.match(r.stdout, /PostgreSQL aún no responde \(127\.0\.0\.1:\d+, base pizarro\): rechaza la conexión/);
  assert.match(r.stderr, /ERROR: No se puede conectar con PostgreSQL \(127\.0\.0\.1:\d+, base pizarro\) tras 4 s/);
  assert.match(r.stderr, /docker compose logs --tail 50 postgres/);
  assert.doesNotMatch(r.stdout + r.stderr, /secreto/);
  assert.equal(existsSync(join(dir, "llamado")), false);
  const rw = await run(dir, await closedPort(), ["--wait", "1"], { RAILWAY_PROJECT_ID: "x" });
  assert.match(rw.stderr, /\$\{\{Postgres\.DATABASE_URL\}\}/);
});

test("migrate.mjs: si la base responde a la primera no espera y migra", async () => {
  const pg = await fakePg();
  try {
    const dir = workdir("lista", "All migrations have been successfully applied.\n", 0);
    const r = await run(dir, portOf(pg));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(join(dir, "llamado"), "utf8").trim(), "migrate deploy");
    assert.doesNotMatch(r.stdout, /no responde/);
    assert.match(r.stdout, /Aplicando migraciones/);
    assert.ok(r.ms < 5000, `tardó ${r.ms} ms`);
  } finally {
    await close(pg);
  }
});

test("migrate.mjs: sale en cuanto la base responde", async () => {
  const port = await closedPort();
  const dir = workdir("tarde", "", 0);
  const p = run(dir, port, ["--wait", "60"]);
  await new Promise((r) => setTimeout(r, 1500));
  const pg = await fakePg(port);
  try {
    const r = await p;
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /aún no responde/);
    assert.match(r.stdout, /PostgreSQL ya responde \(tras \d+ s\)/);
    assert.ok(r.ms < 15_000, `tardó ${r.ms} ms`);
    assert.equal(existsSync(join(dir, "llamado")), true);
  } finally {
    await close(pg);
  }
});

test("migrate.mjs: P3009 de prisma sale con error y la explicación en español", async () => {
  const pg = await fakePg();
  try {
    const dir = workdir("p3009", P3009_OUT, 1);
    const r = await run(dir, portOf(pg));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Error: P3009/, "la salida de prisma se muestra tal cual");
    assert.match(r.stderr, /falló a medias \(P3009\): 20261126100000_quitar_indice/);
    assert.match(r.stderr, /migrate resolve --rolled-back 20261126100000_quitar_indice/);
    // Otro fallo de prisma: su código de salida, sin la ayuda de P3009.
    // Es de las antiguas (sin BEGIN;/COMMIT;): no se marca como revertida sola, y se dice por qué.
    assert.match(r.stdout, /no se reintenta sola: 20261126100000_quitar_indice es de las antiguas/);
    assert.doesNotMatch(r.stdout, /se vuelve a aplicar/);
    assert.equal(readFileSync(join(dir, "llamado"), "utf8").trim(), "migrate deploy");
    const dir2 = workdir("otro", "Error: P3018\n", 1);
    const r2 = await run(dir2, portOf(pg));
    assert.equal(r2.status, 1);
    assert.doesNotMatch(r2.stderr, /falló a medias/);
  } finally {
    await close(pg);
  }
});

test("migrate.mjs: solo se reintenta sola una migración en una transacción, posterior a la v1.62.0 y por primera vez", () => {
  const nueva = "20270101000000_nueva";
  const tx = "-- Qué hace\nBEGIN;\nALTER TABLE \"Task\" ADD COLUMN \"x\" TEXT;\nCOMMIT;\n";
  const sql = (text: string | null) => () => text;
  const failed = [{ migration_name: nueva, rolled_back_at: null }];
  assert.deepEqual(m.autoResolvePlan([nueva], sql(tx), failed), { ok: true });
  // Ya se volvió a aplicar una vez (fila revertida) y ha vuelto a fallar: no se repite en cada arranque.
  assert.match(m.autoResolvePlan([nueva], sql(tx), [{ migration_name: nueva, rolled_back_at: new Date() }, ...failed]).reason!, /ya se volvió a aplicar una vez/);
  // Antiguas (hasta 20261126100000, sin transacción) o sin BEGIN;/COMMIT;: pudo quedar a medias.
  assert.match(m.autoResolvePlan(["20261126100000_quitar_indice"], sql(tx), failed).reason!, /antiguas/);
  assert.match(m.autoResolvePlan([nueva], sql("ALTER TABLE \"Task\" ADD COLUMN \"x\" TEXT;\n"), failed).reason!, /no empieza por «BEGIN;»/);
  assert.match(m.autoResolvePlan([nueva], sql(null), failed).reason!, /no se encuentra/);
  // Varias: todas deben cumplirlo. Sin nombre o sin poder leer la base, no.
  assert.equal(m.autoResolvePlan([nueva, "20261120000000_vieja"], sql(tx), failed).ok, false);
  assert.equal(m.autoResolvePlan([], sql(tx), failed).ok, false);
  assert.match(m.autoResolvePlan([nueva], sql(tx), null).reason!, /estado/);
});

test("migrate.mjs: las líneas informativas de Prisma van a stdout (Railway pinta stderr en rojo); los errores siguen en stderr", async () => {
  for (const l of ["Loaded Prisma config from prisma.config.ts.", "", "Prisma schema loaded from prisma/schema.prisma.", 'Datasource "db": PostgreSQL database "pizarro"']) assert.equal(m.isPrismaInfoLine(l), true, l);
  for (const l of ["Error: P3009", "migrate found failed migrations", "Error: ERROR: current transaction is aborted"]) assert.equal(m.isPrismaInfoLine(l), false, l);
  const pg = await fakePg();
  try {
    const dir = workdir("info", "Loaded Prisma config from prisma.config.ts.\n\nPrisma schema loaded from prisma/schema.prisma.\nwarn algo raro\n", 0);
    const r = await run(dir, portOf(pg));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Loaded Prisma config from prisma\.config\.ts\.\n\nPrisma schema loaded from prisma\/schema\.prisma\./);
    assert.doesNotMatch(r.stderr, /Loaded Prisma config|Prisma schema loaded/);
    assert.match(r.stderr, /^warn algo raro$/m);
    assert.match(r.stdout, /Base de datos al día \(migraciones: \d+,\d s\)/);
  } finally {
    await close(pg);
  }
});

test("start.sh usa migrate.mjs y el Dockerfile lo copia a la imagen", () => {
  const sh = readFileSync("scripts/start.sh", "utf8");
  assert.match(sh, /if ! node scripts\/migrate\.mjs; then/);
  assert.doesNotMatch(sh, /prisma migrate deploy\)/);
  assert.match(readFileSync("Dockerfile", "utf8"), /^COPY scripts\/start\.sh scripts\/migrate\.mjs \.\/scripts\/$/m);
});
