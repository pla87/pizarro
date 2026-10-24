import assert from "node:assert/strict";
import { test } from "node:test";
import { localizeGeneralKind, localizeGeneralKinds } from "../src/lib/kinds-localize";

const feature = { id: "kind_funcionalidad", name: "Funcionalidad", color: "#22c55e", titleTemplate: "", descriptionTemplate: "" };
const bug = { id: "kind_correccion", name: "Corrección", color: "#f97316", titleTemplate: "", descriptionTemplate: "" };
const reply = { id: "kind_respuesta", name: "Respuesta", color: "#a855f7", titleTemplate: "Respuesta", descriptionTemplate: "Respondo a las preguntas y lo que necesitas de mi:" };

test("en español deja los tipos como están", () => {
  const list = [feature, bug];
  assert.equal(localizeGeneralKinds(list, "es"), list);
});

test("en inglés traduce los de serie sin modificar", () => {
  const [f, b, r] = localizeGeneralKinds([feature, bug, reply], "en");
  assert.equal(f!.name, "Feature");
  assert.equal(b!.name, "Bug fix");
  assert.equal(r!.name, "Reply");
  assert.equal(r!.titleTemplate, "Reply");
  assert.equal(r!.descriptionTemplate, "I answer the questions and what you need from me:");
  assert.equal(f!.color, "#22c55e");
});

test("respeta el nombre o la plantilla que haya cambiado un administrador", () => {
  assert.equal(localizeGeneralKind({ ...feature, name: "Mejora" }, "en").name, "Mejora");
  const r = localizeGeneralKind({ ...reply, titleTemplate: "Contestar" }, "en");
  assert.equal(r.name, "Reply");
  assert.equal(r.titleTemplate, "Contestar");
});

test("no toca tipos que no son de serie", () => {
  const own = { id: "k1", name: "Funcionalidad" };
  assert.equal(localizeGeneralKind(own, "en"), own);
});
