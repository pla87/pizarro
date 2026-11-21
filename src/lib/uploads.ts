import "server-only";
import { randomBytes } from "node:crypto";
import { constants as fsConstants, createWriteStream } from "node:fs";
import { copyFile, mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import sharp from "sharp";
import { forgetAttachments } from "./attachment-cache";
import { AppError } from "./errors";
import { uploadDir } from "./upload-dir";

const INPUT_FORMATS = new Set(["png", "jpeg", "webp", "gif", "avif", "heif"]);

// Limita la memoria de sharp en un contenedor pequeño.
sharp.cache({ memory: 64, items: 20 });
sharp.concurrency(2);

/**
 * Id para una fila con fichero (adjunto, documento) que se elige antes de crearla: así el fichero se escribe primero y la
 * fila después. Si el proceso se corta entre medias queda como mucho un fichero sin fila, que la limpieza de huérfanos
 * borra (pasadas 24 h); nunca una fila sin fichero. Mismo formato que los de la importación (letras y cifras, como cuid).
 */
export const newFileId = (): string => `c${randomBytes(12).toString("hex")}`;

/**
 * Imágenes: `<id>.webp` y `<id>.thumb.webp`. Cualquier otro fichero se guarda tal cual
 * (sin conversión) como `<id>.bin`: el nombre y el tipo reales viven en la base de datos.
 */
export function attachmentPath(id: string, variant: "full" | "thumb" | "file"): string {
  if (!/^[a-z0-9]+$/i.test(id)) throw new AppError("Identificador no válido.");
  const name = variant === "full" ? `${id}.webp` : variant === "thumb" ? `${id}.thumb.webp` : `${id}.bin`;
  return path.join(/*turbopackIgnore: true*/ uploadDir(), name);
}

/** Tipos MIME que se pueden servir con su Content-Type real (siempre como descarga). El resto: octet-stream. */
const SAFE_MIME = new Set([
  "application/pdf", "text/plain", "text/csv", "application/zip", "application/x-zip-compressed",
  "application/x-7z-compressed", "application/gzip", "application/x-tar", "application/vnd.rar", "application/x-rar-compressed",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation", "application/json",
  "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm", "audio/aac", "audio/flac",
  "video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-matroska",
]);

/** Normaliza el MIME recibido del cliente: minúsculas, sin parámetros, formato válido o octet-stream. */
export function sanitizeMime(raw: string | null | undefined): string {
  const m = (raw ?? "").split(";")[0]!.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,100}$/.test(m) ? m : "application/octet-stream";
}

/** Content-Type con el que se sirve un adjunto no imagen: solo si está en la lista segura. */
export function safeDownloadMime(stored: string): string {
  return SAFE_MIME.has(stored) ? stored : "application/octet-stream";
}

interface FullImage {
  full: Buffer;
  width: number;
  height: number;
}

interface ProcessedImage extends FullImage {
  thumb: Buffer;
}

/** Sin miniatura: para quien solo guarda la imagen completa (Documentación, adjuntos de releases importados). */
type NoThumb = { thumb: false };

/** Redimensiona a 1280px de ancho máximo, WebP calidad 75, y genera una miniatura (salvo con `{ thumb: false }`). */
// La de siempre (con miniatura) va la última: es la que toma ReturnType<typeof processImage>.
export async function processImage(input: Buffer, opts: NoThumb): Promise<FullImage>;
export async function processImage(input: Buffer): Promise<ProcessedImage>;
export async function processImage(input: Buffer, opts?: NoThumb): Promise<ProcessedImage | FullImage> {
  // Como máximo dos imágenes procesándose a la vez: acota la memoria del contenedor.
  // Y como mucho MAX_WAITING esperando turno: más allá se rechaza (503) en vez de acumular buffers en memoria.
  if (imageQueueFull()) throw new AppError(IMAGE_QUEUE_FULL_MESSAGE, 503);
  await acquire();
  try {
    return await processImageNow(input, opts?.thumb !== false);
  } finally {
    release();
  }
}

/**
 * Imagen de un archivo de importación de proyecto. Lo que exporta la aplicación ya es WebP de 1280 px como mucho:
 * se valida con sharp y se conserva tal cual (sin volver a comprimir), generando solo la miniatura. Cualquier otra
 * cosa pasa por el mismo procesado que una subida normal.
 */
