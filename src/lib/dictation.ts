/**
 * Texto dictado (Web Speech API) → texto que se inserta en un campo. Funciones puras, sin DOM.
 */

/** Signos que, al principio del trozo dictado, se pegan a la palabra anterior (sin espacio delante). */
const CLOSING = /^[.,;:!?)\]»”%]/;
/**
 * Caracteres tras los que no hace falta espacio: abrir paréntesis o comillas, espacio, salto de línea, ¿ ¡.
 * Las comillas rectas, el guion y la barra solo cuentan como «de apertura» al principio o tras un espacio:
 * en «hola"» o «a-b» cierran o unen, y lo dictado después sí lleva espacio.
 */
const OPENING_END = /(?:[\s([{«“¿¡]|(?:^|\s)["'\-/])$/;
/** Tras una línea vacía o un marcador de lista, cita o título de Markdown empieza frase. */
const SENTENCE_START = /^(?:\s*|\s*(?:[-*+>]|\d+[.)]|#{1,6})\s*)$/;

/** ¿Empieza frase justo después de `before`? (principio del campo, de línea o de lista, o tras «. », «? », «! »). */
export function startsSentence(before: string): boolean {
  const line = before.slice(before.lastIndexOf("\n") + 1);
  if (SENTENCE_START.test(line)) return true;
  return /[.!?…]["»”)]?\s*$/.test(line);
}

/** Pone en mayúscula la primera letra del texto. */
export function capitalizeFirst(text: string): string {
  const i = text.search(/\p{L}/u);
  if (i < 0) return text;
  return text.slice(0, i) + text[i]!.toLocaleUpperCase() + text.slice(i + 1);
}

/**
 * Trozo que hay que insertar entre `before` y `after` para el texto dictado `spoken`: sin espacios sobrantes, con el espacio
 * que falte a cada lado, y con mayúscula inicial al empezar frase. Devuelve «» si no hay nada que insertar.
 */
export function dictationChunk(before: string, after: string, spoken: string): string {
  let text = spoken.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (startsSentence(before)) text = capitalizeFirst(text);
  if (before && !OPENING_END.test(before) && !CLOSING.test(text)) text = ` ${text}`;
  if (after && !/^[\s.,;:!?)\]»”]/.test(after)) text = `${text} `;
  return text;
}

export interface DictationEdit {
  value: string;
  /** Posición del cursor tras el texto insertado. */
  start: number;
  end: number;
}

/**
 * Inserta el texto dictado en la selección [start, end) de `value` (la reemplaza). `null` si no hay nada que insertar.
 * Con `newLine` cada trozo va en su propia línea (listas de tareas: una por línea).
 */
export function insertDictation(value: string, start: number, end: number, spoken: string, newLine = false): DictationEdit | null {
  const before = value.slice(0, start);
  const after = value.slice(end);
  if (newLine) {
    const lead = before && !before.endsWith("\n") ? "\n" : "";
    const chunk = dictationChunk(before + lead, "", spoken);
    if (!chunk) return null;
    const trail = after && !after.startsWith("\n") ? "\n" : "";
    const caret = before.length + lead.length + chunk.length;
    return { value: before + lead + chunk + trail + after, start: caret, end: caret };
  }
  const chunk = dictationChunk(before, after, spoken);
  if (!chunk) return null;
  // El cursor queda tras el texto, antes del espacio que se añadió a la derecha.
  const caret = before.length + chunk.trimEnd().length;
  return { value: before + chunk + after, start: caret, end: caret };
}

/** Idioma de reconocimiento por defecto según el idioma de la interfaz («es-ES» / «en-GB» → es-ES / en-US). */
export function dictationLang(intlLocale: string): string {
  return intlLocale.toLowerCase().startsWith("es") ? "es-ES" : "en-US";
}

/** Idiomas que se ofrecen en Mi perfil → Preferencias. */
export const DICTATION_LANGS: { code: string; label: string }[] = [
  { code: "es-ES", label: "Español (España)" },
  { code: "es-MX", label: "Español (México)" },
  { code: "es-AR", label: "Español (Argentina)" },
  { code: "ca-ES", label: "Català" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "fr-FR", label: "Français" },
  { code: "de-DE", label: "Deutsch" },
  { code: "it-IT", label: "Italiano" },
  { code: "pt-PT", label: "Português (Portugal)" },
  { code: "pt-BR", label: "Português (Brasil)" },
];
