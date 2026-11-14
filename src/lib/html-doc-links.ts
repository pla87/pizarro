// Enlaces entre los HTML de una misma Documentación. Funciones puras (también las usa el visor, en el navegador).
import { sanitizeDocumentName } from "./document-kind";

export type HtmlLink =
  | { type: "internal"; hash: string } // «#apartado» (o el propio documento, «este.html#x»): se desplaza dentro de él
  | { type: "external" } // con esquema (https://…, mailto:…) o «//host»: como hasta ahora, en otra pestaña
  | { type: "document"; id: string; hash: string } // otro documento de la MISMA Documentación
  | { type: "missing" }; // enlace relativo a un fichero que no está en la Documentación

/**
 * Último tramo de una ruta relativa (sin «?consulta» ni «#hash»), decodificado, en minúsculas y arreglado como se arregla
 * el nombre de un documento al subirlo (sanitizeDocumentName: forma NFC, espacios seguidos en uno, «:» o «?» a «_»…): así
 * «a%20%20b.html» encuentra «a b.html» y un nombre escrito con tildes descompuestas (NFD, el de macOS) encuentra el suyo.
 * null si no hay nombre.
 */
export function linkFileName(path: string): string | null {
  const last = path.split(/[\\/]/).pop() ?? "";
  if (!last || last === "." || last === "..") return null;
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch { /* «%» suelto: se compara tal cual */ }
  if (!decoded.trim()) return null;
  return sanitizeDocumentName(decoded).toLowerCase();
}

/**
 * Qué hacer con el `href` de un enlace de un documento HTML. `docs` son SOLO los documentos (no borrados) del proyecto que
 * se está viendo: un documento de otro proyecto nunca puede salir de aquí, aunque tenga el mismo nombre. Si hay varios con
 * el mismo nombre gana el primero de la lista (la más reciente). `selfId`: el documento que se está viendo.
 */
export function classifyHtmlLink(href: string, docs: readonly { id: string; name: string }[], selfId?: string): HtmlLink {
  const value = href.trim();
  if (value.startsWith("#")) return { type: "internal", hash: value };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("\\\\")) return { type: "external" };
  const hashAt = value.indexOf("#");
  const hash = hashAt >= 0 ? value.slice(hashAt) : "";
  const path = (hashAt >= 0 ? value.slice(0, hashAt) : value).split("?")[0]!;
  // Sin ruta («», «?x=1», «?x#y»): es el propio documento, como en el navegador.
  if (!path) return { type: "internal", hash };
  const wanted = linkFileName(path);
  if (!wanted) return { type: "missing" };
  const found = docs.find((d) => d.name.trim().toLowerCase() === wanted);
  if (!found) return { type: "missing" };
  // El propio documento por su nombre (el índice de «guia.html» con «guia.html#tema»): se queda en el marco, sin otra pestaña.
  if (found.id === selfId) return { type: "internal", hash };
  // El apartado se normaliza (decodificado y vuelto a codificar) y se acota; nada del enlace original viaja tal cual.
  let fragment = hash.slice(1);
  try {
    fragment = decodeURIComponent(fragment);
  } catch { /* se deja como está */ }
  return { type: "document", id: found.id, hash: fragment && fragment.length <= 200 ? `#${encodeURIComponent(fragment)}` : "" };
}
