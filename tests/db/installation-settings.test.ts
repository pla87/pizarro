// Administración → Ajustes → Instalación: cambiar después del asistente el nombre de la organización, el idioma por
// defecto y la zona horaria (antes solo se elegían en /setup). Contra PostgreSQL real.
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { flushLogs } from "../../src/lib/log";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, logout, makeUser } from "./helpers";
import { saveInstallationSettings } from "../../src/actions/settings";
import { getLocale } from "../../src/i18n/server";
import { getInstanceSettings, invalidateInstance } from "../../src/lib/instance";
import { appTimeZone } from "../../src/lib/format";

const cleanup = async () => {
  await db.appState.deleteMany({ where: { key: { startsWith: "instance." } } });
  invalidateInstance();
};
after(cleanup);

describe("ajustes de la instalación", () => {
  test("el administrador los cambia, se aplican al momento (sin esperar a la caché) y queda en el registro", async () => {
    await cleanup();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    // Se leen antes: la caché de 30 s tiene ya los valores de antes.
    assert.equal((await getInstanceSettings()).locale, "es");
    const res = expectOk(await saveInstallationSettings({ orgName: "  Acme Lda  ", locale: "en", timeZone: "Europe/Lisbon" }));
    assert.deepEqual(res, { orgName: "Acme Lda", locale: "en", timeZone: "Europe/Lisbon" });
    assert.deepEqual(await getInstanceSettings(), { orgName: "Acme Lda", locale: "en", timeZone: "Europe/Lisbon" });
    const prevTz = process.env.APP_TIMEZONE;
    delete process.env.APP_TIMEZONE;
    try {
      assert.equal(appTimeZone(), "Europe/Lisbon");
    } finally {
      if (prevTz !== undefined) process.env.APP_TIMEZONE = prevTz;
    }
    // Sin sesión, las pantallas salen ya en el idioma nuevo.
    logout();
    assert.equal(await getLocale(), "en");

    await flushLogs();
    const log = await db.appLog.findFirst({ where: { action: "settings.saveInstallationSettings", userId: admin.id }, orderBy: { createdAt: "desc" } });
    assert.equal(log?.message, "Cambió los ajustes de la instalación");
    assert.match(JSON.stringify(log?.details ?? {}), /Acme Lda/);
  });

  test("datos no válidos se rechazan sin cambiar nada", async () => {
    await cleanup();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    expectOk(await saveInstallationSettings({ orgName: "Acme", locale: "es", timeZone: "Europe/Madrid" }));
    expectFail(await saveInstallationSettings({ orgName: "   ", locale: "es", timeZone: "Europe/Madrid" }), /nombre de la organización/);
    expectFail(await saveInstallationSettings({ orgName: "x".repeat(81), locale: "es", timeZone: "Europe/Madrid" }), /nombre de la organización/);
    expectFail(await saveInstallationSettings({ orgName: "Acme", locale: "fr", timeZone: "Europe/Madrid" }), /Idioma no válido/);
    expectFail(await saveInstallationSettings({ orgName: "Acme", locale: "es", timeZone: "Marte/Olimpo" }), /Zona horaria no válida/);
    assert.deepEqual(await getInstanceSettings(), { orgName: "Acme", locale: "es", timeZone: "Europe/Madrid" });
  });

  test("con APP_TIMEZONE la zona guardada no se toca (manda la variable)", async () => {
    await cleanup();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    expectOk(await saveInstallationSettings({ orgName: "Acme", locale: "es", timeZone: "Europe/Madrid" }));
    const prev = process.env.APP_TIMEZONE;
    process.env.APP_TIMEZONE = "America/Mexico_City";
    try {
      expectOk(await saveInstallationSettings({ orgName: "Acme 2", locale: "es", timeZone: "no-importa" }));
    } finally {
      if (prev === undefined) delete process.env.APP_TIMEZONE;
      else process.env.APP_TIMEZONE = prev;
    }
    assert.deepEqual(await getInstanceSettings(), { orgName: "Acme 2", locale: "es", timeZone: "Europe/Madrid" });
  });

  test("solo administradores", async () => {
    await cleanup();
    const member = await makeUser();
    await loginAs(member);
    expectFail(await saveInstallationSettings({ orgName: "Otra", locale: "en", timeZone: "UTC" }), FORBIDDEN);
    assert.equal((await getInstanceSettings()).orgName, "");
  });
});
