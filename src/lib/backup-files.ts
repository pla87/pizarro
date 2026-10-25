// Ficheros en las copias de seguridad: manifiesto cifrado por copia y almacén de ficheros incremental.
// Sin dependencias de Next ni de la base de datos (lo usan la app, la herramienta de restauración y los tests).
//
// Cada copia es un trío con la misma raíz «pizarro-backup-AAAAMMDDTHHMMSSZ»:
//   .pzbak       volcado de la base de datos (formato de backup-core.ts, sin cambios)
//   .pzbak.json  resumen en claro del volcado (solo en el destino local)
//   .pzman       manifiesto: "PZMF1\n" · IV · AES-256-GCM(gzip(JSON)) · etiqueta. Qué volcado y qué ficheros forman la copia.
// Los ficheros de UPLOAD_DIR (adjuntos, miniaturas, copias de releases, documentos…) van a un almacén común
// «files/<aa>/<id>», cada uno cifrado por separado ("PZFO1\n" · IV · AES-256-GCM(contenido) · etiqueta).
// El id es un HMAC del sha256 del contenido con una subclave de BACKUP_KEY: un fichero igual se sube una sola vez
// y, sin la clave, el nombre no revela nada del contenido. La retención borra las copias viejas y después los
// objetos del almacén que ya no nombra ningún manifiesto conservado.

import { createHash, createHmac, hkdfSync } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { decryptChunks, encryptChunks, encryptionOverhead, fileSha256, type BackupManifest } from "./backup-core";

export const MANIFEST_VERSION = 1;
export const MANIFEST_MAGIC = Buffer.from("PZMF1\n", "utf8");
export const OBJECT_MAGIC = Buffer.from("PZFO1\n", "utf8");
export const FILES_PREFIX = "files/";

/** Un fichero de la copia: ruta relativa a UPLOAD_DIR (con «/»), tamaño, sha256 del contenido e id del objeto. */
export interface ManifestFile {
  p: string;
  s: number;
  h: string;
  o: string;
}

export interface FullManifest {
  version: number;
  kind: "pizarro-backup";
  /** Raíz de los nombres de la copia (pizarro-backup-AAAAMMDDTHHMMSSZ). */
  stem: string;
  createdAt: string;
  migration: string | null;
  build: string | null;
  db: { file: string; bytes: number; sha256: string; rows: number; tables: number; dataSha256: string };
  files: ManifestFile[];
  fileCount: number;
  fileBytes: number;
}

// --- Manifiesto --------------------------------------------------------------------------------

async function collect(chunks: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of chunks) parts.push(c);
  return Buffer.concat(parts);
}

async function* once(buf: Buffer): AsyncGenerator<Buffer> {
  yield buf;
}

export function buildManifest(opts: { stem: string; dbFile: string; dbBytes: number; dbSha256: string; db: BackupManifest; files: ManifestFile[] }): FullManifest {
  return {
    version: MANIFEST_VERSION,
    kind: "pizarro-backup",
    stem: opts.stem,
    createdAt: opts.db.createdAt,
    migration: opts.db.migration,
    build: opts.db.build,
    db: { file: opts.dbFile, bytes: opts.dbBytes, sha256: opts.dbSha256, rows: opts.db.totalRows, tables: opts.db.tables.length, dataSha256: opts.db.sha256 },
    files: opts.files,
    fileCount: opts.files.length,
    fileBytes: opts.files.reduce((n, f) => n + f.s, 0),
  };
}

/** Manifiesto → bytes cifrados (.pzman). */
export async function encodeManifest(m: FullManifest, key: Buffer): Promise<Buffer> {
  return collect(encryptChunks(once(gzipSync(Buffer.from(JSON.stringify(m), "utf8"))), key, MANIFEST_MAGIC));
}

