/** Automatización por tipo de tarea: al elegir el tipo se fija el título y/o se antepone un texto a la descripción. */
import { makeT, type T } from "@/i18n/core";

interface KindAutomation {
  titleTemplate: string;
  descriptionTemplate: string;
}

/**
 * Título y descripción resultantes de aplicar la automatización del tipo
 * (título fijo y texto inicial en la descripción, sin duplicarlo); null si el tipo no tiene.
 */
export function applyKindTemplate(
  kind: KindAutomation,
  current: { title: string; description: string },
): { title: string; description: string } | null {
  const titleTpl = kind.titleTemplate.trim();
  const descTpl = kind.descriptionTemplate.trim();
  if (!titleTpl && !descTpl) return null;
  let description = current.description;
  if (descTpl && !description.trimStart().startsWith(descTpl)) {
    description = description.trim() ? `${descTpl}\n${description}` : `${descTpl}\n`;
  }
  return { title: titleTpl || current.title, description };
}

/** Máximo de subtareas por plantilla de tipo y por tarea nueva (el de createTask). */
export const MAX_KIND_SUBTASKS = 50;
const MAX_SUBTASK_LEN = 200;

const sameSubtask = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Texto de un cuadro de varias líneas → subtareas: recorta, descarta vacías y repetidas, respeta el máximo. */
export function parseSubtaskLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const title = line.trim().slice(0, MAX_SUBTASK_LEN);
    if (title && !out.some((x) => sameSubtask(x, title))) out.push(title);
    if (out.length >= MAX_KIND_SUBTASKS) break;
  }
  return out;
}

/** Añade al final las subtareas de la plantilla que aún no estén (sin distinguir mayúsculas), hasta el máximo. */
export function mergeSubtasks(current: string[], template: string[]): string[] {
  const out = [...current];
  for (const raw of template) {
    const title = raw.trim().slice(0, MAX_SUBTASK_LEN);
    if (title && out.length < MAX_KIND_SUBTASKS && !out.some((x) => sameSubtask(x, title))) out.push(title);
  }
  return out;
}

function short(text: string, max = 60): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** Una línea breve en español que explica la automatización del tipo; null si no tiene. */
export function describeKindAutomation(kind: KindAutomation, t: T = makeT("es")): string | null {
  const title = kind.titleTemplate.trim();
  const desc = kind.descriptionTemplate.trim();
  if (title && desc) return t("Al elegirlo, el título pasa a ser «{title}» y la descripción empieza por «{desc}».", { title: short(title), desc: short(desc) });
  if (title) return t("Al elegirlo, el título pasa a ser «{title}».", { title: short(title) });
  if (desc) return t("Al elegirlo, la descripción empieza por «{desc}».", { desc: short(desc) });
  return null;
}
