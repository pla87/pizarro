// Máximo de usuarios activos (MAX_USERS, lib/limits.ts): validado como DATABASE_POOL_SIZE y señalado en el diagnóstico.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MAX_USERS, maxUsersConfig } from "../src/lib/limits";
import { envPresence } from "../src/lib/doctor-core";

test("sin variable (o vacía): 10, valor por defecto y sin aviso", () => {
  assert.equal(DEFAULT_MAX_USERS, 10);
  assert.deepEqual(maxUsersConfig({}), { max: 10, source: "default", warning: null });
  assert.deepEqual(maxUsersConfig({ MAX_USERS: "  " }), { max: 10, source: "default", warning: null });
});

test("un entero válido se usa", () => {
  assert.deepEqual(maxUsersConfig({ MAX_USERS: " 50 " }), { max: 50, source: "env", warning: null });
  assert.equal(maxUsersConfig({ MAX_USERS: "100000" }).max, 100000);
});

test("un valor que no es un entero entre 1 y un millón no rompe: se usa 10 y avisa (antes NaN = sin tope, 0 = nadie)", () => {
  for (const raw of ["diez", "0", "-5", "2.5", "1e3", "10 usuarios", "99999999999999999999"]) {
    const c = maxUsersConfig({ MAX_USERS: raw });
    assert.equal(c.max, 10, raw);
    assert.equal(c.source, "invalid", raw);
    assert.match(c.warning ?? "", /MAX_USERS no es un número entero/, raw);
  }
});

test("el diagnóstico marca MAX_USERS no válida (sin dar su valor)", () => {
  assert.equal(envPresence({ MAX_USERS: "diez" }).MAX_USERS, "invalid");
  assert.equal(envPresence({ MAX_USERS: "25" }).MAX_USERS, "set");
  assert.equal(envPresence({}).MAX_USERS, "unset");
});
