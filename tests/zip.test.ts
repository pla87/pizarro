import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { crc32 } from "node:zlib";
import { buildZip } from "../src/lib/zip";

interface Parsed {
  name: string;
  size: number;
  crc: number;
  data: Buffer;
}

/** Lee el ZIP desde el final: EOCD → directorio central → cabeceras locales. */
function parseZip(zip: Buffer): Parsed[] {
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  assert.equal(zip.readUInt16LE(eocd + 8), count);
  let pos = zip.readUInt32LE(eocd + 16);
  assert.equal(pos + zip.readUInt32LE(eocd + 12), eocd);
  const out: Parsed[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(pos), 0x02014b50);
    assert.equal(zip.readUInt16LE(pos + 8) & 0x0800, 0x0800);
    assert.equal(zip.readUInt16LE(pos + 10), 0); // almacenado
    const crc = zip.readUInt32LE(pos + 16);
    const size = zip.readUInt32LE(pos + 20);
    assert.equal(zip.readUInt32LE(pos + 24), size);
    const nameLen = zip.readUInt16LE(pos + 28);
    const offset = zip.readUInt32LE(pos + 42);
    const name = zip.toString("utf8", pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen;

    assert.equal(zip.readUInt32LE(offset), 0x04034b50);
    assert.equal(zip.readUInt32LE(offset + 14), crc);
    assert.equal(zip.readUInt32LE(offset + 18), size);
    const localNameLen = zip.readUInt16LE(offset + 26);
    assert.equal(zip.toString("utf8", offset + 30, offset + 30 + localNameLen), name);
    const start = offset + 30 + localNameLen + zip.readUInt16LE(offset + 28);
    out.push({ name, size, crc, data: zip.subarray(start, start + size) });
  }
  return out;
}

const files = [
  { name: "F1_captura.webp", data: Buffer.from("contenido uno") },
  { name: "C1_Vista_Árbol.webp", data: Buffer.from([0, 1, 2, 3, 255, 254]) },
];

test("ZIP: estructura, nombres UTF-8, tamaños, CRC y contenido", () => {
  const parsed = parseZip(buildZip(files, new Date(2026, 5, 15, 10, 20, 30)));
  assert.equal(parsed.length, 2);
  parsed.forEach((p, i) => {
    assert.equal(p.name, files[i]!.name);
    assert.equal(p.size, files[i]!.data.length);
    assert.equal(p.crc, crc32(files[i]!.data));
    assert.deepEqual(p.data, files[i]!.data);
  });
});

test("ZIP: fecha DOS y ZIP vacío", () => {
  const zip = buildZip(files.slice(0, 1), new Date(2026, 5, 15, 10, 20, 30));
  assert.equal(zip.readUInt16LE(10), (10 << 11) | (20 << 5) | 15);
  assert.equal(zip.readUInt16LE(12), ((2026 - 1980) << 9) | (6 << 5) | 15);
  assert.equal(parseZip(buildZip([])).length, 0);
});

test("ZIP: lo abre python zipfile (si hay python3)", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "zip-"));
  const file = path.join(dir, "t.zip");
  writeFileSync(file, buildZip(files));
  let out: string;
  try {
    out = execFileSync(
      "python3",
      ["-I", "-c", "import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint('|'.join(i.filename+':'+str(len(z.read(i))) for i in z.infolist()))", file],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return t.skip("python3 no disponible");
  }
  assert.equal(out, `F1_captura.webp:13|C1_Vista_Árbol.webp:6`);
});
