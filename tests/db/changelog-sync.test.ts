// Historial de versiones (AppVersionLog) desde changelog.json: solo se escriben las versiones nuevas o cambiadas.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { db, expectFail, expectOk, loginAs, logout, makeUser, SESSION_EXPIRED } from "./helpers";

const { syncChangelog } = await import("../../src/lib/changelog-sync");
const { changelogVersions } = await import("../../src/lib/changelog-page");
const { getOlderVersions } = await import("../../src/actions/changelog");

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

test("Historial de versiones: la página trae las más recientes en orden SemVer y getOlderVersions el resto, con sesión", async () => {
  const mine = ["900.0.9", "900.0.10", "900.1.0", "900.0.2"];
  for (const v of mine) {
    await db.appVersionLog.create({ data: { version: v, releasedAt: new Date("2026-01-01T00:00:00Z"), summary: `S ${v}`, changes: changes(v), summaryEn: `E ${v}`, changesEn: changes(`${v}-en`) } });
  }
  // 900.x es mayor que cualquier versión real: son las primeras. 900.0.10 va antes que 900.0.9 (no es orden de texto).
  const first = await changelogVersions({ en: false, admin: true }, 0, 3);
  assert.deepEqual(first.versions.map((v) => v.version), ["900.1.0", "900.0.10", "900.0.9"]);
  assert.equal(first.versions[0]!.summary, "S 900.1.0");
  const en = await changelogVersions({ en: true, admin: true }, 1, 1);
  assert.deepEqual([en.versions[0]!.summary, en.versions[0]!.changes.nuevas], ["E 900.0.10", ["900.0.10-en"]]);
  assert.equal(first.total, en.total);

  logout();
  expectFail(await getOlderVersions(3), SESSION_EXPIRED);
  await loginAs(await makeUser());
  const rest = expectOk(await getOlderVersions(3));
  assert.equal(rest.versions[0]!.version, "900.0.2");
  assert.equal(rest.versions.length, first.total - 3);
  // Un valor raro empieza por la primera (no rompe ni se salta versiones).
  assert.equal(expectOk(await getOlderVersions(-5)).versions.length, first.total);
  logout();
  await db.appVersionLog.deleteMany({ where: { version: { in: mine } } });
});

test("Historial de versiones: «Cambios técnicos / DB» solo llega a quien administra (desde el servidor)", async () => {
  const v = "900.2.0";
  const withTech = { nuevas: ["Nueva"], mejoras: [], correcciones: [], tecnicos: ["hasTaskCapacity en e2e"] };
  await db.appVersionLog.create({ data: { version: v, releasedAt: new Date("2026-01-01T00:00:00Z"), summary: "S", changes: withTech, summaryEn: "E", changesEn: withTech } });
  try {
    const member = await changelogVersions({ en: false, admin: false }, 0, 1);
    assert.equal(member.versions[0]!.version, v);
    assert.deepEqual(member.versions[0]!.changes, { ...withTech, tecnicos: [] });
    assert.deepEqual((await changelogVersions({ en: true, admin: false }, 0, 1)).versions[0]!.changes.tecnicos, []);
    assert.deepEqual((await changelogVersions({ en: false, admin: true }, 0, 1)).versions[0]!.changes.tecnicos, withTech.tecnicos);
    // La acción de «Ver más» mira el rol de la sesión.
    await loginAs(await makeUser());
    assert.ok(expectOk(await getOlderVersions(0)).versions.every((x) => x.changes.tecnicos.length === 0));
    await loginAs(await makeUser({ role: "ADMIN" }));
    assert.deepEqual(expectOk(await getOlderVersions(0)).versions.find((x) => x.version === v)!.changes.tecnicos, withTech.tecnicos);
  } finally {
    logout();
    await db.appVersionLog.deleteMany({ where: { version: v } });
  }
});
