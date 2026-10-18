import assert from "node:assert/strict";
import { test } from "node:test";
import { applyKindPreset, isRespuestaKind, RESPUESTA_LINE } from "../src/lib/kinds-special";

test("reconoce «Respuesta» sin importar mayúsculas, acentos ni espacios", () => {
  for (const n of ["Respuesta", "respuesta", " RESPUESTA ", "Réspuesta", "Res puesta"]) assert.ok(isRespuestaKind(n), n);
  for (const n of ["Respuestas", "Funcionalidad", ""]) assert.ok(!isRespuestaKind(n), n);
});

test("otros tipos no cambian nada", () => {
  assert.equal(applyKindPreset("Corrección", { title: "x", description: "y" }), null);
});

test("Respuesta fija el título y antepone la línea", () => {
  assert.deepEqual(applyKindPreset("respuesta", { title: "Algo", description: "" }), { title: "Respuesta", description: `${RESPUESTA_LINE}\n` });
  assert.deepEqual(applyKindPreset("Respuesta", { title: "Algo", description: "Texto previo" }), {
    title: "Respuesta",
    description: `${RESPUESTA_LINE}\nTexto previo`,
  });
});

test("no duplica la línea si ya está al principio", () => {
  const description = `${RESPUESTA_LINE}\n- punto`;
  assert.equal(applyKindPreset("Respuesta", { title: "t", description })!.description, description);
});
