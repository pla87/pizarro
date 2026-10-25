import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { backupStem, decryptChunks, encryptChunks, writeBackupFile, type TableBatch } from "../src/lib/backup-core";
import { DirDestination, listObjectKeys, listStems, pruneDestination, readManifest, S3Destination, syncBackup, type BackupDestination } from "../src/lib/backup-dest";
import {
  buildManifest,
  decodeManifest,
  encodeManifest,
  fileNameKey,
  hashFiles,
  objectKey,
  safeRelPath,
  scanFiles,
  selectGarbage,
  type FullManifest,
  type ManifestFile,
} from "../src/lib/backup-files";
import { restoreFiles } from "../src/lib/backup-restore";
import { S3Client } from "../src/lib/backup-s3";
import { startFakeS3 } from "./fake-s3";

const key = randomBytes(32);
const nameKey = fileNameKey(key);
const tmpDirs: string[] = [];
const tmp = async () => {
  const d = await mkdtemp(path.join(tmpdir(), "pz-bkfiles-"));
  tmpDirs.push(d);
  return d;
};
after(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

async function* chunked(buf: Buffer, size: number): AsyncGenerator<Buffer> {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}
async function collect(src: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of src) parts.push(c);
  return Buffer.concat(parts);
}

test("cifrado en streaming: ida y vuelta con trozos de cualquier tamaño; alterado o con otra clave, falla", async () => {
  const plain = randomBytes(70_000);
  const magic = Buffer.from("PZXX1\n");
  const enc = await collect(encryptChunks(chunked(plain, 1000), key, magic));
  assert.equal(enc.length, plain.length + magic.length + 28);
  for (const size of [1, 7, 16, 17, 4096, 1 << 20]) assert.ok((await collect(decryptChunks(chunked(enc, size), key, magic))).equals(plain));
  const bad = Buffer.from(enc);
  bad[100] = bad[100]! ^ 1;
  await assert.rejects(collect(decryptChunks(chunked(bad, 999), key, magic)));
  await assert.rejects(collect(decryptChunks(chunked(enc, 999), randomBytes(32), magic)));
  await assert.rejects(collect(decryptChunks(chunked(enc.subarray(0, 20), 5), key, magic)), /corto/);
});

const sampleManifest = (stem: string, files: ManifestFile[]): FullManifest =>
  buildManifest({
    stem,
    dbFile: `${stem}.pzbak`,
    dbBytes: 10,
    dbSha256: "a".repeat(64),
    db: { version: 1, createdAt: "2026-10-25T03:00:00.000Z", migration: "20261031120000_job_run", build: null, tables: [{ name: "User", rows: 2 }], totalRows: 2, sha256: "b".repeat(64) },
    files,
  });

test("manifiesto: codificar y decodificar; clave equivocada o entrada peligrosa, error", async () => {
  const files: ManifestFile[] = [{ p: "abc.webp", s: 3, h: "c".repeat(64), o: "d".repeat(64) }, { p: "releases/x.bin", s: 5, h: "e".repeat(64), o: "f".repeat(64) }];
  const m = sampleManifest("pizarro-backup-20261025T030000Z", files);
  assert.equal(m.fileCount, 2);
  assert.equal(m.fileBytes, 8);
  const bytes = await encodeManifest(m, key);
  assert.ok(!bytes.includes("releases/x.bin"));
  assert.deepEqual(await decodeManifest(bytes, key), m);
  await assert.rejects(decodeManifest(bytes, randomBytes(32)), /BACKUP_KEY/);
  const evil = await encodeManifest({ ...m, files: [{ ...files[0]!, p: "../../etc/passwd" }], fileCount: 1 }, key);
  await assert.rejects(decodeManifest(evil, key), /inválida/);
});

test("rutas seguras y nombres de copia", () => {
  for (const ok of ["a.webp", "releases/b.bin", "docs/p1/informe final.pdf"]) assert.ok(safeRelPath(ok), ok);
  for (const bad of ["", "/etc/x", "../x", "a/../b", "a//b", "a\\b", "./a"]) assert.ok(!safeRelPath(bad), bad);
  assert.equal(backupStem("pizarro-backup-20261025T030000Z.pzman"), "pizarro-backup-20261025T030000Z");
  assert.equal(backupStem("pizarro-backup-20261025T030000Z.pzbak.json"), "pizarro-backup-20261025T030000Z");
  assert.equal(backupStem("status.json"), null);
});

test("recolección de basura: solo objetos que ningún manifiesto conservado nombra", () => {
  const id = (c: string) => c.repeat(64);
  const present = [objectKey(id("a")), objectKey(id("b")), objectKey(id("c")), "files/zz/raro", "otro.txt"];
  const garbage = selectGarbage(present, [{ files: [{ o: id("a") }] }, { files: [{ o: id("c") }, { o: id("a") }] }]);
  assert.deepEqual(garbage, [objectKey(id("b"))]);
  assert.deepEqual(selectGarbage(present, []), [objectKey(id("a")), objectKey(id("b")), objectKey(id("c"))]);
});

