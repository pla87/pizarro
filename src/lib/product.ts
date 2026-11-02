// Datos del producto (no de cada instalación): Pizarro se vende desde un único sitio.
// Ver docs/VENTA.md para crear el enlace de pago y pegarlo en BUY_URL.

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
