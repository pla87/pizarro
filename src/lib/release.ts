// Generador de release notes. Función pura: se usa en el navegador (instantáneo)
// y en los tests.
import type { TaskTypeValue } from "./constants";

export interface ReleaseTaskInput {
  title: string;
  type: TaskTypeValue;
  linkUrl?: string | null;
}

export interface ReleaseInput {
  header: string;
  footer: string;
  title: string;
  tasks: ReleaseTaskInput[];
}

export const RELEASE_SECTIONS: { heading: string; types: TaskTypeValue[] }[] = [
  { heading: "### Features", types: ["FEATURE"] },
  { heading: "### Fixes", types: ["HOTFIX", "FIX"] },
  { heading: "### Chores / Infra", types: ["CHORE", "REFACTOR"] },
];

/** Escapa los caracteres que romperían el texto de un enlace Markdown. */
function escapeLinkText(text: string): string {
  return text.replace(/([\[\]\\])/g, "\\$1");
}

export function formatReleaseLine(task: ReleaseTaskInput): string {
  const title = task.title.replace(/\s+/g, " ").trim();
  const prefix = task.type === "HOTFIX" ? "**[HOTFIX]** " : task.type === "REFACTOR" ? "*(refactor)* " : "";
  const link = task.linkUrl ? ` ([enlace](<${task.linkUrl.replace(/[<>]/g, "")}>))` : "";
  return `- ${prefix}${escapeLinkText(title)}${link}`;
}

export function buildReleaseMarkdown(input: ReleaseInput): string {
  const parts: string[] = [];
  const header = input.header.trim();
  const footer = input.footer.trim();

  if (header) parts.push(header);
  parts.push(`## ${input.title.trim()}`);

  for (const section of RELEASE_SECTIONS) {
    // Dentro de cada sección se respeta el orden recibido, con los tipos en el orden de la sección.
    const items = section.types.flatMap((type) => input.tasks.filter((t) => t.type === type));
    if (items.length === 0) continue;
    parts.push([section.heading, ...items.map(formatReleaseLine)].join("\n"));
  }

  if (input.tasks.length === 0) parts.push("_Sin tareas seleccionadas._");
  if (footer) parts.push(footer);
  return parts.join("\n\n") + "\n";
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
