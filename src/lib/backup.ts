import "server-only";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { LOCK_BACKUP } from "./advisory-locks";
import { backupFileName, fileSha256, diagnoseBackupKey, parseBackupKey, verifyBackupFile, type BackupManifest } from "./backup-core";
import { listForeignKeys, lastMigration } from "./backup-db";
import {
  checkShrink, copySummary, DirDestination, dumpKey, externalDestinations, lastGoodCopy, localFilesEnabled, listObjectKeys, listStems, manifestKey, pruneDestination, readManifest, stemDate,
  syncBackup, type BackupDestination, type CopyShrink, type CopySummary, type DestinationId, type StemInfo,
} from "./backup-dest";
import { buildManifest, decodeManifest, encodeManifest, fileNameKey, hashFiles, loadHashIndex, saveHashIndex, scanFiles, type FullManifest } from "./backup-files";
import { dumpDatabaseOwnConnection, withDatabase } from "./backup-pg";
import { checkObjects, findMigrationsDir, restoreDatabaseFromDump } from "./backup-restore";
import { db } from "./db";
import { AppError } from "./errors";
import { withAdvisoryLock } from "./jobs";
import { logEvent } from "./log";
import { invalidateMemo, memo } from "./memo";
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
  /** Solo «verify»: referencias entre filas comprobadas (cada una apunta a una fila que está en la copia). */
  referencesChecked?: number;
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
  /** Cuánto contenido tiene cada copia local (de su manifiesto), por raíz: así no hay que descifrarlos en cada copia. */
  copies?: Record<string, Omit<CopySummary, "stem">>;
  /** La copia local más reciente es mucho menor que la última buena (ver lastGoodCopy): se avisa al administrador. */
  shrink?: CopyShrink & { at: string };
  /** Copia desde la que el administrador confirmó que la reducción era intencionada (las anteriores ya no cuentan). */
  shrinkAccepted?: string;
}

export interface BackupFileInfo {
  name: string;
  bytes: number;
  at: string;
}

export function backupKey(): Buffer | null {
  return parseBackupKey(process.env.BACKUP_KEY);
}

/** Por qué la BACKUP_KEY no sirve (sin el valor), o null si es válida o no está definida. */
export function backupKeyProblem() {
  return backupKeyState() === "invalid" ? diagnoseBackupKey(process.env.BACKUP_KEY) : null;
}

/** ¿Está configurada la clave? Distingue «sin definir» de «definida pero inválida» para avisar al admin. */
export function backupKeyState(): "ok" | "missing" | "invalid" {
  const raw = process.env.BACKUP_KEY;
  if (!raw || !raw.trim()) return "missing";
  return backupKey() ? "ok" : "invalid";
}

export { localFilesEnabled } from "./backup-dest";

/**
 * BACKUP_PAUSE=1: detiene las tareas automáticas de copia (la diaria, la subida al destino externo y la prueba de
 * restauración), p. ej. mientras se restaura tras perder la base de datos o el volumen, para que la primera copia de
 * una base vacía no llegue al destino externo. Los botones de Administración siguen funcionando.
 */
export function backupPaused(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env.BACKUP_PAUSE?.trim() ?? "");
}

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

/** Cambia status.json en fila con las demás escrituras. Si `fn` devuelve el mismo objeto, no se escribe nada. */
function updateStatus(fn: (s: BackupStatus) => BackupStatus): Promise<void> {
  const run = statusChain.p.then(async () => {
    await mkdir(backupsDir(), { recursive: true });
    const current = await readStatus();
    const next = fn(current);
    if (next === current) return;
    const file = path.join(backupsDir(), STATUS_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2));
    await rename(tmp, file);
    invalidateMemo(BACKUP_MEMO);
  });
  statusChain.p = run.catch(() => {});
  return run;
}

/**
 * Memoria en proceso (lib/memo.ts) de lo que piden las páginas de administración: la lista de copias y el aviso de copia
 * atrasada (backup-alert.ts). Se invalida con cada copia nueva o podada y con cada cambio de status.json.
 */
const BACKUP_MEMO = "backup:";
export const BACKUP_ALERT_MEMO = `${BACKUP_MEMO}alert`;
const BACKUP_LIST_MEMO = `${BACKUP_MEMO}list`;

/**
 * Copias existentes, la más reciente primero (lectura directa de la carpeta). Sin las copias cortadas entre el volcado y
 * el manifiesto (ver StemInfo en backup-dest.ts): ni se ofrecen para descargar ni cuentan como la última copia.
 */
