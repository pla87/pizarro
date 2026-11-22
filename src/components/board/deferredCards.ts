// Tableros con cientos o miles de tarjetas: el servidor (y la hidratación) pintan solo las primeras FIRST_PAINT_CARDS de
// cada columna; el resto se pinta en el navegador justo después, por tandas y en transiciones (no bloquea), sin salto:
// mientras tanto un hueco ocupa lo mismo que ocuparían (cardsReserve). Antes, 1.000 tarjetas eran unos 5 MB de HTML y más
// de un segundo de hidratación en un móvil. La búsqueda, los filtros, el recuento, la selección y el teclado trabajan con
// las listas de ids, no con lo pintado. Reglas puras (tests/deferred-cards.test.ts); el gancho, en useCardLimit.ts (lo usan
// las columnas y la vista Lista).

/** Tarjetas de cada columna que se pintan en el servidor: más que las que caben a la vista en cualquier pantalla. */
export const FIRST_PAINT_CARDS = 50;
/** Tarjetas que se añaden en cada tanda después de hidratar. */
const CARD_BATCH = 200;

/** Siguiente tope de tarjetas pintadas: una tanda más, o todas (Infinity) cuando ya caben. */
export function nextCardLimit(limit: number, count: number): number {
  return count <= limit + CARD_BATCH ? Infinity : limit + CARD_BATCH;
}

/**
 * Alto del hueco de `hidden` tarjetas aún sin pintar: el mismo que ocuparían fuera de la vista (las que no están entre
 * las primeras de su columna llevan `content-visibility: auto` con 5 rem de alto, TaskCard.tsx) más los huecos de 0,5 rem
 * entre ellas (`gap-2` de la lista). Así, al pintarlas, nada se mueve.
 */
export function cardsReserve(hidden: number): string | null {
  if (hidden <= 0) return null;
  return `calc(${hidden} * 5rem + ${hidden - 1} * 0.5rem)`;
}

/**
 * Vista Lista (`?vista=lista`): no hay columnas, así que el tope es para toda la lista. Con 100 filas ya pasa de lo que cabe
 * en cualquier pantalla; el resto llega por las mismas tandas que las tarjetas (`nextCardLimit`).
 */
export const FIRST_PAINT_ROWS = 100;

/**
 * Alto del hueco de `hidden` filas de la vista Lista aún sin pintar: lo que mide una fila de una línea, raya de
 * separación incluida (33 px en la tabla de escritorio y 60,25 px en la lista compacta del móvil, medidos en Chromium). Una fila más alta (título
 * en dos líneas, etiquetas) solo cambia la barra de scroll al llegar: las filas pintadas no se mueven.
 */
export function rowsReserve(hidden: number, compact: boolean): string | null {
  if (hidden <= 0) return null;
  return `calc(${hidden} * ${compact ? "3.765625rem" : "2.0625rem"})`;
}
