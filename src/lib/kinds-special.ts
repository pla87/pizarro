/** Automatización por tipo de tarea: al elegir el tipo se fija el título y/o se antepone un texto a la descripción. */
import { makeT, type T } from "@/i18n/core";

export interface KindAutomation {
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

// --- Compatibilidad (obsoleto): lo usan TaskDialog y NewTaskDialog hasta migrar a applyKindTemplate. ---

/** @deprecated Usa la plantilla del tipo (descriptionTemplate). */
