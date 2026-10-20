import assert from "node:assert/strict";
import { test } from "node:test";
import { applyKindTemplate, describeKindAutomation } from "../src/lib/kinds-special";

const RESPUESTA_LINE = "Respondo a las preguntas y lo que necesitas de mi:";

const RESP = { titleTemplate: "Respuesta", descriptionTemplate: RESPUESTA_LINE };

test("un tipo sin automatización no cambia nada", () => {
  assert.equal(applyKindTemplate({ titleTemplate: "", descriptionTemplate: "" }, { title: "x", description: "y" }), null);
  assert.equal(applyKindTemplate({ titleTemplate: "  ", descriptionTemplate: " " }, { title: "x", description: "y" }), null);
});

test("fija el título y antepone el texto", () => {
  assert.deepEqual(applyKindTemplate(RESP, { title: "Algo", description: "" }), { title: "Respuesta", description: `${RESPUESTA_LINE}\n` });
  assert.deepEqual(applyKindTemplate(RESP, { title: "Algo", description: "Texto previo" }), {
    title: "Respuesta",
    description: `${RESPUESTA_LINE}\nTexto previo`,
  });
});

test("no duplica el texto si ya está al principio", () => {
  const description = `  ${RESPUESTA_LINE}\n- punto`;
  assert.equal(applyKindTemplate(RESP, { title: "t", description })!.description, description);
});

test("solo título o solo descripción", () => {
  assert.deepEqual(applyKindTemplate({ titleTemplate: "Aviso", descriptionTemplate: "" }, { title: "t", description: "d" }), { title: "Aviso", description: "d" });
  assert.deepEqual(applyKindTemplate({ titleTemplate: "", descriptionTemplate: "Pasos:" }, { title: "t", description: "" }), { title: "t", description: "Pasos:\n" });
});

test("describeKindAutomation resume y trunca", () => {
  assert.equal(describeKindAutomation({ titleTemplate: "", descriptionTemplate: "" }), null);
  assert.equal(describeKindAutomation({ titleTemplate: "Aviso", descriptionTemplate: "" }), "Al elegirlo, el título pasa a ser «Aviso».");
  assert.equal(describeKindAutomation({ titleTemplate: "", descriptionTemplate: "Pasos:" }), "Al elegirlo, la descripción empieza por «Pasos:».");
  const line = describeKindAutomation(RESP)!;
  assert.ok(line.includes("«Respuesta»") && line.includes("«Respondo a las preguntas y lo que necesitas de mi:»"));
  assert.ok(describeKindAutomation({ titleTemplate: "", descriptionTemplate: "a".repeat(100) })!.includes("…"));
});
