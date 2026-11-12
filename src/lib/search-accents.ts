// Búsquedas sin distinguir mayúsculas ni tildes, en el navegador (normalizeSearch) y en PostgreSQL sin la extensión
// unaccent (foldAccents/foldedContains: se comparan los dos lados en minúsculas y con translate() de las letras
// acentuadas a su base, como la búsqueda de releases). Funciones puras, sin dependencias: valen en el cliente.

/**
 * Minúsculas y sin marcas diacríticas («Canción» → «cancion»), para filtrar en el navegador: se aplica igual al texto y
 * a lo buscado. Quita cualquier marca combinante tras NFD, no solo las tildes del español.
 */
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Trozo apto para nombres de fichero y anclas: sin tildes, minúsculas, cada tramo de caracteres que no sean letras
 * a-z o cifras pasa a un «-» y sin guiones al principio ni al final («Canción nº 2» → «cancion-n-2»). Puede quedar
 * vacío: cada sitio pone su valor por defecto. Lo usan los nombres de los PDF, del .ics y del .pizarro.zip y los
 * identificadores de los encabezados de la web (site-markdown.ts, que Node carga sin empaquetador).
 */
export function slugify(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Letras acentuadas (también en mayúscula, por si lower() no las baja) y su letra base, posición a posición. */
export const ACCENTED = "áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ";
export const UNACCENTED = "aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc";

/** El texto en minúsculas y sin tildes, como queda la columna con translate(lower(…), ACCENTED, UNACCENTED). */
export function foldAccents(text: string): string {
  return text.toLowerCase().replace(/[áàäâãéèëêíìïîóòöôõúùüûñç]/g, (c) => UNACCENTED[ACCENTED.indexOf(c)]!);
}

/** Patrón de LIKE «contiene» para comparar con translate(lower(columna), ACCENTED, UNACCENTED). */
export function foldedContains(query: string): string {
  return `%${foldAccents(query).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
