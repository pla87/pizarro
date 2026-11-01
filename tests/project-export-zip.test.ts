// ZIP en flujo y lector seguro del exportador de proyectos, más las piezas puras del formato (versión, menciones, nombres).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { importMaxBytes } from "../src/lib/project-export/config";
import { mapMentions } from "../src/lib/project-export/mentions";
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION, type ExportManifest } from "../src/lib/project-export/types";
import { assertSupportedVersion, upgrade } from "../src/lib/project-export/upgrade";
import { isSafeEntryName, ZipFile, ZipReadError } from "../src/lib/zip-read";
import { streamZip, streamZipSize, type StreamZipEntry } from "../src/lib/zip-stream";

const dir = mkdtempSync(path.join(tmpdir(), "pz-pexport-"));

async function collect(entries: StreamZipEntry[]): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of streamZip(entries)) parts.push(c);
  return Buffer.concat(parts);
}

const buf = (s: string): StreamZipEntry => {
  const b = Buffer.from(s);
  return { name: `f/${s}.txt`, size: b.length, crc: crc32(b), body: b };
};

test("el ZIP en flujo mide lo anunciado y lo abren unzip y el lector propio", async () => {
  const big = Buffer.alloc(300_000, "abc");
  const entries: StreamZipEntry[] = [
    buf("uno"),
    { name: "files/ñandú.bin", size: big.length, crc: crc32(big), body: async function* () { for (let i = 0; i < big.length; i += 65536) yield big.subarray(i, i + 65536); } },
    buf("tres"),
  ];
  const zip = await collect(entries);
  assert.equal(zip.length, streamZipSize(entries));
  const file = path.join(dir, "a.zip");
  writeFileSync(file, zip);
  assert.match(execFileSync("unzip", ["-t", file]).toString(), /No errors detected/);
  const z = await ZipFile.open(file);
  try {
    assert.deepEqual(z.entries.map((e) => e.name), ["f/uno.txt", "files/ñandú.bin", "f/tres.txt"]);
    assert.equal((await z.readAll(z.find("f/uno.txt")!, 100)).toString(), "uno");
    assert.ok((await z.readAll(z.find("files/ñandú.bin")!, 1e6)).equals(big));
  } finally {
    await z.close();
  }
});

test("una entrada que no cuadra con lo declarado corta el flujo", async () => {
  const b = Buffer.from("hola");
  await assert.rejects(collect([{ name: "a", size: 10, crc: crc32(b), body: b }]), /ha cambiado/);
  await assert.rejects(collect([{ name: "a", size: 4, crc: 123, body: b }]), /ha cambiado/);
  await assert.rejects(collect([{ name: "a", size: 2, crc: 0, body: async function* () { yield b; } }]), /ha crecido/);
});

test("el lector rechaza nombres peligrosos, duplicados, cifrado y CRC erróneo", async () => {
  for (const bad of ["../x", "/etc/passwd", "a/../../b", "a\\b", "C:/x", "a//b", "", "a/./b"]) assert.equal(isSafeEntryName(bad), false, bad);
  for (const good of ["manifest.json", "files/" + "a".repeat(64)]) assert.equal(isSafeEntryName(good), true);

  const open = async (name: string, zip: Buffer) => {
    const f = path.join(dir, name);
    writeFileSync(f, zip);
    return ZipFile.open(f);
  };
  await assert.rejects(open("slip.zip", await collect([buf("x")]).then((z) => Buffer.from(z.toString("latin1").replace(/f\/x\.txt/g, "../x.tx"), "latin1"))), ZipReadError);
  await assert.rejects(open("dup.zip", await collect([{ ...buf("x"), name: "a" }, { ...buf("y"), name: "A" }])), /repetida/);
  await assert.rejects(open("junk.zip", Buffer.from("esto no es un zip")), /no es un ZIP/);

  const ok = await collect([buf("dato")]);
  const flipped = Buffer.from(ok);
  flipped[30 + "f/dato.txt".length] = flipped[30 + "f/dato.txt".length]! ^ 0xff; // un byte del contenido
  const z = await open("crc.zip", flipped);
  await assert.rejects(z.readAll(z.entries[0]!, 100), /CRC/);
  await z.close();
  const enc = Buffer.from(ok);
  enc.writeUInt16LE(1, 6); // bit 0 de la cabecera local no se mira, pero sí el del directorio central
  const cd = enc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  enc.writeUInt16LE(1, cd + 8);
  await assert.rejects(open("enc.zip", enc), /cifrado/);
});

test("el lector descomprime deflate y no se fía del tamaño declarado", async () => {
  const data = Buffer.from("x".repeat(5000));
  const comp = deflateRawSync(data);
  const name = Buffer.from("d.txt");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const mk = (declared: number) => {
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(crc32(data), 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(declared, 24); cen.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + comp.length, 16);
    return Buffer.concat([local, name, comp, cen, name, end]);
  };
  const f = path.join(dir, "defl.zip");
  writeFileSync(f, mk(data.length));
  const z = await ZipFile.open(f);
  assert.ok((await z.readAll(z.entries[0]!, 1e6)).equals(data));
  await z.close();
  // Declara menos de lo que realmente se descomprime: se corta.
  writeFileSync(f, mk(100));
  const z2 = await ZipFile.open(f);
  await assert.rejects(z2.readAll(z2.entries[0]!, 1e6), /mayor de lo declarado/);
  await z2.close();
});

test("upgrade: identidad en la versión 1 y rechazo de versiones futuras o inválidas", () => {
  const manifest = { format: EXPORT_FORMAT, formatVersion: 1, appVersion: "1", exportedAt: new Date().toISOString(), options: { attachments: false, scope: "board" }, counts: {}, checksums: {} } as ExportManifest;
  const data = { a: 1 };
  const out = upgrade(manifest, data);
  assert.equal(out.data, data);
  assert.equal(out.manifest.formatVersion, EXPORT_FORMAT_VERSION);
  assert.throws(() => assertSupportedVersion({ formatVersion: EXPORT_FORMAT_VERSION + 1 }), /más reciente/);
  assert.throws(() => assertSupportedVersion({ formatVersion: 0 }), /no es válida/);
  assert.throws(() => assertSupportedVersion({ formatVersion: Number.NaN }), /no es válida/);
  // Con un destino futuro y sin paso de mejora, se rechaza en lugar de importar a ciegas.
  assert.throws(() => upgrade(manifest, data, 2), /tan antigua/);
});

test("menciones y tope de importación", () => {
  assert.equal(mapMentions("hola @[Ana](user:abc1) y @[Luis](user:z9)", (n, id) => `<${n}:${id}>`), "hola <Ana:abc1> y <Luis:z9>");
  assert.equal(mapMentions("sin menciones", () => "x"), "sin menciones");
  assert.equal(importMaxBytes(undefined), 500 * 1024 * 1024);
  assert.equal(importMaxBytes("50"), 50 * 1024 * 1024);
  assert.equal(importMaxBytes("0"), 500 * 1024 * 1024);
  assert.equal(importMaxBytes("abc"), 500 * 1024 * 1024);
});

test("el lector rechaza un directorio central desproporcionado para su número de entradas", async () => {
  // 5 MB de «directorio central» para una sola entrada: no se reserva memoria, se rechaza.
  const body = Buffer.alloc(5 * 1024 * 1024);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(body.length, 12);
  eocd.writeUInt32LE(0, 16);
  const file = path.join(dir, "cd-enorme.zip");
  writeFileSync(file, Buffer.concat([body, eocd]));
  await assert.rejects(ZipFile.open(file), /Directorio central no válido/);
});
