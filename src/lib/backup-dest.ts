// Destinos de las copias: la carpeta local (UPLOAD_DIR/backups), una carpeta montada (BACKUP_EXTERNAL_DIR: disco
// USB, NAS, SFTP montado…) y un almacenamiento S3 compatible (BACKUP_S3_*). Todos con la misma interfaz de claves
// («pizarro-backup-….pzman», «files/ab/<id>»…), así subir, podar y restaurar es el mismo código para los tres.
// Sin dependencias de Next ni de la base de datos.

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { backupStem, parseBackupFileName, selectBackupsToKeep } from "./backup-core";
import { decodeManifest, encryptFileObject, mapLimit, objectKey, objectSize, selectGarbage, uniqueObjects, FILES_PREFIX, type FullManifest, type ManifestFile } from "./backup-files";
import { parseS3Env, S3Client, type UploadBody } from "./backup-s3";

export type DestinationId = "local" | "dir" | "s3";

export interface BackupDestination {
  id: DestinationId;
  /** Descripción sin secretos (para la página de administración y los logs). */
  label: string;
  /** ¿Guarda también los ficheros? (el local puede no hacerlo para no duplicar el volumen). */
  files: boolean;
  put(key: string, body: UploadBody): Promise<void>;
  get(key: string): Promise<AsyncIterable<Buffer>>;
  /** Tamaño, o null si no existe. */
  head(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  /** Con `sizes: false`, una carpeta no mira el tamaño de cada fichero (size 0): basta con los nombres. */
  list(prefix: string, opts?: { sizes?: boolean }): AsyncIterable<{ key: string; size: number }>;
}

// --- Carpeta ------------------------------------------------------------------------------------

function safeKey(key: string): string {
  if (!key || key.startsWith("/") || key.split("/").some((s) => s === "" || s === "." || s === "..")) throw new Error(`Clave de copia inválida: ${key}`);
  return key;
}

/** Antigüedad a partir de la cual un temporal de una carpeta de copias se da por abandonado. */
export const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export class DirDestination implements BackupDestination {
  /**
   * `mustExist`: la carpeta raíz no se crea sola (BACKUP_EXTERNAL_DIR). Si falta (disco sin montar, ruta mal escrita),
   * subir falla con un error claro en vez de crearla y llenar el disco del sistema con lo que debía ir fuera.
   */
  constructor(readonly id: DestinationId, readonly root: string, readonly files: boolean, readonly label = root, readonly mustExist = false) {}

  private file(key: string): string {
    return path.join(this.root, ...safeKey(key).split("/"));
  }

  private async checkRoot(): Promise<void> {
    if (!this.mustExist) return;
    const st = await stat(this.root).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") throw new Error(`La carpeta del destino externo no existe: ${this.root}. Créala o monta el disco; no se crea sola para no dejar las copias en el disco del sistema.`);
      throw err;
    });
    if (!st.isDirectory()) throw new Error(`El destino externo no es una carpeta: ${this.root}.`);
  }

  async put(key: string, body: UploadBody): Promise<void> {
    const file = this.file(key);
    await this.checkRoot();
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      const src = Buffer.isBuffer(body) ? Readable.from([body]) : Readable.from(body.stream());
      await pipeline(src, createWriteStream(tmp, { mode: 0o600 }));
      const size = (await stat(tmp)).size;
      const expected = Buffer.isBuffer(body) ? body.length : body.size;
      if (size !== expected) throw new Error(`Escritura incompleta en ${key} (${size} de ${expected} bytes).`);
      await rename(tmp, file);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async get(key: string): Promise<AsyncIterable<Buffer>> {
    const file = this.file(key);
    await stat(file); // Error claro si no existe, antes de empezar a leer.
    return createReadStream(file);
  }

  async head(key: string): Promise<number | null> {
    try {
      const st = await stat(this.file(key));
      return st.isFile() ? st.size : null;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }

  /**
   * Borra los temporales (*.tmp) de más de `maxAgeMs` que dejó una escritura interrumpida (un reinicio a mitad
   * de un volcado o de una subida), en la raíz y en files/. Una escritura en curso no se toca: su fecha avanza.
   */
  async cleanTemp(maxAgeMs = TEMP_MAX_AGE_MS, now = Date.now()): Promise<number> {
    let removed = 0;
    const walk = async (dir: string, deep: boolean): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (deep) await walk(abs, true);
        } else if (e.isFile() && e.name.endsWith(".tmp")) {
          try {
            if (now - (await stat(abs)).mtimeMs < maxAgeMs) continue;
            await rm(abs, { force: true });
            removed++;
          } catch {
            // Desapareció entre medias.
          }
        }
      }
    };
    await walk(this.root, false);
    await walk(path.join(this.root, FILES_PREFIX.replace(/\/$/, "")), true);
    return removed;
  }

  async *list(prefix: string, opts: { sizes?: boolean } = {}): AsyncGenerator<{ key: string; size: number }> {
    // Solo dos formas de prefijo: "" (la raíz, sin entrar en carpetas) y "files/" (recursivo).
    const sizes = opts.sizes !== false;
    const walk = async function* (dir: string, rel: string, deep: boolean): AsyncGenerator<{ key: string; size: number }> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.endsWith(".tmp")) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (deep) yield* walk(abs, `${rel}${e.name}/`, true);
        } else if (e.isFile()) {
          if (!sizes) {
            yield { key: `${rel}${e.name}`, size: 0 };
            continue;
          }
          try {
            yield { key: `${rel}${e.name}`, size: (await stat(abs)).size };
          } catch {
            // Borrado entre medias.
          }
        }
      }
    };
    if (prefix === "") yield* walk(this.root, "", false);
    else yield* walk(path.join(this.root, ...prefix.replace(/\/$/, "").split("/")), prefix.endsWith("/") ? prefix : `${prefix}/`, true);
  }
}

