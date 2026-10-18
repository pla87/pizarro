// Menciones: se guardan en el texto como @[Nombre](user:ID).

export const MENTION_RE = /@\[([^\]\n]{1,80})\]\(user:([a-z0-9]{1,40})\)/gi;

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
