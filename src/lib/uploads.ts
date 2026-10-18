import "server-only";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { AppError } from "./errors";

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024;
const INPUT_FORMATS = new Set(["png", "jpeg", "webp", "gif", "avif", "heif"]);

// Limita la memoria de sharp en un contenedor pequeño.
sharp.cache({ memory: 64, items: 20 });
sharp.concurrency(2);

export function uploadDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR ?? "./uploads");
}

/** Los ids son cuid: nunca contienen separadores, pero se valida igualmente. */
export function attachmentPath(id: string, variant: "full" | "thumb"): string {
  if (!/^[a-z0-9]+$/i.test(id)) throw new AppError("Identificador no válido.");
  return path.join(/*turbopackIgnore: true*/ uploadDir(), variant === "full" ? `${id}.webp` : `${id}.thumb.webp`);
}

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/** Redimensiona a 1280px de ancho máximo, WebP calidad 75, y genera una miniatura. */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  // Como máximo dos imágenes procesándose a la vez: acota la memoria del contenedor.
  await acquire();
  try {
    return await processImageNow(input);
  } finally {
    release();
  }
}

const MAX_CONCURRENT = 2;
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

export async function removeAttachmentFiles(ids: string[]): Promise<void> {
  await Promise.all(
    ids.flatMap((id) => [rm(attachmentPath(id, "full"), { force: true }), rm(attachmentPath(id, "thumb"), { force: true })]),
  ).catch((err) => console.error("[uploads] no se pudieron borrar ficheros", err));
}
