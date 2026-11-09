// Enlace externo de una tarea: se admite sin esquema («example.com/x», «www.example.com») y se completa con https://.

/** Nombre de host con aspecto de dominio (con al menos un punto y un dominio de primer nivel de letras) o IPv4, con puerto opcional. */
const HOST_RE = /^(?:(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})|\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?$/u;

/** ¿Es una URL http(s) que se guarda tal cual? (sin espacios). */
export function isHttpUrl(v: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(v);
}

/**
 * El enlace listo para guardar: recortado y, si no lleva esquema pero empieza por algo con forma de dominio
 * («example.com/x», «www.example.com», «sub.example.com:8080»), con «https://» delante. «//example.com» también.
 * Lo demás se devuelve sin cambios (recortado), para que la validación lo rechace: `javascript:`, `data:`, `ftp://`,
 * palabras sueltas o texto con espacios.
 */
export function normalizeLinkUrl(raw: string): string {
  const v = raw.trim();
  if (v === "" || isHttpUrl(v) || /\s/.test(v)) return v;
  const rest = v.startsWith("//") ? v.slice(2) : v;
  const host = rest.split(/[/?#]/, 1)[0] ?? "";
  return HOST_RE.test(host) ? `https://${rest}` : v;
}
