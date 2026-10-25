// Lógica pura del asistente de primer arranque: cuándo está pendiente, código de un solo uso y ajustes.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveTimeZone } from "../src/lib/format";
import { parseInstance } from "../src/lib/instance-core";
import {
  SETUP_CODE_TTL_MS,
  generateSetupCode,
  hashSetupCode,
  normalizeSetupCode,
  parseStoredCode,
  setupPending,
  validTimeZone,
  verifySetupCode,
} from "../src/lib/setup-core";

describe("setupPending", () => {
  test("pendiente solo sin usuarios y sin SEED_ADMIN_*", () => {
    assert.equal(setupPending(0, {}), true);
    assert.equal(setupPending(1, {}), false);
    assert.equal(setupPending(0, { SEED_ADMIN_EMAIL: "a@example.com", SEED_ADMIN_PASSWORD: "una-clave-larga" }), false);
  });
  test("con solo una de las dos variables SEED sigue pendiente (el seed no crearía nada)", () => {
    assert.equal(setupPending(0, { SEED_ADMIN_EMAIL: "a@example.com" }), true);
    assert.equal(setupPending(0, { SEED_ADMIN_PASSWORD: "una-clave-larga" }), true);
    assert.equal(setupPending(0, { SEED_ADMIN_EMAIL: "  ", SEED_ADMIN_PASSWORD: "x" }), true);
  });
});

describe("código de configuración", () => {
  test("formato XXXX-XXXX sin caracteres ambiguos y distinto cada vez", () => {
    const codes = new Set(Array.from({ length: 50 }, generateSetupCode));
    assert.equal(codes.size, 50);
    for (const c of codes) assert.match(c, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  });

  test("se guarda con hash: el valor guardado no contiene el código", () => {
    const code = "ABCD-EFGH";
    const stored = hashSetupCode(code, 1000);
    assert.ok(!JSON.stringify(stored).includes("ABCDEFGH"));
    assert.equal(stored.expiresAt, 1000 + SETUP_CODE_TTL_MS);
    assert.match(stored.hash, /^[0-9a-f]{64}$/);
    // La sal hace que el mismo código dé hashes distintos.
    assert.notEqual(hashSetupCode(code).hash, hashSetupCode(code).hash);
  });

  test("verifica ignorando mayúsculas, guion y espacios; rechaza otros", () => {
    const stored = hashSetupCode("ABCD-EFGH", 0);
    assert.equal(verifySetupCode("ABCD-EFGH", stored, 1), true);
    assert.equal(verifySetupCode("abcd efgh", stored, 1), true);
    assert.equal(verifySetupCode("ABCDEFGH", stored, 1), true);
    assert.equal(verifySetupCode("ABCD-EFGJ", stored, 1), false);
    assert.equal(verifySetupCode("", stored, 1), false);
    assert.equal(verifySetupCode("----", stored, 1), false);
    assert.equal(verifySetupCode("ABCD-EFGH", null, 1), false);
  });

  test("caduca a las 24 horas", () => {
    const stored = hashSetupCode("ABCD-EFGH", 0);
    assert.equal(verifySetupCode("ABCD-EFGH", stored, SETUP_CODE_TTL_MS), true);
    assert.equal(verifySetupCode("ABCD-EFGH", stored, SETUP_CODE_TTL_MS + 1), false);
  });

  test("SETUP_TOKEN también vale (mínimo 8 caracteres), incluso caducado el código", () => {
    const stored = hashSetupCode("ABCD-EFGH", 0);
    const late = SETUP_CODE_TTL_MS * 2;
    assert.equal(verifySetupCode("mi-token-secreto", stored, late, "mi-token-secreto"), true);
    assert.equal(verifySetupCode("mi-token-secreto", null, late, "mi-token-secreto"), true);
    assert.equal(verifySetupCode("otro-token-mas", stored, 1, "mi-token-secreto"), false);
    // Un token demasiado corto no se acepta (evita un SETUP_TOKEN=1 olvidado).
    assert.equal(verifySetupCode("abc", null, 1, "abc"), false);
    assert.equal(verifySetupCode("x", stored, 1, ""), false);
  });

  test("normalize y parseStoredCode", () => {
    assert.equal(normalizeSetupCode(" ab-cd 12 "), "ABCD12");
    const stored = hashSetupCode("ABCD-EFGH", 5);
    assert.deepEqual(parseStoredCode(JSON.stringify(stored)), stored);
    for (const bad of [null, undefined, "", "no json", "{}", '{"salt":1,"hash":"x","expiresAt":2}']) assert.equal(parseStoredCode(bad as string | null), null);
  });
});

describe("ajustes de la instalación", () => {
  test("APP_TIMEZONE gana al valor guardado y este a Europe/Madrid", () => {
    assert.equal(resolveTimeZone("America/Mexico_City", "Asia/Tokyo"), "America/Mexico_City");
    assert.equal(resolveTimeZone(undefined, "Asia/Tokyo"), "Asia/Tokyo");
    assert.equal(resolveTimeZone("", ""), "Europe/Madrid");
    assert.equal(resolveTimeZone(undefined, undefined), "Europe/Madrid");
  });

  test("parseInstance descarta valores no válidos", () => {
    assert.deepEqual(parseInstance([]), { orgName: "", locale: "es", timeZone: "" });
    assert.deepEqual(
      parseInstance([
        { key: "instance.orgName", value: " Acme " },
        { key: "instance.locale", value: "en" },
        { key: "instance.timeZone", value: "Europe/Lisbon" },
      ]),
      { orgName: "Acme", locale: "en", timeZone: "Europe/Lisbon" },
    );
    assert.equal(parseInstance([{ key: "instance.timeZone", value: "No/Existe" }]).timeZone, "");
    assert.equal(parseInstance([{ key: "instance.locale", value: "fr" }]).locale, "es");
  });

  test("validTimeZone", () => {
    assert.equal(validTimeZone("Europe/Madrid"), true);
    assert.equal(validTimeZone("UTC"), true);
    assert.equal(validTimeZone("Mars/Olympus"), false);
  });
});