// --- S3 -----------------------------------------------------------------------------------------

export class S3Destination implements BackupDestination {
  readonly id = "s3" as const;
  readonly files = true;
  constructor(readonly client: S3Client) {}
  get label() {
    return `S3 ${this.client.label}`;
  }
  put(key: string, body: UploadBody) {
    return this.client.put(key, body);
  }
  get(key: string) {
    return this.client.get(key);
  }
  head(key: string) {
    return this.client.head(key);
  }
  delete(key: string) {
    return this.client.delete(key);
  }
  async *list(prefix: string) {
    // Sin prefijo, solo las claves de la raíz (como en la carpeta, con delimitador): los objetos files/… se listan aparte.
    for await (const o of this.client.list(prefix, prefix === "" ? "/" : undefined)) if (prefix !== "" || !o.key.includes("/")) yield o;
  }
}

// --- Configuración ------------------------------------------------------------------------------

export interface ExternalConfig {
  destinations: BackupDestination[];
  /** Problemas de configuración (sin secretos), para mostrarlos en Administración. */
  errors: string[];
}

/** Destinos externos configurados por variables de entorno. */
export function externalDestinations(env: Record<string, string | undefined> = process.env): ExternalConfig {
  const destinations: BackupDestination[] = [];
  const errors: string[] = [];
  const dir = env.BACKUP_EXTERNAL_DIR?.trim();
  if (dir) {
    if (!path.isAbsolute(dir)) errors.push("BACKUP_EXTERNAL_DIR debe ser una ruta absoluta.");
    else destinations.push(new DirDestination("dir", path.resolve(dir), true, `${path.resolve(dir)}`, true));
  }
  const s3 = parseS3Env(env);
  if (s3.error) errors.push(s3.error);
  if (s3.config) destinations.push(new S3Destination(new S3Client(s3.config)));
  return { destinations, errors };
}

/**
 * ¿Guarda también el destino local los ficheros? Con BACKUP_LOCAL_FILES=1/0 lo que diga; sin ella, solo si no hay destino
 * externo (con destino externo, la copia en el mismo volumen ocuparía el doble sin proteger de su pérdida).
 */
export function localFilesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.BACKUP_LOCAL_FILES?.trim() ?? "";
  if (/^(0|false|no|off)$/i.test(v)) return false;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  return externalDestinations(env).destinations.length === 0;
}

// --- Operaciones sobre un destino -------------------------------------------------------------

export const manifestKey = (stem: string) => `${stem}.pzman`;
export const dumpKey = (stem: string) => `${stem}.pzbak`;

