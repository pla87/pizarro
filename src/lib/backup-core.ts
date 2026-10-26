// Núcleo de las copias de seguridad: formato, cifrado, verificación y retención.
// Sin dependencias de Next ni de la base de datos (lo usan también scripts/restore.ts y los tests).
//
// Formato de un fichero .pzbak:
//   "PZBK1\n" (6 bytes) · IV (12) · AES-256-GCM(gzip(NDJSON)) · etiqueta GCM (16)
// El NDJSON lleva una línea por fila, `{"t":"<tabla>","r":<fila como JSON>}`, tabla a tabla en orden de
// dependencias, y una última línea `{"manifest":{…}}` con las cuentas y el sha256 de todas las líneas de datos.
// Todo queda autenticado por GCM: si cambia un solo byte, o la clave no es la buena, no se descifra.

import { createCipheriv, createDecipheriv, createHash, randomBytes, type DecipherGCM } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

export const BACKUP_FORMAT_VERSION = 1;
const MAGIC = Buffer.from("PZBK1\n", "utf8");
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + IV_LEN;

export interface BackupManifest {
  version: number;
  createdAt: string;
  /** Última migración de Prisma aplicada cuando se hizo la copia (la restauración exige la misma). */
  migration: string | null;
  build: string | null;
  tables: { name: string; rows: number }[];
  totalRows: number;
  /** sha256 (hex) de todas las líneas de datos del NDJSON, con su salto de línea. */
  sha256: string;
}

/** Lote de filas de una tabla; cada fila ya es JSON (texto) tal como lo devuelve PostgreSQL. */
export interface TableBatch {
  name: string;
  rows: string[];
}

// --- Clave ------------------------------------------------------------------------------

/**
 * Limpia lo que se cuela al pegar la clave desde un .env o desde el panel de Railway: espacios, saltos de línea,
 * comillas simples o dobles alrededor y, si se pegó la línea entera, el prefijo `BACKUP_KEY=`.
 */
