// Escritura de los ficheros de adjuntos (src/lib/uploads.ts): sin temporales ni huérfanos cuando falla una escritura.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { removeAttachmentFiles, saveAttachmentFiles, saveRawAttachmentFile } from "../src/lib/uploads";

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
});
