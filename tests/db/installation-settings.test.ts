// Administración → Ajustes → Instalación: cambiar después del asistente el nombre de la organización, el idioma por
// defecto y la zona horaria (antes solo se elegían en /setup). Contra PostgreSQL real.
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { flushLogs } from "../../src/lib/log";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, logout, makeUser } from "./helpers";
import { saveAppIcon, saveInstallationSettings } from "../../src/actions/settings";
import { APP_ICON_KEY, FAILURE_TTL_MS, getAppIcon } from "../../src/lib/app-icon";
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

  test("color del icono de la app: lo cambia un administrador, se ve al momento y queda en el registro", async () => {
    await cleanup();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    assert.equal(await getAppIcon(), "blue");
    assert.deepEqual(expectOk(await saveAppIcon("forest")), { accent: "forest" });
    assert.equal(await getAppIcon(), "forest");
    expectFail(await saveAppIcon("rojo"), /Color no válido/);
    assert.equal(await getAppIcon(), "forest");
    await flushLogs();
    const log = await db.appLog.findFirst({ where: { action: "settings.saveAppIcon", userId: admin.id, message: { startsWith: "Cambió" } }, orderBy: { createdAt: "desc" } });
    assert.equal(log?.message, "Cambió el color del icono de la app de blue a forest");
    // Un valor guardado que ya no existe (o estropeado) vuelve al azul.
    await db.appState.update({ where: { key: APP_ICON_KEY }, data: { value: "morado" } });
    assert.equal(await getAppIcon(Date.now() + 60_000), "blue"); // pasada la memoria de 30 s
  });

  test("color del icono de la app: si la consulta falla, el azul se guarda unos segundos y no se reintenta en cada petición", async () => {
    await cleanup();
    const real = db.appState.findUnique;
    let calls = 0;
    const patched = db.appState as unknown as { findUnique: unknown };
    patched.findUnique = () => { calls++; throw new Error("sin base de datos"); };
    try {
      const t0 = Date.now() + 10 * 60_000; // fuera de la memoria que dejaron las pruebas anteriores
      assert.equal(await getAppIcon(t0), "blue");
      assert.equal(await getAppIcon(t0 + 2_000), "blue");
      assert.equal(calls, 1);
      assert.equal(await getAppIcon(t0 + FAILURE_TTL_MS + 1), "blue"); // pasados unos segundos, vuelve a intentarlo
      assert.equal(calls, 2);
    } finally {
      patched.findUnique = real;
    }
    assert.equal(await getAppIcon(Date.now() + 20 * 60_000), "blue");
  });

  test("color del icono de la app: solo administradores", async () => {
    await cleanup();
    await loginAs(await makeUser());
    expectFail(await saveAppIcon("sienna"), FORBIDDEN);
    assert.equal(await db.appState.findUnique({ where: { key: APP_ICON_KEY } }), null);
  });
});