export async function listBackups(): Promise<BackupFileInfo[]> {
  const stems = await listStems(localDestination()).catch(() => []);
  return stems.filter((s) => !s.partial).map((s) => ({ name: dumpKey(s.stem), bytes: s.dumpBytes, at: (stemDate(s.stem) ?? new Date(0)).toISOString() }));
}

/** Igual, con un minuto de memoria (Administración → Copias de seguridad); las tareas y las descargas leen la carpeta. */
export function listBackupsCached(): Promise<BackupFileInfo[]> {
  return memo(BACKUP_LIST_MEMO, listBackups);
}

/**
 * Copias completas del destino local solo por sus nombres, sin mirar el tamaño de cada fichero: para saber cuál es la
 * última o cuántas hay (la tarea horaria, el aviso de copia atrasada) no hace falta un stat por fichero.
 */
async function localStemsByName(): Promise<StemInfo[]> {
  const stems = await listStems(localDestination(), { sizes: false }).catch(() => []);
  return stems.filter((s) => !s.partial);
}

/** Fecha (ms) de la copia local completa más reciente, o null si no hay ninguna (sin stat de cada copia). */
export async function latestBackupTime(): Promise<number | null> {
  const [latest] = await localStemsByName();
  return latest ? (stemDate(latest.stem)?.getTime() ?? null) : null;
}

/** Ruta absoluta de la copia más reciente (para la descarga), o null. */
export async function latestBackupPath(): Promise<{ file: string; name: string; bytes: number } | null> {
  const [latest] = await listBackups();
  return latest ? { file: path.join(backupsDir(), latest.name), name: latest.name, bytes: latest.bytes } : null;
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida.");
  return url;
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
  // Exportaciones (pueden pesar GB y caducan en 24 h) e importaciones en curso son temporales: no entran en la copia.
  const exclude = [backupsDir(), path.join(uploadDir(), "exports"), path.join(uploadDir(), "imports")];
  const extDir = process.env.BACKUP_EXTERNAL_DIR?.trim();
  if (extDir && path.isAbsolute(extDir)) exclude.push(extDir);
  const scanned = await scanFiles(uploadDir(), exclude);
  const indexFile = path.join(backupsDir(), INDEX_FILE);
  const { entries, index } = await hashFiles(scanned, await loadHashIndex(indexFile), fileNameKey(key));
  await saveHashIndex(indexFile, index);
  return entries;
}

const BUSY = "Ya hay una copia en curso.";

/**
 * Crea una copia ahora (base de datos + ficheros, en el destino local). Nunca lanza (queda en status.json y en los
 * logs). Una sola a la vez en todo el servidor: además del cerrojo en memoria, el bloqueo LOCK_BACKUP de Postgres (lo
 * comparte la subida al destino externo), para que la copia programada y el botón de otro proceso no se pisen.
 */
export async function createBackup(): Promise<BackupRun> {
  const key = backupKey();
  if (!key) return { at: new Date().toISOString(), ok: false, error: "BACKUP_KEY no está configurada." };
  if (lock.busy) return { at: new Date().toISOString(), ok: false, error: BUSY };
  lock.busy = true;
  try {
    const res = await withAdvisoryLock(LOCK_BACKUP, () => createBackupLocked(key));
    return res.ran ? res.value : { at: new Date().toISOString(), ok: false, error: BUSY };
  } catch (err) {
    // Sin conexión para el bloqueo: la base de datos no contesta, así que la copia tampoco se habría podido hacer.
    const run: BackupRun = { at: new Date().toISOString(), ok: false, error: message(err) };
    logEvent({ level: "error", category: "system", action: "backup.failed", message: `Falló la copia de seguridad: ${run.error}` });
    await updateStatus((s) => ({ ...s, lastBackup: run })).catch((e) => console.error("[backup] no se pudo guardar el estado", e));
    return run;
  } finally {
    lock.busy = false;
  }
}

