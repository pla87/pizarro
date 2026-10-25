import "server-only";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { backupFileName, fileSha256, parseBackupFileName, parseBackupKey, verifyBackupFile, type BackupManifest } from "./backup-core";
import { dumpDatabase } from "./backup-db";
import { DirDestination, externalDestinations, localFilesEnabled, listObjectKeys, listStems, manifestKey, pruneDestination, readManifest, syncBackup, type BackupDestination, type DestinationId } from "./backup-dest";
import { buildManifest, decodeManifest, encodeManifest, fileNameKey, hashFiles, loadHashIndex, saveHashIndex, scanFiles, type FullManifest } from "./backup-files";
import { withDatabase } from "./backup-pg";
import { checkObjects, findMigrationsDir, restoreDatabaseFromDump } from "./backup-restore";
import { db } from "./db";
import { logEvent } from "./log";
import { backupsDir, uploadDir } from "./upload-dir";

// Copias de seguridad automáticas: cada día, la base de datos (volcado cifrado) y los ficheros de UPLOAD_DIR
// (almacén incremental cifrado, ver backup-files.ts) en UPLOAD_DIR/backups y, si está configurado, en un destino
// externo (BACKUP_EXTERNAL_DIR y/o BACKUP_S3_*). Cifradas con BACKUP_KEY (AES-256-GCM); sin clave, desactivadas.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Una copia nueva si la última correcta tiene más de 23 h (la tarea corre cada hora). */
const BACKUP_EVERY_MS = 23 * 60 * 60 * 1000;
/** Prueba de restauración mensual. */
const RESTORE_TEST_EVERY_MS = 30 * DAY_MS;
const STATUS_FILE = "status.json";
const INDEX_FILE = "files-index.json";
const RESTORE_TEST_DB_PREFIX = "pizarro_restoretest_";

export interface BackupRun {
  at: string;
  ok: boolean;
  file?: string;
  bytes?: number;
  rows?: number;
  tables?: number;
  /** Ficheros de UPLOAD_DIR en la copia, sus bytes y cuántos se guardaron nuevos en el almacén local. */
  files?: number;
  filesBytes?: number;
  filesNew?: number;
  durationMs?: number;
  error?: string;
}

export interface RestoreTestRun extends BackupRun {
  /** "database": restaurada de verdad en una base temporal; "verify": solo descifrada y comprobada. */
  mode?: "database" | "verify";
  /** Por qué solo se verificó: el usuario no puede crear bases de datos, o no está la carpeta de migraciones. */
  limit?: "createdb" | "migrations";
  /** Objetos del almacén comprobados (presentes) y descifrados de muestra. */
  objectsChecked?: number;
  objectsSampled?: number;
}

export interface ExternalRun {
  at: string;
  ok: boolean;
  label: string;
  /** Raíz de la copia subida. */
  file?: string;
  uploaded?: number;
  skipped?: number;
  bytes?: number;
  removedBackups?: number;
  removedObjects?: number;
  durationMs?: number;
  error?: string;
  warning?: string;
}

export interface ExternalState {
  last?: ExternalRun;
  lastOkAt?: string;
  lastOkFile?: string;
}

export interface BackupStatus {
  lastBackup?: BackupRun;
  lastRestoreTest?: RestoreTestRun;
  external?: Partial<Record<DestinationId, ExternalState>>;
}

export interface BackupFileInfo {
  name: string;
  bytes: number;
  at: string;
}

export function backupKey(): Buffer | null {
  return parseBackupKey(process.env.BACKUP_KEY);
}

/** ¿Está configurada la clave? Distingue «sin definir» de «definida pero inválida» para avisar al admin. */
export function backupKeyState(): "ok" | "missing" | "invalid" {
  const raw = process.env.BACKUP_KEY;
  if (!raw || !raw.trim()) return "missing";
  return backupKey() ? "ok" : "invalid";
}

