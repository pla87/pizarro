import "server-only";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  backupFileName,
  fileSha256,
  parseBackupFileName,
  parseBackupKey,
  selectBackupsToKeep,
  verifyBackupFile,
  type BackupManifest,
} from "./backup-core";
import { dumpDatabase } from "./backup-db";
import { db } from "./db";
import { logEvent } from "./log";
import { backupsDir } from "./upload-dir";

// Copias de seguridad automáticas de la base de datos en UPLOAD_DIR/backups (el volumen de Railway).
// Cifradas con BACKUP_KEY (AES-256-GCM); sin clave, las copias están desactivadas.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Una copia nueva si la última correcta tiene más de 23 h (la tarea corre cada hora). */
const BACKUP_EVERY_MS = 23 * 60 * 60 * 1000;
/** Prueba de restauración mensual. */
const RESTORE_TEST_EVERY_MS = 30 * DAY_MS;
const STATUS_FILE = "status.json";

export interface BackupRun {
  at: string;
  ok: boolean;
  file?: string;
  bytes?: number;
  rows?: number;
  tables?: number;
  durationMs?: number;
  error?: string;
}

export interface BackupStatus {
  lastBackup?: BackupRun;
  lastRestoreTest?: BackupRun;
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

export async function readStatus(): Promise<BackupStatus> {
  try {
    return JSON.parse(await readFile(path.join(backupsDir(), STATUS_FILE), "utf8")) as BackupStatus;
  } catch {
    return {};
  }
}

async function writeStatus(patch: Partial<BackupStatus>): Promise<void> {
  await mkdir(backupsDir(), { recursive: true });
  const next = { ...(await readStatus()), ...patch };
  const file = path.join(backupsDir(), STATUS_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2));
  await rename(tmp, file);
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

// Evita que una copia manual y la programada se pisen.
const lock = (globalThis as unknown as { __pzBackupBusy?: { busy: boolean } }).__pzBackupBusy ??= { busy: false };

/** Borra las copias que ya no toca conservar (14 diarias + 6 mensuales) y sus manifiestos. */
async function prune(): Promise<number> {
  const names = (await listBackups()).map((b) => b.name);
  const keep = selectBackupsToKeep(names);
  let removed = 0;
  for (const name of names) {
    if (keep.has(name)) continue;
    await rm(path.join(backupsDir(), name), { force: true });
    await rm(path.join(backupsDir(), `${name}.json`), { force: true });
    removed++;
  }
  return removed;
}

/** Crea una copia ahora. Devuelve el resultado; nunca lanza (queda en status.json y en los logs). */
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
    const file = path.join(backupsDir(), name);
    const { manifest, bytes } = await dumpDatabase(db, file, key);
    // Manifiesto en claro junto al fichero (solo cuentas, migración y hashes; sin datos).
    const sidecar = { ...manifest, file: name, bytes, fileSha256: await fileSha256(file) };
    await writeFile(`${file}.json`, JSON.stringify(sidecar, null, 2));
    const removed = await prune();
    run = { at: new Date().toISOString(), ok: true, file: name, bytes, rows: manifest.totalRows, tables: manifest.tables.length, durationMs: Date.now() - started };
    logEvent({
      category: "system",
      action: "backup.created",
      message: `Copia de seguridad creada: ${name} (${Math.round(bytes / 1024)} KB, ${manifest.totalRows} filas)`,
      durationMs: run.durationMs,
      details: { file: name, bytes, rows: manifest.totalRows, tables: manifest.tables.length, pruned: removed },
    });
  } catch (err) {
    run = { at: new Date().toISOString(), ok: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started };
    logEvent({ level: "error", category: "system", action: "backup.failed", message: `Falló la copia de seguridad: ${run.error}`, durationMs: run.durationMs });
  } finally {
    lock.busy = false;
  }
  await writeStatus({ lastBackup: run }).catch((err) => console.error("[backup] no se pudo guardar el estado", err));
  return run;
}

/**
 * Prueba de restauración de la copia más reciente: descifra, comprueba el sha256 del fichero y de los datos,
 * que todo se interpreta y que las cuentas por tabla coinciden con el manifiesto. No toca la base de datos.
 */
export async function runRestoreTest(): Promise<BackupRun> {
  const key = backupKey();
  const started = Date.now();
  const at = new Date().toISOString();
  const latest = await latestBackupPath();
  let run: BackupRun;
  if (!key) run = { at, ok: false, error: "BACKUP_KEY no está configurada." };
  else if (!latest) run = { at, ok: false, error: "No hay ninguna copia que probar." };
  else {
    try {
      const { manifest } = await verifyBackupFile(latest.file, key);
      // El manifiesto en claro y el hash del fichero cifrado deben cuadrar con lo descifrado.
      const sidecar = JSON.parse(await readFile(`${latest.file}.json`, "utf8")) as BackupManifest & { fileSha256?: string };
      if (sidecar.sha256 !== manifest.sha256 || sidecar.totalRows !== manifest.totalRows) throw new Error("El manifiesto externo no coincide con el del interior de la copia.");
      if (sidecar.fileSha256 && sidecar.fileSha256 !== (await fileSha256(latest.file))) throw new Error("El sha256 del fichero cifrado no coincide (¿corrupción en el volumen?).");
      run = { at, ok: true, file: latest.name, bytes: latest.bytes, rows: manifest.totalRows, tables: manifest.tables.length, durationMs: Date.now() - started };
    } catch (err) {
      run = { at, ok: false, file: latest.name, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started };
    }
  }
  logEvent({
    level: run.ok ? "info" : "error",
    category: "system",
    action: "backup.restoreTest",
    message: run.ok ? `Prueba de restauración correcta: ${run.file} (${run.rows} filas en ${run.tables} tablas)` : `Prueba de restauración fallida: ${run.error}`,
    durationMs: run.durationMs,
    details: { file: run.file ?? null, ok: run.ok, rows: run.rows ?? null },
  });
  await writeStatus({ lastRestoreTest: run }).catch((err) => console.error("[backup] no se pudo guardar el estado", err));
  return run;
}

/** Tarea diaria (se llama cada hora): crea la copia si la última correcta tiene más de 23 h. */
export async function dailyBackupJob(now: number = Date.now()): Promise<void> {
  if (!backupKey()) return;
  const status = await readStatus();
  const last = status.lastBackup?.ok ? Date.parse(status.lastBackup.at) : 0;
  const [latestFile] = await listBackups();
  const lastFile = latestFile ? Date.parse(latestFile.at) : 0;
  if (now - Math.max(last, lastFile) < BACKUP_EVERY_MS) return;
  await createBackup();
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
