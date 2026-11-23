// Utilidades de texto y fechas comunes a los lectores de otros Kanban. Sin dependencias de Node.
import type { Locale, T } from "@/i18n/shared";
import { MAX_DESCRIPTION, MAX_TITLE } from "../constants";

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

/** Etiquetas HTML que se quitan dejando su texto (cualquier otra cosa entre «<» y «>», como `<T>` o `<tu-email>`, es texto del usuario). */
const KNOWN_TAG = /<\/?(?:a|b|i|u|em|strong|p|div|span|br|hr|img|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|pre|code|blockquote|font|center|small|sup|sub|s|strike|del|ins)(?:\s[^<>]*)?\/?>/gi;
/** Bloques que se quitan con su contenido. */
const BLOCK_OPEN = /<(script|style|iframe|object|embed)\b/gi;
/** Pasadas máximas de stripHtml (cada una quita un nivel de etiquetas anidadas como `<img x <b>>`). */
const MAX_HTML_PASSES = 50;

/** Quita los comentarios HTML en una sola pasada (un `<!--` sin cierre se queda como texto). */
function stripComments(s: string): string {
  let at = s.indexOf("<!--");
  if (at === -1) return s;
  let out = "";
  let from = 0;
  while (at !== -1) {
    const close = s.indexOf("-->", at + 4);
    if (close === -1) break;
    out += s.slice(from, at);
    from = close + 3;
    at = s.indexOf("<!--", from);
  }
  return out + s.slice(from);
}

/**
 * Quita los bloques <script>, <style>, <iframe>, <object> y <embed> con su contenido; si no tienen cierre, solo la etiqueta
 * de apertura. Lineal: cada búsqueda de cierre o de «>» que falla se recuerda y no se repite.
 */
function stripBlocks(s: string): string {
  if (!/<(?:script|style|iframe|object|embed)\b/i.test(s)) return s;
  const closers = new Map<string, RegExp>();
  const noClose = new Set<string>();
  let noGt = false;
  let out = "";
  let from = 0;
  BLOCK_OPEN.lastIndex = 0;
  for (let m = BLOCK_OPEN.exec(s); m; m = BLOCK_OPEN.exec(s)) {
    if (m.index < from) continue;
    const name = m[1]!.toLowerCase();
    let end = -1;
    if (!noClose.has(name)) {
      let re = closers.get(name);
      if (!re) { re = new RegExp(`</${name}\\s*>`, "gi"); closers.set(name, re); }
      re.lastIndex = m.index + m[0].length;
      const c = re.exec(s);
      if (c) end = c.index + c[0].length; else noClose.add(name);
    }
    if (end === -1 && !noGt) {
      const gt = s.indexOf(">", m.index + m[0].length);
      if (gt === -1) noGt = true; else end = gt + 1;
    }
    if (end === -1) continue;
    out += s.slice(from, m.index);
    from = end;
    BLOCK_OPEN.lastIndex = end;
  }
  return out + s.slice(from);
}

/**
 * HTML en bruto → nada. Los bloques <script>, <style>, <iframe>, <object> y <embed> desaparecen con su contenido, igual que
 * los comentarios; <br> y el cierre de párrafo son saltos de línea; las etiquetas HTML conocidas se quitan dejando el texto.
 * Lo que solo parece una etiqueta (`Promise<void>`, `<T>`, `<tu-email>`) y las autoenlaces <https://…> se conservan.
 * Se repite hasta que no cambie nada (quitar `<b>` de `<img x onerror=1 <b>>` deja una etiqueta `<img>` completa).
 */
