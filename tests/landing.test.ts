import assert from "node:assert/strict";
import { test } from "node:test";
import { makeT } from "../src/i18n/core";
import { buyHref, LICENSE_PRICE_EUR } from "../src/lib/product";
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

test("presentación: «100 € + IVA, pago único por servidor» en los dos idiomas y botón Comprar", () => {
  const es = makeT("es");
  const en = makeT("en");
  assert.equal(`${es("{price} € + IVA", { price: LICENSE_PRICE_EUR })}, ${es("pago único por servidor")}`, "100 € + IVA, pago único por servidor");
  assert.equal(`${en("{price} € + IVA", { price: LICENSE_PRICE_EUR })}, ${en("pago único por servidor")}`, "€100 + VAT, one-off payment per server");
  assert.equal(en("Comprar"), "Buy");
  // Mismo destino que en Administración → Licencia: sin enlace de compra ni email de contacto, /licencia.
  assert.equal(buyHref("", "es", ""), "/licencia?lang=es");
  assert.equal(buyHref("ventas@example.com", "en", ""), "mailto:ventas@example.com");
});
