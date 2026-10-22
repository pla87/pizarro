// Menciones: se guardan en el texto como @[Nombre](user:ID).

const MENTION_RE = /@\[([^\]\n]{1,80})\]\(user:([a-z0-9]{1,40})\)/gi;

export function mentionToken(name: string, userId: string): string {
  return `@[${name.replace(/[\[\]\n]/g, "")}](user:${userId})`;
}

export function extractMentionIds(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_RE)].map((m) => m[2]!))];
}

/** Texto legible para emails, WhatsApp y extractos: @[Ana](user:x) → @Ana. */
export function mentionsToPlain(text: string): string {
  return text.replace(MENTION_RE, "@$1");
}

/** Para renderizar con Markdown: la mención pasa a ser un enlace interno #mention-ID. */
export function mentionsToMarkdown(text: string): string {
  return text.replace(MENTION_RE, (_m, name: string, id: string) => `[@${name}](#mention-${id})`);
}

export function excerpt(text: string, max = 180): string {
  const plain = mentionsToPlain(text).replace(/\s+/g, " ").trim();
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
