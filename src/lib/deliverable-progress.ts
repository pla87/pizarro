// Avance de un entregable: un solo criterio para el calendario y el informe PDF. Puro (sin BD): la lectura agrupada está
// en deliverable-progress-db.ts.

/** Tareas de un entregable en el mismo estado (`count` de ellas; por defecto, una). */
export interface DeliverableTaskGroup {
  /** Tarea fija («Siempre en la release» o en el plan para IA): no se termina nunca, así que no cuenta. */
  evergreen: boolean;
  /** Archivada: cuenta como hecha (lo que se archiva es lo terminado, a mano o al desplegar una release). */
  archived: boolean;
  /** En una columna terminada. */
  inDoneColumn: boolean;
  count?: number;
}

export interface DeliverableProgress {
  total: number;
  done: number;
}

/**
 * Total y hechas de un entregable. Criterio único: las archivadas cuentan como hechas y las fijas no cuentan (ni en el
 * total ni en las hechas). Antes el calendario incluía las fijas y el informe no contaba las archivadas.
 */
export function deliverableProgress(groups: Iterable<DeliverableTaskGroup>): DeliverableProgress {
  let total = 0;
  let done = 0;
  for (const g of groups) {
    if (g.evergreen) continue;
    const n = g.count ?? 1;
    total += n;
    if (g.archived || g.inDoneColumn) done += n;
  }
  return { total, done };
}
