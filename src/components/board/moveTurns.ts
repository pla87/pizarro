/**
 * Turnos de los movimientos de tarjetas (arrastre, Alt+flechas, mover una selección). Cada movimiento pinta su resultado
 * al momento y, al responder el servidor, corrige la posición con la que ha guardado. Con dos seguidos sobre la misma
 * tarjeta (Alt+→ y, antes de que responda, Alt+←), la respuesta del primero llegaba después de pintar el segundo y le
 * ponía su posición: la tarjeta saltaba a otro sitio de su columna nueva y el atajo siguiente partía de ahí (subía dos
 * puestos o no hacía nada). Con los turnos, la respuesta de un movimiento solo se aplica a las tarjetas que nadie ha
 * vuelto a mover después; la del último deja todo como está en el servidor (Next manda las acciones de una en una).
 */
export interface MoveTurns {
  /** Empieza un movimiento de estas tarjetas: su turno. */
  start(ids: readonly string[]): number;
  /** ¿Sigue siendo `turn` el último movimiento de la tarjeta? */
  isLatest(id: string, turn: number): boolean;
}

export function createMoveTurns(): MoveTurns {
  let next = 0;
  const last = new Map<string, number>();
  return {
    start(ids) {
      next++;
      for (const id of ids) last.set(id, next);
      return next;
    },
    isLatest: (id, turn) => last.get(id) === turn,
  };
}
