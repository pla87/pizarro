// Arrastrar (o mover con Alt+flechas) una tarjeta que forma parte de una selección múltiple mueve toda la selección:
// reglas puras, sin React ni dnd-kit (se prueban en tests/group-drag.test.ts). El tablero las usa en Board.tsx y
// cardActions.ts; el servidor coloca el bloque con moveTasks(ids, columna, { prevId, nextId }).

/** Ids por columna (listas COMPLETAS, sin filtrar), como `baseItems` del tablero. */
type ColumnItems = Readonly<Record<string, readonly string[]>>;

/**
 * Grupo que se mueve al coger `activeId`: las tarjetas seleccionadas en orden de tablero (columna a columna, de izquierda
 * a derecha, y dentro de cada una de arriba abajo) si la tarjeta cogida es una de ellas y hay al menos dos. Si no, `null`
 * (se mueve solo esa). Solo cuentan las de las listas de las columnas (no las fijas del panel de la release).
 */
export function selectionGroup(selected: ReadonlySet<string>, activeId: string, columnOrder: readonly string[], items: ColumnItems): string[] | null {
  if (selected.size < 2 || !selected.has(activeId)) return null;
  const group = columnOrder.flatMap((c) => (items[c] ?? []).filter((id) => selected.has(id)));
  return group.length >= 2 && group.includes(activeId) ? group : null;
}

/** Dónde queda el bloque: la lista completa de la columna destino y sus vecinas (las que se envían al servidor). */
export interface BlockPlacement {
  list: string[];
  prevId: string | null;
  nextId: string | null;
}

function blockAt(rest: readonly string[], k: number, group: readonly string[]): BlockPlacement {
  return { list: [...rest.slice(0, k), ...group, ...rest.slice(k)], prevId: rest[k - 1] ?? null, nextId: rest[k] ?? null };
}

/**
 * Soltar el grupo: `list` es la columna destino tal como ha quedado el arrastre (la tarjeta cogida ya en su hueco; las
 * demás seleccionadas siguen donde estaban, atenuadas). Todas van seguidas a ese hueco, en el orden del grupo, y el resto
 * de la columna no cambia de orden: el hueco es el sitio entre las tarjetas no seleccionadas en el que estaba la cogida.
 */
export function placeBlock(list: readonly string[], activeId: string, group: readonly string[]): BlockPlacement {
  const inGroup = new Set(group);
  const rest = list.filter((id) => !inGroup.has(id));
  const at = list.indexOf(activeId);
  const k = at < 0 ? rest.length : list.slice(0, at).filter((id) => !inGroup.has(id)).length;
  return blockAt(rest, k, group);
}

/** Alt+flechas sobre una tarjeta del grupo (la que tiene el foco): a la columna anterior o siguiente, o un puesto arriba o abajo. */
export type BlockMove = "left" | "right" | "up" | "down";

/**
 * Teclado. Izquierda/derecha: todo el grupo al final de la columna anterior o siguiente a la de la tarjeta con el foco
 * (como Alt+flecha con una sola). Arriba/abajo: el grupo, junto, un puesto por encima de la primera seleccionada de esa
 * columna o por debajo de la última (las de otras columnas se le unen). `null` si no hay adónde ir.
 */
export function keyboardBlock(items: ColumnItems, columnOrder: readonly string[], group: readonly string[], focusId: string, move: BlockMove): (BlockPlacement & { columnId: string }) | null {
  const inGroup = new Set(group);
  const fromIndex = columnOrder.findIndex((c) => items[c]?.includes(focusId));
  if (fromIndex < 0) return null;
  if (move === "left" || move === "right") {
    const to = columnOrder[fromIndex + (move === "left" ? -1 : 1)];
    if (!to) return null;
    const rest = (items[to] ?? []).filter((id) => !inGroup.has(id));
    return { columnId: to, ...blockAt(rest, rest.length, group) };
  }
  const from = columnOrder[fromIndex]!;
  const list = items[from] ?? [];
  const rest = list.filter((id) => !inGroup.has(id));
  const restBefore = (id: string) => list.slice(0, list.indexOf(id)).filter((x) => !inGroup.has(x)).length;
  const here = list.filter((id) => inGroup.has(id));
  const k = move === "up" ? Math.max(0, restBefore(here[0]!) - 1) : Math.min(rest.length, restBefore(here.at(-1)!) + 1);
  return { columnId: from, ...blockAt(rest, k, group) };
}

/** ¿Las dos listas tienen los mismos ids en el mismo orden? (Soltar el bloque donde ya estaba no cambia nada.) */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
