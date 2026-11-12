// Recorte de títulos de tarea al máximo permitido (MAX_TITLE) sin tirar el guardado entero.
// Módulo puro (sin servidor ni DOM): lo usan el cliente (aviso al escribir y al guardar) y el servidor.
//
// El máximo cuenta lo que ve la persona: grafemas (un emoji de familia, una bandera o una letra con tilde combinada son
// un solo carácter), no unidades UTF-16. Además hay un tope duro en unidades (MAX_TITLE_UNITS) para que el tamaño
// guardado siga acotado aunque cada carácter sea un emoji compuesto.
import { MAX_TITLE, MAX_TITLE_UNITS } from "./constants";
import { graphemes } from "./graphemes";
import { mentionRegex, mentionsToPlain } from "./mentions";

interface ClampedTitle {
  /** Título ya cortado (con las menciones enteras). */
  value: string;
  /** true si el original superaba el máximo y se ha cortado. */
  clipped: boolean;
  /**
   * Solo si se ha cortado: a cuántos caracteres visibles. Es el máximo, salvo cuando manda el tope de unidades (emojis
   * muy compuestos): entonces caben menos y es lo que se ha guardado de verdad (100 familias 👨‍👩‍👧‍👦 → 76). Los avisos
   * («Título recortado a {max} caracteres») y el contador «n/máx» usan este número.
   */
  limit?: number;
}

/** Número de grafemas (caracteres que se ven) de un texto. */
export function graphemeCount(text: string): number {
  // Solo ASCII imprimible: cada unidad es un carácter (el caso normal, sin segmentar).
  if (/^[\x20-\x7e]*$/.test(text)) return text.length;
  let n = 0;
  for (const _ of graphemes(text)) n++;
  return n;
}

/** Longitud que cuenta para el máximo: caracteres visibles (una mención @[Ana](user:x) cuenta como «@Ana»). */
export function titleLength(text: string): number {
  return graphemeCount(mentionsToPlain(text));
}

/** ¿Pasa del máximo? (caracteres visibles o, con emojis muy compuestos, el tope duro de unidades). */
export function titleTooLong(text: string, max = MAX_TITLE, maxUnits = MAX_TITLE_UNITS): boolean {
  if (text.length <= max) return false;
  const plain = mentionsToPlain(text);
  return plain.length > maxUnits || graphemeCount(plain) > max;
}

// Último resultado: el servidor recorta el título al validarlo y vuelve a preguntar si se recortó (aviso al cliente).
let last: { raw: string; max: number; maxUnits: number; result: ClampedTitle } | null = null;

/**
 * Corta el título a `max` caracteres visibles (y `maxUnits` unidades UTF-16 de texto visible). No parte un emoji ni una
 * mención @[Nombre](user:ID): si la mención no cabe entera, se queda fuera. El corte no deja espacios al final.
 */
export function clampTitle(raw: string, max = MAX_TITLE, maxUnits = MAX_TITLE_UNITS): ClampedTitle {
  // El texto visible nunca es más largo que el original, y cada carácter ocupa al menos una unidad: lo corto no necesita más.
  if (raw.length <= max) return { value: raw, clipped: false };
  if (last && last.raw === raw && last.max === max && last.maxUnits === maxUnits) return last.result;
  const result = clampLong(raw, max, maxUnits);
  last = { raw, max, maxUnits, result };
  return result;
}

function clampLong(raw: string, max: number, maxUnits: number): ClampedTitle {
  let used = 0; // caracteres visibles
  let units = 0; // unidades UTF-16 visibles
  let out = "";
  let last = 0;
  // Se recorre el texto alternando trozos sueltos y menciones (que se conservan tal cual o se descartan enteras). El
  // recorrido se para al llenar el máximo: un texto enorme no se segmenta entero.
  const take = (text: string): boolean => {
    for (const g of graphemes(text)) {
      if (used + 1 > max) return false;
      if (units + g.length > maxUnits) {
        byUnits = true;
        return false;
      }
      out += g;
      used++;
      units += g.length;
    }
    return true;
  };
  let full = true;
  // ¿Se paró por el tope de unidades y no por el de caracteres? (el de caracteres se mira primero).
  let byUnits = false;
  for (const m of raw.matchAll(mentionRegex())) {
    if (!take(raw.slice(last, m.index))) {
      full = false;
      break;
    }
    const visible = `@${m[1]!}`;
    const visibleCount = graphemeCount(visible);
    if (used + visibleCount > max || units + visible.length > maxUnits) {
      byUnits = used + visibleCount <= max;
      full = false;
      break;
    }
    out += m[0];
    used += visibleCount;
    units += visible.length;
    last = m.index + m[0].length;
  }
  if (full && take(raw.slice(last))) return { value: raw, clipped: false };
  const value = out.trimEnd();
  return { value, clipped: true, limit: byUnits ? titleLength(value) : max };
}
