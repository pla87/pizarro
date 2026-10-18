// Generador de release notes. Función pura: se usa en el navegador (instantáneo)
// y en los tests.

export interface ReleaseKind {
  id: string;
  name: string;
}

export interface ReleaseTaskInput {
  title: string;
  kindId: string;
  linkUrl?: string | null;
}

export interface ReleaseInput {
  header: string;
  footer: string;
  title: string;
  /** Tipos en el orden en que deben aparecer las secciones. */
  kinds: ReleaseKind[];
  tasks: ReleaseTaskInput[];
}

/** Escapa los caracteres que romperían el texto de un enlace Markdown. */
function escapeLinkText(text: string): string {
  return text.replace(/([\[\]\\])/g, "\\$1");
}

export function formatReleaseLine(task: Pick<ReleaseTaskInput, "title" | "linkUrl">): string {
  const title = task.title.replace(/\s+/g, " ").trim();
  const link = task.linkUrl ? ` ([enlace](<${task.linkUrl.replace(/[<>]/g, "")}>))` : "";
  return `- ${escapeLinkText(title)}${link}`;
}

/** Cuerpo de la release (título + una sección por tipo), sin cabecera ni pie. */
export function buildReleaseBody(input: Omit<ReleaseInput, "header" | "footer">): string {
  const parts = [`## ${input.title.trim()}`];
  const known = new Set(input.kinds.map((k) => k.id));
  for (const kind of input.kinds) {
    const items = input.tasks.filter((t) => t.kindId === kind.id);
    if (items.length) parts.push([`### ${kind.name}`, ...items.map(formatReleaseLine)].join("\n"));
  }
  const others = input.tasks.filter((t) => !known.has(t.kindId));
  if (others.length) parts.push(["### Otros", ...others.map(formatReleaseLine)].join("\n"));
  if (input.tasks.length === 0) parts.push("_Sin tareas seleccionadas._");
  return parts.join("\n\n");
}

export function buildReleaseMarkdown(input: ReleaseInput): string {
  const header = input.header.trim();
  const footer = input.footer.trim();
  return [header, buildReleaseBody(input), footer].filter(Boolean).join("\n\n") + "\n";
}

/**
 * Cambia la cabecera (o el pie) de un texto ya editado: si el bloque anterior sigue
 * intacto se sustituye; si no, el nuevo se añade al principio (o al final).
 */
export function swapTemplateBlock(text: string, previous: string, next: string, where: "start" | "end"): string {
  const prev = previous.trim();
  const nxt = next.trim();
  if (prev) {
    const idx = where === "start" ? text.indexOf(prev) : text.lastIndexOf(prev);
    if (idx >= 0) {
      const before = text.slice(0, idx);
      const after = text.slice(idx + prev.length);
      if (!nxt) {
        // Quitar también la línea en blanco que lo separaba del resto.
        if (where === "start") return before + after.replace(/^\s*\n/, "");
        return before.replace(/\s+$/, "") + after.replace(/^\s+/, "\n");
      }
      return before + nxt + after;
    }
  }
  if (!nxt) return text;
  return where === "start" ? `${nxt}\n\n${text.replace(/^\s+/, "")}` : `${text.replace(/\s+$/, "")}\n\n${nxt}\n`;
}

/** Fecha local en formato YYYY-MM-DD. */
export function isoDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function releaseFileName(date: Date, ext: "md" | "txt"): string {
  return `release-${isoDate(date)}.${ext}`;
}
