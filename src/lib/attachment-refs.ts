// Enlaces a adjuntos dentro de un texto Markdown (`![captura](/api/attachments/<id>)` en una descripción, o
// `/api/documents/<id>` en una nota de Documentación). Puro, sin
// base de datos: lo usan Duplicar (la copia apunta a sus propios adjuntos, no a los de la original) y la importación
// de proyectos (los adjuntos importados tienen ids nuevos) y la siguiente aparición de una tarea repetida.

const ATTACHMENT_REF = /\/api\/attachments\/([A-Za-z0-9_-]+)/g;

const DOCUMENT_REF = /\/api\/documents\/([A-Za-z0-9]+)/g;

/**
 * ¿Es la dirección de una imagen de adjunto de la app (`/api/attachments/<id>`, sola o con `?thumb=1`)? Sin «..»,
 * «%2e» ni más segmentos: la ruta queda fija. Comprobar solo el prefijo dejaba pasar `/api/attachments/../auth/reset`,
 * que el navegador normaliza y pide desde el mismo origen al pintar la imagen. Ninguna otra consulta: con
 * `?download=1` cada apertura de la tarea pedía una «descarga» (la ruta además no registra las peticiones de imagen).
 * También una imagen de la Documentación del proyecto (`/api/documents/<id>`, sin consulta): las que se pegan en una nota.
 */
export function isAttachmentSrc(src: unknown): src is string {
  return typeof src === "string" && (/^\/api\/attachments\/[A-Za-z0-9_-]{1,40}(?:\?thumb=1)?$/.test(src) || /^\/api\/documents\/[A-Za-z0-9]{1,40}$/.test(src));
}

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

/** Ids de los adjuntos que cita `text` (`/api/attachments/<id>`), sin repetir y en orden de aparición. */
export function attachmentRefIds(text: string): string[] {
  if (!text.includes("/api/attachments/")) return [];
  return [...new Set(Array.from(text.matchAll(ATTACHMENT_REF), (m) => m[1]!))];
}

/**
 * Como remapAttachmentRefs, con los documentos de la Documentación (`/api/documents/<id>`): las imágenes pegadas en una
 * nota. Lo usa exportar e importar un proyecto (los documentos importados tienen ids nuevos).
 */
export function remapDocumentRefs(text: string, map: ReadonlyMap<string, string>): string {
  if (!map.size || !text.includes("/api/documents/")) return text;
  return text.replace(DOCUMENT_REF, (whole, id: string) => {
    const next = map.get(id);
    return next ? `/api/documents/${next}` : whole;
  });
}
