// Lista consolidada: reúne las subtareas de todas las tarjetas de una columna en una sola lista.
// Funciones puras (sin BD) para poder testearlas.
import type { T } from "../i18n/core";

export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
  taskId: string;
  taskTitle: string;
  kindId: string;
  kindName: string;
}

export type ChecklistGroupBy = "card" | "kind";

export interface ChecklistGroup {
  key: string;
  label: string;
  items: ChecklistItem[];
}

/**
 * Agrupa por tarjeta (en el orden recibido, que es el de la columna) o por tipo de tarea (orden alfabético,
 * los elementos conservan el orden de la columna).
 */
export function groupChecklist(items: ChecklistItem[], by: ChecklistGroupBy, locale = "es"): ChecklistGroup[] {
  const groups = new Map<string, ChecklistGroup>();
  for (const item of items) {
    const key = by === "card" ? item.taskId : item.kindId;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label: by === "card" ? item.taskTitle : item.kindName, items: [] }));
    g.items.push(item);
  }
  const list = [...groups.values()];
  return by === "kind" ? list.sort((a, b) => a.label.localeCompare(b.label, locale)) : list;
}

/** Lista en Markdown (`- [ ] …`) con un encabezado por grupo; agrupada por tipo, cada línea indica su tarjeta. */
export function checklistMarkdown(groups: ChecklistGroup[], by: ChecklistGroupBy, title?: string): string {
  const out: string[] = [];
  if (title) out.push(`# ${title}`, "");
  groups.forEach((g, i) => {
    if (i > 0) out.push("");
    out.push(`## ${g.label}`);
    for (const it of g.items) out.push(`- [${it.done ? "x" : " "}] ${it.title}${by === "kind" ? ` (${it.taskTitle})` : ""}`);
  });
  return out.join("\n") + "\n";
}

/** «Faltan 2 subtareas: A, B» (con «y N más» si hay muchas). */
export function missingSubtasksText(titles: string[], t: T, max = 5): string {
  const shown = titles.slice(0, max).join(", ");
  const more = titles.length > max ? t(" y {n} más", { n: titles.length - max }) : "";
  const head = titles.length === 1 ? t("Falta 1 subtarea") : t("Faltan {n} subtareas", { n: titles.length });
  return `${head}: ${shown}${more}`;
}