export interface StemInfo {
  stem: string;
  hasManifest: boolean;
  dumpBytes: number;
  /**
   * Copia cortada: volcado sin manifiesto, más reciente que alguna copia con manifiesto (el proceso se paró entre el
   * volcado y el manifiesto). No cuenta como copia: ni como la última, ni para la tarea diaria, ni para la retención,
   * que la borra pasadas 24 h. Las copias sin manifiesto anteriores a todas las que lo tienen son de versiones
   * antiguas (solo base de datos) y siguen valiendo.
   */
  partial: boolean;
}

/**
 * Raíces de las copias de un destino (las que tienen volcado), la más reciente primero. Con `sizes: false`, sin mirar el
 * tamaño de cada fichero (dumpBytes 0): para saber cuál es la última o cuántas hay basta con los nombres.
 */
export async function listStems(dest: BackupDestination, opts: { sizes?: boolean } = {}): Promise<StemInfo[]> {
  const byStem = new Map<string, { stem: string; hasManifest: boolean; dumpBytes: number; hasDump: boolean }>();
  for await (const { key, size } of dest.list("", opts)) {
    const stem = backupStem(key);
    if (!stem) continue;
    const row = byStem.get(stem) ?? { stem, hasManifest: false, dumpBytes: 0, hasDump: false };
    if (key.endsWith(".pzman")) row.hasManifest = true;
    if (key.endsWith(".pzbak")) {
      row.hasDump = true;
      row.dumpBytes = size;
    }
    byStem.set(stem, row);
  }
  const rows = [...byStem.values()].filter((r) => r.hasDump).sort((a, b) => b.stem.localeCompare(a.stem));
  const oldestWithManifest = rows.filter((r) => r.hasManifest).at(-1)?.stem;
  return rows.map(({ stem, hasManifest, dumpBytes }) => ({ stem, hasManifest, dumpBytes, partial: !hasManifest && oldestWithManifest !== undefined && stem > oldestWithManifest }));
}

/** Fecha de una copia por su raíz (pizarro-backup-AAAAMMDDTHHMMSSZ). */
export function stemDate(stem: string): Date | null {
  return parseBackupFileName(dumpKey(stem));
}

async function readBuffer(src: AsyncIterable<Buffer>, limit = 512 * 1024 * 1024): Promise<Buffer> {
  const parts: Buffer[] = [];
  let n = 0;
  for await (const c of src) {
    n += c.length;
    if (n > limit) throw new Error("Manifiesto demasiado grande.");
    parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return Buffer.concat(parts);
}

export async function readManifest(dest: BackupDestination, stem: string, key: Buffer): Promise<FullManifest> {
  const m = await decodeManifest(await readBuffer(await dest.get(manifestKey(stem))), key);
  if (m.stem !== stem) throw new Error(`El manifiesto ${stem} dice pertenecer a ${m.stem}.`);
  return m;
}

/** Ids de los objetos que hay en el almacén del destino. */
export async function listObjectKeys(dest: BackupDestination): Promise<Set<string>> {
  const out = new Set<string>();
  for await (const { key } of dest.list(FILES_PREFIX)) out.add(key);
  return out;
}

/** Dónde sacar el contenido cifrado de un objeto: de otro destino que ya lo tenga o cifrando el fichero de UPLOAD_DIR. */
export interface ObjectSources {
  key: Buffer;
  uploadRoot: string;
  /** Destino con los objetos ya cifrados (el local, si guarda ficheros), y las claves que tiene. */
  store?: { dest: BackupDestination; keys: Set<string> };
}

function objectBody(entry: ManifestFile, src: ObjectSources): UploadBody {
  const k = objectKey(entry.o);
  if (src.store?.keys.has(k)) {
    const store = src.store.dest;
    return { size: objectSize(entry.s), stream: () => streamFrom(() => store.get(k)) };
  }
  const file = path.join(src.uploadRoot, ...entry.p.split("/"));
  return { size: objectSize(entry.s), stream: () => encryptFileObject(file, entry, src.key) };
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true, () => false);
}

async function* streamFrom(open: () => Promise<AsyncIterable<Buffer>>): AsyncGenerator<Buffer> {
  for await (const c of await open()) yield c;
}

// --- Copia mucho menor que la del destino ------------------------------------------------------