export function stripHtml(s: string): string {
  if (!s.includes("<")) return s;
  let cur = s;
  for (let pass = 0; pass < MAX_HTML_PASSES; pass++) {
    const next = stripBlocks(stripComments(cur))
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
      .replace(KNOWN_TAG, "");
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/** Destino de enlace que solo debe ser texto: un esquema que no sea http(s) o mailto (javascript:, data:…) y los destinos internos de las menciones (`#mention-…`) y del subrayado (`#u`). */
const LINK_TAIL = /\(\s*<?(?:([a-z][a-z0-9+.-]*):|(#(?:mention-|u)))(?:[^()\n]|\([^()\n]*\))*\)/iy;
/** Definición de referencia (`[x]: #mention-abc`) con un destino interno: la línea se descarta. */
const INTERNAL_DEFINITION = /^[ \t]{0,3}\[[^\]\n]*\]:[ \t]*<?#(?:mention-|u)[^\n]*(?:\n|$)/gim;

/**
 * Los enlaces Markdown con un esquema que no sea http(s) o mailto, o con un destino interno (`#mention-…`, `#u`), quedan solo
 * como su texto (si no, `[@Admin](#mention-x)` se pintaría como una mención de verdad). Recorrido lineal: una «[» sin cierre
 * (80.000 seguidas) no obliga a releer el resto de la línea en cada una.
 */
function neutralizeLinks(input: string): string {
  const s = input.includes("#") ? input.replace(INTERNAL_DEFINITION, "") : input;
  if (!s.includes("](")) return s;
  let out = "";
  let from = 0; // lo ya copiado a `out`
  let open = -1; // primera «[» desde el último «]» o salto de línea
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 10) open = -1;
    else if (c === 91) { if (open < 0) open = i; }
    else if (c === 93) {
      if (open >= 0 && s.charCodeAt(i + 1) === 40) {
        LINK_TAIL.lastIndex = i + 1;
        const m = LINK_TAIL.exec(s);
        if (m) {
          const end = i + 1 + m[0].length;
          if (!(m[1] && /^(https?|mailto)$/i.test(m[1]))) {
            const bang = open > from && s.charCodeAt(open - 1) === 33 ? 1 : 0;
            out += s.slice(from, open - bang) + s.slice(open + 1, i);
            from = end;
          }
          i = end - 1;
        }
      }
      open = -1;
    }
  }
  return out + s.slice(from);
}

/** Recorta la entrada en bruto antes de sanearla (el saneado de textos enormes es caro y se recortaría igualmente). Sin partir un par sustituto. */
function bound(raw: string, limit: number): string {
  if (raw.length <= limit) return raw;
  const end = raw.charCodeAt(limit - 1) >= 0xd800 && raw.charCodeAt(limit - 1) <= 0xdbff ? limit - 1 : limit;
  return raw.slice(0, end);
}

/** Cuenta una sola vez el recorte (el de la entrada en bruto y el final son el mismo texto). */
function countClip(raw: string, rawMax: number, final: string, max: number, counter?: { n: number }): string {
  if (!counter) return clip(final, max);
  const own = { n: 0 };
  const out = clip(final, max, own);
  if (own.n || raw.length > rawMax) counter.n++;
  return out;
}

/** Título de una línea, recortado al máximo de la aplicación. */
export function cleanTitle(raw: string, max = MAX_TITLE, counter?: { n: number }): string {
  const rawMax = max * 4;
  return countClip(raw, rawMax, basic(stripHtml(bound(raw, rawMax))).replace(/\s+/g, " ").trim(), max, counter);
}

/** Nombres cortos (columnas, etiquetas): una línea, sin HTML. */
export function cleanName(raw: string, max: number): string {
  return clip(basic(stripHtml(bound(raw, max * 4))).replace(/\s+/g, " ").trim(), max);
}

/** Descripción Markdown: sin HTML en bruto, sin esquemas peligrosos, sin controles, y recortada al máximo. */
export function cleanMarkdown(raw: string, max = MAX_DESCRIPTION, counter?: { n: number }): string {
  const rawMax = max * 2;
  return countClip(raw, rawMax, neutralizeLinks(basic(stripHtml(bound(raw, rawMax)))).replace(/\n{4,}/g, "\n\n\n").trim(), max, counter);
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

/** Sin acentos, en minúsculas y con espacios simples: para comparar cabeceras y valores. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\-./]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Columnas cuyo nombre indica «terminado»: cuentan como hechas en informes y plazos (y en un CSV van al final). */
const DONE_RE = /^(done|hecho|hecha|hechos|completad[oa]s?|completed?|terminad[oa]s?|finalizad[oa]s?|finished|cerrad[oa]s?|closed|resuelt[oa]s?|resolved|en produccion|production|released?|entregad[oa]s?|delivered|archiv\w*)\b/;
export const isDoneName = (name: string): boolean => DONE_RE.test(name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim());

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

/** Un formateador por zona horaria (crearlos es lo caro: 150.000 comentarios tardaban 30 s). null = zona no válida. */
const dayFormats = new Map<string, Intl.DateTimeFormat | null>();

function dayFormat(timeZone: string): Intl.DateTimeFormat | null {
  let f = dayFormats.get(timeZone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      f = null;
    }
    if (dayFormats.size >= 100) dayFormats.clear();
    dayFormats.set(timeZone, f);
  }
  return f;
}

/** Día natural de un instante en una zona horaria (null si el instante no es válido). */
export function instantDay(d: Date, timeZone = "UTC"): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const f = dayFormat(timeZone);
  try {
    if (f) return f.format(d);
  } catch {
    // cae al día UTC
  }
  return d.toISOString().slice(0, 10);
}

/** Orden de una fecha con barras (o puntos o guiones): día/mes («31/12/2026») o mes/día («12/31/2026», EE. UU.). */
export type DayOrder = "dmy" | "mdy";

/** Fecha con barras, puntos o guiones y el año al final: «31/12/2026», «1.2.26», «03-04-2026». */
const SLASH_DAY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/;

/**
 * Fecha con puntos en los dos separadores («1.12.2026», «01.12.26»): siempre día/mes, sea cual sea el idioma o el resto
 * del fichero (decisión del propietario: con puntos no se escribe mes/día en ningún formato habitual). No cuenta para
 * decidir el orden de las demás (decideDayOrder).
 */
const DOTTED_DAY = /^\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4})\b/;

