// Registro de la licencia comercial (informativo): solo admin, validación, anotación en el registro y quitar.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeUser } from "./helpers";
import { removeLicense, saveLicense } from "../../src/actions/license";
import { getLicense } from "../../src/lib/license-registry";
import { flushLogs } from "../../src/lib/log";

describe("licencia comercial registrada", () => {
  test("solo el admin la registra; se valida, se anota en el registro y se puede quitar", async () => {
    await db.appState.deleteMany({ where: { key: "commercialLicense" } });
    assert.equal(await getLicense(), null);
    const member = await makeUser();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(member);
    expectFail(await saveLicense({ holder: "Empresa Ejemplo", reference: "F-1", email: "" }), /No tienes permiso/);
    expectFail(await removeLicense(), /No tienes permiso/);
    await loginAs(admin);
    expectFail(await saveLicense({ holder: "  ", reference: "F-1", email: "" }));
    expectFail(await saveLicense({ holder: "Empresa Ejemplo", reference: "", email: "" }));
    expectFail(await saveLicense({ holder: "Empresa Ejemplo", reference: "F-1", email: "no-es-email" }));
    assert.equal(await getLicense(), null);
    const rec = expectOk(await saveLicense({ holder: " Empresa Ejemplo ", reference: "F-1", email: "compras@example.com" }));
    assert.equal(rec.holder, "Empresa Ejemplo");
    assert.match(rec.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(await getLicense(), rec);
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { action: "settings.saveLicense" }, select: { message: true } });
    assert.ok(logs.some((l) => /Empresa Ejemplo/.test(l.message)));
    expectOk(await removeLicense());
    assert.equal(await getLicense(), null);
  });
});