/** Bytes cifrados (.pzman) → manifiesto validado. Lanza si la clave no es la buena, si está alterado o si no cuadra. */
export async function decodeManifest(buf: Buffer, key: Buffer): Promise<FullManifest> {
  let plain: Buffer;
  try {
    plain = gunzipSync(await collect(decryptChunks(once(buf), key, MANIFEST_MAGIC)));
  } catch (err) {
    throw new Error(`No se pudo descifrar el manifiesto (¿BACKUP_KEY distinta o fichero dañado?): ${err instanceof Error ? err.message : err}`);
  }
  const m = JSON.parse(plain.toString("utf8")) as FullManifest;
  if (m.kind !== "pizarro-backup" || m.version !== MANIFEST_VERSION) throw new Error(`Manifiesto de versión no soportada: ${m.version}.`);
  if (!Array.isArray(m.files) || m.files.length !== m.fileCount) throw new Error("El manifiesto no cuadra (número de ficheros).");
  for (const f of m.files) {
    if (!safeRelPath(f.p) || !/^[0-9a-f]{64}$/.test(f.h) || !/^[0-9a-f]{64}$/.test(f.o) || !Number.isSafeInteger(f.s) || f.s < 0) throw new Error("El manifiesto tiene una entrada de fichero inválida.");
  }
  return m;
}

// --- Objetos del almacén ----------------------------------------------------------------------

/** Subclave para nombrar los objetos (no se usa para cifrar). */
export function fileNameKey(key: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), "pizarro-backup-files", 32));
}

/** Id del objeto de un contenido (sha256 en hex). */
export function objectId(nameKey: Buffer, sha256: string): string {
  return createHmac("sha256", nameKey).update(sha256).digest("hex");
}

/** Clave del objeto en el destino: files/<2 primeros>/<id>. */
export function objectKey(id: string): string {
  return `${FILES_PREFIX}${id.slice(0, 2)}/${id}`;
}

/** Id del objeto a partir de su clave, o null si la clave no es de un objeto del almacén. */
export function objectIdFromKey(key: string): string | null {
  const m = /^files\/([0-9a-f]{2})\/([0-9a-f]{64})$/.exec(key);
  return m && m[2]!.startsWith(m[1]!) ? m[2]! : null;
}

/** Tamaño del objeto cifrado de un fichero de `size` bytes. */
export function objectSize(size: number): number {
  return size + encryptionOverhead(OBJECT_MAGIC);
}

/**
 * Cifra un fichero de UPLOAD_DIR en streaming comprobando que sigue siendo el del manifiesto (tamaño y sha256).
 * Si cambió, lanza ANTES de emitir la etiqueta final, de modo que la subida queda incompleta y se descarta.
 */
export async function* encryptFileObject(file: string, entry: { s: number; h: string }, key: Buffer): AsyncGenerator<Buffer> {
  const hash = createHash("sha256");
  let size = 0;
  async function* source(): AsyncGenerator<Buffer> {
    for await (const chunk of createReadStream(file)) {
      hash.update(chunk as Buffer);
      size += (chunk as Buffer).length;
      yield chunk as Buffer;
    }
    if (size !== entry.s || hash.digest("hex") !== entry.h) throw new Error(`El fichero ${path.basename(file)} cambió desde que se hizo la copia.`);
  }
  yield* encryptChunks(source(), key, OBJECT_MAGIC);
}

/** Descifra un objeto y comprueba el sha256 del contenido; lanza al final si no cuadra. */
export async function* decryptFileObject(source: AsyncIterable<Buffer>, entry: { s: number; h: string }, key: Buffer): AsyncGenerator<Buffer> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of decryptChunks(source, key, OBJECT_MAGIC)) {
    hash.update(chunk);
    size += chunk.length;
    yield chunk;
  }
  if (size !== entry.s || hash.digest("hex") !== entry.h) throw new Error("El contenido descifrado no coincide con el manifiesto.");
}

// --- Recorrido de UPLOAD_DIR ------------------------------------------------------------------

