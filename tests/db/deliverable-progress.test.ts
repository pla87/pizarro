// Avance de los entregables contado en la BD (calendario e informe PDF): archivadas = hechas, las fijas no cuentan.
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, makeProject, makeTask } from "./helpers";
import { deliverableProgressByIds } from "../../src/lib/deliverable-progress-db";

test("avance por entregable: pendientes, terminadas, archivadas y fijas; solo los pedidos", async () => {
  const f = await makeProject({ members: [] });
  const [d1, d2, d3, other] = await Promise.all(
    ["Uno", "Dos", "Tres", "Otro"].map((name, i) => db.deliverable.create({ data: { projectId: f.project.id, name, position: (i + 1) * 1000 } })),
  );
  const task = async (deliverableId: string, opts: { columnId?: string; archived?: boolean; evergreen?: boolean } = {}) => {
    const t = await makeTask(f, { columnId: opts.columnId });
    await db.task.update({ where: { id: t.id }, data: { deliverableId, archivedAt: opts.archived ? new Date() : null, evergreen: opts.evergreen ?? false } });
  };
  await task(d1!.id); // pendiente
  await task(d1!.id, { columnId: f.columns.doing }); // pendiente en otra columna
  await task(d1!.id, { columnId: f.columns.done }); // terminada
  await task(d1!.id, { archived: true }); // archivada desde «Por hacer»: cuenta como hecha
  await task(d1!.id, { columnId: f.columns.done, archived: true });
  await task(d1!.id, { evergreen: true }); // fija: no cuenta
  await task(d1!.id, { evergreen: true, archived: true });
  await task(d2!.id, { evergreen: true }); // solo fijas: sin tareas
  await task(other!.id); // no pedido
  const progress = await deliverableProgressByIds([d1!.id, d2!.id, d3!.id]);
  assert.deepEqual([...progress], [
    [d1!.id, { total: 5, done: 3 }],
    [d2!.id, { total: 0, done: 0 }],
    [d3!.id, { total: 0, done: 0 }],
  ]);
  assert.equal((await deliverableProgressByIds([])).size, 0);
});
