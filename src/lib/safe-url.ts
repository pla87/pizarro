// Enlaces que se pintan desde Markdown (descripciones, comentarios, releases). Lista blanca explícita: no
// dependemos del valor por defecto de react-markdown, que podría cambiar en una actualización.

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * La URL tal cual si es segura; "" si no (p. ej. `javascript:`, `data:`, `vbscript:`). Valen las URL
 * http(s), mailto y tel, y las relativas o internas (`/api/attachments/…`, `#mention-…`, `#u`).
 */
export function safeMarkdownUrl(url: string): string {
  const value = url.trim();
  // Los navegadores ignoran tabuladores y saltos de línea dentro del esquema («java\tscript:»).
  const compact = value.replace(/[\u0000-\u001F\u007F\s]+/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1];
  // Sin esquema: relativa o ancla (o «//host», que usa el protocolo de la página: http(s)).
  if (!scheme) return value;
  return SAFE_PROTOCOLS.has(`${scheme.toLowerCase()}:`) ? value : "";
}
