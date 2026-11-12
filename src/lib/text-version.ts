// Contra qué texto se guarda un cambio del título o de la descripción (para no pisar lo que otra persona, u otra pestaña,
// haya guardado entretanto). Sin zod ni nada del servidor: lo usan el detalle de la tarea y la acción que guarda.
//
// La tarea solo tiene una versión para los dos campos (`contentUpdatedAt`, `textVersion`): con ella no se sabe QUÉ campo
// cambió. Por eso el detalle envía, junto a la versión, la huella del título y de la descripción sobre los que se escribió,
// y solo hay conflicto si cambió el mismo campo que se guarda. Antes guardar solo el título se rechazaba porque otra
// persona había cambiado la descripción, y el título escrito se perdía.

/** Versión del texto sobre la que se editó y huellas (`textHash`) del título y la descripción de esa versión. */
export interface TextSince {
  version: string | null;
  title?: string;
  description?: string;
}

/** Huella corta de un texto (53 bits, cyrb53): solo para comparar, no es criptográfica. */
export function textHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Campos del guardado (`patch`) que chocan con lo que hay ahora. `since` es la versión sobre la que se editó:
 * - una cadena (o null): solo la versión, sin saber sobre qué texto. Cualquier cambio del texto posterior choca, en los
 *   dos campos (borradores recuperados, «Cancelar», versiones anteriores del cliente).
 * - con huellas: choca cada campo que se guarda y que ya no es el que se editó. La versión no cuenta aquí: la que
 *   devuelve un guardado propio puede incluir el cambio ajeno del otro campo, que este cliente no ha visto.
 */
export function textConflicts(
  now: { contentUpdatedAt: Date | null; title?: string; description?: string },
  since: string | null | TextSince,
  patch: { title?: unknown; description?: unknown } = {},
): ("title" | "description")[] {
  const fields = (["title", "description"] as const).filter((f) => patch[f] !== undefined);
  if (since !== null && typeof since === "object") {
    return fields.filter((f) => {
      const value = now[f];
      const seen = since[f];
      return value === undefined || seen === undefined || textHash(value) !== seen;
    });
  }
  const base = since ? new Date(since).getTime() : 0;
  if (!now.contentUpdatedAt || now.contentUpdatedAt.getTime() <= base) return [];
  return fields;
}
