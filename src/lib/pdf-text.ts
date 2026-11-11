// Texto para los PDF (@react-pdf/renderer con las fuentes estándar Helvetica). Funciones puras.
//
// Las fuentes estándar de PDF solo tienen los caracteres de WinAnsi (Windows-1252: latín occidental, € y comillas
// tipográficas); cualquier otro se pintaba como basura («🎉» salía «<‰», «😀» «=»). No se registra una fuente TTF
// con más glifos porque ninguna fuente libre de un tamaño razonable cubre también los emojis (y @react-pdf no pinta
// emojis de color sin descargar imágenes de fuera). Así que, antes de pintar, se cambian los caracteres que no caben:
// los emojis se quitan, las letras con diacríticos de otras lenguas pierden el diacrítico («ā» → «a») y lo demás
// queda como «?», para que se note que ahí había algo.

// Los 27 caracteres de WinAnsi entre 0x80 y 0x9F que no son de Latin-1.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

function isWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch);
}

// Equivalentes legibles de símbolos frecuentes que no están en WinAnsi.
const SUBSTITUTE: Record<string, string> = {
  "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "−": "-", "‐": "-", "‑": "-",
  "‒": "-", "―": "—", "′": "'", "″": '"', "✓": "v", "✔": "v", "✗": "x", "✘": "x", "\u2028": "\n", "\u2029": "\n",
  "\u200b": "", "\u2060": "", "\ufeff": "",
};

// Emojis y sus piezas: pictogramas, modificadores de tono, selectores de variación, unión (ZWJ), banderas y teclas.
const EMOJI = /(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u200d\ufe0e\ufe0f\u20e3]|[\u{e0020}-\u{e007f}])+/gu;

/** Texto que pueden pintar las fuentes estándar del PDF (ver arriba). */
export function pdfSafeText(text: string): string {
  if (!/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) return text;
  // Un emoji entre dos espacios deja uno solo; pegado a una palabra o al principio o al final, ninguno («Hecho 🎉 ya» →
  // «Hecho ya», «🎉 Hecho» → «Hecho»). ©, ® y ™ también son «pictográficos», pero WinAnsi los tiene: se quedan.
  const noEmoji = text
    .normalize("NFC")
    .replace(EMOJI, (m) => [...m].filter(isWinAnsi).join("") || "\u0000")
    .replace(/( ?)\u0000(?: *\u0000)*( ?)/g, (m: string, a: string, b: string, at: number, all: string) =>
      at === 0 || at + m.length === all.length ? "" : a && b ? " " : a || b,
    );
  let out = "";
  for (const ch of noEmoji) {
    if (isWinAnsi(ch)) out += ch;
    else if (ch in SUBSTITUTE) out += SUBSTITUTE[ch];
    else {
      const base = ch.normalize("NFKD").replace(/\p{M}/gu, "");
      out += base && [...base].every(isWinAnsi) ? base : "?";
    }
  }
  return out;
}

/** Copia de los datos de un PDF con todos sus textos pasados por pdfSafeText. */
export function pdfSafeData<T>(value: T): T {
  if (typeof value === "string") return pdfSafeText(value) as T;
  if (Array.isArray(value)) return value.map(pdfSafeData) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pdfSafeData(v)])) as T;
  }
  return value;
}

/** A partir de cuántos caracteres una palabra se puede partir, y en trozos de cuántos. */
export const PDF_LONG_WORD = 20;
const PDF_WORD_PIECE = 10;

/**
 * Puntos de corte de una palabra (para Font.registerHyphenationCallback). Las palabras normales no se parten (con la
 * partición por sílabas en inglés salía «re-sumen»); las de más de PDF_LONG_WORD caracteres (URLs, rutas, textos sin
 * espacios) se ofrecen en trozos para que la línea pueda cortarse dentro de ellas en vez de salirse de la celda o de
 * la página. Solo se corta donde hace falta.
 */
export function pdfWordParts(word: string): string[] {
  const chars = [...word];
  if (chars.length <= PDF_LONG_WORD) return [word];
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += PDF_WORD_PIECE) parts.push(chars.slice(i, i + PDF_WORD_PIECE).join(""));
  return parts;
}
