// Solo tipos de dnd-kit: así el módulo se prueba en Node sin cargar React.
import type { CollisionDetection } from "@dnd-kit/core";

/** Prefijo del id de los droppables de columna (el resto de droppables son tarjetas). */
export const COLUMN_DROPPABLE_PREFIX = "col:";

/**
 * Detección de colisiones del tablero. Solo cuentan los droppables visibles (en móvil las columnas
 * ocultas miden 0×0). Si hay puntero, manda lo que tiene debajo: una tarjeta si está sobre una, y si no,
 * la columna (así una columna vacía, corta, recibe la tarjeta aunque otra vecina tenga las esquinas más
 * cerca). Sin puntero (teclado) o fuera de toda columna, se cae a las esquinas más cercanas.
 */
export const createBoardCollisionDetection = (algos: {
  closestCorners: CollisionDetection;
  pointerWithin: CollisionDetection;
}): CollisionDetection => (args) => {
  const { closestCorners, pointerWithin } = algos;
  const visible = {
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => (args.droppableRects.get(c.id)?.width ?? 0) > 0),
  };
  if (args.pointerCoordinates) {
    const hits = pointerWithin(visible);
    const cards = hits.filter((h) => !String(h.id).startsWith(COLUMN_DROPPABLE_PREFIX));
    if (cards.length) return cards;
    if (hits.length) return hits;
  }
  return closestCorners(visible);
};