test("recorrido de UPLOAD_DIR: sin backups/, temporales ni ocultos; la caché evita releer", async () => {
  const root = await tmp();
  await mkdir(path.join(root, "backups/files/aa"), { recursive: true });
  await mkdir(path.join(root, "releases"), { recursive: true });
  await mkdir(path.join(root, "documentos/p1"), { recursive: true });
  await writeFile(path.join(root, "a1.webp"), "uno");
  await writeFile(path.join(root, "a1.thumb.webp"), "mini");
  await writeFile(path.join(root, "a2.bin.123.tmp"), "temporal");
  await writeFile(path.join(root, ".oculto"), "x");
  await writeFile(path.join(root, "releases/r1.bin"), "release");
  await writeFile(path.join(root, "documentos/p1/acta.pdf"), "pdf");
  await writeFile(path.join(root, "backups/status.json"), "{}");
  const files = await scanFiles(root, [path.join(root, "backups")]);
  assert.deepEqual(files.map((f) => f.rel), ["a1.thumb.webp", "a1.webp", "documentos/p1/acta.pdf", "releases/r1.bin"]);
  const first = await hashFiles(files, {}, nameKey);
  assert.equal(first.hashed, 4);
  const second = await hashFiles(files, first.index, nameKey);
  assert.equal(second.hashed, 0);
  assert.deepEqual(second.entries, first.entries);
  // Cambia un fichero (y su fecha): solo ese se vuelve a leer.
  await writeFile(path.join(root, "a1.webp"), "UNO!");
  await utimes(path.join(root, "a1.webp"), new Date(), new Date(Date.now() + 5000));
  const third = await hashFiles(await scanFiles(root, [path.join(root, "backups")]), second.index, nameKey);
  assert.equal(third.hashed, 1);
});

async function* oneTable(): AsyncGenerator<TableBatch> {
  yield { name: "User", rows: [JSON.stringify({ id: "u1" })] };
}

