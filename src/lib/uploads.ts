import "server-only";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { AppError } from "./errors";
import { uploadDir } from "./upload-dir";

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024;
const INPUT_FORMATS = new Set(["png", "jpeg", "webp", "gif", "avif", "heif"]);

// Limita la memoria de sharp en un contenedor pequeño.
sharp.cache({ memory: 64, items: 20 });
sharp.concurrency(2);

/** Los ids son cuid: nunca contienen separadores, pero se valida igualmente. */
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

interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/** Redimensiona a 1280px de ancho máximo, WebP calidad 75, y genera una miniatura. */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  // Como máximo dos imágenes procesándose a la vez: acota la memoria del contenedor.
  // Y como mucho MAX_WAITING esperando turno: más allá se rechaza (503) en vez de acumular buffers en memoria.
  if (imageQueueFull()) throw new AppError(IMAGE_QUEUE_FULL_MESSAGE, 503);
  await acquire();
  try {
    return await processImageNow(input);
  } finally {
    release();
  }
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

async function processImageNow(input: Buffer): Promise<ProcessedImage> {
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
  const thumb = await sharp(full.data).resize({ width: 480, height: 360, fit: "inside", withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
  return { full: full.data, thumb, width: full.info.width, height: full.info.height };
}

async function writeAtomic(file: string, data: Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

export async function saveAttachmentFiles(id: string, image: ProcessedImage): Promise<void> {
  await mkdir(uploadDir(), { recursive: true });
  await Promise.all([
    writeAtomic(attachmentPath(id, "full"), image.full),
    writeAtomic(attachmentPath(id, "thumb"), image.thumb),
  ]);
}

/** Guarda un adjunto que no es imagen, sin transformarlo. */
export async function saveRawAttachmentFile(id: string, data: Buffer): Promise<void> {
  await mkdir(uploadDir(), { recursive: true });
  await writeAtomic(attachmentPath(id, "file"), data);
}

export async function removeAttachmentFiles(ids: string[]): Promise<void> {
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

/** Lee la copia de histórico de un adjunto, sea imagen compacta (.webp) o fichero tal cual (.bin). */
export async function readReleaseAttachmentFile(id: string): Promise<Buffer> {
  try {
    return await readFile(releaseAttachmentPath(id, "webp"));
  } catch {
    return await readFile(releaseAttachmentPath(id, "bin"));
  }
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
