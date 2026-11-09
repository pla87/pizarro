// Registro de la licencia comercial (informativo): solo admin, validación, anotación en el registro y quitar;
// declaración de uso personal y recordatorio de licencia para administradores.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeUser } from "./helpers";
import { removeLicense, saveLicense, setPersonalUseDeclared, snoozeLicenseNudge } from "../../src/actions/license";
import { getLicense, getLicenseStatus, licenseNudgeFor } from "../../src/lib/license-registry";
import { flushLogs } from "../../src/lib/log";

const DAY = 24 * 60 * 60 * 1000;
const reset = () => db.appState.deleteMany({ where: { key: { in: ["commercialLicense", "licensePersonalUse"] } } });

describe("licencia comercial registrada", () => {
  test("solo el admin la registra; se valida, se anota en el registro y se puede quitar", async () => {
    await reset();
    assert.equal(await getLicense(), null);
    const member = await makeUser();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(member);
    expectFail(await saveLicense({ holder: "Empresa Ejemplo", reference: "F-1", email: "" }), /No tienes permiso/);
    expectFail(await removeLicense(), /No tienes permiso/);
    expectFail(await setPersonalUseDeclared(true), /No tienes permiso/);
    expectFail(await snoozeLicenseNudge(), /No tienes permiso/);
    await loginAs(admin);
    expectFail(await saveLicense({ holder: "  ", reference: "F-1", email: "" }));
    expectFail(await saveLicense({ holder: "Empresa Ejemplo", reference: "F-1", email: "no-es-email" }));
    assert.equal(await getLicense(), null);
    // El nº de factura o recibo es opcional.
    const bare = expectOk(await saveLicense({ holder: "Empresa Ejemplo", reference: "", email: "" }));
    assert.equal(bare.reference, "");
    const rec = expectOk(await saveLicense({ holder: " Empresa Ejemplo ", reference: "F-1", email: "compras@example.com" }));
    assert.equal(rec.holder, "Empresa Ejemplo");
    assert.match(rec.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(await getLicense(), rec);
    assert.equal((await getLicenseStatus()).kind, "licensed");
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { action: "settings.saveLicense" }, select: { message: true } });
    assert.ok(logs.some((l) => /Empresa Ejemplo \(F-1\)/.test(l.message)));
    expectOk(await removeLicense());
    assert.equal(await getLicense(), null);
    assert.equal((await getLicenseStatus()).kind, "none");
  });

  test("uso personal: excluye a la licencia registrada, se anota y se puede retirar", async () => {
    await reset();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    expectOk(await saveLicense({ holder: "Empresa Ejemplo", reference: "F-2", email: "" }));
    const personal = expectOk(await setPersonalUseDeclared(true));
    assert.match(personal?.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal((await getLicenseStatus()).kind, "personal");
    assert.equal(await getLicense(), null);
    // Registrar una licencia quita la declaración.
    expectOk(await saveLicense({ holder: "Empresa Ejemplo", reference: "", email: "" }));
    assert.equal((await getLicenseStatus()).kind, "licensed");
    expectOk(await setPersonalUseDeclared(true));
    expectOk(await setPersonalUseDeclared(false));
    assert.equal((await getLicenseStatus()).kind, "none");
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { action: "settings.setPersonalUse" }, select: { message: true } });
    assert.ok(logs.some((l) => /Declaró la instalación de uso personal/.test(l.message)));
    assert.ok(logs.some((l) => /Retiró la declaración de uso personal/.test(l.message)));
  });

  test("recordatorio: solo admins, tras 7 días, y al verlo se pospone 30 días para ese admin", async () => {
    await reset();
    const admin = await makeUser({ role: "ADMIN" });
    const other = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    // La instalación se crea con el primer usuario: en esta base de pruebas puede ser reciente o no; se mide desde ahí.
    const first = await db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    const later = new Date(first!.createdAt.getTime() + 8 * DAY);
    const early = new Date(first!.createdAt.getTime() + 2 * DAY);
    assert.equal(await licenseNudgeFor(admin, early), false);
    assert.equal(await licenseNudgeFor(admin, later), true);
    assert.equal(await licenseNudgeFor(member, later), false);

    await loginAs(admin);
    expectOk(await snoozeLicenseNudge());
    const { licenseNudgeUntil } = await db.user.findUniqueOrThrow({ where: { id: admin.id }, select: { licenseNudgeUntil: true } });
    assert.ok(licenseNudgeUntil && Math.abs(licenseNudgeUntil.getTime() - Date.now() - 30 * DAY) < 60_000);
    const soon = new Date(Math.max(later.getTime(), Date.now() + DAY));
    assert.equal(await licenseNudgeFor(admin, soon), false);
    assert.equal(await licenseNudgeFor(other, soon), true, "posponerlo es por administrador");
    assert.equal(await licenseNudgeFor(admin, new Date(licenseNudgeUntil!.getTime() + 1000)), true);

    // Con licencia o con uso personal declarado, nadie lo ve.
    expectOk(await setPersonalUseDeclared(true));
    assert.equal(await licenseNudgeFor(other, soon), false);
    expectOk(await saveLicense({ holder: "Empresa Ejemplo", reference: "", email: "" }));
    assert.equal(await licenseNudgeFor(other, soon), false);
    await reset();
  });
});
