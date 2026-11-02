// LICENSE.md (fuente) y src/lib/license-text.ts (generado para la página /licencia) no deben desincronizarse.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { LICENSE_EN, LICENSE_ES } from "../src/lib/license-text";
import { parseLicense } from "../src/lib/license-core";
import { BUY_URL, buyHref, LICENSE_PRICE_EUR } from "../src/lib/product";

const md = readFileSync(new URL("../LICENSE.md", import.meta.url), "utf8").replace(/\r\n/g, "\n").trimEnd();

describe("licencia", () => {
  test("el módulo coincide con LICENSE.md (si falla: npm run license:sync)", () => {
    assert.equal(md, `${LICENSE_ES}\n\n---\n\n${LICENSE_EN}`);
  });
  test("contiene lo esencial en los dos idiomas y ningún dato personal", () => {
    assert.match(LICENSE_ES, /^# Licencia de Pizarro/);
    assert.match(LICENSE_EN, /^# Pizarro License/);
    assert.match(LICENSE_ES, /En resumen/);
    assert.match(LICENSE_EN, /Spanish version prevails/);
    assert.match(LICENSE_ES, /una sola vez por cada instalación/);
    assert.match(LICENSE_ES, /propiedad intelectual/);
    assert.doesNotMatch(md, /@|https?:\/\//);
  });
  test("el precio se publica sin IVA y el pago es con pasarela y factura automática", () => {
    assert.match(LICENSE_ES, /más los impuestos aplicables \(IVA\)/);
    assert.match(LICENSE_ES, /pasarela de pago/);
    assert.match(LICENSE_ES, /factura se emite de forma automática/);
    assert.match(LICENSE_EN, /plus applicable taxes \(VAT\)/);
    assert.match(LICENSE_EN, /payment gateway/);
    assert.equal(LICENSE_PRICE_EUR, 100);
  });
  test("enlace de compra: BUY_URL, si no el email de contacto y si no /licencia", () => {
    assert.equal(buyHref("", "es", "https://pago.example.com/x"), "https://pago.example.com/x");
    assert.equal(buyHref("ventas@example.com", "es", "https://pago.example.com/x"), "https://pago.example.com/x");
    assert.equal(buyHref(" ventas@example.com ", "es", ""), "mailto:ventas@example.com");
    assert.equal(buyHref("", "en", ""), "/licencia?lang=en");
    assert.equal(buyHref("", "es", "  "), "/licencia?lang=es");
    assert.equal(typeof BUY_URL, "string");
  });
  test("registro de licencia: lo ilegible cuenta como uso personal", () => {
    assert.equal(parseLicense(null), null);
    assert.equal(parseLicense("no es json"), null);
    assert.equal(parseLicense(JSON.stringify({ holder: "", reference: "F-1" })), null);
    assert.deepEqual(parseLicense(JSON.stringify({ holder: " Empresa Ejemplo ", reference: "F-1", date: "2026-11-02" })), { holder: "Empresa Ejemplo", reference: "F-1", email: "", date: "2026-11-02" });
  });
});