export { localFilesEnabled } from "./backup-dest";

export function localDestination(): DirDestination {
  return new DirDestination("local", backupsDir(), localFilesEnabled(), "UPLOAD_DIR/backups");
}

/** Destinos configurados, sin secretos (para la página de administración). */
export function backupDestinationsInfo(): { local: { label: string; files: boolean }; external: { id: DestinationId; label: string }[]; errors: string[] } {
  const ext = externalDestinations();
  return { local: { label: "UPLOAD_DIR/backups", files: localFilesEnabled() }, external: ext.destinations.map((d) => ({ id: d.id, label: d.label })), errors: ext.errors };
}

export async function readStatus(): Promise<BackupStatus> {
  try {
    return JSON.parse(await readFile(path.join(backupsDir(), STATUS_FILE), "utf8")) as BackupStatus;
  } catch {
    return {};
  }
}

// Las escrituras del estado se encadenan para que dos actualizaciones seguidas no se pisen.
const statusChain = (globalThis as unknown as { __pzBackupStatus?: { p: Promise<void> } }).__pzBackupStatus ??= { p: Promise.resolve() };

function updateStatus(fn: (s: BackupStatus) => BackupStatus): Promise<void> {
  const run = statusChain.p.then(async () => {
    await mkdir(backupsDir(), { recursive: true });
    const next = fn(await readStatus());
    const file = path.join(backupsDir(), STATUS_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2));
    await rename(tmp, file);
  });
  statusChain.p = run.catch(() => {});
  return run;
}