function cleanBackupKey(raw: string): { text: string; quoted: boolean } {
  let text = raw.trim();
  let quoted = false;
  text = text.replace(/^(export\s+)?BACKUP_KEY\s*=\s*/, "");
  for (;;) {
    const m = /^["'`“”‘’](.*)["'`“”‘’]$/s.exec(text);
    if (!m) break;
    text = (m[1] ?? "").trim();
    quoted = true;
  }
  return { text, quoted };
}

/**
 * BACKUP_KEY: 32 bytes en base64 o base64url (`openssl rand -base64 32`) o en hexadecimal de 64 caracteres
 * (`openssl rand -hex 32`). Se ignoran espacios y comillas de alrededor. Devuelve null si no está definida o no es válida.
 * Las claves en base64 que ya eran válidas dan exactamente los mismos 32 bytes que antes.
 */
export function parseBackupKey(raw: string | undefined | null): Buffer | null {
  if (!raw || !raw.trim()) return null;
  const { text } = cleanBackupKey(raw);
  if (/^[0-9a-fA-F]{64}$/.test(text)) return Buffer.from(text, "hex");
  const key = Buffer.from(text, "base64");
  return key.length === 32 ? key : null;
}

/** Qué se ha detectado en una BACKUP_KEY no válida (nunca incluye el valor). */
export type BackupKeyProblem =
  | { kind: "empty" }
  | { kind: "hex"; chars: number }
  | { kind: "base64"; chars: number; bytes: number }
  | { kind: "other"; chars: number };

/** Para explicar al administrador por qué una BACKUP_KEY no sirve. null si es válida. */
export type BackupKeyDiagnosis = BackupKeyProblem & { quoted: boolean; spaces: boolean };

export function diagnoseBackupKey(raw: string | undefined | null): BackupKeyDiagnosis | null {
  if (parseBackupKey(raw)) return null;
  const { text, quoted } = cleanBackupKey(raw ?? "");
  const spaces = /\s/.test(text);
  const base = { quoted, spaces };
  if (!text) return { kind: "empty", ...base };
  if (/^[0-9a-fA-F]+$/.test(text) && text.length >= 32) return { kind: "hex", chars: text.length, ...base };
  const compact = text.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return { kind: "base64", chars: compact.length, bytes: Buffer.from(compact, "base64").length, ...base };
  return { kind: "other", chars: text.length, ...base };
}

// --- Cifrado ----------------------------------------------------------------------------

/**
 * Cifra un flujo con AES-256-GCM: `magic` · IV (12) · datos cifrados · etiqueta (16). La salida mide
 * siempre `magic.length + 28` bytes más que la entrada (lo usan las subidas a S3, que necesitan el tamaño antes).
 */
export async function* encryptChunks(source: AsyncIterable<Buffer>, key: Buffer, magic: Buffer = MAGIC): AsyncGenerator<Buffer> {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  yield magic;
  yield iv;
  for await (const chunk of source) {
    const out = cipher.update(chunk);
    if (out.length) yield out;
  }
  const last = cipher.final();
  if (last.length) yield last;
  yield cipher.getAuthTag();
}

/** Bytes que añade el cifrado (cabecera, IV y etiqueta) a un contenido de `magic`. */
export function encryptionOverhead(magic: Buffer = MAGIC): number {
  return magic.length + IV_LEN + TAG_LEN;
}

/**
 * Descifra un flujo cifrado con `encryptChunks` sin conocer su tamaño: retiene siempre los últimos 16 bytes
 * (la etiqueta). Lanza al final si la etiqueta no cuadra; quien consume no debe dar nada por bueno hasta entonces.
 */
export async function* decryptChunks(source: AsyncIterable<Buffer | Uint8Array | string>, key: Buffer, magic: Buffer = MAGIC): AsyncGenerator<Buffer> {
  const headerLen = magic.length + IV_LEN;
  let head: Buffer = Buffer.alloc(0);
  let decipher: DecipherGCM | null = null;
  let tail: Buffer = Buffer.alloc(0);
  for await (const raw of source) {
    let chunk: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
    if (!decipher) {
      head = Buffer.concat([head, chunk]);
      if (head.length < headerLen) continue;
      if (!head.subarray(0, magic.length).equals(magic)) throw new Error("Cabecera desconocida (no es un fichero de copia de Pizarro).");
      decipher = createDecipheriv("aes-256-gcm", key, head.subarray(magic.length, headerLen));
      chunk = head.subarray(headerLen);
    }
    tail = tail.length ? Buffer.concat([tail, chunk]) : chunk;
    if (tail.length > TAG_LEN) {
      const out = decipher.update(tail.subarray(0, tail.length - TAG_LEN));
      tail = Buffer.from(tail.subarray(tail.length - TAG_LEN));
      if (out.length) yield out;
    }
  }
  if (!decipher || tail.length < TAG_LEN) throw new Error("Fichero de copia demasiado corto.");
  decipher.setAuthTag(tail);
  const last = decipher.final();
  if (last.length) yield last;
}

/** Descifra un fichero .pzbak. Lanza al terminar si la etiqueta GCM no cuadra (clave incorrecta o fichero alterado). */
export async function* decryptFile(file: string, key: Buffer): AsyncGenerator<Buffer> {
  const handle = await open(file, "r");
  let size: number;
  const tag = Buffer.alloc(TAG_LEN);
  const header = Buffer.alloc(HEADER_LEN);
  try {
    size = (await handle.stat()).size;
    if (size < HEADER_LEN + TAG_LEN) throw new Error("Fichero de copia demasiado corto.");
    await handle.read(header, 0, HEADER_LEN, 0);
    await handle.read(tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("No es una copia de Pizarro (cabecera desconocida).");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  if (size - TAG_LEN > HEADER_LEN) {
    for await (const chunk of createReadStream(file, { start: HEADER_LEN, end: size - TAG_LEN - 1 })) {
      const out = decipher.update(chunk as Buffer);
      if (out.length) yield out;
    }
  }
  const last = decipher.final();
  if (last.length) yield last;
}

/** Texto plano (NDJSON) de una copia: descifra y descomprime. Los errores se propagan al consumidor. */
async function* plainText(file: string, key: Buffer): AsyncGenerator<string> {
  const gunzip = createGunzip();
  gunzip.setEncoding("utf8");
  const done = pipeline(Readable.from(decryptFile(file, key)), gunzip);
  done.catch(() => {}); // El error llega por gunzip; evita el rechazo sin manejar.
  for await (const chunk of gunzip) yield chunk as string;
  await done;
}

/** Líneas del NDJSON de una copia (sin el salto de línea). */
export async function* readLines(file: string, key: Buffer): AsyncGenerator<string> {
  let rest = "";
  for await (const chunk of plainText(file, key)) {
    rest += chunk;
    let i: number;
    let from = 0;
    while ((i = rest.indexOf("\n", from)) !== -1) {
      yield rest.slice(from, i);
      from = i + 1;
    }
    rest = rest.slice(from);
  }
  if (rest) yield rest;
}

// --- Escritura --------------------------------------------------------------------------

/** Línea de datos de una fila; `rowJson` es el JSON de la fila tal cual. */
export function dataLine(table: string, rowJson: string): string {
  return `{"t":${JSON.stringify(table)},"r":${rowJson}}\n`;
}

/**
 * Escribe una copia cifrada y comprimida en `file` (primero a un temporal, luego se renombra).
 * `tables` entrega las tablas en orden; devuelve el manifiesto.
 */
export async function writeBackupFile(opts: {
  file: string;
  key: Buffer;
  tables: AsyncIterable<TableBatch>;
  migration: string | null;
  build?: string | null;
  now?: Date;
}): Promise<{ manifest: BackupManifest; bytes: number }> {
  const hash = createHash("sha256");
  const counts = new Map<string, number>();
  let manifest: BackupManifest | null = null;

  async function* plain(): AsyncGenerator<Buffer> {
    for await (const batch of opts.tables) {
      if (!counts.has(batch.name)) counts.set(batch.name, 0);
      if (batch.rows.length === 0) continue;
      const text = batch.rows.map((r) => dataLine(batch.name, r)).join("");
      hash.update(text);
      counts.set(batch.name, counts.get(batch.name)! + batch.rows.length);
      yield Buffer.from(text, "utf8");
    }
    const tables = [...counts].map(([name, rows]) => ({ name, rows }));
    manifest = {
      version: BACKUP_FORMAT_VERSION,
      createdAt: (opts.now ?? new Date()).toISOString(),
      migration: opts.migration,
      build: opts.build ?? null,
      tables,
      totalRows: tables.reduce((n, t) => n + t.rows, 0),
      sha256: hash.digest("hex"),
    };
    yield Buffer.from(`${JSON.stringify({ manifest })}\n`, "utf8");
  }

  const tmp = `${opts.file}.${process.pid}.tmp`;
  try {
    await pipeline(
      Readable.from(plain()),
      createGzip({ level: 6 }),
      (gz: AsyncIterable<Buffer>) => encryptChunks(gz, opts.key),
      createWriteStream(tmp, { mode: 0o600 }),
    );
    await rename(tmp, opts.file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  if (!manifest) throw new Error("La copia no generó manifiesto.");
  const handle = await open(opts.file, "r");
  const bytes = (await handle.stat()).size;
  await handle.close();
  return { manifest, bytes };
}

/** sha256 (hex) de un fichero, en streaming. */
export async function fileSha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

// --- Lectura y verificación --------------------------------------------------------------

/** Separa una línea de datos en tabla y fila (JSON sin interpretar). */
export function splitDataLine(line: string): { table: string; row: string } | null {
  const m = /^\{"t":("(?:[^"\\]|\\.)*"),"r":/.exec(line);
  if (!m || !line.endsWith("}")) return null;
  return { table: JSON.parse(m[1]!) as string, row: line.slice(m[0].length, -1) };
}

export interface VerifiedBackup {
  manifest: BackupManifest;
  counts: Map<string, number>;
}

/**
 * Descifra y recorre toda la copia: autenticación GCM, sha256 de los datos, que cada línea sea JSON
 * válido y que las cuentas por tabla coincidan con el manifiesto. Lanza con un mensaje claro si algo falla.
 */
export async function verifyBackupFile(file: string, key: Buffer): Promise<VerifiedBackup> {
  const hash = createHash("sha256");
  const counts = new Map<string, number>();
  let manifest: BackupManifest | null = null;
  for await (const line of readLines(file, key)) {
    if (manifest) throw new Error("Hay datos después del manifiesto.");
    if (line.startsWith('{"manifest":')) {
      manifest = (JSON.parse(line) as { manifest: BackupManifest }).manifest;
      continue;
    }
    const parts = splitDataLine(line);
    if (!parts) throw new Error("Línea de datos con formato inválido.");
    JSON.parse(parts.row);
    hash.update(`${line}\n`);
    counts.set(parts.table, (counts.get(parts.table) ?? 0) + 1);
  }
  if (!manifest) throw new Error("La copia no tiene manifiesto (¿incompleta?).");
  if (manifest.version !== BACKUP_FORMAT_VERSION) throw new Error(`Versión de copia no soportada: ${manifest.version}.`);
  if (hash.digest("hex") !== manifest.sha256) throw new Error("El sha256 de los datos no coincide con el manifiesto.");
  let total = 0;
  for (const t of manifest.tables) {
    const got = counts.get(t.name) ?? 0;
    if (got !== t.rows) throw new Error(`Tabla ${t.name}: el manifiesto dice ${t.rows} filas y la copia tiene ${got}.`);
    total += got;
  }
  for (const name of counts.keys()) if (!manifest.tables.some((t) => t.name === name)) throw new Error(`Tabla ${name} no figura en el manifiesto.`);
  if (total !== manifest.totalRows) throw new Error("El total de filas no coincide con el manifiesto.");
  return { manifest, counts };
}

// --- Orden de tablas por claves foráneas ---------------------------------------------------

/** Ordena las tablas para que las referenciadas vayan antes (aristas: hijo → padre). Devuelve también si hay ciclos. */
export function orderTables(tables: string[], fks: { child: string; parent: string }[]): { order: string[]; cyclic: boolean } {
  const pending = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of fks) if (child !== parent && pending.has(child) && pending.has(parent)) pending.get(child)!.add(parent);
  const order: string[] = [];
  while (pending.size) {
    const ready = [...pending].filter(([, deps]) => deps.size === 0).map(([t]) => t).sort();
    if (ready.length === 0) {
      const rest = [...pending.keys()].sort();
      return { order: [...order, ...rest], cyclic: true };
    }
    for (const t of ready) {
      pending.delete(t);
      order.push(t);
    }
    for (const deps of pending.values()) for (const t of ready) deps.delete(t);
  }
  return { order, cyclic: false };
}

// --- Nombres y retención ------------------------------------------------------------------

const NAME_RE = /^pizarro-backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.pzbak$/;

/** pizarro-backup-20261022T031500Z.pzbak (UTC). */
export function backupFileName(at: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `pizarro-backup-${p(at.getUTCFullYear(), 4)}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}T${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}Z.pzbak`;
}

/** Fecha que codifica el nombre de un fichero de copia, o null si no lo es. */
export function parseBackupFileName(name: string): Date | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

const STEM_RE = /^(pizarro-backup-\d{8}T\d{6}Z)\.(?:pzbak|pzbak\.json|pzman)$/;

/**
 * Raíz común («pizarro-backup-AAAAMMDDTHHMMSSZ») de los ficheros de una misma copia: el volcado `.pzbak`, su
 * resumen en claro `.pzbak.json` y el manifiesto cifrado `.pzman` (lista de ficheros). null si no es de una copia.
 */
export function backupStem(name: string): string | null {
  return STEM_RE.exec(name)?.[1] ?? null;
}

/**
 * Qué copias se conservan: la más reciente de cada uno de los últimos `daily` días con copia y la más
 * reciente de cada uno de los últimos `monthly` meses con copia (UTC). El resto se puede borrar.
 */
export function selectBackupsToKeep(names: string[], daily = 14, monthly = 6): Set<string> {
  const dated = names
    .map((name) => ({ name, at: parseBackupFileName(name) }))
    .filter((x): x is { name: string; at: Date } => x.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const keep = new Set<string>();
  const days = new Set<string>();
  const months = new Set<string>();
  for (const { name, at } of dated) {
    const iso = at.toISOString();
    const day = iso.slice(0, 10);
    const month = iso.slice(0, 7);
    if (!days.has(day) && days.size < daily) {
      days.add(day);
      keep.add(name);
    }
    if (!months.has(month) && months.size < monthly) {
      months.add(month);
      keep.add(name);
    }
  }
  return keep;
}
