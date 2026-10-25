// Restauración completa sin git: la usan la herramienta `node dist/restore.mjs` y la prueba de restauración mensual.
// Sin dependencias de Next ni de Prisma (habla con PostgreSQL por pg).
//
// Pasos sobre una base de datos VACÍA:
//   1) verifica el volcado (clave, integridad, sha256, cuentas) y lee su migración;
//   2) aplica las migraciones de la imagen HASTA la de la copia (mismo esquema que cuando se hizo);
//   3) carga los datos en una transacción (restoreDatabase);
//   4) aplica el resto de migraciones (las de versiones posteriores) sobre los datos ya cargados;
//   5) opcionalmente, restaura los ficheros de UPLOAD_DIR desde el almacén del mismo origen.
// Las migraciones se registran en _prisma_migrations igual que lo hace `prisma migrate deploy` (mismo checksum
// sha256 del fichero), así el arranque normal de la app las reconoce como aplicadas.

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { chown, mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileSha256, verifyBackupFile, type BackupManifest } from "./backup-core";
import { quoteIdent, restoreDatabase } from "./backup-db";
import { DirDestination, dumpKey, externalDestinations, listObjectKeys, listStems, readManifest, type BackupDestination } from "./backup-dest";
import { decryptFileObject, mapLimit, objectKey, uniqueObjects, type FullManifest, type ManifestFile } from "./backup-files";
import { connectPg, type PgSql } from "./backup-pg";

type Log = (msg: string) => void;

// --- Migraciones ------------------------------------------------------------------------------

const MIGRATION_RE = /^\d{14}_[A-Za-z0-9_]+$/;

/** Carpeta de migraciones de la imagen (o del repositorio en desarrollo). */
export function findMigrationsDir(extra: string[] = []): string | null {
  const candidates = [...extra, path.join(process.cwd(), "migrator", "prisma", "migrations"), path.join(process.cwd(), "prisma", "migrations")];
  return candidates.find((d) => existsSync(d)) ?? null;
}

export async function listMigrations(dir: string): Promise<string[]> {
  const names: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory() && MIGRATION_RE.test(e.name) && existsSync(path.join(dir, e.name, "migration.sql"))) names.push(e.name);
  }
  return names.sort();
}

const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
)`;

/**
 * Aplica, en orden, las migraciones que falten hasta `upTo` (incluida; null = todas). Cada script va en su propia
 * transacción implícita: si falla, no queda a medias ni registrado. Devuelve cuántas aplicó.
 */
export async function applyMigrations(sql: PgSql, dir: string, opts: { upTo?: string | null; log?: Log } = {}): Promise<number> {
  await sql.exec(MIGRATIONS_TABLE);
  const applied = new Set(
    (await sql.$queryRawUnsafe<{ migration_name: string }[]>(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).map((r) => r.migration_name),
  );
  let n = 0;
  for (const name of await listMigrations(dir)) {
    if (opts.upTo && name > opts.upTo) break;
    if (applied.has(name)) continue;
    const script = await readFile(path.join(dir, name, "migration.sql"));
    const started = new Date();
    try {
      await sql.exec(script.toString("utf8"));
    } catch (err) {
      throw new Error(`Falló la migración ${name}: ${err instanceof Error ? err.message : err}`);
    }
    await sql.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ($1, $2, now(), $3, NULL, NULL, $4, 1)`,
      randomUUID(),
      createHash("sha256").update(script).digest("hex"),
      name,
      started,
    );
    opts.log?.(`Migración aplicada: ${name}`);
    n++;
  }
  return n;
}

// --- Estado de la base de datos de destino -------------------------------------------------------

export async function databaseState(sql: PgSql): Promise<{ tables: string[]; hasUserData: boolean }> {
  const tables = (await sql.$queryRawUnsafe<{ t: string }[]>("SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'")).map((r) => r.t);
  let hasUserData = false;
  for (const name of ["User", "Project"]) {
    if (!tables.includes(name)) continue;
    const [row] = await sql.$queryRawUnsafe<{ n: boolean }[]>(`SELECT EXISTS (SELECT 1 FROM ${quoteIdent(name)}) AS n`);
    if (row?.n) hasUserData = true;
  }
  return { tables, hasUserData };
}