/** Por debajo de estos tamaños, la copia del destino es tan pequeña que no se compara (instalación recién empezada). */
export const SHRINK_MIN_ROWS = 500;
const SHRINK_MIN_CORE_ROWS = 50;
export const SHRINK_MIN_FILES = 20;

/**
 * Tablas que dicen cuánto contenido hay (personas, proyectos y tareas). El total de filas no sirve: lo inflan los
 * registros, el deshacer, las sesiones y los avisos, que se vacían solos (una limpieza de registros no es una pérdida).
 */
const SHRINK_CORE_TABLES = ["User", "Project", "Task"] as const;

interface ShrinkProblem {
  /** "core": personas, proyectos y tareas; "rows": todas las filas (manifiestos antiguos, sin cuentas por tabla). */
  what: "core" | "rows" | "files";
  local: number;
  remote: number;
}

/** Filas de personas, proyectos y tareas de una copia, o null si su manifiesto es anterior a las cuentas por tabla. */
export function coreRows(db: { counts?: Record<string, number> }): number | null {
  if (!db.counts) return null;
  return SHRINK_CORE_TABLES.reduce((n, t) => n + (db.counts![t] ?? 0), 0);
}

interface ShrinkSide {
  rows: number;
  fileCount: number;
  /** Personas + proyectos + tareas (null o ausente: manifiesto sin cuentas por tabla). */
  core?: number | null;
}

/**
 * ¿Es la copia nueva sospechosamente menor que la última del destino? Menos de la mitad de personas, proyectos y
 * tareas (con al menos SHRINK_MIN_CORE_ROWS en el destino; si alguno de los dos manifiestos no tiene cuentas por tabla,
 * de filas en total con al menos SHRINK_MIN_ROWS) o de ficheros (con al menos SHRINK_MIN_FILES). Pasa al arrancar sobre
 * una base de datos o un volumen nuevos tras perder los datos: subirla y aplicar la retención borraría la copia buena.
 */
export function backupShrink(local: ShrinkSide, remote: ShrinkSide): ShrinkProblem | null {
  if (local.core != null && remote.core != null) {
    if (remote.core >= SHRINK_MIN_CORE_ROWS && local.core < remote.core / 2) return { what: "core", local: local.core, remote: remote.core };
  } else if (remote.rows >= SHRINK_MIN_ROWS && local.rows < remote.rows / 2) return { what: "rows", local: local.rows, remote: remote.rows };
  if (remote.fileCount >= SHRINK_MIN_FILES && local.fileCount < remote.fileCount / 2) return { what: "files", local: local.fileCount, remote: remote.fileCount };
  return null;
}

/**
 * Compara `manifest` con la copia más reciente del destino (si es otra): el problema si es mucho menor, o null. Si el
 * manifiesto del destino no se puede leer, `unreadable` lo explica y no se bloquea (la retención ya protege sus objetos).
 */
export async function checkShrink(dest: BackupDestination, manifest: FullManifest, key: Buffer): Promise<{ problem: (ShrinkProblem & { stem: string }) | null; unreadable?: string }> {
  const latest = (await listStems(dest)).find((s) => s.hasManifest);
  if (!latest || latest.stem === manifest.stem) return { problem: null };
  let remote: FullManifest;
  try {
    remote = await readManifest(dest, latest.stem, key);
  } catch (err) {
    return { problem: null, unreadable: `${latest.stem}: ${err instanceof Error ? err.message : err}` };
  }
  const problem = backupShrink(
    { rows: manifest.db.rows, fileCount: manifest.fileCount, core: coreRows(manifest.db) },
    { rows: remote.db.rows, fileCount: remote.fileCount, core: coreRows(remote.db) },
  );
  return { problem: problem && { ...problem, stem: latest.stem } };
}

// --- Última copia buena (retención local) -----------------------------------------------------

/** Lo que dice cuánto contenido tiene una copia (de su manifiesto); se guarda en status.json para no descifrarlo cada vez. */
export interface CopySummary {
  stem: string;
  rows: number;
  fileCount: number;
  /** Personas + proyectos + tareas (null: manifiesto sin cuentas por tabla). */
  core: number | null;
}

export const copySummary = (m: FullManifest): CopySummary => ({ stem: m.stem, rows: m.db.rows, fileCount: m.fileCount, core: coreRows(m.db) });

