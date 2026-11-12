// Texto por caracteres visibles (grafemas): un emoji de familia, una bandera o una letra con tilde combinada son uno
// solo, no varias unidades UTF-16. Módulo puro (sin servidor ni DOM): lo usan el cliente y el servidor.

let segmenter: Intl.Segmenter | null | undefined;

/**
 * Trozos de texto sin partir emojis ni secuencias unidas (bandera, familia, tono de piel). Es perezoso: quien lo recorre
 * se para cuando quiere, así que un texto enorme (p. ej. 1 MB pegado en el título) no se segmenta entero. Sin
 * Intl.Segmenter (navegadores antiguos), por puntos de código: al menos nunca parte un par sustituto.
 */
export function* graphemes(text: string): Generator<string> {
  segmenter ??= typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  if (segmenter) for (const s of segmenter.segment(text)) yield s.segment;
  else yield* text;
}

/** Empieza por una letra o un número (de cualquier alfabeto): no un signo de puntuación, un símbolo ni un emoji. */
const ALNUM_START = /^[\p{L}\p{N}]/u;

/** Primer carácter visible de la palabra que es letra o número, en mayúsculas («¡hola» → «H»); null si no tiene. Sin
 * toLocaleUpperCase: el servidor y el navegador pueden tener otro idioma y la hidratación no cuadraría. */
function firstAlnum(word: string): string | null {
  for (const g of graphemes(word)) if (ALNUM_START.test(g)) return g.toUpperCase();
  return null;
}

/**
 * Iniciales de un nombre por caracteres visibles y solo con letras o números: las palabras sin ninguno (emojis,
 * comillas, guiones sueltos) no cuentan. `pick`: «firstLast», la primera y la última palabra (avatares: «Dani Ruiz 😀» →
 * «DR»); «firstTwo», las dos primeras (proyectos en el calendario: «Trello «raro» 🎉» → «TR»). Sin ninguna letra ni
 * número, el primer carácter visible del nombre (un emoji entero, nunca medio) o «?» si está vacío.
 */
export function initialsOf(name: string, pick: "firstLast" | "firstTwo"): string {
  const letters = name.split(/\s+/).map(firstAlnum).filter((x): x is string => x !== null);
  if (letters.length) {
    const chosen = letters.length === 1 ? letters : pick === "firstLast" ? [letters[0], letters.at(-1)] : letters.slice(0, 2);
    return chosen.join("");
  }
  const first = graphemes(name.trim()).next();
  return first.done ? "?" : first.value;
}