/** Orden con el que se lee una fecha con barras, puntos o guiones: el del fichero (`order`), salvo con puntos (día/mes). */
function dayOrderFor(raw: string, order: DayOrder): DayOrder {
  return DOTTED_DAY.test(raw.trim()) ? "dmy" : order;
}

/** Día y mes de «a/b/año» según el orden: si en ese orden el mes pasa de 12, se lee al revés (la única lectura posible). */
function slashDayMonth(a: number, b: number, order: DayOrder): [month: number, day: number] {
  if (order === "mdy") return a <= 12 ? [a, b] : [b, a];
  return b <= 12 ? [b, a] : [a, b];
}

/**
 * Orden de las fechas con barras de un fichero (o de una columna de un CSV), decidido una vez para todas (las de puntos
 * no cuentan: siempre día/mes, dayOrderFor): una que solo
 * puede ser día/mes («21/03/2026») hace que todo el fichero sea día/mes; una que solo puede ser mes/día («03/21/2026»),
 * mes/día. Si todas son ambiguas («03/04/2026»), el idioma de quien importa: en inglés (EE. UU.) mes/día, en español
 * día/mes. `mixed`: hay de las dos clases (fechas incompatibles entre sí); entonces las ambiguas van por el idioma y las
 * otras se leen de la única manera posible, y quien importa debe ser avisado. Antes se decidía fecha a fecha y en un
 * mismo CSV americano «03/04/2026» salía 3 de abril y «03/21/2026», 21 de marzo, sin avisar.
 */
export function decideDayOrder(values: Iterable<unknown>, locale: Locale = "es"): { order: DayOrder; mixed: boolean } {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    if (typeof v !== "string" || DOTTED_DAY.test(v.trim())) continue;
    const m = SLASH_DAY.exec(v.trim());
    if (!m) continue;
    const a = +m[1]!, b = +m[2]!;
    if (a > 12 && b <= 12) dmy = true;
    else if (b > 12 && a <= 12) mdy = true;
    if (dmy && mdy) break;
  }
  const byLocale: DayOrder = locale === "en" ? "mdy" : "dmy";
  return { order: dmy && mdy ? byLocale : dmy ? "dmy" : mdy ? "mdy" : byLocale, mixed: dmy && mdy };
}

/** Aviso de fechas con barras en dos órdenes (decideDayOrder: `mixed`), ya traducido; `order`: cómo se han leído las ambiguas. */
export function mixedDayOrderWarning(t: T, order: DayOrder): string {
  return t("Hay fechas en dos formatos (día/mes y mes/día): las que valen de las dos maneras (como 03/04/2026) se han leído como {order}. Revísalas.", { order: order === "mdy" ? t("mes/día") : t("día/mes") });
}

/**
 * Fecha de un CSV (o de cualquier texto) → YYYY-MM-DD, o null si no se entiende. Admite ISO (con hora o no),
 * 31/12/2026 (en el orden `order`, decidido para todo el fichero con decideDayOrder; si en ese orden el mes pasa de 12,
 * al revés; con puntos, «1.12.2026», siempre día/mes), 31-dic-2026, 15/Jan/26 10:20 AM, «January 15, 2026» y «15 de enero de 2026». Una fecha ISO con hora y zona
 * (Z o ±hh:mm) pasa al día de `timeZone`.
 */
export function parseDay(raw: string, timeZone = "UTC", order: DayOrder = "dmy"): string | null {
  const s = raw.trim();
  if (!s || s.length > 100) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (m) {
    if (m[7]) return instantDay(new Date(s.replace(" ", "T")), timeZone) ?? validDay(+m[1]!, +m[2]!, +m[3]!);
    return validDay(+m[1]!, +m[2]!, +m[3]!);
  }
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})\b/.exec(s);
  if (m) return validDay(+m[1]!, +m[2]!, +m[3]!);
  m = SLASH_DAY.exec(s);
  if (m) {
    const [month, day] = slashDayMonth(+m[1]!, +m[2]!, dayOrderFor(s, order));
    return validDay(fullYear(+m[3]!), month, day);
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

/**
 * Bytes → texto: UTF-8 (con o sin BOM), UTF-16 con BOM (Excel) y, si no es UTF-8 válido, Windows-1252. `whole`: son todos
 * los bytes del archivo (no solo la cabecera que se mira para detectar el formato), así que no puede haber un carácter
 * cortado al final: sin él, un Windows-1252 cuyos únicos bytes no ASCII están en los 3 últimos los perdía («Peñ\n»).
 * Sin `whole`, un carácter cortado al final de la cabecera se deja fuera (`stream`) en vez de tomarlo por Windows-1252:
 * quitar siempre 3 bytes cortaba a veces el carácter anterior y pasaba toda la cabecera a Windows-1252 («TÃ­tulo»).
 */
export function decodeText(buf: Uint8Array, whole = false): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf, { stream: !whole });
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}