async function createBackupLocked(key: Buffer): Promise<BackupRun> {
  const started = Date.now();
  const prevStatus = await readStatus();
  let run: BackupRun;
  let health: CopyHealth | null = null;
  let file: string | null = null;
  let dumpTmp: string | null = null;
  try {
    await mkdir(backupsDir(), { recursive: true, mode: 0o700 });
    const name = backupFileName(new Date());
    const stem = name.replace(/\.pzbak$/, "");
    file = path.join(backupsDir(), name);
    // El volcado se escribe como temporal (no cuenta como copia) y solo pasa a llamarse .pzbak justo antes de escribir
    // el manifiesto: si el proceso se para entre medias, no queda una «copia» sin manifiesto que parezca la última.
    // Un temporal abandonado se borra pasadas 24 h (cleanTemp). En una conexión propia, cerrada siempre al terminar.
    const tmpPath = `${file}.${process.pid}.dump.tmp`;
    dumpTmp = tmpPath;
    const { manifest: dbManifest, bytes } = await dumpDatabaseOwnConnection(requireDatabaseUrl(), tmpPath, key);
    const dumpSha = await fileSha256(tmpPath);

    // Ficheros: manifiesto con todos y, en el almacén local, solo los que aún no estaban.
    const files = await collectFiles(key);
    const local = localDestination();
    const manifest = buildManifest({ stem, dbFile: name, dbBytes: bytes, dbSha256: dumpSha, db: dbManifest, files, localFiles: local.files });
    const manifestBytes = await encodeManifest(manifest, key);
    const finalPath = file;
    const sync = await syncBackup(local, manifest, manifestBytes, { size: bytes, open: () => createReadStream(tmpPath), place: () => rename(tmpPath, finalPath) }, { key, uploadRoot: uploadDir() });
    // Resumen en claro junto al fichero (solo cuentas, migración y hashes; sin datos).
    await writeFile(`${file}.json`, JSON.stringify({ ...dbManifest, file: name, bytes, fileSha256: dumpSha }, null, 2));
    // La copia ya está completa. Antes de la retención, la última copia buena (la de antes de perder los datos, si la
    // nueva es casi vacía): la retención nunca la borra.
    // Si no se puede saber cuál es (p. ej. un manifiesto ilegible), esta vez no se aplica la retención.
    const h = await localCopyHealth(local, key, copySummary(manifest), prevStatus).catch((err) => {
      logEvent({ level: "warn", category: "system", action: "backup.pruneFailed", message: `No se aplicó la retención de las copias locales (no se pudo comprobar cuál es la última copia buena): ${message(err)}` });
      return null;
    });
    health = h;
    if (h?.shrink) {
      const sh = h.shrink;
      logEvent({
        level: "warn", category: "system", action: "backup.shrunk",
        message: `La copia ${sh.stem} tiene ${sh.local} ${shrinkWhat(sh.what)} y la última buena (${sh.goodStem}) tiene ${sh.remote}. ¿Se ha perdido la base de datos o el volumen? La retención conserva ${sh.goodStem}.`,
        details: { ...sh },
      });
    }
    // Si la retención falla, se avisa, pero la copia vale.
    const noPrune = { removedBackups: 0, removedObjects: 0, gcSkipped: null, removedTemp: 0 };
    const pruned = !h ? noPrune : await pruneDestination(local, key, { extraKeys: (s) => [`${s}.pzbak.json`], protect: h.good ? [h.good] : [] }).catch((err) => {
      logEvent({ level: "warn", category: "system", action: "backup.pruneFailed", message: `No se aplicó la retención de las copias locales: ${message(err)}` });
      return noPrune;
    });
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
      details: { file: name, bytes, rows: dbManifest.totalRows, tables: dbManifest.tables.length, files: manifest.fileCount, filesBytes: manifest.fileBytes, filesNew: run.filesNew, pruned: pruned.removedBackups, objectsRemoved: pruned.removedObjects, tempRemoved: pruned.removedTemp ?? 0 },
    });
  } catch (err) {
    run = { at: new Date().toISOString(), ok: false, error: message(err), durationMs: Date.now() - started };
    // Un volcado a medias (o sin su manifiesto) no sirve: se borra para no llenar el disco con un reintento por hora.
    const doomed = [dumpTmp, file, file && `${file}.json`, file && path.join(backupsDir(), manifestKey(path.basename(file).replace(/\.pzbak$/, "")))];
    await Promise.all(doomed.filter((f): f is string => !!f).map((f) => rm(f, { force: true }))).catch(() => {});
    logEvent({ level: "error", category: "system", action: "backup.failed", message: `Falló la copia de seguridad: ${run.error}`, durationMs: run.durationMs });
  } finally {
    // Copia nueva (y las viejas podadas): la lista y el aviso de las páginas de administración se vuelven a leer.
    invalidateMemo(BACKUP_MEMO);
  }
  const at = run.at;
  const known = health ? await keepExisting(health.copies) : null;
  await updateStatus((s) => {
    // Solo con una copia correcta cambia el estado de la reducción (una copia fallida no dice nada nuevo).
    if (!health || !known) return { ...s, lastBackup: run };
    // El estado se vuelve a leer aquí: si un administrador confirmó la reducción mientras se hacía esta copia, el aviso
    // se calcula de nuevo desde la copia que aceptó (con el de antes, el aviso ya confirmado volvía una vez).
    const shrink = s.shrinkAccepted === prevStatus.shrinkAccepted
      ? health.shrink
      : lastGoodCopy(Object.entries(known).map(([stem, c]) => ({ stem, ...c })), s.shrinkAccepted).shrink;
    return { ...s, lastBackup: run, copies: known, shrink: shrink ? { ...shrink, at } : undefined };
  }).catch((err) => console.error("[backup] no se pudo guardar el estado", err));
  return run;
}

