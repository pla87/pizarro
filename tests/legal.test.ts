// Textos legales editables: texto por defecto, marcadores, regla de idioma y validación (parte pura).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defaultLegalMarkdown, fillLegalPlaceholders, LEGAL_MAX, pickLegalText, validateLegalText } from "../src/lib/legal-core";

describe("textos legales: lógica pura", () => {
  test("el texto por defecto lleva los marcadores y existe en los dos idiomas", () => {
    for (const kind of ["privacy", "terms"] as const) {
      const es = defaultLegalMarkdown(kind, "es");
      const en = defaultLegalMarkdown(kind, "en");
      assert.match(es, /\{email\}/);
      assert.match(en, /\{email\}/);
      assert.notEqual(es, en);
    }
    assert.match(defaultLegalMarkdown("privacy", "es"), /\{responsable\}/);
  });

  test("los marcadores se sustituyen; sin valores queda «el administrador de esta instalación»", () => {
    assert.equal(fillLegalPlaceholders("Lo opera {responsable} ({email})", "es", "Empresa Ejemplo", "privacidad@example.com"), "Lo opera Empresa Ejemplo (privacidad@example.com)");
    assert.equal(fillLegalPlaceholders("{responsable} / {email}", "es", "", ""), "el administrador de esta instalación / el administrador de esta instalación");
    assert.equal(fillLegalPlaceholders("{responsable} / {email}", "en", "", ""), "this installation's administrator / this installation's administrator");
    // Sin email se nombra al responsable
    assert.equal(fillLegalPlaceholders("contacta con {email}", "es", "Empresa Ejemplo", ""), "contacta con Empresa Ejemplo");
    // Otros marcadores no se tocan
    assert.equal(fillLegalPlaceholders("{otro}", "es", "x", "y"), "{otro}");
  });

  test("regla de idioma: propio, luego español propio (solo en inglés), luego genérico", () => {
    assert.deepEqual(pickLegalText({ es: "ES", en: "EN" }, "en"), { source: "custom", text: "EN", locale: "en" });
    assert.deepEqual(pickLegalText({ es: "ES", en: "" }, "en"), { source: "custom-es-fallback", text: "ES", locale: "es" });
    assert.equal(pickLegalText({ es: "ES", en: "  " }, "en").source, "custom-es-fallback");
    assert.equal(pickLegalText({ es: "", en: "EN" }, "es").source, "default");
    assert.equal(pickLegalText({ es: "", en: "" }, "en").source, "default");
    assert.equal(pickLegalText({ es: "ES", en: "EN" }, "es").text, "ES");
  });

  test("validación: normaliza saltos de línea, recorta y limita la longitud", () => {
    assert.deepEqual(validateLegalText("  a\r\nb  "), { ok: true, value: "a\nb" });
    assert.equal(validateLegalText("x".repeat(LEGAL_MAX)).ok, true);
    assert.equal(validateLegalText("x".repeat(LEGAL_MAX + 1)).ok, false);
    assert.equal(validateLegalText(5).ok, false);
  });
});
