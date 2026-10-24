// Ordenación por posiciones fraccionarias: mover una tarjeta solo actualiza una fila.

export const POSITION_STEP = 1024;
const MIN_GAP = 1e-6;

/** Posición entre dos vecinos (cualquiera puede faltar). */
export function positionBetween(prev?: number | null, next?: number | null): number {
  if (prev == null && next == null) return POSITION_STEP;
  if (prev == null) return next! - POSITION_STEP;
  if (next == null) return prev + POSITION_STEP;
  return (prev + next) / 2;
}

/**
 * true si entre los dos vecinos no cabe una posición nueva distinta de ambas: están tan cerca que conviene
 * renumerar la lista, son iguales (empate) o vienen al revés. Nunca debe acabar habiendo dos posiciones iguales.
 */
export function needsRebalance(prev?: number | null, next?: number | null): boolean {
  if (prev == null || next == null) return false;
  const mid = (prev + next) / 2;
  return next - prev < MIN_GAP || !(mid > prev && mid < next);
}

/**
 * Orden de las tarjetas: por posición y, si dos coincidieran, por id. Es el mismo criterio que usa el
 * servidor (TASK_ORDER en task-positions.ts): sin desempate, el orden de dos posiciones iguales dependería
 * de cómo devuelva las filas PostgreSQL y podría cambiar tras cualquier refresco.
 */
export function compareTaskOrder(a: { position: number; id: string }, b: { position: number; id: string }): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// --- Arrastre sobre listas COMPLETAS -------------------------------------------------------
// Con un filtro activo solo se ven algunas tarjetas, pero el arrastre trabaja sobre la lista
// completa de la columna: así los vecinos que se envían al servidor son los reales y las tarjetas
// ocultas no cambian de orden entre sí.

/** Mueve `id` (de la misma lista) a la posición de `overId`: queda justo antes si sube, justo después si baja. */
export function moveOnto(list: string[], id: string, overId: string): string[] {
  const from = list.indexOf(id);
  const to = list.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return list;
  const next = list.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Inserta `id` justo antes de `overId` (al final si `overId` no está en la lista, p. ej. una columna vacía). */
export function insertBefore(list: string[], id: string, overId: string): string[] {
  const rest = list.filter((x) => x !== id);
  const index = rest.indexOf(overId);
  return index >= 0 ? [...rest.slice(0, index), id, ...rest.slice(index)] : [...rest, id];
}

/** Vecinos de `id` en la lista completa (null si es la primera o la última). */
export function neighboursOf(list: string[], id: string): { prevId: string | null; nextId: string | null } {
  const index = list.indexOf(id);
  return { prevId: list[index - 1] ?? null, nextId: list[index + 1] ?? null };
}
