// Escritura de los ficheros de adjuntos (src/lib/uploads.ts): sin temporales ni huérfanos cuando falla una escritura.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { attachmentPath, copyReleaseAttachmentFile, documentPath, removeAttachmentFiles, saveAttachmentFiles, saveDocumentFile, saveRawAttachmentFile } from "../src/lib/uploads";

describe("escritura de adjuntos", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pz-uploads-"));
  process.env.UPLOAD_DIR = dir;
  const tmps = () => readdirSync(dir).filter((f) => f.endsWith(".tmp"));

  test("si falla la escritura, no queda el temporal", async () => {
    // El destino es una carpeta: el rename falla después de escribir el temporal.
    mkdirSync(path.join(dir, "craw1.bin"));
    writeFileSync(path.join(dir, "craw1.bin", "x"), "x");
    await assert.rejects(saveRawAttachmentFile("craw1", Buffer.from("hola")));
    assert.deepEqual(tmps(), []);
  });

  test("si falla la miniatura, espera a la otra escritura: borrar al fallar no deja huérfanos", async () => {
    mkdirSync(path.join(dir, "cimg1.thumb.webp"));
    writeFileSync(path.join(dir, "cimg1.thumb.webp", "x"), "x");
    const big = Buffer.alloc(64 * 1024 * 1024, 1);
    await assert.rejects(saveAttachmentFiles("cimg1", { full: big, thumb: Buffer.from("t"), width: 1, height: 1 }));
    // Lo que hace la ruta de subida al fallar.
    await removeAttachmentFiles(["cimg1"]);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(existsSync(path.join(dir, "cimg1.webp")), false, "la imagen no aparece después del borrado");
    assert.deepEqual(tmps(), []);
  });

  // Las rutas de subida pasan el File del multipart tal cual (sin Buffer.from(await file.arrayBuffer()), que duplicaba
  // en memoria lo subido): se escribe en flujo, con el mismo temporal y renombrado.
  test("un Blob se escribe en flujo con el mismo contenido; si falla, no queda el temporal", async () => {
    const bytes = Buffer.alloc(3 * 1024 * 1024 + 7);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    await saveRawAttachmentFile("cblob1", new Blob([bytes]));
    assert.deepEqual(readFileSync(attachmentPath("cblob1", "file")), bytes);
    await saveDocumentFile("cblob2", new File([bytes], "a.bin"));
    assert.deepEqual(readFileSync(documentPath("cblob2")), bytes);
    mkdirSync(path.join(dir, "cblob3.bin"));
    writeFileSync(path.join(dir, "cblob3.bin", "x"), "x");
    await assert.rejects(saveRawAttachmentFile("cblob3", new Blob([bytes])));
    assert.deepEqual(tmps(), []);
  });

  test("copia de histórico de un fichero que no es imagen: tal cual y sin temporales", async () => {
    const src = path.join(dir, "origen.bin");
    writeFileSync(src, "contenido del adjunto");
    await copyReleaseAttachmentFile("crel1", src);
    assert.equal(readFileSync(path.join(dir, "releases", "crel1.bin"), "utf8"), "contenido del adjunto");
    await assert.rejects(copyReleaseAttachmentFile("crel2", path.join(dir, "no-existe.bin")));
    assert.deepEqual(readdirSync(path.join(dir, "releases")).filter((f) => f.endsWith(".tmp")), []);
  });
});