/** La copia más reciente es mucho menor que la última buena: qué se redujo y cuánto. */
export interface CopyShrink extends ShrinkProblem {
  /** Copia sospechosa (la más reciente) y la última buena con la que se compara. */
  stem: string;
  goodStem: string;
}

/**
 * Última copia «buena» de un destino: recorriendo las copias de la más antigua a la más reciente, cada una es buena si no
 * es mucho menor que la última buena anterior (el mismo criterio que la subida al destino externo, backupShrink: menos de
 * la mitad de personas, proyectos y tareas, o de ficheros, con mínimos para las instalaciones pequeñas). Las copias
 * anteriores a `accepted` (una reducción que el administrador confirmó como intencionada) no cuentan: desde ella se
 * vuelve a empezar. Devuelve la última buena y, si la más reciente no lo es, en qué se redujo.
 *
 * Tras perder la base de datos o el volumen, las copias nuevas (casi vacías) nunca son buenas, así que la buena sigue
 * siendo la de antes de la pérdida aunque la retención de 14 días ya la hubiera borrado.
 */
export function lastGoodCopy(copies: CopySummary[], accepted?: string | null): { good: string | null; shrink: CopyShrink | null } {
  const ordered = [...copies].filter((c) => !accepted || c.stem >= accepted).sort((a, b) => a.stem.localeCompare(b.stem));
  let good: CopySummary | null = null;
  let shrink: CopyShrink | null = null;
  for (const c of ordered) {
    const problem = good ? backupShrink(c, good) : null;
    if (problem && good) shrink = { ...problem, stem: c.stem, goodStem: good.stem };
    else {
      good = c;
      shrink = null;
    }
  }
  return { good: good?.stem ?? null, shrink };
}

export interface SyncResult {
  /** Ficheros del manifiesto que ya no existían al subirlos (borrados después de la copia). */
  missing?: number;
  uploaded: number;
  skipped: number;
  bytes: number;
}

/**
 * Copia una copia completa a `dest`: primero los objetos que faltan (lista una vez lo que ya hay, así se puede
 * reanudar tras un fallo), después el volcado y, al final, el manifiesto (que es lo que hace «existir» la copia).
 * `dump` abre el .pzbak local; con `place` (el destino local), lo pone en su sitio en vez de copiarlo: el volcado se
 * escribe como temporal y solo pasa a llamarse .pzbak justo antes del manifiesto. Lanza en el primer error, sin subir el
 * manifiesto.
 */
export async function syncBackup(
  dest: BackupDestination,
  manifest: FullManifest,
  manifestBytes: Buffer,
  dump: { size: number; open: () => AsyncIterable<Buffer>; place?: () => Promise<void> },
  src: ObjectSources,
  log: (m: string) => void = () => {},
): Promise<SyncResult> {
  const result: SyncResult = { uploaded: 0, skipped: 0, bytes: 0 };
  if (dest.files) {
    const present = await listObjectKeys(dest);
    const todo = uniqueObjects(manifest.files).filter((entry) => !present.has(objectKey(entry.o)));
    result.skipped = uniqueObjects(manifest.files).length - todo.length;
    // Unas pocas subidas a la vez: con miles de ficheros pequeños manda la latencia, no el ancho de banda.
    await mapLimit(todo, dest.id === "s3" ? 4 : 1, async (entry) => {
      // Fichero borrado de UPLOAD_DIR después de la copia (y sin objeto ya cifrado en el almacén local): se salta
      // con aviso en lugar de hacer fallar toda la subida hasta la copia del día siguiente.
      if (!src.store?.keys.has(objectKey(entry.o)) && !(await exists(path.join(src.uploadRoot, ...entry.p.split("/"))))) {
        result.missing = (result.missing ?? 0) + 1;
        log(`Fichero ya borrado, se omite: ${entry.p}`);
        return;
      }
      const body = objectBody(entry, src);
      await dest.put(objectKey(entry.o), body);
      result.uploaded++;
      result.bytes += Buffer.isBuffer(body) ? body.length : body.size;
      if (result.uploaded % 500 === 0) log(`${result.uploaded} ficheros subidos…`);
    });
  }
  if ((await dest.head(dumpKey(manifest.stem))) !== manifest.db.bytes) {
    if (dump.place) await dump.place();
    else {
      await dest.put(dumpKey(manifest.stem), { size: manifest.db.bytes, stream: dump.open });
      result.bytes += manifest.db.bytes;
    }
  }
  await dest.put(manifestKey(manifest.stem), manifestBytes);
  result.bytes += manifestBytes.length;
  return result;
}