interface CopyHealth {
  good: string | null;
  shrink: CopyShrink | null;
  /** Resumen de cada copia local con manifiesto (los que faltaban en status.json, leídos de su manifiesto). */
  copies: Record<string, Omit<CopySummary, "stem">>;
}

/**
 * Última copia buena del destino local y si la nueva (`current`) es mucho menor (ver lastGoodCopy). Los resúmenes salen
 * de status.json; los de las copias que no están allí (hechas con versiones anteriores) se leen una vez de su manifiesto.
 * Una copia cuyo manifiesto no se puede leer no cuenta.
 */
async function localCopyHealth(local: DirDestination, key: Buffer, current: CopySummary, status: BackupStatus): Promise<CopyHealth> {
  const copies: Record<string, Omit<CopySummary, "stem">> = {};
  const summaries: CopySummary[] = [];
  for (const s of await listStems(local, { sizes: false })) {
    if (s.partial || !s.hasManifest) continue;
    let sum: CopySummary | null = s.stem === current.stem ? current : status.copies?.[s.stem] ? { stem: s.stem, ...status.copies[s.stem]! } : null;
    if (!sum) sum = await readManifest(local, s.stem, key).then(copySummary, () => null);
    if (!sum) continue;
    const { stem, ...rest } = sum;
    copies[stem] = rest;
    summaries.push(sum);
  }
  const { good, shrink } = lastGoodCopy(summaries, status.shrinkAccepted);
  return { good, shrink, copies };
}

/** Los resúmenes de las copias que siguen existiendo tras la retención. */
async function keepExisting(copies: Record<string, Omit<CopySummary, "stem">>): Promise<Record<string, Omit<CopySummary, "stem">>> {
  const left = new Set((await listStems(localDestination(), { sizes: false }).catch(() => [])).map((s) => s.stem));
  return Object.fromEntries(Object.entries(copies).filter(([stem]) => left.has(stem)));
}

const shrinkWhat = (what: CopyShrink["what"]) => (what === "core" ? "personas, proyectos y tareas" : what === "rows" ? "filas en la base de datos" : "ficheros");

/** Al confirmar la reducción, el aviso que tenía delante el administrador ya no es el vigente. */
const SHRINK_CHANGED_MESSAGE = "Ha llegado una copia nueva: revisa el aviso otra vez.";

/**
 * El administrador confirma que la reducción de la última copia es intencionada (ha borrado datos a propósito): desde esa
 * copia se vuelve a empezar, la anterior deja de conservarse siempre y el aviso desaparece. Devuelve la copia aceptada, o
 * null si no había aviso. `seen`: la copia del aviso que vio (raíz de la reducida y de la buena); si entretanto ha llegado
 * otra, lanza SHRINK_CHANGED_MESSAGE y no confirma nada (se comprueba en la misma escritura del estado, en fila con la
 * de las copias).
 */
export async function acceptBackupShrink(by?: { id: string; name: string }, seen?: { stem: string; goodStem: string }): Promise<string | null> {
  const out: { shrink: NonNullable<BackupStatus["shrink"]> | null; changed: boolean } = { shrink: null, changed: false };
  await updateStatus((s) => {
    if (!s.shrink) return s;
    if (seen && (s.shrink.stem !== seen.stem || s.shrink.goodStem !== seen.goodStem)) {
      out.changed = true;
      return s;
    }
    out.shrink = s.shrink;
    return { ...s, shrink: undefined, shrinkAccepted: s.shrink.stem };
  });
  if (out.changed) {
    // Lo que se ve tras el error debe ser ya el aviso de la copia nueva (sin esperar a que caduque la memoria).
    invalidateMemo(BACKUP_MEMO);
    throw new AppError(SHRINK_CHANGED_MESSAGE);
  }
  const shrink = out.shrink;
  if (!shrink) return null;
  logEvent({
    level: "warn", category: "system", action: "backup.shrinkAccepted",
    message: `Reducción de las copias confirmada como intencionada desde ${shrink.stem}: ${shrink.goodStem} ya no se conserva siempre`,
    userId: by?.id, userName: by?.name, details: { ...shrink },
  });
  return shrink.stem;
}

