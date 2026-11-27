import "server-only";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { LOCK_BACKUP } from "./advisory-locks";
import { backupFileName, fileSha256, diagnoseBackupKey, parseBackupKey, verifyBackupFile, type BackupManifest } from "./backup-core";
import { listForeignKeys, lastMigration } from "./backup-db";
import {
  checkShrink, copySummary, DirDestination, dumpKey, externalDestinations, lastGoodCopy, localFilesEnabled, listObjectKeys, listStems, manifestKey, pruneDestination, readManifest, stemDate,
  syncBackup, type BackupDestination, type CopyShrink, type CopySummary, type DestinationId, type ExternalConfig, type StemInfo,
} from "./backup-dest";
import { buildManifest, decodeManifest, encodeManifest, fileNameKey, hashFiles, loadHashIndex, saveHashIndex, scanFiles, type FullManifest } from "./backup-files";
import { dumpDatabaseOwnConnection, withDatabase } from "./backup-pg";
import { checkObjects, findMigrationsDir, restoreDatabaseFromDump } from "./backup-restore";
import { db } from "./db";
import { assertDiskRoom, backupMarginBytes, isNoSpaceError, NO_SPACE_MESSAGE, type DiskRoom } from "./disk-space";
import { AppError } from "./errors";
import { withAdvisoryLock, type JobSkip } from "./jobs";
import { logEvent, logText } from "./log";
import { invalidateMemo, memo } from "./memo";
import { backupsDir, uploadDir } from "./upload-dir";
import { logSize } from "./format-size";
import { esText } from "./es-text";

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
  /** Copia fallida por disco lleno: bytes del volcado que se llegaron a escribir (cota inferior para el reintento). */
  partialBytes?: number;
}

export interface RestoreTestRun extends BackupRun {
  /** "database": restaurada de verdad en una base temporal; "verify": solo descifrada y comprobada. */
  mode?: "database" | "verify";
  /** Por qué solo se verificó: el usuario no puede crear bases de datos, no está la carpeta de migraciones, o no hay disco para la base temporal. */
  limit?: "createdb" | "migrations" | "disk";
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
  /** Objetos que la retención debía borrar y el destino no dejó (bloqueo de retención del bucket): siguen allí. */
  retained?: number;
  durationMs?: number;
  error?: string;
  warning?: string;
}

interface ExternalState {
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

/**
 * BACKUP_PAUSE=1: detiene las tareas automáticas de copia (la diaria, la subida al destino externo y la prueba de
 * restauración), p. ej. mientras se restaura tras perder la base de datos o el volumen, para que la primera copia de
 * una base vacía no llegue al destino externo. Los botones de Administración siguen funcionando.
 */
export function backupPaused(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env.BACKUP_PAUSE?.trim() ?? "");
}

