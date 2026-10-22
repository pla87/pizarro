import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import {
  backupFileName,
  orderTables,
  parseBackupFileName,
  parseBackupKey,
  readLines,
  selectBackupsToKeep,
  verifyBackupFile,
  writeBackupFile,
  type TableBatch,
} from "../src/lib/backup-core";

const key = randomBytes(32);

async function* tables(): AsyncGenerator<TableBatch> {
  yield { name: "User", rows: [] };
  yield { name: "User", rows: [JSON.stringify({ id: "u1", name: "Ana «ñ» 日本" }), JSON.stringify({ id: "u2", name: "Luis\nlínea" })] };
  yield { name: "Empty", rows: [] };
  yield { name: "Task", rows: [JSON.stringify({ id: "t1", position: 1.5, tags: ["a"], when: "2026-10-22T10:00:00.000" })] };
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "pz-backup-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("BACKUP_KEY: solo 32 bytes en base64", () => {
  assert.equal(parseBackupKey(undefined), null);
  assert.equal(parseBackupKey(""), null);
  assert.equal(parseBackupKey(randomBytes(16).toString("base64")), null);
  assert.equal(parseBackupKey(key.toString("base64"))?.length, 32);
});

test("cifrar y descifrar: ida y vuelta con manifiesto correcto", async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, "a.pzbak");
    const { manifest, bytes } = await writeBackupFile({ file, key, tables: tables(), migration: "20261023130000_cuota_copias", now: new Date("2026-10-22T03:00:00Z") });
    assert.ok(bytes > 0);
    assert.equal(manifest.totalRows, 3);
    assert.deepEqual(manifest.tables, [{ name: "User", rows: 2 }, { name: "Empty", rows: 0 }, { name: "Task", rows: 1 }]);
    // El fichero no contiene el texto en claro.
    assert.ok(!(await readFile(file)).includes("Ana"));
    const verified = await verifyBackupFile(file, key);
    assert.deepEqual(verified.manifest, manifest);
    const lines: string[] = [];
    for await (const l of readLines(file, key)) lines.push(l);
    assert.equal(lines.length, 4);
    assert.deepEqual(JSON.parse(lines[0]!), { t: "User", r: { id: "u1", name: "Ana «ñ» 日本" } });
    assert.equal(JSON.parse(lines[1]!).r.name, "Luis\nlínea");
    assert.ok(lines[3]!.startsWith('{"manifest":'));
  });
});

test("con otra clave no se descifra", async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, "a.pzbak");
    await writeBackupFile({ file, key, tables: tables(), migration: null });
    await assert.rejects(() => verifyBackupFile(file, randomBytes(32)));
  });
});

test("un byte alterado o un fichero truncado se detecta", async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, "a.pzbak");
    await writeBackupFile({ file, key, tables: tables(), migration: null });
    const good = await readFile(file);
    const flipped = Buffer.from(good);
    flipped[Math.floor(flipped.length / 2)]! ^= 0xff;
    await writeFile(file, flipped);
    await assert.rejects(() => verifyBackupFile(file, key));
    await writeFile(file, good.subarray(0, good.length - 40));
    await assert.rejects(() => verifyBackupFile(file, key));
    await writeFile(file, Buffer.from("no es una copia"));
    await assert.rejects(() => verifyBackupFile(file, key));
  });
});

test("manifiesto: las cuentas deben coincidir con los datos", async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, "a.pzbak");
    // Se fabrica una copia con un manifiesto mentiroso: se cifra con el mismo formato a mano.
    const { manifest } = await writeBackupFile({ file, key, tables: tables(), migration: null });
    const lies = path.join(dir, "lies.pzbak");
    const lines: string[] = [];
    for await (const l of readLines(file, key)) lines.push(l);
    const fake = { ...manifest, tables: manifest.tables.map((t) => (t.name === "User" ? { ...t, rows: 3 } : t)) };
    lines[lines.length - 1] = JSON.stringify({ manifest: fake });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(lines.join("\n") + "\n"))), cipher.final()]);
    await writeFile(lies, Buffer.concat([Buffer.from("PZBK1\n"), iv, body, cipher.getAuthTag()]));
    await assert.rejects(() => verifyBackupFile(lies, key), /manifiesto dice 3 filas/);
  });
});

test("orden de tablas por claves foráneas", () => {
  const { order, cyclic } = orderTables(["Task", "User", "Column", "Project"], [
    { child: "Task", parent: "Column" },
    { child: "Column", parent: "Project" },
    { child: "Task", parent: "User" },
    { child: "Project", parent: "Project" },
  ]);
  assert.equal(cyclic, false);
  assert.ok(order.indexOf("Project") < order.indexOf("Column"));
  assert.ok(order.indexOf("Column") < order.indexOf("Task"));
  assert.ok(order.indexOf("User") < order.indexOf("Task"));
  assert.equal(orderTables(["A", "B"], [{ child: "A", parent: "B" }, { child: "B", parent: "A" }]).cyclic, true);
});

test("nombres de fichero y retención 14 diarias + 6 mensuales", () => {
  const d = new Date("2026-10-22T03:15:00Z");
  const name = backupFileName(d);
  assert.equal(name, "pizarro-backup-20261022T031500Z.pzbak");
  assert.equal(parseBackupFileName(name)?.toISOString(), d.toISOString());
  assert.equal(parseBackupFileName("otra-cosa.pzbak"), null);

  // Una copia al día durante 400 días (más una segunda el último día).
  const names: string[] = [];
  for (let i = 0; i < 400; i++) names.push(backupFileName(new Date(Date.UTC(2026, 9, 22, 3, 0, 0) - i * 86_400_000)));
  names.push(backupFileName(new Date("2026-10-22T20:00:00Z")));
  const keep = selectBackupsToKeep(names);
  // 14 días + (meses distintos de los últimos 6 que no coincidan con esos días).
  const kept = [...keep].sort().reverse();
  assert.ok(keep.has(backupFileName(new Date("2026-10-22T20:00:00Z"))), "la más reciente del día se queda");
  assert.ok(!keep.has(backupFileName(new Date("2026-10-22T03:00:00Z"))), "la otra del mismo día se descarta");
  const months = new Set(kept.map((n) => parseBackupFileName(n)!.toISOString().slice(0, 7)));
  assert.ok(months.size >= 6);
  assert.ok(kept.length >= 14 && kept.length <= 14 + 6);
  assert.ok(!keep.has(backupFileName(new Date(Date.UTC(2026, 9, 22, 3) - 100 * 86_400_000))), "una copia diaria antigua no se conserva");
});
