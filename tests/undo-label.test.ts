import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeLabel, encodeLabel, renderLabelEs, renderStoredLabel, tasksN, LABEL_MAX } from "../src/lib/undo-label";
import { makeT } from "../src/i18n/core";

const es = makeT("es");
const en = makeT("en");
const sub = { k: "Añadió la subtarea «{subtask}» en «{task}»", p: { subtask: "asdasd", task: "Tarea X" } };

test("etiqueta: se muestra en el idioma de quien la lee", () => {
  const raw = encodeLabel(sub);
  assert.equal(renderStoredLabel(raw, es), "Añadió la subtarea «asdasd» en «Tarea X»");
  assert.equal(renderStoredLabel(raw, en), "Added the subtask “asdasd” in “Tarea X”");
  assert.equal(renderLabelEs(sub), "Añadió la subtarea «asdasd» en «Tarea X»");
});

test("etiqueta: plantillas anidadas y listas", () => {
  const l = { k: "Modificó «{title}»: {changes}", p: { title: "T", changes: { k: "{list} y {last}", p: { list: [{ k: "tipo" }, { k: "color" }], last: { k: "fecha límite" } } } } };
  assert.equal(renderLabelEs(l), "Modificó «T»: tipo, color y fecha límite");
  assert.equal(renderStoredLabel(encodeLabel(l), en), "Edited “T”: type, color and due date");
  assert.equal(renderStoredLabel(encodeLabel({ k: "Archivó {count}", p: { count: tasksN(3) } }), en), "Archived 3 tasks");
});

test("etiqueta: el contenido del usuario no se traduce ni se interpreta", () => {
  const raw = encodeLabel({ k: "Comentó en «{title}»", p: { title: "{x} tipo" } });
  assert.equal(renderStoredLabel(raw, en), "Commented on “{x} tipo”");
});

test("etiqueta: valores largos se acortan y el JSON sigue siendo válido", () => {
  const raw = encodeLabel({ k: "Borró {count}: {titles}", p: { count: tasksN(2), titles: "x".repeat(2000) } });
  assert.ok(raw.length <= LABEL_MAX);
  assert.ok(decodeLabel(raw));
  assert.match(renderStoredLabel(raw, en), /^Deleted 2 tasks: x+…$/);
});

test("etiqueta: las entradas antiguas (texto plano) se muestran tal cual", () => {
  assert.equal(renderStoredLabel("Añadió la subtarea «a» en «b»", en), "Añadió la subtarea «a» en «b»");
  assert.equal(renderStoredLabel("{no es json", en), "{no es json");
  assert.equal(renderStoredLabel('{"otra":1}', en), '{"otra":1}');
});
