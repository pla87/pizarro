import assert from "node:assert/strict";
import { test } from "node:test";
import { intlLocale, toLocale, translate } from "../src/i18n/core";

test("español: devuelve la clave con sus variables", () => {
  assert.equal(translate("es", "Hola"), "Hola");
  assert.equal(translate("es", "{n} tareas", { n: 3 }), "3 tareas");
});

test("inglés: sin traducción, cae al español; variables desconocidas se quedan", () => {
  assert.equal(translate("en", "Texto que no existe en el diccionario"), "Texto que no existe en el diccionario");
  assert.equal(translate("en", "{x} y {y}", { x: 1 }), "1 y {y}");
});

test("locales", () => {
  assert.equal(toLocale("EN"), "en");
  assert.equal(toLocale(null), "es");
  assert.equal(intlLocale("en"), "en-GB");
  assert.equal(intlLocale("es"), "es-ES");
});