/** Borra tablas, vistas, secuencias y tipos del esquema public (lo que crean las migraciones). */
export async function wipeDatabase(sql: PgSql): Promise<void> {
  const list = async (q: string) => (await sql.$queryRawUnsafe<{ n: string }[]>(q)).map((r) => quoteIdent(r.n));
  const views = await list("SELECT viewname AS n FROM pg_views WHERE schemaname = 'public'");
  if (views.length) await sql.exec(`DROP VIEW IF EXISTS ${views.join(", ")} CASCADE`);
  const tables = await list("SELECT tablename AS n FROM pg_tables WHERE schemaname = 'public'");
  if (tables.length) await sql.exec(`DROP TABLE IF EXISTS ${tables.join(", ")} CASCADE`);
  const seqs = await list("SELECT sequencename AS n FROM pg_sequences WHERE schemaname = 'public'");
  if (seqs.length) await sql.exec(`DROP SEQUENCE IF EXISTS ${seqs.join(", ")} CASCADE`);
  const types = await list("SELECT t.typname AS n FROM pg_type t JOIN pg_namespace s ON s.oid = t.typnamespace WHERE s.nspname = 'public' AND t.typtype IN ('e', 'd')");
  if (types.length) await sql.exec(`DROP TYPE IF EXISTS ${types.join(", ")} CASCADE`);
}

// --- Origen de la copia --------------------------------------------------------------------------

export interface Source {
  dest: BackupDestination;
  /** Raíz de la copia o "latest". */
  stem: string;
}

/**
 * Interpreta el origen de la línea de órdenes:
 *   latest | local:latest | local:<copia>      carpeta local (UPLOAD_DIR/backups)
 *   external:latest | external:<copia>         BACKUP_EXTERNAL_DIR
 *   s3:latest | s3:<copia o clave>             BACKUP_S3_*
 *   /ruta/a/pizarro-backup-….pzman (o .pzbak)  esa carpeta (con su files/ al lado)
 * <copia> es el nombre de cualquiera de sus ficheros o su raíz (pizarro-backup-AAAAMMDDTHHMMSSZ).
 */
export function parseSource(spec: string, opts: { localDir: string; env?: Record<string, string | undefined> }): Source {
  const env = opts.env ?? process.env;
  const stemOf = (s: string) => {
    if (s === "latest") return s;
    const base = s.split("/").pop() ?? s;
    const m = /^(pizarro-backup-\d{8}T\d{6}Z)(?:\.(?:pzman|pzbak|pzbak\.json))?$/.exec(base);
    if (!m) throw new Error(`«${s}» no es el nombre de una copia (pizarro-backup-AAAAMMDDTHHMMSSZ…) ni «latest».`);
    return m[1]!;
  };
  const m = /^(local|external|s3):(.+)$/.exec(spec);
  if (m || spec === "latest") {
    const where = m?.[1] ?? "local";
    const stem = stemOf(m?.[2] ?? "latest");
    if (where === "local") return { dest: new DirDestination("local", opts.localDir, true), stem };
    const ext = externalDestinations(env);
    const dest = ext.destinations.find((d) => d.id === (where === "external" ? "dir" : "s3"));
    if (!dest) throw new Error(ext.errors[0] ?? (where === "s3" ? "No hay S3 configurado (BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY)." : "BACKUP_EXTERNAL_DIR no está definida."));
    return { dest, stem };
  }
  const file = path.resolve(spec);
  return { dest: new DirDestination("dir", path.dirname(file), true), stem: stemOf(path.basename(file)) };
}

export async function resolveStem(src: Source): Promise<{ stem: string; hasManifest: boolean }> {
  const stems = await listStems(src.dest);
  if (src.stem === "latest") {
    if (!stems[0]) throw new Error(`No hay ninguna copia en ${src.dest.label}.`);
    return stems[0];
  }
  const found = stems.find((s) => s.stem === src.stem);
  if (!found) throw new Error(`No existe la copia ${src.stem} en ${src.dest.label}.`);
  return found;
}

// --- Restauración -------------------------------------------------------------------------------

export interface RestoreOptions {
  databaseUrl: string;
  source: Source;
  key: Buffer;
  migrationsDir: string;
  /** Borrar la base de datos de destino aunque tenga datos. */
  force?: boolean;
  /** Restaurar la base de datos (por defecto, sí). */
  database?: boolean;
  /** Restaurar también los ficheros en `uploadRoot`. */
  files?: boolean;
  uploadRoot?: string;
  /** Dueño para los ficheros restaurados (si se ejecuta como root). */
  owner?: { uid: number; gid: number } | null;
  log?: Log;
}

export interface RestoreResult {
  stem: string;
  manifest: FullManifest | null;
  db: BackupManifest | null;
  migrationsBefore: number;
  migrationsAfter: number;
  files: { restored: number; skipped: number; bytes: number } | null;
}

