// Título automático de las notas de Documentación (v1.77): una nota recién creada («Nota sin título») toma como nombre
// su primera línea con texto, sin marcas de Markdown, mientras nadie la renombre a mano. Funciones puras.
import { translate } from "../i18n/core";
import { sanitizeDocumentName } from "./document-kind";
import { ellipsize } from "./graphemes";
import { markdownToPlain } from "./ics";

/** Largo máximo del nombre que se toma de la primera línea (el de un documento admite 120). */
export const NOTE_TITLE_MAX = 80;

/** Cuánto texto del principio de la nota se mira: el título sale de ahí (no se pasa a texto plano la nota entera). */
const HEAD_CHARS = 4000;

/** Nombres por defecto de una nota nueva, en cada idioma de la app (el de quien la creó). */
const DEFAULT_NOTE_NAMES = new Set([translate("es", "Nota sin título"), translate("en", "Nota sin título")]);

export const isDefaultNoteName = (name: string): boolean => DEFAULT_NOTE_NAMES.has(name);

/**
 * Nombre que sale de la primera línea con texto de la nota: sin marcas de Markdown (títulos, listas, casillas, citas,
 * énfasis, enlaces, imágenes, HTML), las menciones como «@Ana», sin los caracteres que no admite un nombre de archivo y
 * recortado a NOTE_TITLE_MAX caracteres con «…». "" si la nota no tiene texto.
 */
export function noteAutoTitle(content: string): string {
  // En un título no caben direcciones: de un enlace queda su texto y una imagen no cuenta (una línea con solo una
  // imagen pegada no es el título). Las menciones (@[Ana](user:x)) quedan como «@Ana».
  const head = content.slice(0, HEAD_CHARS)
    .replace(/!\[[^\]\n]{0,500}\]\([^()\s]{0,2000}(?:\s[^()\n]{0,500})?\)/g, "")
    .replace(/(?<!@)\[([^\]\n]{1,500})\]\([^()\s]{1,2000}(?:\s[^()\n]{0,500})?\)/g, "$1");
  const plain = markdownToPlain(head);
  for (const raw of plain.split("\n")) {
    const line = raw
      // Viñetas, casillas y números de lista que markdownToPlain deja («- », «[ ] », «1. »).
      .replace(/^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?(?:\d{1,9}[.)]\s+)?/, "")
      .replace(/\s+/g, " ")
      .trim();
    // Separadores («---», «***») y líneas de tabla sin letras no son un título.
    if (!line || !/[\p{L}\p{N}]/u.test(line)) continue;
    return sanitizeDocumentName(ellipsize(line, NOTE_TITLE_MAX), "");
  }
  return "";
}
