import assert from "node:assert/strict";
import { test } from "node:test";
import { localeFromAcceptLanguage, pickLandingLocale } from "../src/lib/landing-locale";

test("idioma de la presentación: ?lang manda, luego el navegador, luego la instalación", () => {
  assert.equal(pickLandingLocale({ lang: "en", acceptLanguage: "es-ES", fallback: "es" }), "en");
  assert.equal(pickLandingLocale({ lang: "xx", acceptLanguage: "en-GB,en;q=0.8", fallback: "es" }), "en");
  assert.equal(pickLandingLocale({ acceptLanguage: "fr-FR,fr;q=0.9", fallback: "en" }), "en");
  assert.equal(pickLandingLocale({ acceptLanguage: null, fallback: "es" }), "es");
  assert.equal(localeFromAcceptLanguage("fr;q=0.9, es;q=0.5, en;q=0.7"), "en");
  assert.equal(localeFromAcceptLanguage("en;q=0, es"), "es");
  assert.equal(localeFromAcceptLanguage("*"), null);
});
