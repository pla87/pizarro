// Reglas de «Borrar mi cuenta» sin base de datos (la acción completa: tests/db/account-delete.test.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmWordMatches, DELETE_ACCOUNT_WORD, deleteAlternatives, DELETION_BLOCK_MESSAGES, deletionBlockFor } from "../src/lib/user-delete-core";
import { makeT } from "../src/i18n/core";

test("la única cuenta de la instalación no se puede borrar, sea admin o no", () => {
  assert.equal(deletionBlockFor({ role: "ADMIN", active: true }, { users: 0, activeAdmins: 0 }), "only-user");
  assert.equal(deletionBlockFor({ role: "MEMBER", active: true }, { users: 0, activeAdmins: 0 }), "only-user");
});

test("el último administrador activo no se puede borrar; un miembro o un admin desactivado, sí", () => {
  assert.equal(deletionBlockFor({ role: "ADMIN", active: true }, { users: 3, activeAdmins: 0 }), "last-admin");
  assert.equal(deletionBlockFor({ role: "ADMIN", active: true }, { users: 3, activeAdmins: 1 }), null);
  assert.equal(deletionBlockFor({ role: "ADMIN", active: false }, { users: 3, activeAdmins: 0 }), null);
  assert.equal(deletionBlockFor({ role: "MEMBER", active: true }, { users: 3, activeAdmins: 0 }), null);
});

test("los mensajes explican qué hacer y están traducidos", () => {
  assert.match(DELETION_BLOCK_MESSAGES["last-admin"], /Nombra antes a otro/);
  const en = makeT("en");
  for (const m of Object.values(DELETION_BLOCK_MESSAGES)) assert.notEqual(en(m), m);
});

test("la palabra de confirmación: sin distinguir mayúsculas ni espacios de los lados, en cada idioma", () => {
  const es = makeT("es")(DELETE_ACCOUNT_WORD);
  const en = makeT("en")(DELETE_ACCOUNT_WORD);
  assert.equal(es, "BORRAR");
  assert.equal(en, "DELETE");
  assert.ok(confirmWordMatches(" borrar ", es));
  assert.ok(confirmWordMatches("Delete", en));
  assert.ok(!confirmWordMatches("BORRA", es));
  assert.ok(!confirmWordMatches("BORRAR", en));
});

test("sin contraseña conocida (entra con Google): con la app, su código; sin ella, el email o volver a entrar con Google", () => {
  const base = { googleLinked: true, passwordLogin: true, twoFactor: null, emailAvailable: true, googleAvailable: true } as const;
  // Con contraseña y sin Google: solo la contraseña, como siempre.
  assert.deepEqual(deleteAlternatives({ ...base, googleLinked: false }), []);
  assert.deepEqual(deleteAlternatives({ ...base, googleLinked: false, twoFactor: "TOTP" }), []);
  // Entra con Google: con TOTP, solo el código de la app; si no, el email y/o Google.
  assert.deepEqual(deleteAlternatives({ ...base, twoFactor: "TOTP" }), ["totp"]);
  assert.deepEqual(deleteAlternatives(base), ["email", "google"]);
  assert.deepEqual(deleteAlternatives({ ...base, twoFactor: "EMAIL" }), ["email", "google"]);
  assert.deepEqual(deleteAlternatives({ ...base, emailAvailable: false }), ["google"]);
  assert.deepEqual(deleteAlternatives({ ...base, googleAvailable: false }), ["email"]);
  // Con «solo Google» (su rol no entra con contraseña) también, aunque no conste el enlace.
  assert.deepEqual(deleteAlternatives({ ...base, googleLinked: false, passwordLogin: false }), ["email"]);
});
