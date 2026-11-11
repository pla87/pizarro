// Menciones: se guardan en el texto como @[Nombre](user:ID).
import { decodeEntities } from "./markdown-entities";

const MENTION_RE = /@\[([^\]\n]{1,80})\]\(user:([a-z0-9]{1,40})\)/gi;

/** Expresión nueva (con el estado a cero) que reconoce una mención; grupo 1 = nombre, grupo 2 = id. */
export function mentionRegex(): RegExp {
  return new RegExp(MENTION_RE.source, MENTION_RE.flags);
}

export function mentionToken(name: string, userId: string): string {
  return `@[${name.replace(/[\[\]\n]/g, "")}](user:${userId})`;
}

export function extractMentionIds(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_RE)].map((m) => m[2]!))];
}

/** Texto legible para emails, WhatsApp y extractos: @[Ana](user:x) → @Ana. */
export function mentionsToPlain(text: string, withAt = true): string {
  return text.replace(MENTION_RE, withAt ? "@$1" : "$1");
}

/** Para renderizar con Markdown: la mención pasa a ser un enlace interno #mention-ID. */
export function mentionsToMarkdown(text: string): string {
  return text.replace(MENTION_RE, (_m, name: string, id: string) => `[@${name}](#mention-${id})`);
}

/**
 * Extracto de un texto para avisos y emails, en texto plano: las entidades que guarda el editor (`&lt;`, `&amp;`,
 * `&nbsp;`…) pasan a su carácter, porque el extracto se muestra (y se escapa) como texto, no como HTML.
 */
export function excerpt(text: string, max = 180): string {
  const plain = decodeEntities(mentionsToPlain(text)).replace(/\s+/g, " ").trim();
  return plain.length > max ? plain.slice(0, max - 1) + "…" : plain;
}

/** Trozos de un texto con menciones: texto suelto o {name, id}. Sirve para pintar las menciones como etiquetas. */
export function splitMentions(text: string): (string | { name: string; id: string })[] {
  const out: (string | { name: string; id: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ name: m[1]!, id: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