// La de siempre (con miniatura) va la última: es la que toma ReturnType<typeof processImportedImage>.
export async function processImportedImage(input: Buffer, opts: NoThumb): Promise<FullImage>;
export async function processImportedImage(input: Buffer): Promise<ProcessedImage>;
export async function processImportedImage(input: Buffer, opts?: NoThumb): Promise<ProcessedImage | FullImage> {
  if (imageQueueFull()) throw new AppError(IMAGE_QUEUE_FULL_MESSAGE, 503);
  const withThumb = opts?.thumb !== false;
  let kept: ProcessedImage | FullImage | null = null;
  await acquire();
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata().catch(() => {
      throw new AppError("El archivo no es una imagen válida.");
    });
    if (meta.format === "webp" && meta.width && meta.height && meta.width <= 1280 && meta.height <= 16384 && (meta.pages ?? 1) <= 1) {
      if (!withThumb) kept = { full: input, width: meta.width, height: meta.height };
      else {
        const thumb = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).resize({ width: 480, height: 360, fit: "inside", withoutEnlargement: true }).webp({ quality: 70 }).toBuffer()
          .catch(() => { throw new AppError("El archivo no es una imagen válida."); });
        kept = { full: input, thumb, width: meta.width, height: meta.height };
      }
    }
  } finally {
    release();
  }
  return kept ?? (withThumb ? processImage(input) : processImage(input, { thumb: false }));
}

const MAX_CONCURRENT = 2;
export const MAX_WAITING = 10;
export const IMAGE_QUEUE_FULL_MESSAGE = "El servidor está procesando muchas imágenes. Inténtalo de nuevo en unos segundos.";
/** ¿Hay ya MAX_WAITING imágenes esperando turno? Las rutas lo miran antes de leer el cuerpo de la petición. */
export const imageQueueFull = (): boolean => running >= MAX_CONCURRENT && queue.length >= MAX_WAITING;
let running = 0;
const queue: (() => void)[] = [];
function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}
function release(): void {
  const next = queue.shift();
  if (next) next();
  else running--;
}

const MAX_INPUT_PIXELS = 30_000_000;