/** Copias existentes, la más reciente primero. */
export async function listBackups(): Promise<BackupFileInfo[]> {
  let names: string[];
  try {
    names = await readdir(backupsDir());
  } catch {
    return [];
  }
  const out: BackupFileInfo[] = [];
  for (const name of names) {
    const at = parseBackupFileName(name);
    if (!at) continue;
    try {
      out.push({ name, bytes: (await stat(path.join(backupsDir(), name))).size, at: at.toISOString() });
    } catch {
      // Borrada entre medias.
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Ruta absoluta de la copia más reciente (para la descarga), o null. */
export async function latestBackupPath(): Promise<{ file: string; name: string; bytes: number } | null> {
  const [latest] = await listBackups();
  return latest ? { file: path.join(backupsDir(), latest.name), name: latest.name, bytes: latest.bytes } : null;
}

// Evita que una copia manual, la programada y la subida externa se pisen.
const lock = (globalThis as unknown as { __pzBackupBusy?: { busy: boolean; external: boolean } }).__pzBackupBusy ??= { busy: false, external: false };

/** ¿Hay una subida a destino externo en curso en este proceso? */
export function externalCopyRunning(): boolean {
  return lock.external;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Lista los ficheros de UPLOAD_DIR (sin backups/ ni temporales) con su sha256: solo se leen los nuevos o cambiados
 * (caché por ruta, tamaño y fecha en backups/files-index.json).
 */
async function collectFiles(key: Buffer) {
  const exclude = [backupsDir()];
  const extDir = process.env.BACKUP_EXTERNAL_DIR?.trim();
  if (extDir && path.isAbsolute(extDir)) exclude.push(extDir);
  const scanned = await scanFiles(uploadDir(), exclude);
  const indexFile = path.join(backupsDir(), INDEX_FILE);
  const { entries, index } = await hashFiles(scanned, await loadHashIndex(indexFile), fileNameKey(key));
  await saveHashIndex(indexFile, index);
  return entries;
}

/** Crea una copia ahora (base de datos + ficheros, en el destino local). Nunca lanza (queda en status.json y en los logs). */
export async function createBackup(): Promise<BackupRun> {
  const key = backupKey();
  const started = Date.now();
  if (!key) return { at: new Date().toISOString(), ok: false, error: "BACKUP_KEY no está configurada." };
  if (lock.busy) return { at: new Date().toISOString(), ok: false, error: "Ya hay una copia en curso." };
  lock.busy = true;
  let run: BackupRun;
  try {
    await mkdir(backupsDir(), { recursive: true, mode: 0o700 });
    const name = backupFileName(new Date());
    const stem = name.replace(/\.pzbak$/, "");
    const file = path.join(backupsDir(), name);
    const { manifest: dbManifest, bytes } = await dumpDatabase(db, file, key);
    const dumpSha = await fileSha256(file);
    // Resumen en claro junto al fichero (solo cuentas, migración y hashes; sin datos).
    await writeFile(`${file}.json`, JSON.stringify({ ...dbManifest, file: name, bytes, fileSha256: dumpSha }, null, 2));

    // Ficheros: manifiesto con todos y, en el almacén local, solo los que aún no estaban.
    const files = await collectFiles(key);
    const manifest = buildManifest({ stem, dbFile: name, dbBytes: bytes, dbSha256: dumpSha, db: dbManifest, files });
    const manifestBytes = await encodeManifest(manifest, key);
    const local = localDestination();
    const sync = await syncBackup(local, manifest, manifestBytes, { size: bytes, open: () => createReadStream(file) }, { key, uploadRoot: uploadDir() });
    const pruned = await pruneDestination(local, key, { extraKeys: (s) => [`${s}.pzbak.json`] });
    if (pruned.gcSkipped) logEvent({ level: "warn", category: "system", action: "backup.gcSkipped", message: `No se limpió el almacén de ficheros local: ${pruned.gcSkipped}` });
    run = {
      at: new Date().toISOString(), ok: true, file: name, bytes, rows: dbManifest.totalRows, tables: dbManifest.tables.length,
      files: manifest.fileCount, filesBytes: manifest.fileBytes, filesNew: local.files ? sync.uploaded : 0, durationMs: Date.now() - started,
    };
    logEvent({
      category: "system",
      action: "backup.created",
      message: `Copia de seguridad creada: ${name} (${Math.round(bytes / 1024)} KB, ${dbManifest.totalRows} filas, ${manifest.fileCount} ficheros)`,
      durationMs: run.durationMs,
      details: { file: name, bytes, rows: dbManifest.totalRows, tables: dbManifest.tables.length, files: manifest.fileCount, filesBytes: manifest.fileBytes, filesNew: run.filesNew, pruned: pruned.removedBackups, objectsRemoved: pruned.removedObjects },
    });
  } catch (err) {
    run = { at: new Date().toISOString(), ok: false, error: message(err), durationMs: Date.now() - started };
    logEvent({ level: "error", category: "system", action: "backup.failed", message: `Falló la copia de seguridad: ${run.error}`, durationMs: run.durationMs });
  } finally {
    lock.busy = false;
  }
  await updateStatus((s) => ({ ...s, lastBackup: run })).catch((err) => console.error("[backup] no se pudo guardar el estado", err));
  return run;
}

/** Última copia local completa (con manifiesto): su manifiesto descifrado y sus bytes cifrados. */
async function latestLocalManifest(key: Buffer): Promise<{ manifest: FullManifest; bytes: Buffer } | null> {
  const local = localDestination();
  const latest = (await listStems(local)).find((s) => s.hasManifest);
  if (!latest) return null;
  const bytes = await readFile(path.join(local.root, manifestKey(latest.stem)));
  return { manifest: await decodeManifest(bytes, key), bytes };
}

/**
 * Sube la última copia local a cada destino externo que aún no la tenga (o a todos con `force`), reanudando lo
 * que quedara a medias, y aplica allí la misma retención. Devuelve un resultado por destino; nunca lanza.
 */
export async function syncExternal(opts: { force?: boolean } = {}): Promise<ExternalRun[]> {
  const key = backupKey();
  const { destinations, errors } = externalDestinations();
  const at = () => new Date().toISOString();
  if (!key || (destinations.length === 0 && errors.length === 0)) return [];
  if (errors.length) logEvent({ level: "error", category: "system", action: "backup.externalConfig", message: `Destino externo de copias mal configurado: ${errors.join(" ")}` });
  if (destinations.length === 0) return [];
  if (lock.busy || lock.external) return [];
  lock.external = true;
  const runs: ExternalRun[] = [];
  try {
    const latest = await latestLocalManifest(key);
    if (!latest) return [];
    const { manifest, bytes } = latest;
    const local = localDestination();
    const dumpFile = path.join(local.root, `${manifest.stem}.pzbak`);
    const store = local.files ? { dest: local as BackupDestination, keys: await listObjectKeys(local) } : undefined;
    const status = await readStatus();
    for (const dest of destinations) {
      const prev = status.external?.[dest.id];
      if (!opts.force && prev?.lastOkFile === manifest.stem && prev.last?.ok) continue;
      const started = Date.now();
      let run: ExternalRun;
      try {
        const sync = await syncBackup(dest, manifest, bytes, { size: manifest.db.bytes, open: () => createReadStream(dumpFile) }, { key, uploadRoot: uploadDir(), store });
        let pruned = null;
        let warning: string | undefined;
        try {
          pruned = await pruneDestination(dest, key);
          if (pruned.gcSkipped) warning = `No se limpió el almacén: ${pruned.gcSkipped}`;
        } catch (err) {
          warning = `Retención: ${message(err)}`;
        }
        run = { at: at(), ok: true, label: dest.label, file: manifest.stem, uploaded: sync.uploaded, skipped: sync.skipped, bytes: sync.bytes, removedBackups: pruned?.removedBackups, removedObjects: pruned?.removedObjects, durationMs: Date.now() - started, warning };
        logEvent({
          level: warning ? "warn" : "info", category: "system", action: "backup.external",
          message: `Copia subida a ${dest.label}: ${manifest.stem} (${sync.uploaded} ficheros nuevos, ${sync.skipped} ya estaban, ${Math.round(sync.bytes / 1024)} KB)${warning ? `. ${warning}` : ""}`,
          durationMs: run.durationMs, details: { dest: dest.id, file: manifest.stem, uploaded: sync.uploaded, skipped: sync.skipped, bytes: sync.bytes, removedBackups: pruned?.removedBackups ?? null, removedObjects: pruned?.removedObjects ?? null },
        });
      } catch (err) {
        run = { at: at(), ok: false, label: dest.label, file: manifest.stem, durationMs: Date.now() - started, error: message(err) };
        logEvent({ level: "error", category: "system", action: "backup.externalFailed", message: `Falló la copia a ${dest.label}: ${run.error}`, durationMs: run.durationMs, details: { dest: dest.id, file: manifest.stem } });
      }
      runs.push(run);
      const r = run;
      await updateStatus((s) => ({
        ...s,
        external: { ...s.external, [dest.id]: { ...s.external?.[dest.id], last: r, ...(r.ok ? { lastOkAt: r.at, lastOkFile: r.file } : {}) } },
      })).catch((err) => console.error("[backup] no se pudo guardar el estado", err));
    }
  } catch (err) {
    logEvent({ level: "error", category: "system", action: "backup.externalFailed", message: `Falló la copia a destino externo: ${message(err)}` });
    runs.push({ at: at(), ok: false, label: "externo", error: message(err) });
  } finally {
    lock.external = false;
  }
  return runs;
}

/** Arranca la subida externa en segundo plano (botón «Copiar ahora a destino externo»). false si ya hay una en curso. */
export function startExternalCopy(): boolean {
  if (lock.busy || lock.external) return false;
  void syncExternal({ force: true }).catch((err) => console.error("[backup] copia externa", err));
  return true;
}

// --- Prueba de restauración --------------------------------------------------------------------

/** ¿Puede el usuario de la base de datos crear bases de datos? (para la prueba de restauración completa). */
async function canCreateDatabase(): Promise<boolean> {
  try {
    const rows = await db.$queryRawUnsafe<{ ok: boolean }[]>("SELECT (rolcreatedb OR rolsuper) AS ok FROM pg_roles WHERE rolname = current_user");
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

async function dropDatabase(name: string): Promise<void> {
  try {
    await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } catch {
    await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
  }
}

/** Restaura el volcado en una base de datos temporal (pizarro_restoretest_*) y la borra al terminar. */
async function restoreIntoTemporaryDatabase(dumpFile: string, key: Buffer, migrationsDir: string): Promise<BackupManifest> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida.");
  // Restos de una prueba anterior interrumpida (solo las bases con nuestro prefijo).
  const stale = await db.$queryRawUnsafe<{ n: string }[]>(`SELECT datname AS n FROM pg_database WHERE datname LIKE '${RESTORE_TEST_DB_PREFIX}%'`);
  for (const { n } of stale) if (/^pizarro_restoretest_[0-9a-f]+$/.test(n)) await dropDatabase(n).catch(() => {});
  const name = `${RESTORE_TEST_DB_PREFIX}${randomBytes(6).toString("hex")}`;
  await db.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  try {
    const r = await restoreDatabaseFromDump({ databaseUrl: withDatabase(url, name), dumpFile, key, migrationsDir });
    return r.db;
  } finally {
    await dropDatabase(name).catch((err) => console.error(`[backup] no se pudo borrar ${name}`, err));
  }
}

/**
 * Prueba de restauración de la copia local más reciente. Si el usuario de la base de datos puede crear bases de
 * datos, la restaura de verdad en una temporal (migraciones hasta la de la copia, datos, resto de migraciones) y la
 * borra; si no, la descifra y comprueba entera (integridad, sha256 y cuentas). Además comprueba que el almacén de
 * cada destino tiene todos los ficheros de su última copia y descifra unos pocos al azar.
 */
export async function runRestoreTest(): Promise<RestoreTestRun> {
  const key = backupKey();
  const started = Date.now();
  const at = new Date().toISOString();
  const latest = await latestBackupPath();
  let run: RestoreTestRun;
  if (!key) run = { at, ok: false, error: "BACKUP_KEY no está configurada." };
  else if (!latest) run = { at, ok: false, error: "No hay ninguna copia que probar." };
  else {
    try {
      const stem = latest.name.replace(/\.pzbak$/, "");
      const local = localDestination();
      const hasManifest = (await local.head(manifestKey(stem))) !== null;
      const manifest = hasManifest ? await readManifest(local, stem, key) : null;
      const fileSha = await fileSha256(latest.file);
      if (manifest && manifest.db.sha256 !== fileSha) throw new Error("El sha256 del volcado no coincide con el del manifiesto (¿corrupción en el volumen?).");
      try {
        const sidecar = JSON.parse(await readFile(`${latest.file}.json`, "utf8")) as BackupManifest & { fileSha256?: string };
        if (sidecar.fileSha256 && sidecar.fileSha256 !== fileSha) throw new Error("El sha256 del fichero cifrado no coincide (¿corrupción en el volumen?).");
      } catch (err) {
        if (!(err instanceof SyntaxError) && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      const migrationsDir = findMigrationsDir();
      let dbManifest: BackupManifest;
      let mode: RestoreTestRun["mode"];
      let limit: RestoreTestRun["limit"];
      if (migrationsDir && (await canCreateDatabase())) {
        dbManifest = await restoreIntoTemporaryDatabase(latest.file, key, migrationsDir);
        mode = "database";
      } else {
        dbManifest = (await verifyBackupFile(latest.file, key)).manifest;
        mode = "verify";
        limit = migrationsDir ? "createdb" : "migrations";
      }
      if (manifest && (manifest.db.dataSha256 !== dbManifest.sha256 || manifest.db.rows !== dbManifest.totalRows)) throw new Error("El manifiesto no coincide con el volcado.");
      // Ficheros: en cada destino con almacén, todos los objetos de su última copia y unos pocos descifrados.
      let objectsChecked = 0;
      let objectsSampled = 0;
      const dests: BackupDestination[] = [...(local.files ? [local] : []), ...externalDestinations().destinations];
      for (const dest of dests) {
        const last = dest === local ? (manifest ? { stem } : null) : (await listStems(dest)).find((s) => s.hasManifest);
        if (!last) continue;
        const m = dest === local && manifest ? manifest : await readManifest(dest, last.stem, key);
        const check = await checkObjects(dest, m, key, 3);
        if (check.missing > 0) throw new Error(`Faltan ${check.missing} de ${check.objects} ficheros en ${dest.label} (copia ${last.stem}).`);
        objectsChecked += check.objects;
        objectsSampled += check.sampled;
      }
      run = { at, ok: true, file: latest.name, bytes: latest.bytes, rows: dbManifest.totalRows, tables: dbManifest.tables.length, files: manifest?.fileCount, filesBytes: manifest?.fileBytes, mode, limit, objectsChecked, objectsSampled, durationMs: Date.now() - started };
    } catch (err) {
      run = { at, ok: false, file: latest.name, error: message(err), durationMs: Date.now() - started };
    }
  }
  logEvent({
    level: run.ok ? "info" : "error",
    category: "system",
    action: "backup.restoreTest",
    message: run.ok
      ? `Prueba de restauración correcta${run.mode === "database" ? " (restaurada en una base temporal)" : ""}: ${run.file} (${run.rows} filas en ${run.tables} tablas, ${run.objectsChecked ?? 0} ficheros comprobados)`
      : `Prueba de restauración fallida: ${run.error}`,
    durationMs: run.durationMs,
    details: { file: run.file ?? null, ok: run.ok, rows: run.rows ?? null, mode: run.mode ?? null, objectsChecked: run.objectsChecked ?? null },
  });
  const r = run;
  await updateStatus((s) => ({ ...s, lastRestoreTest: r })).catch((err) => console.error("[backup] no se pudo guardar el estado", err));
  return run;
}

/** Tarea diaria (se llama cada hora): crea la copia si la última correcta tiene más de 23 h o si la última falló. */
export async function dailyBackupJob(now: number = Date.now()): Promise<void> {
  if (!backupKey()) return;
  const status = await readStatus();
  const last = status.lastBackup?.ok ? Date.parse(status.lastBackup.at) : 0;
  const [latestFile] = await listBackups();
  const lastFile = latestFile ? Date.parse(latestFile.at) : 0;
  const failedSince = status.lastBackup?.ok === false && Date.parse(status.lastBackup.at) >= lastFile;
  if (!failedSince && now - Math.max(last, lastFile) < BACKUP_EVERY_MS) return;
  await createBackup();
}

/** Tarea horaria: sube a los destinos externos la última copia si aún no la tienen (o reintenta si falló). Lanza si falla alguno. */
export async function externalBackupJob(): Promise<void> {
  const runs = await syncExternal();
  const failed = runs.filter((r) => !r.ok);
  if (failed.length) throw new Error(failed.map((r) => `${r.label}: ${r.error}`).join(" · "));
}

/** Tarea mensual (se llama cada hora): prueba de restauración si hace más de 30 días de la última (o nunca). */
export async function monthlyRestoreTestJob(now: number = Date.now()): Promise<void> {
  if (!backupKey() || (await listBackups()).length === 0) return;
  const status = await readStatus();
  const last = status.lastRestoreTest ? Date.parse(status.lastRestoreTest.at) : 0;
  // Si la última prueba falló se repite al día siguiente en vez de esperar un mes.
  if (now - last < (status.lastRestoreTest?.ok === false ? DAY_MS : RESTORE_TEST_EVERY_MS)) return;
  await runRestoreTest();
}