/** Última copia local completa (con manifiesto): su manifiesto descifrado y sus bytes cifrados. */
async function latestLocalManifest(key: Buffer): Promise<{ manifest: FullManifest; bytes: Buffer } | null> {
  const local = localDestination();
  const latest = (await listStems(local)).find((s) => s.hasManifest);
  if (!latest) return null;
  const bytes = await readFile(path.join(local.root, manifestKey(latest.stem)));
  return { manifest: await decodeManifest(bytes, key), bytes };
}

/** Mensaje del bloqueo por copia mucho menor que la del destino (ver checkShrink). */
function shrinkMessage(p: { what: "core" | "rows" | "files"; local: number; remote: number; stem: string }, stem: string): string {
  const what = shrinkWhat(p.what);
  return `No se sube la copia ${stem}: tiene ${p.local} ${what} y la última del destino (${p.stem}) tiene ${p.remote}. ¿Se ha perdido la base de datos o el volumen? Para no sustituir una copia buena por una casi vacía, no se sube ni se aplica la retención. Restaura la copia buena (node dist/restore.mjs con su nombre; --list las muestra) o, si la reducción es intencionada, pulsa «Copiar ahora a destino externo».`;
}

/**
 * Sube la última copia local a cada destino externo que aún no la tenga (o a todos con `force`), reanudando lo
 * que quedara a medias, y aplica allí la misma retención. Sin `force`, no sube a un destino cuya última copia es
 * mucho mayor (ver checkShrink): es un fallo. Devuelve un resultado por destino; nunca lanza. Con el mismo bloqueo
 * entre procesos que createBackup (LOCK_BACKUP): si otro proceso está copiando o subiendo, no hace nada.
 */
export async function syncExternal(opts: { force?: boolean } = {}): Promise<ExternalRun[]> {
  const key = backupKey();
  const { destinations, errors } = externalDestinations();
  if (!key || (destinations.length === 0 && errors.length === 0)) return [];
  if (errors.length) logEvent({ level: "error", category: "system", action: "backup.externalConfig", message: `Destino externo de copias mal configurado: ${errors.join(" ")}` });
  if (destinations.length === 0) return [];
  if (lock.busy || lock.external) return [];
  lock.external = true;
  try {
    const res = await withAdvisoryLock(LOCK_BACKUP, () => syncExternalLocked(key, destinations, opts));
    if (!res.ran) console.info("[backup] destino externo: otro proceso está copiando; se omite esta pasada");
    return res.ran ? res.value : [];
  } catch (err) {
    logEvent({ level: "error", category: "system", action: "backup.externalFailed", message: `Falló la copia a destino externo: ${message(err)}` });
    return [{ at: new Date().toISOString(), ok: false, label: "externo", error: message(err) }];
  } finally {
    lock.external = false;
  }
}

