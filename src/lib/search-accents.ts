// Búsquedas sin distinguir mayúsculas ni tildes en PostgreSQL sin la extensión unaccent: se comparan los dos lados en
// minúsculas y con translate() de las letras acentuadas a su base (como la búsqueda de releases). Funciones puras.

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