/** Descarga (si hace falta) el volcado a un fichero local y comprueba su sha256. Devuelve la ruta y cómo limpiarla. */
async function localDump(dest: BackupDestination, stem: string, expectedSha: string | null, log: Log): Promise<{ file: string; cleanup: () => Promise<void> }> {
  if (dest instanceof DirDestination) {
    const file = path.join(dest.root, dumpKey(stem));
    if (expectedSha && (await fileSha256(file)) !== expectedSha) throw new Error("El sha256 del volcado no coincide con el manifiesto (¿fichero dañado?).");
    return { file, cleanup: async () => {} };
  }
  const dir = await mkdtemp(path.join(tmpdir(), "pizarro-restore-"));
  const file = path.join(dir, dumpKey(stem));
  log(`Descargando ${dumpKey(stem)} de ${dest.label}…`);
  try {
    await pipeline(Readable.from(await dest.get(dumpKey(stem))), createWriteStream(file, { mode: 0o600 }));
    if (expectedSha && (await fileSha256(file)) !== expectedSha) throw new Error("El sha256 del volcado descargado no coincide con el manifiesto.");
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  return { file, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Restaura la base de datos de un volcado sobre `databaseUrl` (ver pasos al principio del fichero). */
export async function restoreDatabaseFromDump(opts: { databaseUrl: string; dumpFile: string; key: Buffer; migrationsDir: string; force?: boolean; log?: Log }): Promise<{ db: BackupManifest; before: number; after: number }> {
  const log = opts.log ?? (() => {});
  log("Verificando el volcado (descifrado, integridad y cuentas)…");
  const { manifest } = await verifyBackupFile(opts.dumpFile, opts.key);
  log(`Volcado válido: ${manifest.totalRows} filas en ${manifest.tables.length} tablas, del ${manifest.createdAt}, migración ${manifest.migration ?? "ninguna"}.`);
  if (!manifest.migration) throw new Error("El volcado no indica su migración: no se puede reconstruir el esquema.");
  const migrations = await listMigrations(opts.migrationsDir);
  if (!migrations.includes(manifest.migration)) {
    const newest = migrations[migrations.length - 1] ?? "ninguna";
    throw new Error(
      manifest.migration > newest
        ? `La copia es de una versión de Pizarro más nueva que esta (migración ${manifest.migration}; la última de esta imagen es ${newest}). Restaura con una imagen igual o más reciente.`
        : `La migración de la copia (${manifest.migration}) no existe en ${opts.migrationsDir}.`,
    );
  }
  const sql = await connectPg(opts.databaseUrl);
  try {
    const state = await databaseState(sql);
    if (state.tables.length) {
      if (state.hasUserData && !opts.force) {
        throw new Error("La base de datos de destino NO está vacía (tiene usuarios o proyectos). Restaura sobre una base de datos nueva o, si de verdad quieres BORRAR lo que tiene, añade --force.");
      }
      log(state.hasUserData ? "--force: se borra todo lo que tiene la base de datos de destino." : "La base de datos tiene tablas sin datos de usuario: se vacía.");
      await wipeDatabase(sql);
    }
    const before = await applyMigrations(sql, opts.migrationsDir, { upTo: manifest.migration, log });
    log(`Esquema en la migración de la copia (${before} migraciones). Cargando datos…`);
    await restoreDatabase(sql, opts.dumpFile, opts.key, log, { verified: manifest });
    const after = await applyMigrations(sql, opts.migrationsDir, { log });
    if (after) log(`Aplicadas ${after} migraciones posteriores a la copia.`);
    return { db: manifest, before, after };
  } finally {
    await sql.end().catch(() => {});
  }
}

/** ¿El fichero ya está y es igual? (para reanudar una restauración de ficheros). */
async function sameFile(file: string, entry: ManifestFile): Promise<boolean> {
  try {
    const st = await stat(file);
    return st.isFile() && st.size === entry.s && (await fileSha256(file)) === entry.h;
  } catch {
    return false;
  }
}

/**
 * Restaura los ficheros del manifiesto en `root` desde el almacén de `dest`. Los que ya están iguales se saltan
 * (se puede repetir tras un fallo). Cada fichero se descifra a un temporal y solo se renombra si cuadra el sha256.
 * No borra ficheros que no estén en la copia.
 */
export async function restoreFiles(dest: BackupDestination, manifest: FullManifest, root: string, key: Buffer, opts: { owner?: { uid: number; gid: number } | null; log?: Log } = {}): Promise<{ restored: number; skipped: number; bytes: number }> {
  const log = opts.log ?? (() => {});
  if (!dest.files) throw new Error(`${dest.label} no guarda los ficheros (BACKUP_LOCAL_FILES=0): restáuralos desde el destino externo (external:… o s3:…).`);
  const res = { restored: 0, skipped: 0, bytes: 0 };
  const madeDirs = new Set<string>();
  const ensureDir = async (dir: string) => {
    if (madeDirs.has(dir)) return;
    await mkdir(dir, { recursive: true });
    if (opts.owner) {
      // Cada carpeta creada entre la raíz y `dir`, para que la app (sin privilegios) pueda escribir después.
      for (let d = dir; d.startsWith(root) && d !== root; d = path.dirname(d)) await chown(d, opts.owner.uid, opts.owner.gid).catch(() => {});
    }
    madeDirs.add(dir);
  };
  await mapLimit(manifest.files, 4, async (entry) => {
    const file = path.join(root, ...entry.p.split("/"));
    if (await sameFile(file, entry)) {
      res.skipped++;
      return;
    }
    await ensureDir(path.dirname(file));
    const tmp = `${file}.${process.pid}.restore.tmp`;
    try {
      const src = await dest.get(objectKey(entry.o));
      await pipeline(Readable.from(decryptFileObject(src, entry, key)), createWriteStream(tmp, { mode: 0o640 }));
      if (opts.owner) await chown(tmp, opts.owner.uid, opts.owner.gid);
      await rename(tmp, file);
    } catch (err) {
      await rm(tmp, { force: true });
      throw new Error(`No se pudo restaurar ${entry.p}: ${err instanceof Error ? err.message : err}`);
    }
    res.restored++;
    res.bytes += entry.s;
    if (res.restored % 500 === 0) log(`${res.restored} ficheros restaurados…`);
  });
  return res;
}

/** Restauración completa desde un origen: base de datos y/o ficheros. */
export async function restoreBackup(opts: RestoreOptions): Promise<RestoreResult> {
  const log = opts.log ?? (() => {});
  const { stem, hasManifest } = await resolveStem(opts.source);
  log(`Copia: ${stem} (${opts.source.dest.label}).`);
  const manifest = hasManifest ? await readManifest(opts.source.dest, stem, opts.key) : null;
  if (manifest) log(`Manifiesto: ${manifest.db.rows} filas, ${manifest.fileCount} ficheros (${Math.round(manifest.fileBytes / 1024 / 1024)} MB), migración ${manifest.migration ?? "ninguna"}.`);
  else log("Copia sin manifiesto (anterior a las copias con ficheros): solo se puede restaurar la base de datos.");
  const result: RestoreResult = { stem, manifest, db: null, migrationsBefore: 0, migrationsAfter: 0, files: null };
  if (opts.database !== false) {
    const dump = await localDump(opts.source.dest, stem, manifest?.db.sha256 ?? null, log);
    try {
      const r = await restoreDatabaseFromDump({ databaseUrl: opts.databaseUrl, dumpFile: dump.file, key: opts.key, migrationsDir: opts.migrationsDir, force: opts.force, log });
      Object.assign(result, { db: r.db, migrationsBefore: r.before, migrationsAfter: r.after });
    } finally {
      await dump.cleanup();
    }
  }
  if (opts.files) {
    if (!manifest) throw new Error("Esta copia no incluye ficheros.");
    if (!opts.uploadRoot) throw new Error("Falta la carpeta de subidas (UPLOAD_DIR).");
    log(`Restaurando ${manifest.fileCount} ficheros en ${opts.uploadRoot}…`);
    result.files = await restoreFiles(opts.source.dest, manifest, path.resolve(opts.uploadRoot), opts.key, { owner: opts.owner, log });
    log(`Ficheros: ${result.files.restored} restaurados, ${result.files.skipped} ya estaban.`);
  }
  return result;
}

/**
 * Comprueba los ficheros de una copia en un destino sin restaurarlos: que estén todos los objetos y que una muestra
 * al azar se descifre y coincida con su sha256. Barato (un listado y unos pocos ficheros).
 */
export async function checkObjects(dest: BackupDestination, manifest: FullManifest, key: Buffer, sample = 5): Promise<{ objects: number; missing: number; sampled: number }> {
  const present = await listObjectKeys(dest);
  const objects = uniqueObjects(manifest.files);
  const there = objects.filter((f) => present.has(objectKey(f.o)));
  const picks = [...there].sort(() => Math.random() - 0.5).slice(0, sample);
  for (const entry of picks) {
    for await (const chunk of decryptFileObject(await dest.get(objectKey(entry.o)), entry, key)) void chunk;
  }
  return { objects: objects.length, missing: objects.length - there.length, sampled: picks.length };
}
