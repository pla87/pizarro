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
}

/** Escapa un valor TEXT: barra, punto y coma, coma y saltos de línea. */
export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
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

/** Markdown de la descripción de una tarea a texto plano legible. */
export function markdownToPlain(md: string): string {
  return mentionsToPlain(md)
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, text: string, href: string) => (text === href ? text : `${text} (${href})`))
    .replace(/<[^>\n]+>/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    // Énfasis solo en límite de palabra: no toca guiones bajos de URL ni de snake_case, ni 2*3*4.
    .replace(/(?<![\p{L}\p{N}_*])(\*\*|__)(?=\S)(.+?)(?<=\S)\1(?![\p{L}\p{N}_*])/gu, "$2")
    .replace(/(?<![\p{L}\p{N}_*])([*_])(?=[^\s*_])(.+?)(?<=[^\s*_])\1(?![\p{L}\p{N}_*])/gu, "$2")
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
export function buildIcs(opts: { name: string; events: IcsEvent[]; now?: Date; prodId?: string }): string {
  const stamp = stampOf(opts.now ?? new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${opts.prodId ?? "-//Pizarro//Agenda//ES"}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeIcsText(opts.name)}`];
  for (const e of opts.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(e.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      // En eventos de día completo DTEND es exclusivo: el día siguiente al último.
      `DTEND;VALUE=DATE:${compact(addDaysIso(e.endDate && e.endDate > e.date ? e.endDate : e.date, 1))}`,
      `SUMMARY:${escapeIcsText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url.replace(/[\r\n]/g, "")}`);
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
