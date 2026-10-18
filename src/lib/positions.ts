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

/** true si los vecinos están tan cerca que conviene renumerar la lista. */
export function needsRebalance(prev?: number | null, next?: number | null): boolean {
  return prev != null && next != null && Math.abs(next - prev) < MIN_GAP;
}
