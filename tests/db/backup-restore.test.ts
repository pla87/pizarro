// Copias completas de punta a punta: copia (base de datos + ficheros) → subida a un S3 falso y a una carpeta externa
// → «se pierde todo» → restauración sin git en una base de datos nueva y una carpeta de subidas vacía → mismos datos
// y mismos ficheros. También: migraciones hasta la de la copia y después hacia delante, negativa a pisar una base con
// datos, compatibilidad con `prisma migrate` y la prueba de restauración mensual en una base temporal.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { db, makeProject, makeTask, makeUser } from "./helpers";
import { startFakeS3, type FakeS3 } from "../fake-s3";

const { createBackup, readStatus, runRestoreTest, syncExternal } = await import("../../src/lib/backup");
const { computeBackupAlert } = await import("../../src/lib/backup-alert");
const { applyMigrations, listMigrations, parseSource, restoreBackup } = await import("../../src/lib/backup-restore");
const { connectPg, withDatabase } = await import("../../src/lib/backup-pg");
const { dumpDatabase } = await import("../../src/lib/backup-db");

const MIGRATIONS = path.resolve("prisma/migrations");
const baseUrl = process.env.DATABASE_URL!;
const created: string[] = [];
const dirs: string[] = [];
let s3: FakeS3;
let uploads: string;

async function newDatabase(): Promise<string> {
  // Mismo prefijo que la base de pruebas, con sufijo: así es evidente que es de los tests.
  const name = `${new URL(baseUrl).pathname.slice(1)}_r${randomBytes(3).toString("hex")}`;
  await db.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created.push(name);
  return withDatabase(baseUrl, name);
}

async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "pz-restore-"));
  dirs.push(d);
  return d;
}