/** Prepara UPLOAD_DIR con ficheros y una copia (volcado + manifiesto) con fecha `at`. */
async function makeBackup(root: string, backups: string, at: Date): Promise<{ manifest: FullManifest; bytes: Buffer; dumpFile: string }> {
  const stem = `pizarro-backup-${at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
  const dumpFile = path.join(backups, `${stem}.pzbak`);
  await mkdir(backups, { recursive: true });
  const { manifest: dbm, bytes } = await writeBackupFile({ file: dumpFile, key, tables: oneTable(), migration: "20261031120000_job_run", now: at });
  const { entries } = await hashFiles(await scanFiles(root, [backups]), {}, nameKey);
  const { fileSha256 } = await import("../src/lib/backup-core");
  const manifest = buildManifest({ stem, dbFile: `${stem}.pzbak`, dbBytes: bytes, dbSha256: await fileSha256(dumpFile), db: dbm, files: entries });
  return { manifest, bytes: await encodeManifest(manifest, key), dumpFile };
}

const dumpOf = (m: FullManifest, file: string) => ({ size: m.db.bytes, open: () => createReadStream(file) });

test("destinos: subida incremental, reanudación, retención y restauración de ficheros (carpeta y S3 falso)", async () => {
  const s3 = await startFakeS3({ accessKeyId: "AKIDTEST", secretAccessKey: "secreto-de-prueba", pageSize: 2 });
  try {
    const root = await tmp();
    const backups = path.join(root, "backups");
    await mkdir(path.join(root, "releases"), { recursive: true });
    await writeFile(path.join(root, "a1.webp"), randomBytes(50_000));
    await writeFile(path.join(root, "a2.bin"), randomBytes(1234));
    await writeFile(path.join(root, "copia-de-a2.bin"), await readFile(path.join(root, "a2.bin"))); // mismo contenido: un objeto
    await writeFile(path.join(root, "releases/r1.bin"), "release");
    const local = new DirDestination("local", backups, true);
    const s3dest = new S3Destination(new S3Client({ endpoint: s3.endpoint, bucket: s3.bucket, region: "auto", accessKeyId: "AKIDTEST", secretAccessKey: "secreto-de-prueba", prefix: "pizarro/" }));
    const ext = new DirDestination("dir", await tmp(), true);

    const b1 = await makeBackup(root, backups, new Date("2026-10-01T03:00:00Z"));
    assert.equal(b1.manifest.fileCount, 4);
    const r1 = await syncBackup(local, b1.manifest, b1.bytes, dumpOf(b1.manifest, b1.dumpFile), { key, uploadRoot: root });
    assert.equal(r1.uploaded, 3);
    const store = { dest: local as BackupDestination, keys: await listObjectKeys(local) };
    // Al externo, desde el almacén local (ya cifrado) y desde UPLOAD_DIR.
    for (const dest of [s3dest, ext] as BackupDestination[]) {
      const r = await syncBackup(dest, b1.manifest, b1.bytes, dumpOf(b1.manifest, b1.dumpFile), { key, uploadRoot: root, store: dest === ext ? undefined : store });
      assert.deepEqual([r.uploaded, r.skipped], [3, 0]);
    }
    assert.ok([...s3.objects.keys()].every((k) => k.startsWith("pizarro/")));
    assert.ok(s3.objects.has(`pizarro/${b1.manifest.stem}.pzman`));
    assert.ok(![...s3.objects.values()].some((v) => v.includes("release")), "nada en claro en el destino");

    // Segunda copia con un fichero nuevo: solo sube ese. Si se corta a medias, la siguiente reanuda.
    await writeFile(path.join(root, "a3.webp"), randomBytes(3000));
    await writeFile(path.join(root, "a4.webp"), randomBytes(3000));
    const b2 = await makeBackup(root, backups, new Date("2026-10-02T03:00:00Z"));
    let puts = 0;
    s3.failIf = (method, k) => method === "PUT" && k.includes("files/") && ++puts > 1;
    await assert.rejects(syncBackup(s3dest, b2.manifest, b2.bytes, dumpOf(b2.manifest, b2.dumpFile), { key, uploadRoot: root }), /HTTP 500/);
    assert.ok(!s3.objects.has(`pizarro/${b2.manifest.stem}.pzman`), "sin manifiesto si falla");
    s3.failIf = null;
    const r2 = await syncBackup(s3dest, b2.manifest, b2.bytes, dumpOf(b2.manifest, b2.dumpFile), { key, uploadRoot: root });
    assert.deepEqual([r2.uploaded, r2.skipped], [1, 4]);
    assert.deepEqual((await listStems(s3dest)).map((s) => s.stem), [b2.manifest.stem, b1.manifest.stem]);
    assert.equal((await readManifest(s3dest, b2.manifest.stem, key)).fileCount, 6);

    // Retención: con 1 diaria y 0 mensuales se borra la copia del día 1 y el objeto que solo ella nombraba.
    await rm(path.join(root, "a1.webp"));
    const b3 = await makeBackup(root, backups, new Date("2026-10-03T03:00:00Z"));
    await syncBackup(s3dest, b3.manifest, b3.bytes, dumpOf(b3.manifest, b3.dumpFile), { key, uploadRoot: root, store });
    const pruned = await pruneDestination(s3dest, key, { daily: 1, monthly: 0 });
    assert.deepEqual([pruned.removedBackups, pruned.removedObjects, pruned.gcSkipped], [2, 1, null]);
    assert.equal((await listObjectKeys(s3dest)).size, 4);

    // Restaurar los ficheros de la última copia desde S3 en una carpeta vacía: iguales a los originales.
    const target = await tmp();
    const m3 = await readManifest(s3dest, b3.manifest.stem, key);
    const res = await restoreFiles(s3dest, m3, target, key);
    assert.deepEqual([res.restored, res.skipped], [5, 0]);
    for (const f of m3.files) assert.ok((await readFile(path.join(target, f.p))).equals(await readFile(path.join(root, f.p))), f.p);
    // Repetirla no vuelve a descargar nada; un objeto alterado se rechaza.
    assert.equal((await restoreFiles(s3dest, m3, target, key)).skipped, 5);
    const victim = `pizarro/${objectKey(m3.files.find((f) => f.p === "releases/r1.bin")!.o)}`;
    const bad = Buffer.from(s3.objects.get(victim)!);
    bad[bad.length - 20] = bad[bad.length - 20]! ^ 1;
    s3.objects.set(victim, bad);
    await rm(path.join(target, "releases/r1.bin"));
    await assert.rejects(restoreFiles(s3dest, m3, target, key), /releases\/r1.bin/);
    await assert.rejects(readFile(path.join(target, "releases/r1.bin")), "no queda un fichero a medias");

    // Firma: con otra clave secreta, S3 responde 403 y el error no muestra secretos.
    const wrong = new S3Client({ endpoint: s3.endpoint, bucket: s3.bucket, region: "auto", accessKeyId: "AKIDTEST", secretAccessKey: "otra-clave", prefix: "" });
    await assert.rejects(wrong.head("x"), (err: Error) => /403/.test(err.message) && !err.message.includes("otra-clave"));
  } finally {
    await s3.close();
  }
});

test("BACKUP_LOCAL_FILES: automático según haya destino externo; 1/0 lo fuerzan", async () => {
  const { localFilesEnabled } = await import("../src/lib/backup-dest");
  assert.equal(localFilesEnabled({}), true);
  assert.equal(localFilesEnabled({ BACKUP_EXTERNAL_DIR: "/copias" }), false);
  assert.equal(localFilesEnabled({ BACKUP_EXTERNAL_DIR: "/copias", BACKUP_LOCAL_FILES: "1" }), true);
  assert.equal(localFilesEnabled({ BACKUP_LOCAL_FILES: "0" }), false);
});
