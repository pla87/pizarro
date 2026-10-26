import assert from "node:assert/strict";
import { test } from "node:test";
import { actionThrowMessage, isStaleActionError } from "../src/lib/stale-action";

test("reconoce el error de una acción de otra versión del despliegue", () => {
  assert.equal(isStaleActionError(new Error('Failed to find Server Action "abc123". This request might be from an older or newer deployment.')), true);
  assert.equal(isStaleActionError(new Error("Server Action \"x\" was not found on the server.")), true);
  assert.equal(isStaleActionError(new Error("Failed to fetch")), false);
  assert.equal(isStaleActionError(undefined), false);
});

test("sin ventana (servidor) el mensaje es el genérico", () => {
  assert.equal(actionThrowMessage(new Error("Failed to find Server Action"), (s) => s), "Error inesperado. Inténtalo de nuevo.");
});
