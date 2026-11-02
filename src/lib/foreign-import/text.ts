// Utilidades de texto y fechas comunes a los lectores de otros Kanban. Sin dependencias de Node.
import { MAX_DESCRIPTION, MAX_TITLE, PALETTE } from "../constants";

/** Quita lo que un texto importado nunca debe llevar: caracteres de control y NUL, y menciones @[x](user:id) falsas. */
function basic(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/@\[/g, "@ [");
}

/** Recorta sin partir un par sustituto ni dejar espacios al final. */
export function clip(s: string, max: number, counter?: { n: number }): string {
  if (s.length <= max) return s;
  if (counter) counter.n++;
  let end = max - 1;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return `${s.slice(0, end).trimEnd()}…`;
}

/**
 * HTML en bruto → nada. Los bloques <script> y <style> desaparecen con su contenido; <br> y el cierre de párrafo
 * son saltos de línea; el resto de etiquetas se quita dejando el texto. Se conservan las autoenlaces <https://…>.
 */
export function stripHtml(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed)\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<\/?(?!https?:|mailto:)[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/gi, "");
}

/** Los enlaces Markdown con un esquema que no sea http(s) o mailto (javascript:, data:…) quedan solo como su texto. */
function neutralizeLinks(s: string): string {
  return s.replace(/(!?)\[([^\]\n]*)\]\(\s*<?([a-z][a-z0-9+.-]*):(?:[^()\n]|\([^()\n]*\))*\)/gi, (m, _bang: string, text: string, scheme: string) => (/^(https?|mailto)$/i.test(scheme) ? m : text));
}

/** Título de una línea, recortado al máximo de la aplicación. */
export function cleanTitle(raw: string, max = MAX_TITLE, counter?: { n: number }): string {
  return clip(basic(stripHtml(raw)).replace(/\s+/g, " ").trim(), max, counter);
}

/** Nombres cortos (columnas, etiquetas): una línea, sin HTML. */
export function cleanName(raw: string, max: number): string {
  return clip(basic(stripHtml(raw)).replace(/\s+/g, " ").trim(), max);
}

/** Descripción Markdown: sin HTML en bruto, sin esquemas peligrosos, sin controles, y recortada al máximo. */
export function cleanMarkdown(raw: string, max = MAX_DESCRIPTION, counter?: { n: number }): string {
  return clip(neutralizeLinks(basic(stripHtml(raw))).replace(/\n{4,}/g, "\n\n\n").trim(), max, counter);
}

/** URL http(s) sin espacios ni caracteres que rompan un enlace Markdown, o null. */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!/^https?:\/\/[^\s<>]+$/i.test(url) || url.length > 2000) return null;
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/** Enlace Markdown con el texto escapado. */
export function mdLink(text: string, url: string): string {
  const label = text.replace(/\s+/g, " ").trim().replace(/([[\]\\])/g, "\\$1") || url;
  return `[${label}](${url})`;
}

/** Color de la paleta de la aplicación más cercano a uno hexadecimal cualquiera. */
export function nearestPaletteColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return PALETTE[0];
  const n = parseInt(m[1]!, 16);
  const rgb = [n >> 16, (n >> 8) & 255, n & 255];
  let best: string = PALETTE[0];
  let bestD = Infinity;
  for (const p of PALETTE) {
    const q = parseInt(p.slice(1), 16);
    const d = (rgb[0]! - (q >> 16)) ** 2 + (rgb[1]! - ((q >> 8) & 255)) ** 2 + (rgb[2]! - (q & 255)) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** Sin acentos, en minúsculas y con espacios simples: para comparar cabeceras y valores. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\-./]+/g, " ").replace(/\s+/g, " ").trim();
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, ene: 1, enero: 1, feb: 2, february: 2, febrero: 2, mar: 3, march: 3, marzo: 3, apr: 4, april: 4, abr: 4, abril: 4,
  may: 5, mayo: 5, jun: 6, june: 6, junio: 6, jul: 7, july: 7, julio: 7, aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9, setiembre: 9, oct: 10, october: 10, octubre: 10, nov: 11, november: 11, noviembre: 11,
  dec: 12, december: 12, dic: 12, diciembre: 12,
};

function validDay(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const back = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(back.getTime()) && back.toISOString().slice(0, 10) === iso ? iso : null;
}

const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** Día natural de un instante en una zona horaria (null si el instante no es válido). */
export function instantDay(d: Date, timeZone = "UTC"): string | null {
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Fecha de un CSV (o de cualquier texto) → YYYY-MM-DD, o null si no se entiende. Admite ISO (con hora o no),
 * 31/12/2026 (día primero; si el segundo número pasa de 12 se entiende mes primero), 31-dic-2026, 15/Jan/26 10:20 AM,
 * «January 15, 2026» y «15 de enero de 2026». Una fecha ISO con hora y zona (Z o ±hh:mm) pasa al día de `timeZone`.
 */
export function parseDay(raw: string, timeZone = "UTC"): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (m) {
    if (m[7]) return instantDay(new Date(s.replace(" ", "T")), timeZone) ?? validDay(+m[1]!, +m[2]!, +m[3]!);
    return validDay(+m[1]!, +m[2]!, +m[3]!);
  }
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})\b/.exec(s);
  if (m) return validDay(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(s);
  if (m) {
    const a = +m[1]!, b = +m[2]!, y = fullYear(+m[3]!);
    return b > 12 && a <= 12 ? validDay(y, a, b) : validDay(y, b, a);
  }
  m = /^(\d{1,2})[\s/.-]+(?:de\s+)?([a-záéíóú]+)\.?[\s/.-]+(?:de\s+)?(\d{2}|\d{4})\b/i.exec(s);
  if (m && MONTHS[fold(m[2]!)]) return validDay(fullYear(+m[3]!), MONTHS[fold(m[2]!)]!, +m[1]!);
  m = /^([a-záéíóú]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(s);
  if (m && MONTHS[fold(m[1]!)]) return validDay(+m[3]!, MONTHS[fold(m[1]!)]!, +m[2]!);
  return null;
}

/** Instante a Date (o null si no vale). */
export function parseInstant(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) || d.getFullYear() < 1990 || d.getFullYear() > 2999 ? null : d;
}