/** ¿Ruta relativa segura? (sin «..», sin absoluta, sin vacíos ni barras invertidas). */
export function safeRelPath(p: string): boolean {
  if (typeof p !== "string" || !p || p.length > 1024 || p.startsWith("/") || p.includes("\\") || p.includes("\0")) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** ¿Fichero temporal que no se copia? (subidas a medias, ficheros ocultos). */
export function isTempName(name: string): boolean {
  return /\.(tmp|part|partial)$/i.test(name) || name.startsWith(".");
}

export interface ScannedFile {
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

/**
 * Ficheros regulares bajo `root` (recursivo), sin enlaces simbólicos, temporales ni las carpetas de `exclude`
 * (rutas absolutas; p. ej. UPLOAD_DIR/backups). Ordenados por ruta.
 */
export async function scanFiles(root: string, exclude: string[] = []): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];
  const skip = new Set(exclude.map((p) => path.resolve(p)));
  const walk = async (dir: string, rel: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (isTempName(e.name)) continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!skip.has(abs)) await walk(abs, r);
      } else if (e.isFile()) {
        try {
          const st = await lstat(abs);
          if (st.isFile() && safeRelPath(r)) out.push({ rel: r, abs, size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          // Borrado entre medias.
        }
      }
    }
  };
  await walk(path.resolve(root), "");
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** Caché de hashes: ruta → [tamaño, mtime, sha256]. Así solo se leen los ficheros nuevos o cambiados. */
export type HashIndex = Record<string, [number, number, string]>;

export async function loadHashIndex(file: string): Promise<HashIndex> {
  try {
    const data = JSON.parse(await readFile(file, "utf8")) as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as HashIndex) : {};
  } catch {
    return {};
  }
}

export async function saveHashIndex(file: string, index: HashIndex): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(index), { mode: 0o600 });
  await rename(tmp, file);
}

/**
 * Entradas del manifiesto para los ficheros recorridos. Usa la caché si tamaño y mtime no cambiaron; si no, lee el
 * fichero. Devuelve también la caché nueva (solo con los ficheros que siguen existiendo).
 */
export async function hashFiles(files: ScannedFile[], index: HashIndex, nameKey: Buffer): Promise<{ entries: ManifestFile[]; index: HashIndex; hashed: number }> {
  const next: HashIndex = {};
  const entries: ManifestFile[] = [];
  let hashed = 0;
  for (const f of files) {
    const cached = index[f.rel];
    let h: string;
    if (cached && cached[0] === f.size && cached[1] === f.mtimeMs && /^[0-9a-f]{64}$/.test(cached[2])) h = cached[2];
    else {
      try {
        h = await fileSha256(f.abs);
      } catch {
        continue; // Borrado entre medias: no entra en la copia.
      }
      hashed++;
    }
    next[f.rel] = [f.size, f.mtimeMs, h];
    entries.push({ p: f.rel, s: f.size, h, o: objectId(nameKey, h) });
  }
  return { entries, index: next, hashed };
}

// --- Retención del almacén ---------------------------------------------------------------------

/** Objetos presentes que ningún manifiesto conservado nombra (se pueden borrar). Las claves desconocidas no se tocan. */
export function selectGarbage(presentKeys: Iterable<string>, kept: Iterable<{ files: { o: string }[] }>): string[] {
  const referenced = new Set<string>();
  for (const m of kept) for (const f of m.files) referenced.add(f.o);
  const out: string[] = [];
  for (const k of presentKeys) {
    const id = objectIdFromKey(k);
    if (id && !referenced.has(id)) out.push(k);
  }
  return out;
}

/** Objetos distintos de un manifiesto (dos ficheros iguales comparten objeto). */
export function uniqueObjects(files: ManifestFile[]): ManifestFile[] {
  const seen = new Map<string, ManifestFile>();
  for (const f of files) if (!seen.has(f.o)) seen.set(f.o, f);
  return [...seen.values()];
}

/** Ejecuta `fn` sobre los elementos con como mucho `limit` a la vez. Para en el primer error. */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (failed === null && next < items.length) {
      const item = items[next++]!;
      try {
        await fn(item);
      } catch (err) {
        failed ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed !== null) throw failed;
}
