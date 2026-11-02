// iCalendar (RFC 5545) para exportar a calendario las tareas de una columna Agenda. Funciones puras.
import { addDaysIso } from "./dates";
import { mentionsToPlain } from "./mentions";

export interface IcsEvent {
  /** Identificador estable (sobrescribe el evento al volver a importar). */
  uid: string;
  /** YYYY-MM-DD: evento de día completo (el primer día si es un rango). */
  date: string;
  /** YYYY-MM-DD: último día (incluido) de un rango de días completos; sin él, el evento dura solo `date`. */
  endDate?: string;
  summary: string;
  /** Texto plano. */
  description?: string;
  url?: string;
  /** Último cambio del evento: DTSTAMP y LAST-MODIFIED (sin él, DTSTAMP es el instante de generación). */
  modifiedAt?: Date;
  /** SEQUENCE: entero que sube con cada cambio, para que los clientes sustituyan la copia que ya tienen. */
  sequence?: number;
  /** Etiqueta del evento (CATEGORIES). */
  category?: string;
}

/** Escapa un valor TEXT: barra, punto y coma, coma y saltos de línea. */
export function escapeIcsText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Pliega una línea a 75 octetos como máximo (CRLF + espacio), sin partir caracteres UTF-8. */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  // La primera línea admite 75 octetos; las de continuación 74 (empiezan con un espacio).
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const EMPHASIS_EDGE = /[\p{L}\p{N}_*]/u;
const BLANK = /\s/u;
const LINE_BREAKS = /\r\n|[\n\r\u2028\u2029]/;

const cpBefore = (s: string, i: number): string => {
  if (i <= 0) return "";
  const c = s.charCodeAt(i - 1);
  if (c >= 0xdc00 && c <= 0xdfff && i >= 2) {
    const h = s.charCodeAt(i - 2);
    if (h >= 0xd800 && h <= 0xdbff) return s.slice(i - 2, i);
  }
  return s[i - 1]!;
};
const cpAt = (s: string, i: number): string => (i >= s.length ? "" : String.fromCodePoint(s.codePointAt(i)!));

/**
 * Quita el énfasis Markdown (`**a**`, `__a__`, `*a*`, `_a_`) solo en límite de palabra, igual que lo hacían dos expresiones
 * regulares, pero en tiempo lineal: con `(.+?)` y muchos delimitadores sin cierre (`**a **a **a …`) aquellas eran cuadráticas.
 * `inner` dice si el carácter pegado al delimitador por dentro vale (no vacío ni espacio; en el énfasis simple, tampoco * ni _).
 */
function stripEmphasis(text: string, delims: readonly string[], inner: (cp: string) => boolean): string {
  let out = "";
  let last = 0;
  let lineStart = 0;
  const lines = text.split(LINE_BREAKS);
  // Los terminadores de línea miden 1 o 2 unidades (\r\n): se recorren con una expresión global para conocer cada inicio.
  const breaks = [...text.matchAll(new RegExp(LINE_BREAKS.source, "g"))];
  for (let n = 0; n < lines.length; n++) {
    const ls = lineStart;
    const le = ls + lines[n]!.length;
    lineStart = le + (breaks[n]?.[0].length ?? 0);
    if (le - ls < 3) continue;
    // Cierres válidos por delimitador (solo dependen de la posición), en orden; el cursor avanza y nunca retrocede.
    const closings = new Map<string, { list: number[]; at: number }>();
    const closingsOf = (d: string) => {
      let c = closings.get(d);
      if (!c) {
        const list: number[] = [];
        for (let j = text.indexOf(d, ls); j !== -1 && j + d.length <= le; j = text.indexOf(d, j + 1)) {
          if (inner(cpBefore(text, j)) && !EMPHASIS_EDGE.test(cpAt(text, j + d.length))) list.push(j);
        }
        c = { list, at: 0 };
        closings.set(d, c);
      }
      return c;
    };
    for (let i = ls; i < le; i++) {
      const d = delims.find((x) => text.startsWith(x, i));
      if (!d) continue;
      const after = cpAt(text, i + d.length);
      if (i + d.length >= le || !inner(after) || EMPHASIS_EDGE.test(cpBefore(text, i))) continue;
      const minClose = i + d.length + after.length;
      const c = closingsOf(d);
      while (c.at < c.list.length && c.list[c.at]! < minClose) c.at++;
      const j = c.list[c.at];
      if (j === undefined) continue;
      out += text.slice(last, i) + text.slice(i + d.length, j);
      last = j + d.length;
      i = last - 1;
    }
  }
  return last === 0 ? text : out + text.slice(last);
}

const isInner = (cp: string) => cp !== "" && !BLANK.test(cp);
const isInnerSingle = (cp: string) => isInner(cp) && cp !== "*" && cp !== "_";

/** Recorta a `max` caracteres (puntos de código, sin partir un par sustituto) antes de procesar un texto largo. */
export function cutChars(text: string, max: number): string {
  if (text.length <= max) return text;
  const c = text.charCodeAt(max - 1);
  return text.slice(0, c >= 0xd800 && c <= 0xdbff ? max - 1 : max);
}

/** Descripción de una tarea a texto plano para el .ics: se recorta ANTES de convertir (las expresiones regulares de abajo no deben ver textos enormes). */
export function descriptionToPlain(md: string, max = 1500): string {
  return markdownToPlain(cutChars(md, max));
}

/** Markdown de la descripción de una tarea a texto plano legible. */
export function markdownToPlain(md: string): string {
  const plain = mentionsToPlain(md)
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, text: string, href: string) => (text === href ? text : `${text} (${href})`))
    .replace(/<[^>\n]+>/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "");
  // Énfasis solo en límite de palabra: no toca guiones bajos de URL ni de snake_case, ni 2*3*4.
  return stripEmphasis(stripEmphasis(plain, ["**", "__"], isInner), ["*", "_"], isInnerSingle)
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+\[( |x)\]\s+/gim, (_m, c: string) => (c === " " ? "[ ] " : "[x] "))
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const compact = (iso: string) => iso.replace(/-/g, "");
const stampOf = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Calendario con un evento de día completo por tarea. Líneas separadas por CRLF y plegadas a 75 octetos. */
export function buildIcs(opts: { name: string; events: IcsEvent[]; now?: Date; prodId?: string; /** Suscripción viva: cada cuántos minutos se sugiere a los clientes volver a consultarla. */ refreshMinutes?: number }): string {
  const stamp = stampOf(opts.now ?? new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${opts.prodId ?? "-//Pizarro//Agenda//ES"}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeIcsText(opts.name)}`];
  if (opts.refreshMinutes) lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${opts.refreshMinutes}M`, `X-PUBLISHED-TTL:PT${opts.refreshMinutes}M`);
  for (const e of opts.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(e.uid)}`,
      `DTSTAMP:${e.modifiedAt ? stampOf(e.modifiedAt) : stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      // En eventos de día completo DTEND es exclusivo: el día siguiente al último.
      `DTEND;VALUE=DATE:${compact(addDaysIso(e.endDate && e.endDate > e.date ? e.endDate : e.date, 1))}`,
      `SUMMARY:${escapeIcsText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`);
    if (e.category) lines.push(`CATEGORIES:${escapeIcsText(e.category)}`);
    if (e.modifiedAt) lines.push(`LAST-MODIFIED:${stampOf(e.modifiedAt)}`);
    if (e.sequence !== undefined) lines.push(`SEQUENCE:${Math.max(0, Math.trunc(e.sequence))}`);
    if (e.url) lines.push(`URL:${e.url.replace(/[\r\n]/g, "")}`);
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
