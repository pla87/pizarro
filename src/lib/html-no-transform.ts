// «no-transform» en el Cache-Control de las páginas HTML (solo runtime Node; lo aplica response-length.ts al escribir las
// cabeceras de cada respuesta).
//
// Cloudflare, con «Email Address Obfuscation» activada (lo está por defecto), reescribe los emails del HTML por un enlace
// a /cdn-cgi/l/email-protection y un script suyo: la página no coincide con lo que pintó React (errores de hidratación) y
// el script no lleva el nonce de la CSP. Cloudflare no toca las respuestas con «Cache-Control: no-transform». Next fija el
// Cache-Control de las páginas él mismo (pisa lo de next.config.ts), así que se añade aquí, a nivel de Node, conservando
// lo que haya puesto (private, no-cache, no-store…). Solo en text/html: las descargas y el JSON no lo necesitan.

import type http from "node:http";

/** Cache-Control con «no-transform» añadido (si no estaba). Sin cabecera, solo «no-transform». */
export function withNoTransform(cacheControl: string | null | undefined): string {
  const current = (cacheControl ?? "").trim();
  if (!current) return "no-transform";
  if (current.split(",").some((d) => d.trim().toLowerCase() === "no-transform")) return current;
  return `${current}, no-transform`;
}

/** ¿Es una página HTML? (por su Content-Type). */
export function isHtmlContentType(contentType: unknown): boolean {
  const v = Array.isArray(contentType) ? contentType[0] : contentType;
  return typeof v === "string" && /^\s*text\/html\b/i.test(v);
}

type HeaderTarget = Pick<http.ServerResponse, "getHeader" | "setHeader">;

/** En una respuesta HTML, añade «no-transform» al Cache-Control. */
export function applyHtmlNoTransform(res: HeaderTarget): void {
  if (!isHtmlContentType(res.getHeader("content-type"))) return;
  const raw = res.getHeader("cache-control");
  res.setHeader("cache-control", withNoTransform(Array.isArray(raw) ? raw.join(", ") : raw === undefined ? null : String(raw)));
}
