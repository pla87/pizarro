// Conflictos del texto de una tarea campo a campo (src/lib/text-version.ts): guardar el título no choca con un cambio
// ajeno de la descripción, y al revés; el mismo campo cambiado sí; una versión sin huellas compara todo el texto.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { textConflicts, textHash } from "../src/lib/text-version";

const opened = "2026-03-01T10:00:00.000Z";
const later = new Date("2026-03-01T10:05:00.000Z");
const since = { version: opened, title: textHash("Título"), description: textHash("Descripción") };

describe("textConflicts", () => {
  test("sin cambios desde la versión editada, nunca choca", () => {
    assert.deepEqual(textConflicts({ contentUpdatedAt: new Date(opened), title: "Otro", description: "Otra" }, opened, { title: "x" }), []);
    assert.deepEqual(textConflicts({ contentUpdatedAt: null }, opened, { title: "x" }), []);
    assert.deepEqual(textConflicts({ contentUpdatedAt: later, title: "Título", description: "Descripción" }, since, { title: "x", description: "y" }), []);
  });

  test("con huellas cuenta el texto, no la versión: la de un guardado propio puede incluir un cambio ajeno no visto", () => {
    // La versión es la del último guardado propio (del título), pero la descripción la cambió otra persona antes.
    const now = { contentUpdatedAt: later, title: "Título", description: "Descripción ajena" };
    assert.deepEqual(textConflicts(now, { ...since, version: later.toISOString() }, { description: "Mía" }), ["description"]);
  });

  test("otra persona cambió solo la descripción: guardar el título no choca, guardar la descripción sí", () => {
    const now = { contentUpdatedAt: later, title: "Título", description: "Descripción ajena" };
    assert.deepEqual(textConflicts(now, since, { title: "Mío" }), []);
    assert.deepEqual(textConflicts(now, since, { description: "Mía" }), ["description"]);
    assert.deepEqual(textConflicts(now, since, { title: "Mío", description: "Mía" }), ["description"]);
  });

  test("otra persona cambió solo el título: guardar la descripción no choca, el título sí", () => {
    const now = { contentUpdatedAt: later, title: "Título ajeno", description: "Descripción" };
    assert.deepEqual(textConflicts(now, since, { description: "Mía" }), []);
    assert.deepEqual(textConflicts(now, since, { title: "Mío" }), ["title"]);
  });

  test("sin huellas (solo la versión) cualquier cambio posterior choca, como antes", () => {
    const now = { contentUpdatedAt: later, title: "Título", description: "Descripción ajena" };
    assert.deepEqual(textConflicts(now, opened, { title: "Mío" }), ["title"]);
    assert.deepEqual(textConflicts(now, null, { title: "Mío", description: "Mía" }), ["title", "description"]);
    // Falta la huella del campo que se guarda: se da por cambiado.
    assert.deepEqual(textConflicts(now, { version: opened, title: textHash("Título") }, { description: "Mía" }), ["description"]);
  });

  test("la huella distingue textos parecidos y es estable", () => {
    assert.equal(textHash("Descripción"), textHash("Descripción"));
    assert.notEqual(textHash("a"), textHash("b"));
    assert.notEqual(textHash("ab"), textHash("ba"));
    assert.notEqual(textHash(""), textHash(" "));
    assert.ok(textHash("x".repeat(20000)).length <= 12);
  });
});
