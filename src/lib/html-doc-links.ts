// Enlaces entre los HTML de una misma Documentación. Funciones puras (también las usa el visor, en el navegador).

export type HtmlLink =
  | { type: "internal" } // «#apartado»: se desplaza dentro del propio documento
  | { type: "external" } // con esquema (https://…, mailto:…) o «//host»: como hasta ahora, en otra pestaña
  | { type: "document"; id: string; hash: string } // otro documento de la MISMA Documentación
  | { type: "missing" }; // enlace relativo a un fichero que no está en la Documentación

/** Último tramo de una ruta relativa (sin «?consulta» ni «#hash»), decodificado y en minúsculas; null si no hay nombre. */
export function linkFileName(path: string): string | null {
  const last = path.split(/[\\/]/).pop() ?? "";
  if (!last || last === "." || last === "..") return null;
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch { /* «%» suelto: se compara tal cual */ }
  return decoded.trim().toLowerCase();
}

/**
 * Qué hacer con el `href` de un enlace de un documento HTML. `docs` son SOLO los documentos (no borrados) del proyecto que
 * se está viendo: un documento de otro proyecto nunca puede salir de aquí, aunque tenga el mismo nombre. Si hay varios con
 * el mismo nombre gana el primero de la lista (la más reciente).
 */
export function classifyHtmlLink(href: string, docs: readonly { id: string; name: string }[]): HtmlLink {
  const value = href.trim();
  if (value.startsWith("#")) return { type: "internal" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("\\\\")) return { type: "external" };
  const hashAt = value.indexOf("#");
  const hash = hashAt >= 0 ? value.slice(hashAt) : "";
  const path = (hashAt >= 0 ? value.slice(0, hashAt) : value).split("?")[0]!;
  const wanted = linkFileName(path);
  if (!wanted) return { type: "missing" };
  const found = docs.find((d) => d.name.trim().toLowerCase() === wanted);
  if (!found) return { type: "missing" };
  // El apartado se normaliza (decodificado y vuelto a codificar) y se acota; nada del enlace original viaja tal cual.
  let fragment = hash.slice(1);
  try {
    fragment = decodeURIComponent(fragment);
  } catch { /* se deja como está */ }
  return { type: "document", id: found.id, hash: fragment && fragment.length <= 200 ? `#${encodeURIComponent(fragment)}` : "" };
}
