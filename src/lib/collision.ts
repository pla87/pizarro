// Solo tipos de dnd-kit: así el módulo se prueba en Node sin cargar React.
import type { CollisionDetection } from "@dnd-kit/core";

/** Prefijo del id de los droppables de columna (el resto de droppables son tarjetas). */
const COLUMN_DROPPABLE_PREFIX = "col:";
/** Prefijo del id de la cabecera de una columna que se arrastra para cambiarla de sitio (no es un droppable). */
export const COLUMN_DRAG_PREFIX = "colmove:";

/** Lista ordenable (SortableContext) a la que pertenece una tarjeta; el tablero le da el id de su columna («col:…»). */
function containerOf(container: { data: { current?: unknown } }): string | null {
  const id = (container.data.current as { sortable?: { containerId?: unknown } } | undefined)?.sortable?.containerId;
  return id == null ? null : String(id);
}

type RectMap = Parameters<CollisionDetection>[0]["droppableRects"];
type Rect = NonNullable<ReturnType<RectMap["get"]>>;
type Id = Parameters<RectMap["get"]>[0];

/**
 * Las medidas de dnd-kit recalculan su posición con el scroll de sus contenedores en CADA lectura de top, left, bottom o
 * right (leen scrollTop/scrollLeft del DOM, y si hay cambios pendientes el navegador recoloca la página para
 * responder). Durante una detección el scroll no cambia: cada medida se lee una vez (top y left; el resto sale del ancho y
 * el alto) y se reutiliza, también entre los algoritmos (columnas, tarjetas, la más cercana y las esquinas).
 */
class RectSnapshot extends Map<Id, Rect> {
  readonly #source: RectMap;
  constructor(source: RectMap) {
    super();
    this.#source = source;
  }
  override get(id: Id): Rect | undefined {
    let r = super.get(id);
    if (!r) {
      const live = this.#source.get(id);
      if (!live) return undefined;
      const { width, height, top, left } = live;
      r = { width, height, top, left, bottom: top + height, right: left + width };
      super.set(id, r);
    }
    return r;
  }
  override has(id: Id): boolean {
    return this.#source.has(id);
  }
}

/**
 * Detección de colisiones del tablero. Solo cuentan los droppables visibles (en móvil las columnas
 * ocultas miden 0×0). Si hay puntero, manda lo que tiene debajo: una tarjeta si está sobre una, y si no,
 * la columna (así una columna vacía, corta, recibe la tarjeta aunque otra vecina tenga las esquinas más
 * cerca). Sin puntero (teclado) o fuera de toda columna, se cae a las esquinas más cercanas.
 *
 * Rapidez (tableros de cientos de tarjetas): se mira primero qué columna hay bajo el puntero y después solo las tarjetas
 * de esa columna. Cada lectura de la posición de un droppable consulta el scroll de sus contenedores, y repasar todas
 * las tarjetas en cada movimiento del ratón hacía que el arrastre fuera a tirones.
 */
/**
 * Arrastre de una columna (su cabecera): solo cuentan las columnas, y por la horizontal, la que tiene el puntero encima o,
 * entre dos (en el hueco) o fuera del tablero, la de centro más cercano. Sin puntero (no se arrastra con el teclado), la
 * de centro más cercano a la columna arrastrada.
 */
export const columnDragCollision: CollisionDetection = ({ droppableContainers, droppableRects, pointerCoordinates, collisionRect }) => {
  const x = pointerCoordinates?.x ?? collisionRect.left + collisionRect.width / 2;
  let best: (typeof droppableContainers)[number] | null = null;
  let bestD = Infinity;
  for (const c of droppableContainers) {
    if (!String(c.id).startsWith(COLUMN_DROPPABLE_PREFIX)) continue;
    const r = droppableRects.get(c.id);
    if (!r || r.width <= 0) continue;
    const d = x >= r.left && x <= r.left + r.width ? 0 : Math.abs(x - (r.left + r.width / 2));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best ? [{ id: best.id, data: { droppableContainer: best, value: bestD } }] : [];
};

export const createBoardCollisionDetection = (algos: {
  closestCorners: CollisionDetection;
  pointerWithin: CollisionDetection;
}): CollisionDetection => (input) => {
  const { closestCorners, pointerWithin } = algos;
  const args = { ...input, droppableRects: new RectSnapshot(input.droppableRects) };
  // El ancho no depende del scroll: se lee de la medida original, sin fijar la posición de todas.
  const visibleContainers = args.droppableContainers.filter((c) => (input.droppableRects.get(c.id)?.width ?? 0) > 0);
  const visible = { ...args, droppableContainers: visibleContainers };
  if (args.pointerCoordinates) {
    const columns = visibleContainers.filter((c) => String(c.id).startsWith(COLUMN_DROPPABLE_PREFIX));
    const columnHits = pointerWithin({ ...args, droppableContainers: columns });
    const column = columnHits[0] ? String(columnHits[0].id) : null;
    // Tarjetas de la columna bajo el puntero (las que no dicen su lista, por si acaso, también). Fuera de toda columna, todas.
    const cards = visibleContainers.filter((c) => {
      if (String(c.id).startsWith(COLUMN_DROPPABLE_PREFIX)) return false;
      if (!column) return true;
      const owner = containerOf(c);
      return owner === null || owner === column;
    });
    const cardHits = pointerWithin({ ...args, droppableContainers: cards });
    if (cardHits.length) return cardHits;
    // En el hueco entre dos tarjetas de la columna, la más cercana: si no, al cruzar cada hueco el destino saltaba a la
    // columna y volvía a la tarjeta siguiente, y todas las tarjetas de la columna se recolocaban dos veces (tirones).
    // Por encima de la primera o por debajo de la última sigue mandando la columna (la tarjeta va al final).
    const pointer = args.pointerCoordinates;
    if (column) {
      let nearest: (typeof cards)[number] | null = null;
      let best = Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      for (const card of cards) {
        if (containerOf(card) !== column) continue;
        const r = args.droppableRects.get(card.id);
        if (!r) continue;
        const cardTop = r.top;
        const cardBottom = r.bottom;
        top = Math.min(top, cardTop);
        bottom = Math.max(bottom, cardBottom);
        const d = pointer.y < cardTop ? cardTop - pointer.y : pointer.y > cardBottom ? pointer.y - cardBottom : 0;
        if (d < best) {
          best = d;
          nearest = card;
        }
      }
      if (nearest && pointer.y > top && pointer.y < bottom) return [{ id: nearest.id, data: { droppableContainer: nearest, value: best } }];
    }
    if (columnHits.length) return columnHits;
  }
  return closestCorners(visible);
};
