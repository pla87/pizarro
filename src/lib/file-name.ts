// Nombres de archivo subidos (adjuntos y documentos): se guardan como los escribió la persona, salvo lo que de verdad
// no puede ir en un nombre. Funciones puras.
//
// Solo es metadato: el fichero se guarda en el disco con un id generado, la descarga lo manda en Content-Disposition con
// `filename*=UTF-8''…` (RFC 5987, todo codificado) y los ZIP usan su propio nombre saneado. Por eso se conservan
// paréntesis, comas, &, +, #, acentos… y solo se cambian los caracteres que Windows no admite en un nombre.

/** Lo que no admite un nombre de archivo en Windows (y la barra, separador en todos los sistemas). */
const FORBIDDEN = /[\\/:*?"<>|]/g;
/** Controles invisibles: los de C0/C1 y los de dirección del texto (con U+202E «exe.pdf» se ve como «fdp.exe»). */
const CONTROL = /[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
/** Extensión que se conserva al recortar: tras el último punto, sin espacios y de 12 caracteres como mucho. */
const EXTENSION = /\.[^.\s]{1,12}$/u;

/** Recorta a `max` unidades sin dejar medio par sustituto. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/[\uD800-\uDBFF]$/, "");
}

/**
 * Nombre de archivo para guardar y mostrar: sin caracteres prohibidos (pasan a «_») ni de control (tabuladores y saltos
 * de línea pasan a espacio; el resto se quita), espacios juntos en uno, sin puntos ni espacios al final y con `max`
 * caracteres como mucho; si hay que recortar, se recorta el nombre y se conserva la extensión.
 */
export function cleanFileName(raw: string | null | undefined, fallback: string, max = 120): string {
  const name = (raw ?? "")
    .normalize("NFC")
    .replace(/[\t\n\r\v\f]/g, " ")
    .replace(CONTROL, "")
    .replace(FORBIDDEN, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (!name) return fallback;
  if (name.length <= max) return name;
  const ext = EXTENSION.exec(name)?.[0] ?? "";
  if (!ext || ext.length >= max) return cut(name, max).trimEnd();
  return cut(name.slice(0, -ext.length), max - ext.length).replace(/[. ]+$/, "") + ext;
}