async function syncExternalLocked(key: Buffer, destinations: BackupDestination[], opts: { force?: boolean }): Promise<ExternalRun[]> {
  const at = () => new Date().toISOString();
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
        let warning: string | undefined;
        // Antes de subir y podar: una copia casi vacía (base de datos o volumen perdidos) no sustituye a la buena.
        if (!opts.force) {
          const shrink = await checkShrink(dest, manifest, key);
          if (shrink.problem) throw new Error(shrinkMessage(shrink.problem, manifest.stem));
          if (shrink.unreadable) warning = `No se pudo comparar con la última copia del destino: ${shrink.unreadable}`;
        }
        const sync = await syncBackup(dest, manifest, bytes, { size: manifest.db.bytes, open: () => createReadStream(dumpFile) }, { key, uploadRoot: uploadDir(), store });
        let pruned = null;
        try {
          pruned = await pruneDestination(dest, key);
          if (pruned.gcSkipped) warning = [warning, `No se limpió el almacén: ${pruned.gcSkipped}`].filter(Boolean).join(" · ");
          if (sync.missing) warning = [warning, `${sync.missing} ficheros ya borrados no se subieron (se borraron después de la copia)`].filter(Boolean).join(" · ");
        } catch (err) {
          warning = `Retención: ${message(err)}`;
        }
        run = { at: at(), ok: true, label: dest.label, file: manifest.stem, uploaded: sync.uploaded, skipped: sync.skipped, bytes: sync.bytes, removedBackups: pruned?.removedBackups, removedObjects: pruned?.removedObjects, durationMs: Date.now() - started, warning };
        logEvent({
          level: warning ? "warn" : "info", category: "system", action: "backup.external",
          message: `Copia subida a ${dest.label}: ${manifest.stem} (${sync.uploaded} ficheros nuevos, ${sync.skipped} ya estaban, ${Math.round(sync.bytes / 1024)} KB)${warning ? `. ${warning}` : ""}`,
          durationMs: run.durationMs, details: { dest: dest.id, file: manifest.stem, uploaded: sync.uploaded, skipped: sync.skipped, bytes: sync.bytes, removedBackups: pruned?.removedBackups ?? null, removedObjects: pruned?.removedObjects ?? null, removedTemp: pruned?.removedTemp ?? null },
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
      let referencesChecked: number | undefined;
      if (migrationsDir && (await canCreateDatabase())) {
        dbManifest = await restoreIntoTemporaryDatabase(latest.file, key, migrationsDir);
        mode = "database";
      } else {
        // Sin base temporal: además de descifrar y contar, comprueba lo que comprobaría PostgreSQL al cargarla, que
        // cada referencia entre filas (claves foráneas del esquema actual) apunta a una fila que está en la copia.
        // Solo si la copia es de la misma migración que la base (mismo esquema).
        const sameSchema = manifest !== null && manifest.migration === (await lastMigration(db));
        const verified = await verifyBackupFile(latest.file, key, { references: sameSchema ? await listForeignKeys(db) : undefined });
        dbManifest = verified.manifest;
        referencesChecked = verified.referencesChecked;
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
      run = { at, ok: true, file: latest.name, bytes: latest.bytes, rows: dbManifest.totalRows, tables: dbManifest.tables.length, files: manifest?.fileCount, filesBytes: manifest?.fileBytes, mode, limit, objectsChecked, objectsSampled, referencesChecked, durationMs: Date.now() - started };
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
    details: { file: run.file ?? null, ok: run.ok, rows: run.rows ?? null, mode: run.mode ?? null, objectsChecked: run.objectsChecked ?? null, referencesChecked: run.referencesChecked ?? null },
  });
  const r = run;
  await updateStatus((s) => ({ ...s, lastRestoreTest: r })).catch((err) => console.error("[backup] no se pudo guardar el estado", err));
  return run;
}

/** Tarea diaria (se llama cada hora): crea la copia si la última correcta tiene más de 23 h o si la última falló. */
export async function dailyBackupJob(now: number = Date.now()): Promise<void> {
  if (!backupKey() || backupPaused()) return;
  const status = await readStatus();
  const last = status.lastBackup?.ok ? Date.parse(status.lastBackup.at) : 0;
  const lastFile = (await latestBackupTime()) ?? 0;
  const failedSince = status.lastBackup?.ok === false && Date.parse(status.lastBackup.at) >= lastFile;
  if (!failedSince && now - Math.max(last, lastFile) < BACKUP_EVERY_MS) return;
  await createBackup();
}

/** Tarea horaria: sube a los destinos externos la última copia si aún no la tienen (o reintenta si falló). Lanza si falla alguno. */
export async function externalBackupJob(): Promise<void> {
  if (backupPaused()) return;
  const runs = await syncExternal();
  const failed = runs.filter((r) => !r.ok);
  if (failed.length) throw new Error(failed.map((r) => `${r.label}: ${r.error}`).join(" · "));
}

/** Tarea mensual (se llama cada hora): prueba de restauración si hace más de 30 días de la última (o nunca). */
export async function monthlyRestoreTestJob(now: number = Date.now()): Promise<void> {
  if (!backupKey() || backupPaused() || (await latestBackupTime()) === null) return;
  const status = await readStatus();
  const last = status.lastRestoreTest ? Date.parse(status.lastRestoreTest.at) : 0;
  // Si la última prueba falló se repite al día siguiente en vez de esperar un mes.
  if (now - last < (status.lastRestoreTest?.ok === false ? DAY_MS : RESTORE_TEST_EVERY_MS)) return;
  await runRestoreTest();
}