async function processImageNow(input: Buffer, withThumb: boolean): Promise<ProcessedImage | FullImage> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new AppError("El archivo no es una imagen válida.");
  }
  if (!meta.format || !INPUT_FORMATS.has(meta.format)) {
    throw new AppError("Formato no admitido. Usa PNG, JPEG, WebP, GIF o AVIF.");
  }
  // Se decodifica una sola vez; la miniatura sale de la imagen ya reducida.
  const full = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
    .rotate()
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw new AppError("No se pudo procesar la imagen (¿es demasiado grande?).");
    });
  if (!withThumb) return { full: full.data, width: full.info.width, height: full.info.height };
  const thumb = await sharp(full.data).resize({ width: 480, height: 360, fit: "inside", withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
  return { full: full.data, thumb, width: full.info.width, height: full.info.height };
}

/**
 * Escribe en un temporal y lo renombra. Un Blob (el File de un multipart) se escribe en flujo desde su contenido, sin
 * copiarlo antes a otro Buffer: con `Buffer.from(await file.arrayBuffer())` una subida de 100 MB ocupaba 200 en memoria.
 */
async function writeAtomic(file: string, data: Buffer | Blob): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    if (Buffer.isBuffer(data)) await writeFile(tmp, data);
    else await pipeline(Readable.fromWeb(data.stream() as NodeWebStream<Uint8Array>), createWriteStream(tmp));
    await rename(tmp, file);
  } catch (err) {
    // Disco lleno o similar: no se deja el temporal a medias.
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function saveAttachmentFiles(id: string, image: ProcessedImage): Promise<void> {
  await mkdir(uploadDir(), { recursive: true });
  // Se esperan las dos escrituras aunque una falle: quien llama borra los ficheros al fallar, y la otra no debe
  // terminar después (con su rename) y dejar un fichero huérfano.
  const results = await Promise.allSettled([
    writeAtomic(attachmentPath(id, "full"), image.full),
    writeAtomic(attachmentPath(id, "thumb"), image.thumb),
  ]);
  for (const r of results) if (r.status === "rejected") throw r.reason;
}

/** Guarda un adjunto que no es imagen, sin transformarlo (un Blob, en flujo). */
export async function saveRawAttachmentFile(id: string, data: Buffer | Blob): Promise<void> {
  await mkdir(uploadDir(), { recursive: true });
  await writeAtomic(attachmentPath(id, "file"), data);
}

export async function removeAttachmentFiles(ids: string[]): Promise<void> {
  forgetAttachments(ids);
  await Promise.all(
    ids.flatMap((id) => [
      rm(attachmentPath(id, "full"), { force: true }),
      rm(attachmentPath(id, "thumb"), { force: true }),
      rm(attachmentPath(id, "file"), { force: true }),
    ]),
  ).catch((err) => console.error("[uploads] no se pudieron borrar ficheros", err));
}

// --- Copias compactas de adjuntos para el histórico de releases -----------------

/** Los ids son cuid; ficheros en UPLOAD_DIR/releases/<id>.webp (imágenes) o <id>.bin (otros ficheros, tal cual). */
function releaseAttachmentPath(id: string, kind: "webp" | "bin" = "webp"): string {
  if (!/^[a-z0-9]+$/i.test(id)) throw new AppError("Identificador no válido.");
  return path.join(/*turbopackIgnore: true*/ uploadDir(), "releases", `${id}.${kind}`);
}

/** La copia de histórico de un adjunto en flujo (imagen compacta .webp o fichero .bin), sin leerla entera en memoria. */
export async function* releaseAttachmentStream(id: string): AsyncGenerator<Buffer> {
  let handle;
  try {
    handle = await open(releaseAttachmentPath(id, "webp"));
  } catch {
    handle = await open(releaseAttachmentPath(id, "bin"));
  }
  // createReadStream cierra el descriptor al terminar o al interrumpirse la lectura.
  yield* handle.createReadStream();
}

/** Tamaño en disco de la copia de histórico de un adjunto; null si falta el fichero. */
export async function releaseAttachmentFileSize(id: string): Promise<number | null> {
  for (const kind of ["webp", "bin"] as const) {
    try {
      return (await stat(releaseAttachmentPath(id, kind))).size;
    } catch {
      // se prueba con la otra extensión
    }
  }
  return null;
}

/** Reduce un WebP ya guardado a 960px de ancho máximo, calidad ~55, sin metadatos. */
export async function compactImage(input: Buffer): Promise<Buffer> {
  await acquire();
  try {
    return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .resize({ width: 960, withoutEnlargement: true })
      .webp({ quality: 55, effort: 4 })
      .toBuffer();
  } finally {
    release();
  }
}

export async function saveReleaseAttachmentFile(id: string, data: Buffer, kind: "webp" | "bin" = "webp"): Promise<void> {
  await mkdir(path.dirname(releaseAttachmentPath(id)), { recursive: true });
  await writeAtomic(releaseAttachmentPath(id, kind), data);
}

/**
 * Copia tal cual un fichero (un adjunto que no es imagen) como copia de histórico `.bin`, sin leerlo en memoria: con
 * COPYFILE_FICLONE, en un sistema de ficheros que lo admite (btrfs, XFS, APFS) es una copia por referencia, y si no, una
 * copia normal del núcleo. A un temporal y renombrado, como las demás escrituras.
 */
export async function copyReleaseAttachmentFile(id: string, source: string): Promise<void> {
  const file = releaseAttachmentPath(id, "bin");
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await copyFile(source, tmp, fsConstants.COPYFILE_FICLONE);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function removeReleaseAttachmentFiles(ids: string[]): Promise<void> {
  // Cada id por separado: un id raro o un fallo no impide borrar los demás.
  await Promise.all(
    ids.map(async (id) => {
      try {
        await Promise.all([rm(releaseAttachmentPath(id, "webp"), { force: true }), rm(releaseAttachmentPath(id, "bin"), { force: true })]);
      } catch (err) {
        console.error("[uploads] no se pudieron borrar ficheros de releases", err);
      }
    }),
  );
}

// --- Documentación del proyecto -------------------------------------------------

/** Ficheros de la documentación: UPLOAD_DIR/documents/<id>.bin (siempre por id; el nombre real vive en la base de datos). */
export function documentPath(id: string): string {
  if (!/^[a-z0-9]+$/i.test(id)) throw new AppError("Identificador no válido.");
  return path.join(/*turbopackIgnore: true*/ uploadDir(), "documents", `${id}.bin`);
}

/** Guarda un documento (un Blob, en flujo). */
export async function saveDocumentFile(id: string, data: Buffer | Blob): Promise<void> {
  const file = documentPath(id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeAtomic(file, data);
}

export async function removeDocumentFiles(ids: string[]): Promise<void> {
  // Cada id por separado: un id raro o un fallo no impide borrar los demás.
  await Promise.all(
    ids.map(async (id) => {
      try {
        await rm(documentPath(id), { force: true });
      } catch (err) {
        console.error("[uploads] no se pudieron borrar documentos", err);
      }
    }),
  );
}
