/**
 * Ids de fila (cuid, `newFileId`, los de importación y los de las pruebas): letras, cifras, `_` y `-`. Un id con otros
 * caracteres (el nulo, por ejemplo) no existe: se rechaza como «no encontrado» en vez de llegar a PostgreSQL, que con
 * algunos de ellos falla (22021) y acababa en «Error inesperado» con una entrada de error en los logs.
 * Sin zod: también lo usa el navegador (`calendar.ts`).
 */
export const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Si `s` tiene forma de id de fila: para descartar los ids mal formados de una URL antes de consultar. */
export const isRowId = (s: string) => ID_RE.test(s);
