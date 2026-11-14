// Tope de sesiones de una columna «Programa del curso» (rol PROGRAM): cada tarea no archivada es una sesión del PDF y,
// con muchas, el PDF tarda demasiado. Sin dependencias de servidor: lo usan también el tablero (contador y «+») y la
// lectura de un archivo de proyecto al importarlo. Las comprobaciones con la base de datos están en column-capacity.ts.

/** Sesiones (tareas no archivadas) que admite una columna con rol PROGRAM. */
export const PROGRAM_MAX_SESSIONS = 100;

/** ¿Tiene la columna el tope de sesiones (o más, con datos de antes del límite)? Solo las columnas PROGRAM tienen tope. */
export function columnAtSessionLimit(role: string, sessions: number): boolean {
  return role === "PROGRAM" && sessions >= PROGRAM_MAX_SESSIONS;
}

/**
 * Columnas PROGRAM que pasan del tope con sus tareas no archivadas (para validar un archivo de proyecto antes de
 * importarlo). En el orden de `columns`.
 */
export function programColumnsOverLimit<C extends { ref: string; role: string }>(
  columns: readonly C[],
  tasks: readonly { columnRef: string; archivedAt: string | null }[],
): { column: C; sessions: number }[] {
  const active = new Map<string, number>();
  for (const t of tasks) if (!t.archivedAt) active.set(t.columnRef, (active.get(t.columnRef) ?? 0) + 1);
  return columns
    .filter((c) => c.role === "PROGRAM" && (active.get(c.ref) ?? 0) > PROGRAM_MAX_SESSIONS)
    .map((column) => ({ column, sessions: active.get(column.ref)! }));
}
