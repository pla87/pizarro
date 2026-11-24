// «← Volver a «…»» del detalle: al abrir desde una tarea otra enlazada («Bloqueada por», «Bloquea a»), el detalle nuevo
// sustituye al anterior (el tablero solo tiene uno abierto). Aquí se recuerda de cuál se vino, un solo paso y en memoria:
// se olvida al cerrar el detalle o al volver.

let back: { from: string; to: string } | null = null;

/** Se va de la tarea `from` a la `to` desde un enlace del detalle. */
export function rememberTaskReturn(from: string, to: string): void {
  back = from === to ? null : { from, to };
}

/** Tarea a la que se puede volver desde el detalle de `taskId` (null si no se llegó desde otra). */
export function taskReturnFor(taskId: string): string | null {
  return back?.to === taskId ? back.from : null;
}

export function forgetTaskReturn(): void {
  back = null;
}
