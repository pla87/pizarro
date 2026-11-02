// Datos del producto (no de cada instalación): Pizarro se vende desde un único sitio.
// Ver docs/VENTA.md para crear el enlace de pago y pegarlo en BUY_URL.
import type { T } from "../i18n/core";

/** Enlace de compra (p. ej. un Payment Link de Stripe). Vacío hasta que el autor lo publique. */
export const BUY_URL: string = "";

/** Precio de la licencia comercial, en euros y sin IVA (pago único por servidor). */
export const LICENSE_PRICE_EUR = 100;

/**
 * A dónde lleva el botón «Comprar»: el enlace de compra si existe; si no, el email de contacto público
 * y, si tampoco hay, la página /licencia.
 */
export function buyHref(contactEmail: string, locale: string = "es", buyUrl: string = BUY_URL): string {
  const url = buyUrl.trim();
  if (url) return url;
  const email = contactEmail.trim();
  if (email) return `mailto:${email}`;
  return `/licencia?lang=${locale === "en" ? "en" : "es"}`;
}

/**
 * Frase bajo el precio de la presentación. Solo promete pago con tarjeta y factura automática si hay enlace de pago
 * (BUY_URL); sin él, el botón lleva al email de contacto (o a la licencia) y la frase no promete pasarela.
 */
export function buyNote(t: T, contactEmail: string, buyUrl: string = BUY_URL): string {
  if (buyUrl.trim()) return t("Pago con tarjeta en la web y factura automática con los datos de tu empresa o con los tuyos (el DNI o NIF es opcional). El IVA se suma después.");
  if (contactEmail.trim()) return t("Escríbenos para comprarla; emitimos factura con los datos de tu empresa. El IVA se suma después.");
  return t("Lee la licencia para saber cómo comprarla; emitimos factura con los datos de tu empresa. El IVA se suma después.");
}
