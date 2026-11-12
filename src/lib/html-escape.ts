// Escapado de texto para meterlo en HTML (contenido o valor de atributo entre comillas dobles o simples). Sin
// dependencias ni alias «@/»: lo importan también los .ts que Node carga tal cual (site-markdown.ts en build-site.mjs).

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** & < > " y ' como entidades: vale dentro de etiquetas y de atributos con cualquiera de las dos comillas. */
export const escapeHtml = (s: string): string => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c]!);
