// Destinos de las copias: la carpeta local (UPLOAD_DIR/backups), una carpeta montada (BACKUP_EXTERNAL_DIR: disco
// USB, NAS, SFTP montado…) y un almacenamiento S3 compatible (BACKUP_S3_*). Todos con la misma interfaz de claves
// («pizarro-backup-….pzman», «files/ab/<id>»…), así subir, podar y restaurar es el mismo código para los tres.
// Sin dependencias de Next ni de la base de datos.

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { backupStem, selectBackupsToKeep } from "./backup-core";
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
  list(prefix: string): AsyncIterable<{ key: string; size: number }>;
}

// --- Carpeta ------------------------------------------------------------------------------------

function safeKey(key: string): string {
  if (!key || key.startsWith("/") || key.split("/").some((s) => s === "" || s === "." || s === "..")) throw new Error(`Clave de copia inválida: ${key}`);
  return key;
}

export class DirDestination implements BackupDestination {
  constructor(readonly id: DestinationId, readonly root: string, readonly files: boolean, readonly label = root) {}

  private file(key: string): string {
    return path.join(this.root, ...safeKey(key).split("/"));
  }

  async put(key: string, body: UploadBody): Promise<void> {
    const file = this.file(key);
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

  async *list(prefix: string): AsyncGenerator<{ key: string; size: number }> {
    // Solo dos formas de prefijo: "" (la raíz, sin entrar en carpetas) y "files/" (recursivo).
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
    else destinations.push(new DirDestination("dir", path.resolve(dir), true, `${path.resolve(dir)}`));
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

/** Raíces de las copias de un destino (las que tienen volcado), la más reciente primero. */
export async function listStems(dest: BackupDestination): Promise<{ stem: string; hasManifest: boolean; dumpBytes: number }[]> {
  const byStem = new Map<string, { stem: string; hasManifest: boolean; dumpBytes: number; hasDump: boolean }>();
  for await (const { key, size } of dest.list("")) {
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
  return [...byStem.values()].filter((r) => r.hasDump).map(({ stem, hasManifest, dumpBytes }) => ({ stem, hasManifest, dumpBytes })).sort((a, b) => b.stem.localeCompare(a.stem));
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

async function* streamFrom(open: () => Promise<AsyncIterable<Buffer>>): AsyncGenerator<Buffer> {
  for await (const c of await open()) yield c;
}

export interface SyncResult {
  uploaded: number;
  skipped: number;
  bytes: number;
}

/**
 * Copia una copia completa a `dest`: primero los objetos que faltan (lista una vez lo que ya hay, así se puede
 * reanudar tras un fallo), después el volcado y, al final, el manifiesto (que es lo que hace «existir» la copia).
 * `dump` abre el .pzbak local. Lanza en el primer error, sin subir el manifiesto.
 */
export async function syncBackup(
  dest: BackupDestination,
  manifest: FullManifest,
  manifestBytes: Buffer,
  dump: { size: number; open: () => AsyncIterable<Buffer> },
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
      const body = objectBody(entry, src);
      await dest.put(objectKey(entry.o), body);
      result.uploaded++;
      result.bytes += Buffer.isBuffer(body) ? body.length : body.size;
      if (result.uploaded % 500 === 0) log(`${result.uploaded} ficheros subidos…`);
    });
  }
  if ((await dest.head(dumpKey(manifest.stem))) !== manifest.db.bytes) {
    await dest.put(dumpKey(manifest.stem), { size: manifest.db.bytes, stream: dump.open });
    result.bytes += manifest.db.bytes;
  }
  await dest.put(manifestKey(manifest.stem), manifestBytes);
  result.bytes += manifestBytes.length;
  return result;
}

export interface PruneResult {
  removedBackups: number;
  removedObjects: number;
  /** El almacén no se limpió porque algún manifiesto conservado no se pudo leer (por prudencia). */
  gcSkipped: string | null;
}

/**
 * Retención de un destino: conserva las copias de selectBackupsToKeep (14 diarias y 6 mensuales) y borra las
 * demás; después borra los objetos que no nombra ningún manifiesto conservado. Si algún manifiesto conservado no se
 * puede leer, no se borra ningún objeto (mejor ocupar sitio que perder ficheros).
 */
export async function pruneDestination(dest: BackupDestination, key: Buffer, opts: { daily?: number; monthly?: number; extraKeys?: (stem: string) => string[] } = {}): Promise<PruneResult> {
  const stems = await listStems(dest);
  const keep = selectBackupsToKeep(stems.map((s) => dumpKey(s.stem)), opts.daily, opts.monthly);
  let removedBackups = 0;
  for (const s of stems) {
    if (keep.has(dumpKey(s.stem))) continue;
    // El manifiesto primero: una copia sin manifiesto ya no retiene objetos.
    for (const k of [manifestKey(s.stem), dumpKey(s.stem), ...(opts.extraKeys?.(s.stem) ?? [])]) await dest.delete(k);
    removedBackups++;
  }
  if (!dest.files) {
    // Destino sin ficheros (BACKUP_LOCAL_FILES=0): lo que quedara de antes en su almacén ya no hace falta.
    const all = [...(await listObjectKeys(dest))];
    for (const k of all) await dest.delete(k);
    return { removedBackups, removedObjects: all.length, gcSkipped: null };
  }
  const kept: { files: { o: string }[] }[] = [];
  for (const s of stems) {
    if (!keep.has(dumpKey(s.stem)) || !s.hasManifest) continue;
    try {
      kept.push({ files: (await readManifest(dest, s.stem, key)).files.map((f) => ({ o: f.o })) });
    } catch (err) {
      return { removedBackups, removedObjects: 0, gcSkipped: `${s.stem}: ${err instanceof Error ? err.message : err}` };
    }
  }
  const garbage = selectGarbage(await listObjectKeys(dest), kept);
  for (const k of garbage) await dest.delete(k);
  return { removedBackups, removedObjects: garbage.length, gcSkipped: null };
}
