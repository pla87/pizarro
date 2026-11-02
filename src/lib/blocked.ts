// Tareas bloqueadas (versión mínima): una tarea puede estar «bloqueada por» otra del mismo proyecto.
// Funciones puras, usadas por el servidor (validación) y por el cliente (selector, icono atenuado).

/**
 * ¿Crearía un ciclo bloquear `taskId` por `blockerId`? Sigue la cadena de bloqueos del posible bloqueador
 * (A → B → C…) y mira si pasa por `taskId`. `next(id)` da la tarea que bloquea a `id` (o null). Con tope de pasos
 * por si los datos ya tuvieran un ciclo.
 */
export function wouldCycle(taskId: string, blockerId: string, next: (id: string) => string | null | undefined, maxSteps = 1000): boolean {
  let cur: string | null | undefined = blockerId;
  for (let i = 0; cur && i < maxSteps; i++) {
    if (cur === taskId) return true;
    cur = next(cur);
  }
  return false;
}

/**
 * ¿Ha terminado la tarea que bloquea? Lo está cuando está archivada (no aparece entre las activas del tablero) o su
 * columna cuenta como terminada. `blocker` es la tarea activa del tablero, o undefined si no está.
 */
export function blockerIsDone(blocker: { columnId: string } | undefined, columns: readonly { id: string; isDone: boolean }[]): boolean {
  return !blocker || (columns.find((c) => c.id === blocker.columnId)?.isDone ?? false);
}