function localDestination(): DirDestination {
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

/** Ficheros de UPLOAD_DIR que entran en la copia (solo recorrido y tamaños, sin leerlos). */
function scanBackupFiles() {
  // Exportaciones (pueden pesar GB y caducan en 24 h) e importaciones en curso son temporales: no entran en la copia.
  // Fuera también lo compartido con «Compartir → Pizarro» sin usar (UPLOAD_DIR/shared: temporal, caduca a los 30 minutos).
  const exclude = [backupsDir(), path.join(uploadDir(), "exports"), path.join(uploadDir(), "imports"), path.join(uploadDir(), "shared")];
  const extDir = process.env.BACKUP_EXTERNAL_DIR?.trim();
  if (extDir && path.isAbsolute(extDir)) exclude.push(extDir);
  return scanFiles(uploadDir(), exclude);
}

/**
 * Lista los ficheros de UPLOAD_DIR (sin backups/ ni temporales) con su sha256: solo se leen los nuevos o cambiados
 * (caché por ruta, tamaño y fecha en backups/files-index.json).
 */
async function collectFiles(key: Buffer) {
  const scanned = await scanBackupFiles();
  const indexFile = path.join(backupsDir(), INDEX_FILE);
  const { entries, index } = await hashFiles(scanned, await loadHashIndex(indexFile), fileNameKey(key));
  await saveHashIndex(indexFile, index);
  return entries;
}

/** Holgura sobre el volcado anterior: la base crece entre una copia y la siguiente. */
const DUMP_GROWTH = 1.2;

/**
 * Bytes del volcado que va a escribir la copia, estimados sin escribir nada: el volcado anterior × 1,2. Sin copia
 * anterior, null: no se comprueba de antemano (el tamaño de la base en PostgreSQL suele ser varias veces el volcado y,
 * como nunca bajaría, bloquearía la primera copia para siempre; si el disco se llena al volcar, ENOSPC se traduce y se
 * limpia). Los ficheros no cuentan: «nuevo» según files-index.json no es lo mismo que «falta en el almacén» (tras una
 * restauración o un cp sin conservar las fechas, todos parecen nuevos aunque sus objetos ya estén guardados), y un
 * corte por ENOSPC al guardarlos no repite en el reintento lo ya escrito.
 */
async function estimateDumpBytes(prev: BackupStatus): Promise<number | null> {
  let dump = prev.lastBackup?.ok && prev.lastBackup.bytes ? prev.lastBackup.bytes : 0;
  if (!dump) {
    const [latest] = await localStemsByName();
    if (latest) dump = await stat(path.join(backupsDir(), dumpKey(latest.stem))).then((s) => s.size, () => 0);
  }
  // Sin ninguna copia, pero la anterior se quedó sin disco a mitad: lo que llegó a escribir es una cota inferior. Así el
  // reintento de cada hora no vuelve a llenar el disco hasta ENOSPC (y a tumbar las subidas) mientras no haya sitio.
  if (!dump && prev.lastBackup && !prev.lastBackup.ok && prev.lastBackup.partialBytes) dump = prev.lastBackup.partialBytes;
  return dump ? Math.ceil(dump * DUMP_GROWTH) : null;
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
    logEvent({ level: "error", category: "system", action: "backup.failed", label: { k: "Falló la copia de seguridad: {error}", p: { error: logText(run.error ?? "") } } });
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
    // Antes de escribir nada: si no cabe el volcado estimado (más el margen de la copia, 100 MB: backupMarginBytes), falla
    // con «disco lleno» sin empezar. La tarea lo reintenta cada hora (ver dailyBackupJob); cada intento solo mira el disco.
    const estimate = await estimateDumpBytes(prevStatus);
    if (estimate !== null) {
      await assertDiskRoom(backupsDir(), estimate, undefined, undefined, undefined, () => backupMarginBytes()).catch((err) => {
        throw Object.assign(err as Error, { estimate });
      });
    }
    const name = await freshBackupName();
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
      logEvent({ level: "warn", category: "system", action: "backup.pruneFailed", label: { k: "No se aplicó la retención de las copias locales (no se pudo comprobar cuál es la última copia buena): {error}", p: { error: logText(message(err)) } } });
      return null;
    });
    health = h;
    if (h?.shrink) {
      const sh = h.shrink;
      logEvent({
        level: "warn", category: "system", action: "backup.shrunk",
        label: {
          k: "La copia {stem} tiene {local} {what} y la última buena ({good}) tiene {remote}. ¿Se ha perdido la base de datos o el volumen? La retención conserva {good}.",
          p: { stem: sh.stem, local: sh.local, what: logText(shrinkWhat(sh.what)), good: sh.goodStem, remote: sh.remote },
        },
        details: { ...sh },
      });
    }
    // Si la retención falla, se avisa, pero la copia vale.
    const noPrune = { removedBackups: 0, removedObjects: 0, gcSkipped: null, removedTemp: 0 };
    const pruned = !h ? noPrune : await pruneDestination(local, key, { extraKeys: (s) => [`${s}.pzbak.json`], protect: h.good ? [h.good] : [] }).catch((err) => {
      logEvent({ level: "warn", category: "system", action: "backup.pruneFailed", label: { k: "No se aplicó la retención de las copias locales: {error}", p: { error: logText(message(err)) } } });
      return noPrune;
    });
    if (pruned.gcSkipped) logEvent({ level: "warn", category: "system", action: "backup.gcSkipped", label: { k: "No se limpió el almacén de ficheros local: {reason}", p: { reason: pruned.gcSkipped } } });
    run = {
      at: new Date().toISOString(), ok: true, file: name, bytes, rows: dbManifest.totalRows, tables: dbManifest.tables.length,
      files: manifest.fileCount, filesBytes: manifest.fileBytes, filesNew: local.files ? sync.uploaded : 0, durationMs: Date.now() - started,
    };
    logEvent({
      category: "system",
      action: "backup.created",
      label: { k: "Copia de seguridad creada: {file} ({size}, {rows} filas, {files} ficheros)", p: { file: name, size: logSize(bytes), rows: dbManifest.totalRows, files: manifest.fileCount } },
      durationMs: run.durationMs,
      details: { file: name, bytes, rows: dbManifest.totalRows, tables: dbManifest.tables.length, files: manifest.fileCount, filesBytes: manifest.fileBytes, filesNew: run.filesNew, pruned: pruned.removedBackups, objectsRemoved: pruned.removedObjects, tempRemoved: pruned.removedTemp ?? 0 },
    });
  } catch (err) {
    // Disco lleno al volcar o al guardar los ficheros: el mensaje de la app, no el de Node («ENOSPC: no space left…»).
    const noSpace = isNoSpaceError(err);
    const partialBytes = noSpace && dumpTmp ? await stat(dumpTmp).then((s) => s.size, () => 0) : 0;
    run = { at: new Date().toISOString(), ok: false, error: noSpace ? NO_SPACE_MESSAGE : message(err), durationMs: Date.now() - started, ...(partialBytes ? { partialBytes } : {}) };
    // Un volcado a medias (o sin su manifiesto) no sirve: se borra para no llenar el disco con un reintento por hora.
    const doomed = [dumpTmp, file, file && `${file}.json`, file && path.join(backupsDir(), manifestKey(path.basename(file).replace(/\.pzbak$/, "")))];
    await Promise.all(doomed.filter((f): f is string => !!f).map((f) => rm(f, { force: true }))).catch(() => {});
    const { estimate, room } = err as { estimate?: number; room?: DiskRoom };
    logEvent({
      level: "error", category: "system", action: "backup.failed",
      label: estimate !== undefined && room
        ? {
            k: "Falló la copia de seguridad: {error} (se estiman {dump} para el volcado de la base de datos; hay {free} libres y se exige dejar un margen de {margin}, que fija DISK_MIN_FREE_MB; no se ha escrito nada)",
            p: { error: logText(run.error ?? ""), dump: logSize(estimate), free: logSize(room.free), margin: logSize(room.margin) },
          }
        : { k: "Falló la copia de seguridad: {error}", p: { error: logText(run.error ?? "") } },
      durationMs: run.durationMs,
      ...(estimate !== undefined && room ? { details: { estimatedDumpBytes: estimate, freeBytes: room.free, marginBytes: room.margin } } : {}),
    });
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

/**
 * Nombre de la copia nueva (por la hora, al segundo) que no use ya otra: dos copias en el mismo segundo (una base pequeña,
 * «Crear copia ahora» justo después de la programada) compartirían raíz y la segunda pisaría el volcado de la primera, que
 * quizá ya está en el destino externo; con un bloqueo de retención en el bucket, sobrescribirlo falla. Se usa el segundo
 * siguiente libre.
 */
async function freshBackupName(): Promise<string> {
  const taken = (n: string) => Promise.all([n, manifestKey(n.replace(/\.pzbak$/, ""))].map((f) => stat(path.join(backupsDir(), f)).then(() => true, () => false))).then((r) => r.some(Boolean));
  let at = new Date();
  while (await taken(backupFileName(at))) at = new Date(at.getTime() + 1000);
  return backupFileName(at);
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
    label: { k: "Reducción de las copias confirmada como intencionada desde {stem}: {good} ya no se conserva siempre", p: { stem: shrink.stem, good: shrink.goodStem } },
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
  return esText("No se sube la copia {stem}: tiene {local} {what} y la última del destino ({good}) tiene {remote}. ¿Se ha perdido la base de datos o el volumen? Para no sustituir una copia buena por una casi vacía, no se sube ni se aplica la retención. Restaura la copia buena (node dist/restore.mjs con su nombre; --list las muestra) o, si la reducción es intencionada, pulsa «Copiar ahora a destino externo».", { stem, local: p.local, what, good: p.stem, remote: p.remote });
}

const externalConfigMessage = (errors: string[]) => esText("Destino externo de copias mal configurado: {errors}", { errors: errors.join(" ") });

/**
 * Sube la última copia local a cada destino externo que aún no la tenga (o a todos con `force`), reanudando lo
 * que quedara a medias, y aplica allí la misma retención. Sin `force`, no sube a un destino cuya última copia es
 * mucho mayor (ver checkShrink): es un fallo. Devuelve un resultado por destino; nunca lanza. Con el mismo bloqueo
 * entre procesos que createBackup (LOCK_BACKUP): si otro proceso está copiando o subiendo, no hace nada.
 */
export async function syncExternal(opts: { force?: boolean; config?: ExternalConfig } = {}): Promise<ExternalRun[]> {
  const key = backupKey();
  const { destinations, errors } = opts.config ?? externalDestinations();
  if (!key || (destinations.length === 0 && errors.length === 0)) return [];
  if (errors.length) logEvent({ level: "error", category: "system", action: "backup.externalConfig", label: { k: "Destino externo de copias mal configurado: {errors}", p: { errors: errors.join(" ") } } });
  if (destinations.length === 0) return [];
  if (lock.busy || lock.external) return [];
  lock.external = true;
  try {
    // Sin nada que subir no se abre la conexión del bloqueo (23 de cada 24 pasadas).
    if (!opts.force && (await nothingToUpload(destinations))) return [];
    const res = await withAdvisoryLock(LOCK_BACKUP, () => syncExternalLocked(key, destinations, opts));
    if (!res.ran) console.info("[backup] destino externo: otro proceso está copiando; se omite esta pasada");
    return res.ran ? res.value : [];
  } catch (err) {
    logEvent({ level: "error", category: "system", action: "backup.externalFailed", label: { k: "Falló la copia a destino externo: {error}", p: { error: logText(message(err)) } } });
    return [{ at: new Date().toISOString(), ok: false, label: "externo", error: message(err) }];
  } finally {
    lock.external = false;
  }
}

/**
 * ¿Todos los destinos tienen ya subida la última copia local (o no hay ninguna)? Solo lee el almacén local y el estado:
 * syncExternal lo mira antes de abrir la conexión del bloqueo (lo normal en cada pasada horaria) y otra vez dentro.
 */
async function nothingToUpload(destinations: BackupDestination[]): Promise<boolean> {
  const stem = (await listStems(localDestination(), { sizes: false })).find((s) => s.hasManifest)?.stem;
  if (!stem) return true;
  const status = await readStatus();
  return destinations.every((d) => {
    const prev = status.external?.[d.id];
    return prev?.lastOkFile === stem && prev.last?.ok === true;
  });
}

async function syncExternalLocked(key: Buffer, destinations: BackupDestination[], opts: { force?: boolean }): Promise<ExternalRun[]> {
  const at = () => new Date().toISOString();
  const runs: ExternalRun[] = [];
  try {
    // Sin `force`, si todos los destinos ya tienen subida la última copia local (lo normal en cada pasada), no hay nada
    // que hacer: se sale sin descifrar el manifiesto ni listar el almacén local (mismo criterio que el bucle de abajo).
    if (!opts.force && (await nothingToUpload(destinations))) return [];
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
          if (shrink.unreadable) warning = esText("No se pudo comparar con la última copia del destino: {error}", { error: shrink.unreadable });
        }
        const sync = await syncBackup(dest, manifest, bytes, { size: manifest.db.bytes, open: () => createReadStream(dumpFile) }, { key, uploadRoot: uploadDir(), store });
        let pruned = null;
        try {
          pruned = await pruneDestination(dest, key);
          if (pruned.gcSkipped) warning = [warning, esText("No se limpió el almacén: {error}", { error: pruned.gcSkipped })].filter(Boolean).join(" · ");
          if (sync.missing) warning = [warning, esText("{n} ficheros ya borrados no se subieron (se borraron después de la copia)", { n: sync.missing })].filter(Boolean).join(" · ");
        } catch (err) {
          warning = esText("Retención: {error}", { error: message(err) });
        }
        run = { at: at(), ok: true, label: dest.label, file: manifest.stem, uploaded: sync.uploaded, skipped: sync.skipped, bytes: sync.bytes, removedBackups: pruned?.removedBackups, removedObjects: pruned?.removedObjects, ...(pruned?.retained ? { retained: pruned.retained } : {}), durationMs: Date.now() - started, warning };
        logEvent({
          level: warning ? "warn" : "info", category: "system", action: "backup.external",
          label: {
            k: pruned?.retained
              ? warning
                ? "Copia subida a {dest}: {file} ({uploaded} ficheros nuevos, {skipped} ya estaban, {size}). {retained} objetos retenidos por el bloqueo del bucket (se borrarán cuando venza). {warning}"
                : "Copia subida a {dest}: {file} ({uploaded} ficheros nuevos, {skipped} ya estaban, {size}). {retained} objetos retenidos por el bloqueo del bucket (se borrarán cuando venza)"
              : warning
                ? "Copia subida a {dest}: {file} ({uploaded} ficheros nuevos, {skipped} ya estaban, {size}). {warning}"
                : "Copia subida a {dest}: {file} ({uploaded} ficheros nuevos, {skipped} ya estaban, {size})",
            p: { dest: dest.label, file: manifest.stem, uploaded: sync.uploaded, skipped: sync.skipped, size: logSize(sync.bytes), retained: pruned?.retained ?? 0, warning: logText(warning ?? "") },
          },
          durationMs: run.durationMs, details: { dest: dest.id, file: manifest.stem, uploaded: sync.uploaded, skipped: sync.skipped, bytes: sync.bytes, removedBackups: pruned?.removedBackups ?? null, removedObjects: pruned?.removedObjects ?? null, removedTemp: pruned?.removedTemp ?? null, retained: pruned?.retained ?? 0 },
        });
      } catch (err) {
        run = { at: at(), ok: false, label: dest.label, file: manifest.stem, durationMs: Date.now() - started, error: message(err) };
        logEvent({ level: "error", category: "system", action: "backup.externalFailed", label: { k: "Falló la copia a {dest}: {error}", p: { dest: dest.label, error: logText(run.error ?? "") } }, durationMs: run.durationMs, details: { dest: dest.id, file: manifest.stem } });
      }
      runs.push(run);
      const r = run;
      await updateStatus((s) => ({
        ...s,
        external: { ...s.external, [dest.id]: { ...s.external?.[dest.id], last: r, ...(r.ok ? { lastOkAt: r.at, lastOkFile: r.file } : {}) } },
      })).catch((err) => console.error("[backup] no se pudo guardar el estado", err));
    }
  } catch (err) {
    logEvent({ level: "error", category: "system", action: "backup.externalFailed", label: { k: "Falló la copia a destino externo: {error}", p: { error: logText(message(err)) } } });
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

/**
 * ¿Hay disco para restaurar entera la base en una temporal? Necesita su tamaño ×1,2 libre. Se mide en el volumen de las
 * copias (backupsDir()): con el PostgreSQL en la misma máquina o volumen es el mismo disco. Con la base en otro servidor
 * (p. ej. Railway, donde el disco de PostgreSQL no es el de Pizarro) no es una medida exacta; en ese caso, si no cabe,
 * la prueba pasa al modo «verify» (que no escribe nada en la base) en vez de arriesgar llenar el disco de la base.
 */
async function roomForTemporaryDatabase(): Promise<boolean> {
  try {
    const rows = await db.$queryRawUnsafe<{ bytes: bigint | number }[]>("SELECT pg_database_size(current_database()) AS bytes");
    const size = Number(rows[0]?.bytes ?? 0);
    await assertDiskRoom(backupsDir(), Math.ceil(size * 1.2));
    return true;
  } catch (err) {
    return !(err instanceof AppError && err.code === "disk_full");
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
      const canRestore = migrationsDir && (await canCreateDatabase());
      const diskRoom = canRestore ? await roomForTemporaryDatabase() : true;
      if (canRestore && diskRoom) {
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
        limit = !migrationsDir ? "migrations" : canRestore ? "disk" : "createdb";
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
        if (check.missing > 0) throw new Error(esText("Faltan {missing} de {objects} ficheros en {dest} (copia {stem}).", { missing: check.missing, objects: check.objects, dest: dest.label, stem: last.stem }));
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
    label: run.ok
      ? {
          k: run.mode === "database"
            ? "Prueba de restauración correcta (restaurada en una base temporal): {file} ({rows} filas en {tables} tablas, {objects} ficheros comprobados)"
            : "Prueba de restauración correcta: {file} ({rows} filas en {tables} tablas, {objects} ficheros comprobados)",
          p: { file: String(run.file), rows: String(run.rows), tables: String(run.tables), objects: run.objectsChecked ?? 0 },
        }
      : { k: "Prueba de restauración fallida: {error}", p: { error: logText(String(run.error)) } },
    durationMs: run.durationMs,
    details: { file: run.file ?? null, ok: run.ok, rows: run.rows ?? null, mode: run.mode ?? null, objectsChecked: run.objectsChecked ?? null, referencesChecked: run.referencesChecked ?? null },
  });
  const r = run;
  await updateStatus((s) => ({ ...s, lastRestoreTest: r })).catch((err) => console.error("[backup] no se pudo guardar el estado", err));
  return run;
}

/** Tarea diaria (se llama cada hora): crea la copia si la última correcta tiene más de 23 h o si la última falló. */
export async function dailyBackupJob(now: number = Date.now()): Promise<JobSkip | void> {
  if (!backupKey()) return { skipped: "noKey" };
  if (backupPaused()) return { skipped: "paused" };
  const status = await readStatus();
  const last = status.lastBackup?.ok ? Date.parse(status.lastBackup.at) : 0;
  const lastFile = (await latestBackupTime()) ?? 0;
  const failedSince = status.lastBackup?.ok === false && Date.parse(status.lastBackup.at) >= lastFile;
  // La pasada es cada hora: casi siempre ya hay copia de las últimas 23 h y no hay nada que hacer (se dice así en
  // Tareas de mantenimiento, en vez de un «Correcta» con una hora que no es la de la última copia).
  if (!failedSince && now - Math.max(last, lastFile) < BACKUP_EVERY_MS) return { skipped: "alreadyToday" };
  // createBackup no lanza: el fallo se pasa a la tarea para que conste en Tareas de mantenimiento (JobRun). Que otra copia
  // esté en curso (el botón, otro proceso) no es un fallo de la tarea.
  const run = await createBackup();
  if (!run.ok && run.error !== BUSY) throw new Error(run.error ?? "Error");
}

/**
 * Tarea horaria: sube a los destinos externos la última copia si aún no la tienen (o reintenta si falló). Lanza si
 * falla alguno, y también si el destino está mal configurado y no queda ninguno válido: no se ha copiado nada fuera,
 * así que en Tareas de mantenimiento sale «Con error» con el motivo, no «Correcta».
 */
export async function externalBackupJob(): Promise<JobSkip | void> {
  if (!backupKey()) return { skipped: "noKey" };
  if (backupPaused()) return { skipped: "paused" };
  const config = externalDestinations();
  const { destinations, errors } = config;
  if (destinations.length === 0 && errors.length === 0) return { skipped: "noDestination" };
  const runs = await syncExternal({ config });
  if (destinations.length === 0) throw new Error(externalConfigMessage(errors));
  const failed = runs.filter((r) => !r.ok);
  if (failed.length) throw new Error(failed.map((r) => `${r.label}: ${r.error}`).join(" · "));
}

/** Tarea mensual (se llama cada hora): prueba de restauración si hace más de 30 días de la última (o nunca). */
export async function monthlyRestoreTestJob(now: number = Date.now()): Promise<JobSkip | void> {
  if (!backupKey()) return { skipped: "noKey" };
  if (backupPaused()) return { skipped: "paused" };
  if ((await latestBackupTime()) === null) return { skipped: "noBackup" };
  const status = await readStatus();
  const last = status.lastRestoreTest ? Date.parse(status.lastRestoreTest.at) : 0;
  // Si la última prueba falló se repite al día siguiente en vez de esperar un mes.
  const failed = status.lastRestoreTest?.ok === false;
  if (now - last < (failed ? DAY_MS : RESTORE_TEST_EVERY_MS)) return { skipped: failed ? "retryTomorrow" : "notThisMonth" };
  // runRestoreTest no lanza: el fallo se pasa a la tarea (JobRun), como en la copia diaria.
  const run = await runRestoreTest();
  if (!run.ok) throw new Error(run.error ?? "Error");
}