/** Huella de cada tabla (filas y md5 de su contenido), sin las que cambian solas (logs) ni la de migraciones. */
async function fingerprint(url: string): Promise<Record<string, string>> {
  const sql = await connectPg(url);
  try {
    const tables = (await sql.$queryRawUnsafe<{ t: string }[]>("SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).map((r) => r.t).filter((t) => !["_prisma_migrations", "AppLog"].includes(t));
    const out: Record<string, string> = {};
    for (const t of tables) {
      const [row] = await sql.$queryRawUnsafe<{ n: number; h: string }[]>(`SELECT count(*)::int AS n, md5(coalesce(string_agg(r, E'\\n' ORDER BY r), '')) AS h FROM (SELECT row_to_json(x)::text AS r FROM "${t}" x) s`);
      out[t] = `${row!.n}:${row!.h}`;
    }
    return out;
  } finally {
    await sql.end();
  }
}

before(async () => {
  s3 = await startFakeS3({ accessKeyId: "AKIDTEST", secretAccessKey: "secreto-de-prueba", pageSize: 5 });
  uploads = await tmp();
  Object.assign(process.env, {
    UPLOAD_DIR: uploads,
    BACKUP_KEY: randomBytes(32).toString("base64"),
    BACKUP_EXTERNAL_DIR: await tmp(),
    BACKUP_LOCAL_FILES: "1",
    BACKUP_S3_ENDPOINT: s3.endpoint,
    BACKUP_S3_BUCKET: s3.bucket,
    BACKUP_S3_ACCESS_KEY_ID: "AKIDTEST",
    BACKUP_S3_SECRET_ACCESS_KEY: "secreto-de-prueba",
    BACKUP_S3_PREFIX: "pizarro",
  });
});

after(async () => {
  for (const name of created) await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  await s3?.close();
  for (const k of ["UPLOAD_DIR", "BACKUP_KEY", "BACKUP_LOCAL_FILES", "BACKUP_EXTERNAL_DIR", "BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY", "BACKUP_S3_PREFIX"]) delete process.env[k];
});

describe("copias completas", () => {
  test("copia → destino externo → restauración en una base y una carpeta vacías: todo igual", async () => {
    const owner = await makeUser({ name: "Persona Copia" });
    const f = await makeProject({ owner });
    await makeTask(f, { title: "Tarea con adjunto «ñ» 日本" });
    // Ficheros como los de la app: adjuntos, miniaturas, copias de releases, documentos; y cosas que NO van.
    await mkdir(path.join(uploads, "releases"), { recursive: true });
    await mkdir(path.join(uploads, "documentos", f.project.id), { recursive: true });
    const files: Record<string, Buffer> = {
      "att1.webp": randomBytes(40_000),
      "att1.thumb.webp": randomBytes(2_000),
      "att2.bin": randomBytes(150_000),
      "releases/rel1.webp": randomBytes(3_000),
      [`documentos/${f.project.id}/acta.pdf`]: Buffer.from("%PDF-1.4 acta"),
    };
    for (const [p, data] of Object.entries(files)) await writeFile(path.join(uploads, p), data);
    await writeFile(path.join(uploads, "att3.bin.999.tmp"), "subida a medias");

    const run = await createBackup();
    assert.equal(run.ok, true, run.error);
    assert.deepEqual([run.files, run.filesNew], [5, 5]);
    const ext = await syncExternal();
    assert.deepEqual(ext.map((r) => [r.ok, r.uploaded, r.error ?? null]), [[true, 5, null], [true, 5, null]]);
    const status = await readStatus();
    assert.ok(status.external?.s3?.lastOkAt && status.external?.dir?.lastOkAt);
    assert.equal((await computeBackupAlert()).active, false);
    // Sin cambios, la siguiente pasada no sube nada; una copia nueva solo sube lo nuevo.
    assert.deepEqual(await syncExternal(), []);
    await writeFile(path.join(uploads, "att4.webp"), randomBytes(500));
    await new Promise((r) => setTimeout(r, 1100)); // los nombres de las copias van por segundos
    assert.equal((await createBackup()).filesNew, 1);
    files["att4.webp"] = await readFile(path.join(uploads, "att4.webp"));
    const ext2 = await syncExternal();
    assert.deepEqual(ext2.map((r) => [r.ok, r.uploaded, r.skipped]), [[true, 1, 5], [true, 1, 5]]);
    const expected = await fingerprint(baseUrl);

    // «Se pierde el disco»: base de datos nueva y UPLOAD_DIR vacía; se restaura desde S3.
    const url = await newDatabase();
    const fresh = await tmp();
    const res = await restoreBackup({ databaseUrl: url, source: parseSource("s3:latest", { localDir: path.join(fresh, "backups") }), key: Buffer.from(process.env.BACKUP_KEY!, "base64"), migrationsDir: MIGRATIONS, files: true, uploadRoot: fresh });
    assert.equal(res.files?.restored, 6);
    assert.deepEqual(await fingerprint(url), expected);
    for (const [p, data] of Object.entries(files)) assert.ok((await readFile(path.join(fresh, p))).equals(data), p);
    assert.ok(!(await readdir(fresh)).includes("att3.bin.999.tmp"));

    // Prisma reconoce las migraciones aplicadas por la restauración (mismo registro que `migrate deploy`).
    const st = spawnSync("npx", ["prisma", "migrate", "status"], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    assert.equal(st.status, 0, st.stdout + st.stderr);
    assert.match(st.stdout, /up to date/i);

    // Sobre una base con datos se niega; con --force la vacía y restaura (también desde la carpeta externa).
    const again = { databaseUrl: url, key: Buffer.from(process.env.BACKUP_KEY!, "base64"), migrationsDir: MIGRATIONS };
    await assert.rejects(restoreBackup({ ...again, source: parseSource("external:latest", { localDir: "/nada" }) }), /NO está vacía/);
    await restoreBackup({ ...again, source: parseSource("external:latest", { localDir: "/nada" }), force: true });
    assert.deepEqual(await fingerprint(url), expected);
  });

  test("copia de una versión anterior: migra hasta la de la copia, carga y sigue migrando", async () => {
    const all = await listMigrations(MIGRATIONS);
    const old = all[2]!;
    // Una base «antigua» en la migración `old`, con un usuario, volcada con el mismo código que la app.
    const oldUrl = await newDatabase();
    const oldDb = await connectPg(oldUrl);
    const dir = await tmp();
    const dump = path.join(dir, "pizarro-backup-20261001T030000Z.pzbak");
    const key = randomBytes(32);
    try {
      assert.equal(await applyMigrations(oldDb, MIGRATIONS, { upTo: old }), 3);
      await oldDb.$executeRawUnsafe(`INSERT INTO "User" (id, email, name, "passwordHash", "updatedAt") VALUES ('u-old', 'antiguo@example.com', 'Antiguo', '!', now())`);
      await dumpDatabase(oldDb, dump, key);
    } finally {
      await oldDb.end();
    }
    const url = await newDatabase();
    const logs: string[] = [];
    const res = await restoreBackup({ databaseUrl: url, source: parseSource(dump, { localDir: "/nada" }), key, migrationsDir: MIGRATIONS, log: (m) => logs.push(m) });
    assert.deepEqual([res.manifest, res.migrationsBefore, res.migrationsAfter], [null, 3, all.length - 3]);
    const sql = await connectPg(url);
    try {
      const [u] = await sql.$queryRawUnsafe<{ email: string; role: string }[]>(`SELECT email, role::text FROM "User" WHERE id = 'u-old'`);
      assert.deepEqual(u, { email: "antiguo@example.com", role: "MEMBER" });
      const [m] = await sql.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "_prisma_migrations"`);
      assert.equal(m!.n, all.length);
    } finally {
      await sql.end();
    }
    // Una copia de una versión MÁS NUEVA que la imagen se rechaza con un mensaje claro.
    const fewer = await tmp();
    for (const name of all.slice(0, 2)) {
      await mkdir(path.join(fewer, name));
      await writeFile(path.join(fewer, name, "migration.sql"), await readFile(path.join(MIGRATIONS, name, "migration.sql")));
    }
    await assert.rejects(restoreBackup({ databaseUrl: await newDatabase(), source: parseSource(dump, { localDir: "/nada" }), key, migrationsDir: fewer }), /más nueva/);
  });

  test("prueba de restauración mensual: restaura de verdad en una base temporal y comprueba los ficheros", async () => {
    const run = await runRestoreTest();
    assert.equal(run.ok, true, run.error);
    assert.equal(run.mode, "database");
    assert.ok((run.objectsChecked ?? 0) >= 6);
    const left = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE 'pizarro_restoretest_%'`);
    assert.equal(left[0]!.n, 0);
    // Si falta un objeto en el destino externo, la prueba falla.
    const victim = [...s3.objects.keys()].find((k) => k.includes("/files/"))!;
    s3.objects.delete(victim);
    const bad = await runRestoreTest();
    assert.equal(bad.ok, false);
    assert.match(bad.error ?? "", /Faltan 1 de/);
  });

  test("aviso: destino externo configurado sin ninguna subida correcta", async () => {
    const saved = process.env.BACKUP_S3_BUCKET;
    process.env.BACKUP_S3_BUCKET = "";
    try {
      // Configuración a medias: cuenta como destino que nunca ha recibido copia.
      assert.equal((await computeBackupAlert()).reason, "externalNone");
    } finally {
      process.env.BACKUP_S3_BUCKET = saved;
    }
  });
});
