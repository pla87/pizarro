// Tableros con cientos o miles de tarjetas: el servidor (y la hidratación) pintan solo las primeras FIRST_PAINT_CARDS de
// cada columna; el resto se pinta en el navegador justo después, por tandas y en transiciones (no bloquea), sin salto:
// mientras tanto un hueco ocupa lo mismo que ocuparían (cardsReserve). Antes, 1.000 tarjetas eran unos 5 MB de HTML y más
// de un segundo de hidratación en un móvil. La búsqueda, los filtros, el recuento, la selección y el teclado trabajan con
// las listas de ids, no con lo pintado. Reglas puras (tests/deferred-cards.test.ts); el gancho está en ColumnView.tsx.

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
