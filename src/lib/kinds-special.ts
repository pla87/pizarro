/** Automatización por tipo de tarea: al elegir el tipo se fija el título y/o se antepone un texto a la descripción. */

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
export function describeKindAutomation(kind: KindAutomation): string | null {
  const title = kind.titleTemplate.trim();
  const desc = kind.descriptionTemplate.trim();
  if (title && desc) return `Al elegirlo, el título pasa a ser «${short(title)}» y la descripción empieza por «${short(desc)}».`;
  if (title) return `Al elegirlo, el título pasa a ser «${short(title)}».`;
  if (desc) return `Al elegirlo, la descripción empieza por «${short(desc)}».`;
  return null;
}

// --- Compatibilidad (obsoleto): lo usan TaskDialog y NewTaskDialog hasta migrar a applyKindTemplate. ---

/** @deprecated Usa la plantilla del tipo (descriptionTemplate). */
export const RESPUESTA_LINE = "Respondo a las preguntas y lo que necesitas de mi:";

/** Minúsculas, sin acentos y sin espacios, para comparar nombres de tipo. */
function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").toLowerCase();
}

/** @deprecated Usa la propiedad `system` del tipo. */
export function isRespuestaKind(kindName: string): boolean {
  return normalizeName(kindName) === "respuesta";
}

/** @deprecated Usa applyKindTemplate. */
export function applyKindPreset(
  kindName: string,
  current: { title: string; description: string },
): { title: string; description: string } | null {
  if (!isRespuestaKind(kindName)) return null;
  return applyKindTemplate({ titleTemplate: "Respuesta", descriptionTemplate: RESPUESTA_LINE }, current);
}