export interface PruneResult {
  /** Copias borradas por la retención (y copias cortadas de más de 24 h). */
  removedBackups: number;
  removedObjects: number;
  /** El almacén no se limpió porque algún manifiesto conservado no se pudo leer (por prudencia). */
  gcSkipped: string | null;
  /** Temporales abandonados borrados (solo en carpetas). */
  removedTemp?: number;
}

/**
 * Retención de un destino: conserva las copias de selectBackupsToKeep (14 diarias, 6 mensuales y las 3 más
 * recientes) y borra las demás; después borra los objetos que no nombra ningún manifiesto conservado. Si algún
 * manifiesto conservado no se puede leer, no se borra ningún objeto (mejor ocupar sitio que perder ficheros). Las copias
 * cortadas (volcado sin manifiesto, ver StemInfo) no cuentan para la retención y se borran pasadas 24 h. En una
 * carpeta, además, borra los temporales de escrituras interrumpidas de más de 24 h.
 *
 * `protect`: raíces que se conservan aunque la retención las borraría (la última copia buena del destino local).
 *
 * En un destino que ya no guarda ficheros (el local al configurar un destino externo, sin BACKUP_LOCAL_FILES=1), solo
 * las copias hechas cuando sí los guardaba retienen objetos: así el almacén antiguo se vacía a medida que la retención
 * borra esas copias, y no de golpe antes de que el destino externo tenga ninguna copia buena.
 */
export async function pruneDestination(dest: BackupDestination, key: Buffer, opts: { daily?: number; monthly?: number; recent?: number; extraKeys?: (stem: string) => string[]; now?: number; protect?: string[] } = {}): Promise<PruneResult> {
  const removedTemp = dest instanceof DirDestination ? await dest.cleanTemp(TEMP_MAX_AGE_MS, opts.now) : undefined;
  const result = await pruneBackups(dest, key, { ...opts, now: opts.now ?? Date.now() });
  return removedTemp === undefined ? result : { ...result, removedTemp };
}

async function pruneBackups(dest: BackupDestination, key: Buffer, opts: { daily?: number; monthly?: number; recent?: number; extraKeys?: (stem: string) => string[]; now: number; protect?: string[] }): Promise<PruneResult> {
  const stems = await listStems(dest);
  const keep = selectBackupsToKeep(stems.filter((s) => !s.partial).map((s) => dumpKey(s.stem)), opts.daily, opts.monthly, opts.recent);
  // Copias que se conservan siempre (la última buena, ver lastGoodCopy), con sus ficheros.
  for (const stem of opts.protect ?? []) if (stems.some((s) => s.stem === stem && !s.partial)) keep.add(dumpKey(stem));
  let removedBackups = 0;
  for (const s of stems) {
    if (s.partial ? opts.now - (stemDate(s.stem)?.getTime() ?? 0) < TEMP_MAX_AGE_MS : keep.has(dumpKey(s.stem))) continue;
    // El manifiesto primero: una copia sin manifiesto ya no retiene objetos.
    for (const k of [manifestKey(s.stem), dumpKey(s.stem), ...(opts.extraKeys?.(s.stem) ?? [])]) await dest.delete(k);
    removedBackups++;
  }
  const kept: { files: { o: string }[] }[] = [];
  for (const s of stems) {
    if (!keep.has(dumpKey(s.stem)) || !s.hasManifest) continue;
    try {
      const m = await readManifest(dest, s.stem, key);
      // Sin ficheros en este destino, las copias hechas así no retienen nada (sus ficheros están en el externo).
      if (dest.files || m.localFiles !== false) kept.push({ files: m.files.map((f) => ({ o: f.o })) });
    } catch (err) {
      return { removedBackups, removedObjects: 0, gcSkipped: `${s.stem}: ${err instanceof Error ? err.message : err}` };
    }
  }
  const garbage = selectGarbage(await listObjectKeys(dest), kept);
  for (const k of garbage) await dest.delete(k);
  return { removedBackups, removedObjects: garbage.length, gcSkipped: null };
}
