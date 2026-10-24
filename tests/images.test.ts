import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { AppError } from "../src/lib/errors";
import { IMAGE_QUEUE_FULL_MESSAGE, imageQueueFull, MAX_WAITING, processImage } from "../src/lib/uploads";

test("redimensiona a 1280px de ancho y convierte a WebP", async () => {
  const png = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#123456" } }).png().toBuffer();
  const out = await processImage(png);
  assert.equal(out.width, 1280);
  assert.equal(out.height, 640);
  assert.equal((await sharp(out.full).metadata()).format, "webp");
  assert.ok((await sharp(out.thumb).metadata()).width! <= 480);
});

test("no amplía imágenes pequeñas", async () => {
  const jpg = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  const out = await processImage(jpg);
  assert.equal(out.width, 400);
});

test("rechaza ficheros que no son imágenes", async () => {
  await assert.rejects(processImage(Buffer.from("<svg onload=alert(1)></svg>")), /imagen|Formato/);
  await assert.rejects(processImage(Buffer.from("hola")), /imagen/);
});

test("rechaza imágenes con demasiados píxeles (protección de memoria)", async () => {
  const huge = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
  assert.ok(huge.length < 2_000_000, "PNG pequeño en bytes pero enorme en píxeles");
  await assert.rejects(processImage(huge), /imagen/);
});

test("la cola de imágenes rechaza con 503 a partir de 10 esperando", async () => {
  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#123456" } }).png().toBuffer();
  // 2 en proceso + 10 esperando; la siguiente se rechaza al instante.
  const jobs = Array.from({ length: MAX_WAITING + 2 }, () => processImage(png));
  assert.equal(imageQueueFull(), true);
  await assert.rejects(processImage(png), (e: unknown) => e instanceof AppError && e.status === 503 && e.message === IMAGE_QUEUE_FULL_MESSAGE);
  await Promise.all(jobs);
  assert.equal(imageQueueFull(), false);
  await processImage(png);
});
