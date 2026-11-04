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

let segmenter: Intl.Segmenter | null | undefined;

/**
 * Trozos de texto sin partir emojis ni secuencias unidas (bandera, familia, tono de piel). Es perezoso: quien lo recorre
 * se para al llenar el máximo, así que un texto enorme (p. ej. 1 MB pegado en el título) no se segmenta entero.
 */
function* graphemes(text: string): Generator<string> {
  segmenter ??= typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  if (segmenter) for (const s of segmenter.segment(text)) yield s.segment;
  else yield* text;
}

// Último resultado: el servidor recorta el título al validarlo y vuelve a preguntar si se recortó (aviso al cliente).
let last: { raw: string; max: number; result: ClampedTitle } | null = null;

/**
 * Corta el título a `max` caracteres visibles. No parte un emoji ni una mención @[Nombre](user:ID): si la mención
 * no cabe entera, se queda fuera. El corte no deja espacios al final.
 */
export function clampTitle(raw: string, max = MAX_TITLE): ClampedTitle {
  // El texto visible nunca es más largo que el original: lo corto no necesita más cálculo.
  if (raw.length <= max) return { value: raw, clipped: false };
  if (last && last.raw === raw && last.max === max) return last.result;
  const result = clampLong(raw, max);
  last = { raw, max, result };
  return result;
}

function clampLong(raw: string, max: number): ClampedTitle {
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
