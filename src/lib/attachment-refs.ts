// Enlaces a adjuntos dentro de un texto Markdown (`![captura](/api/attachments/<id>)` en una descripción). Puro, sin
// base de datos: lo usan Duplicar (la copia apunta a sus propios adjuntos, no a los de la original) y la importación
// de proyectos (los adjuntos importados tienen ids nuevos).

const ATTACHMENT_REF = /\/api\/attachments\/([A-Za-z0-9_-]+)/g;

/**
 * Cambia en `text` cada `/api/attachments/<id>` cuyo id está en `map` por el id nuevo (con lo que lleve detrás:
 * `?thumb=1`, el cierre del enlace…). Los ids que no están en el mapa (adjuntos de otra tarea) se dejan como están.
 */
export function remapAttachmentRefs(text: string, map: ReadonlyMap<string, string>): string {
  if (!map.size || !text.includes("/api/attachments/")) return text;
  return text.replace(ATTACHMENT_REF, (whole, id: string) => {
    const next = map.get(id);
    return next ? `/api/attachments/${next}` : whole;
  });
}
