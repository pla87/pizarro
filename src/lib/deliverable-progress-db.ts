import { db } from "./db";
import { deliverableProgress, type DeliverableProgress, type DeliverableTaskGroup } from "./deliverable-progress";

/**
 * Avance de cada entregable (`deliverableProgress`), contado en la BD sin traer las tareas: las activas agrupadas por
 * entregable, columna y si son fijas, y las archivadas por entregable y si son fijas, filtrando por los ids (un `_count`
 * de relación agruparía todas las tareas del servidor). Lo usan el calendario y el informe PDF.
 */
export async function deliverableProgressByIds(ids: readonly string[]): Promise<Map<string, DeliverableProgress>> {
  if (!ids.length) return new Map();
  const inIds = { deliverableId: { in: [...ids] } };
  const [active, archived] = await Promise.all([
    db.task.groupBy({ by: ["deliverableId", "columnId", "evergreen"], where: { ...inIds, archivedAt: null }, _count: { _all: true } }),
    db.task.groupBy({ by: ["deliverableId", "evergreen"], where: { ...inIds, archivedAt: { not: null } }, _count: { _all: true } }),
  ]);
  const columnIds = [...new Set(active.map((g) => g.columnId))];
  const doneColumns = new Set(
    columnIds.length ? (await db.column.findMany({ where: { id: { in: columnIds }, isDone: true }, select: { id: true } })).map((c) => c.id) : [],
  );
  const groups = new Map<string, DeliverableTaskGroup[]>();
  const add = (id: string | null, group: DeliverableTaskGroup) => {
    if (!id) return;
    const list = groups.get(id);
    if (list) list.push(group);
    else groups.set(id, [group]);
  };
  for (const g of active) add(g.deliverableId, { evergreen: g.evergreen, archived: false, inDoneColumn: doneColumns.has(g.columnId), count: g._count._all });
  for (const g of archived) add(g.deliverableId, { evergreen: g.evergreen, archived: true, inDoneColumn: false, count: g._count._all });
  return new Map(ids.map((id) => [id, deliverableProgress(groups.get(id) ?? [])]));
}
