// Lo que el layout pide en cada página de un administrador (recordatorio de licencia, aviso de versión, aviso de copias)
// va con un minuto de memoria en el proceso, invalidada por las acciones que lo cambian; con licencia registrada, el
// recordatorio no hace ninguna otra consulta.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import pg from "pg";
import { db, expectOk, loginAs, makeUser } from "./helpers";
import { removeLicense, saveLicense, setPersonalUseDeclared, snoozeLicenseNudge } from "../../src/actions/license";
import { licenseNudgeFor } from "../../src/lib/license-registry";
import { invalidateMemo } from "../../src/lib/memo";
import { dismissUpdateNotice, getUpdateNotice } from "../../src/lib/update-check";

const DAY = 24 * 60 * 60 * 1000;

/** Consultas que llegan a PostgreSQL mientras corre `fn`. */
async function queries<T>(fn: () => Promise<T>): Promise<{ result: T; n: number }> {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const orig = proto.query;
  let n = 0;
  proto.query = function (this: unknown, ...args: unknown[]) {
    n++;
    return orig.apply(this, args);
  };
  try {
    return { result: await fn(), n };
  } finally {
    proto.query = orig;
  }
}

describe("memoria de las páginas de administración", () => {
  test("recordatorio de licencia: con licencia, ninguna consulta más; las acciones lo invalidan al momento", async () => {
    await db.appState.deleteMany({ where: { key: { in: ["commercialLicense", "licensePersonalUse"] } } });
    invalidateMemo("license:");
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const first = await db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    const later = new Date(Math.max(first!.createdAt.getTime() + 8 * DAY, Date.now() + DAY));

    // Sin licencia: la primera vez, licencia + uso personal + alta + posposición; después, de memoria.
    const cold = await queries(() => licenseNudgeFor(admin, later));
    assert.equal(cold.result, true);
    assert.ok(cold.n <= 4, `${cold.n} consultas`);
    const warm = await queries(() => licenseNudgeFor(admin, later));
    assert.deepEqual(warm, { result: true, n: 0 });

    // Posponerlo se ve enseguida.
    expectOk(await snoozeLicenseNudge());
    assert.equal(await licenseNudgeFor(admin, new Date(Date.now() + DAY)), false);

    // Con licencia registrada: la acción invalida; luego solo licencia y uso personal, y después nada.
    expectOk(await saveLicense({ holder: "Empresa Ejemplo", reference: "", email: "" }));
    const licensed = await queries(() => licenseNudgeFor(admin, later));
    assert.equal(licensed.result, false);
    assert.ok(licensed.n <= 2, `con licencia, ${licensed.n} consultas (antes, 4 en cada página)`);
    assert.deepEqual(await queries(() => licenseNudgeFor(admin, later)), { result: false, n: 0 });

    // Quitarla o declarar uso personal también se ve al momento.
    expectOk(await removeLicense());
    assert.equal(await licenseNudgeFor(admin, new Date(Date.now() + 40 * DAY)), true);
    expectOk(await setPersonalUseDeclared(true));
    assert.equal(await licenseNudgeFor(admin, new Date(Date.now() + 40 * DAY)), false);
    expectOk(await setPersonalUseDeclared(false));
  });

  test("aviso de versión: consulta la base la primera vez, ninguna después; descartarlo lo invalida", async () => {
    const saved = process.env.UPDATE_CHECK;
    delete process.env.UPDATE_CHECK;
    try {
      // Caché de GitHub reciente (no toca consultar) con una versión más nueva.
      const value = JSON.stringify({ checkedAt: Date.now(), latest: "99.0.0", url: "https://github.com/pla87/pizarro/releases/tag/v99.0.0" });
      await db.appState.upsert({ where: { key: "updateCheck" }, create: { key: "updateCheck", value }, update: { value } });
      await db.appState.deleteMany({ where: { key: "updateDismissed" } });
      invalidateMemo("update:notice");
      const cold = await queries(() => getUpdateNotice());
      assert.equal(cold.result?.version, "99.0.0");
      assert.ok(cold.n >= 1, "la primera vez consulta la base");
      const warm = await queries(() => getUpdateNotice());
      assert.equal(warm.n, 0);
      assert.equal(warm.result?.version, "99.0.0");
      await dismissUpdateNotice("99.0.0");
      assert.equal(await getUpdateNotice(), null, "descartado: se ve al momento");
    } finally {
      if (saved === undefined) delete process.env.UPDATE_CHECK;
      else process.env.UPDATE_CHECK = saved;
      await db.appState.deleteMany({ where: { key: { in: ["updateCheck", "updateDismissed"] } } });
      invalidateMemo("update:notice");
    }
  });
});
