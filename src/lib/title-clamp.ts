// Recorte de títulos de tarea al máximo permitido (MAX_TITLE) sin tirar el guardado entero.
// Módulo puro (sin servidor ni DOM): lo usan el cliente (aviso al escribir y al guardar) y el servidor.
import { MAX_TITLE } from "./constants";
import { mentionRegex, mentionsToPlain } from "./mentions";

export interface ClampedTitle {
  /** Título ya cortado (con las menciones enteras). */
  value: string;
  /** true si el original superaba el máximo y se ha cortado. */
  clipped: boolean;
}

/** Longitud que cuenta para el máximo: el texto visible (una mención @[Ana](user:x) cuenta como «@Ana»). */
export function titleLength(text: string): number {
  return mentionsToPlain(text).length;
}

/** Trozos de texto sin partir emojis ni secuencias unidas (bandera, familia, tono de piel). */
function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/**
 * Corta el título a `max` caracteres visibles. No parte un emoji ni una mención @[Nombre](user:ID): si la mención
 * no cabe entera, se queda fuera. El corte no deja espacios al final.
 */
export function clampTitle(raw: string, max = MAX_TITLE): ClampedTitle {
  if (titleLength(raw) <= max) return { value: raw, clipped: false };
  let used = 0;
  let out = "";
  let last = 0;
  // Se recorre el texto alternando trozos sueltos y menciones (que se conservan tal cual o se descartan enteras).
  const take = (text: string): boolean => {
    for (const g of graphemes(text)) {
      if (used + g.length > max) return false;
      out += g;
      used += g.length;
    }
    return true;
  };
  let full = true;
  for (const m of raw.matchAll(mentionRegex())) {
    if (!take(raw.slice(last, m.index))) {
      full = false;
      break;
    }
    const visible = m[1]!.length + 1;
    if (used + visible > max) {
      full = false;
      break;
    }
    out += m[0];
    used += visible;
    last = m.index + m[0].length;
  }
  if (full) take(raw.slice(last));
  return { value: out.trimEnd(), clipped: true };
}
