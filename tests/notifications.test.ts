// Avisos en el navegador: contador de sin leer de la cabecera al leerlos sin volver a pedir la página.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyUnreadChange, UNREAD_COUNT_CAP } from "../src/lib/unread-core";

test("leer un aviso baja el contador; nunca por debajo de cero", () => {
  assert.equal(applyUnreadChange(5, { read: 1 }), 4);
  assert.equal(applyUnreadChange(1, { read: 1 }), 0);
  assert.equal(applyUnreadChange(0, { read: 1 }), 0);
});

test("marcar todo deja el contador a cero, también en el tope", () => {
  assert.equal(applyUnreadChange(7, { all: true }), 0);
  assert.equal(applyUnreadChange(UNREAD_COUNT_CAP, { all: true }), 0);
});

test("en el tope («99+») no se sabe cuántos hay: leer uno no lo baja a 99", () => {
  assert.equal(applyUnreadChange(UNREAD_COUNT_CAP, { read: 1 }), UNREAD_COUNT_CAP);
  assert.equal(applyUnreadChange(UNREAD_COUNT_CAP - 1, { read: 1 }), UNREAD_COUNT_CAP - 2);
});
