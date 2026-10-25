// Asistente de primer arranque contra PostgreSQL real: código en AppState, creación del administrador y bloqueo de una segunda ejecución.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { db } from "./helpers";
import { verifyPassword } from "../../src/lib/password";
import { SETUP_CODE_KEY, announceSetup, checkSetupCode, completeSetup, isSetupPending, resetSetupCache, type SetupInput } from "../../src/lib/setup";
import { parseStoredCode } from "../../src/lib/setup-core";

const ENV = { APP_URL: "https://pizarro.example.com" } as Record<string, string | undefined>;

const input = (code: string, over: Partial<SetupInput> = {}): SetupInput => ({
  code,
  orgName: "Acme",
  locale: "en",
  timeZone: "Europe/Lisbon",
  adminName: "Admin Uno",
  adminEmail: "Primero@Example.com",
  adminPassword: "una-clave-larga-1",
  ...over,
});

const cleanup = async () => {
  await db.user.deleteMany();
  await db.project.deleteMany();
  await db.appState.deleteMany({ where: { OR: [{ key: SETUP_CODE_KEY }, { key: { startsWith: "instance." } }] } });
  resetSetupCache();
};

// Estos tests necesitan una instalación sin usuarios: los demás ficheros de tests/db crean los suyos.
before(cleanup);
after(cleanup);

describe("asistente de primer arranque", () => {
  test("sin usuarios y sin SEED_ADMIN_* está pendiente; con SEED_ADMIN_* no", async () => {
    assert.equal(await isSetupPending(db, ENV), true);
    assert.equal(await isSetupPending(db, { ...ENV, SEED_ADMIN_EMAIL: "a@example.com", SEED_ADMIN_PASSWORD: "una-clave-larga" }), false);
  });

  test("el arranque imprime el código, lo guarda con hash y lo regenera cada vez", async () => {
    const lines: string[] = [];
    const code1 = await announceSetup(db, (m) => lines.push(m), ENV);
    assert.match(code1 ?? "", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(lines.some((l) => l.includes(`Abre https://pizarro.example.com/setup e introduce el código: ${code1}`)));
    const row = await db.appState.findUniqueOrThrow({ where: { key: SETUP_CODE_KEY } });
    assert.ok(!row.value.includes(code1!.replace("-", "")));
    const stored = parseStoredCode(row.value)!;
    assert.ok(stored.expiresAt > Date.now() + 23 * 3600_000 && stored.expiresAt <= Date.now() + 24 * 3600_000);

    const code2 = await announceSetup(db, () => {}, ENV);
    assert.notEqual(code1, code2);
    assert.equal(await checkSetupCode(db, code1!, Date.now(), ENV), false, "el código anterior deja de valer");
    assert.equal(await checkSetupCode(db, code2!, Date.now(), ENV), true);
    assert.equal(await checkSetupCode(db, code2!, Date.now() + 25 * 3600_000, ENV), false, "caducado");
    assert.equal(await checkSetupCode(db, "OTRO-CODE", Date.now(), ENV), false);
  });

  test("un código incorrecto no crea nada", async () => {
    await assert.rejects(completeSetup(db, input("AAAA-AAAA"), ENV), /código/);
    assert.equal(await db.user.count(), 0);
  });

  test("datos no válidos se rechazan antes de crear nada", async () => {
    const code = (await announceSetup(db, () => {}, ENV))!;
    await assert.rejects(completeSetup(db, input(code, { adminPassword: "corta" }), ENV), /10 caracteres/);
    await assert.rejects(completeSetup(db, input(code, { adminEmail: "no-es-email" }), ENV), /email/);
    await assert.rejects(completeSetup(db, input(code, { timeZone: "Mars/Olympus" }), ENV), /Zona horaria/);
    await assert.rejects(completeSetup(db, input(code, { orgName: "  " }), ENV), /organización/);
    assert.equal(await db.user.count(), 0);
  });

  test("dos finalizaciones a la vez: solo se crea un administrador", async () => {
    const code = (await announceSetup(db, () => {}, ENV))!;
    const results = await Promise.allSettled([
      completeSetup(db, input(code, { adminEmail: "a@example.com" }), ENV),
      completeSetup(db, input(code, { adminEmail: "b@example.com" }), ENV),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(await db.user.count(), 1);
    // Se deshace para comprobar el flujo completo en limpio.
    await cleanup();
  });

  test("la finalización crea el administrador, guarda los ajustes y borra el código", async () => {
    const code = (await announceSetup(db, () => {}, ENV))!;
    const { adminId } = await completeSetup(db, input(code), ENV);
    const admin = await db.user.findUniqueOrThrow({ where: { id: adminId }, include: { releaseTemplates: true } });
    assert.equal(admin.role, "ADMIN");
    assert.equal(admin.email, "primero@example.com");
    assert.equal(admin.name, "Admin Uno");
    assert.equal(admin.locale, "EN");
    assert.equal(admin.mustChangePassword, false);
    assert.equal(admin.twoFactorMethod, null, "el segundo paso se configura en el primer acceso");
    assert.equal(await verifyPassword("una-clave-larga-1", admin.passwordHash), true);
    assert.equal(admin.releaseTemplates.length, 2);

    const state = Object.fromEntries((await db.appState.findMany({ where: { key: { startsWith: "instance." } } })).map((r) => [r.key, r.value]));
    assert.deepEqual(state, { "instance.orgName": "Acme", "instance.locale": "en", "instance.timeZone": "Europe/Lisbon" });
    assert.equal(await db.appState.count({ where: { key: SETUP_CODE_KEY } }), 0, "el código se borra");
    assert.equal(await db.project.count(), 1, "proyecto de ejemplo como con el seed");
  });

  test("una segunda ejecución se bloquea (también con el código válido o SETUP_TOKEN)", async () => {
    assert.equal(await isSetupPending(db, ENV), false);
    const env = { ...ENV, SETUP_TOKEN: "token-de-prueba-123" };
    await assert.rejects(completeSetup(db, input("token-de-prueba-123", { adminEmail: "otro@example.com" }), env), /ya está configurada/);
    // Aunque el estado en memoria no lo supiera, la comprobación dentro de la transacción lo impide.
    resetSetupCache();
    await assert.rejects(completeSetup(db, input("token-de-prueba-123", { adminEmail: "otro@example.com" }), env), /ya está configurada/);
    assert.equal(await db.user.count(), 1);
    // Un nuevo arranque con usuarios no deja ningún código vivo.
    await db.appState.create({ data: { key: SETUP_CODE_KEY, value: "{}" } });
    assert.equal(await announceSetup(db, () => {}, ENV), null);
    assert.equal(await db.appState.count({ where: { key: SETUP_CODE_KEY } }), 0);
  });
});
