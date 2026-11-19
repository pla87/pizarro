// Historial de versiones (AppVersionLog) desde changelog.json: solo se escriben las versiones nuevas o cambiadas.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { db } from "./helpers";

const { syncChangelog } = await import("../../src/lib/changelog-sync");

const dir = await mkdtemp(path.join(tmpdir(), "pz-changelog-"));
after(() => rm(dir, { recursive: true, force: true }));

const changes = (s: string) => ({ nuevas: [s], mejoras: [], correcciones: [], tecnicos: [] });
const VERSIONS = ["900.0.1", "900.0.2", "900.0.3"];

async function write(versions: unknown[]): Promise<string> {
  const file = path.join(dir, "changelog.json");
  await writeFile(file, JSON.stringify({ versions }));
  return file;
}

const syncedAt = async () =>
  Object.fromEntries((await db.appVersionLog.findMany({ where: { version: { in: VERSIONS } }, select: { version: true, syncedAt: true } })).map((r) => [r.version, r.syncedAt.getTime()]));

test("syncChangelog: inserta las que faltan y solo reescribe las que cambian", async () => {
  const base = [
    { version: "900.0.3", date: "2026-01-03", releasedAt: "2026-01-03T10:00:00+01:00", summary: "Tres", changes: changes("c"), en: { summary: "Three", changes: changes("c-en") } },
    { version: "900.0.2", date: "2026-01-02", summary: "Dos", changes: changes("b") },
    { version: "900.0.1", date: "2026-01-01", summary: "Uno", changes: changes("a") },
  ];
  assert.equal(await syncChangelog(db, await write(base)), 3);
  const first = await syncedAt();
  assert.deepEqual(Object.keys(first).sort(), VERSIONS);

  // Sin cambios: no se escribe ninguna (syncedAt, que es @updatedAt, no se mueve).
  await new Promise((r) => setTimeout(r, 20));
  await syncChangelog(db, await write(base));
  assert.deepEqual(await syncedAt(), first);

  // Cambia el inglés de una: solo esa se reescribe; se añade una nueva.
  const edited = structuredClone(base);
  edited[0]!.en!.changes = changes("c-en-2");
  await db.appVersionLog.deleteMany({ where: { version: "900.0.1" } });
  await syncChangelog(db, await write(edited));
  const second = await syncedAt();
  assert.ok(second["900.0.3"]! > first["900.0.3"]!);
  assert.equal(second["900.0.2"], first["900.0.2"]);
  assert.ok(second["900.0.1"]);
  const row = await db.appVersionLog.findUniqueOrThrow({ where: { version: "900.0.3" } });
  assert.deepEqual(row.changesEn, changes("c-en-2"));
  assert.equal(row.releasedAt.toISOString(), "2026-01-03T09:00:00.000Z");

  // Quitar la traducción también cuenta como cambio.
  delete (edited[0] as { en?: unknown }).en;
  await syncChangelog(db, await write(edited));
  assert.equal((await db.appVersionLog.findUniqueOrThrow({ where: { version: "900.0.3" } })).changesEn, null);
  await db.appVersionLog.deleteMany({ where: { version: { in: VERSIONS } } });
});
