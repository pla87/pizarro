import assert from "node:assert/strict";
import { test } from "node:test";
import { makeT } from "../src/i18n/core";
import { BUY_URL, buyHref, buyNote, LICENSE_PRICE_EUR } from "../src/lib/product";
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

test("frase de compra: solo promete tarjeta y factura automática si hay enlace de pago (BUY_URL)", () => {
  for (const locale of ["es", "en"] as const) {
    const t = makeT(locale);
    const withUrl = buyNote(t, "ventas@example.com", "https://buy.example.com/x");
    const withEmail = buyNote(t, "ventas@example.com", "");
    const noContact = buyNote(t, "  ", "   ");
    assert.match(withUrl, locale === "es" ? /tarjeta/ : /card/);
    for (const text of [withEmail, noContact]) {
      assert.doesNotMatch(text, /tarjeta|automática|card|automatic/i);
      assert.match(text, locale === "es" ? /factura/ : /invoice/);
      assert.ok(!text.includes("Escríbenos") || locale === "es");
    }
    assert.match(withEmail, locale === "es" ? /^Escríbenos/ : /^Write to us/);
    assert.match(noContact, locale === "es" ? /^Lee la licencia/ : /^Read the licence/);
    assert.notEqual(withEmail, noContact);
  }
  // Con el BUY_URL real vacío (hasta que el autor lo publique) la frase por defecto no promete pasarela.
  if (!BUY_URL.trim()) assert.doesNotMatch(buyNote(makeT("es"), "ventas@example.com"), /tarjeta/);
});

test("Administración → Licencia: los marcadores de los campos se traducen", () => {
  const en = makeT("en");
  assert.equal(en("Empresa Ejemplo, S.L."), "Example Company, Ltd.");
  assert.equal(en("compras@example.com"), "purchases@example.com");
});
