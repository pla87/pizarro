/** Tipos de tarea con comportamiento especial al seleccionarlos. */

export const RESPUESTA_LINE = "Respondo a las preguntas y lo que necesitas de mi:";

/** Minúsculas, sin acentos y sin espacios, para comparar nombres de tipo. */
function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").toLowerCase();
}

export function isRespuestaKind(kindName: string): boolean {
  return normalizeName(kindName) === "respuesta";
}

/**
 * Si el tipo es «Respuesta», devuelve el título y la descripción resultantes
 * (título fijo y línea inicial en la descripción, sin duplicarla); si no, null.
 */
export function applyKindPreset(
  kindName: string,
  current: { title: string; description: string },
): { title: string; description: string } | null {
  if (!isRespuestaKind(kindName)) return null;
  const desc = current.description;
  const description = desc.trimStart().startsWith(RESPUESTA_LINE)
    ? desc
    : desc.trim() ? `${RESPUESTA_LINE}\n${desc}` : `${RESPUESTA_LINE}\n`;
  return { title: "Respuesta", description };
}
