// Correcciones de revisión: campos opcionales en la siguiente aparición, subtareas de tareas archivadas,
// destino de rutinas, deshacer de columnas y tareas con recurrencia, listado de clientes y documentación.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { archiveTask, deleteSubtask, deleteTask, moveTask, reorderSubtask, updateSubtask } from "../../src/actions/tasks";
import { deleteColumn, setColumnRole, setColumnRoutineTarget } from "../../src/actions/columns";
import { undoLast } from "../../src/actions/undo";
import { taskUpdateData } from "../../src/lib/undo";
import { projectClients } from "../../src/lib/board";
import { listProjectDocumentsOf, listTrashedDocumentsOf } from "../../src/lib/documents";

const nextOf = (taskId: string) => db.task.findFirstOrThrow({ where: { recurrenceFromId: taskId } });
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("siguiente aparición de una tarea recurrente", () => {
  test("copia coste, horas estimadas, prioridad y cliente; reinicia pagado y horas reales; desplaza la fecha de inicio", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const a = await makeTask(f, { title: "Mensual", recurrence: "DAILY", columnId: f.columns.doing, dueDate: day("2999-01-10") });
    await db.task.update({
      where: { id: a.id },
      data: { cost: "120.50", costPaid: true, estimatedHours: "3.5", actualHours: "4", priority: "ALTA", client: "Cliente SL", startDate: day("2999-01-07") },
    });
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    const next = await nextOf(a.id);
    assert.equal(next.cost?.toFixed(2), "120.50");
    assert.equal(next.costPaid, false);
    assert.equal(next.estimatedHours?.toFixed(2), "3.50");
    assert.equal(next.actualHours, null);
    assert.equal(next.priority, "ALTA");
    assert.equal(next.client, "Cliente SL");
    // Diaria con límite 2999-01-10 → 2999-01-11: el inicio se desplaza el mismo día (3 días antes del límite).
    assert.equal(next.dueDate?.toISOString().slice(0, 10), "2999-01-11");
    assert.equal(next.startDate?.toISOString().slice(0, 10), "2999-01-08");
  });

  test("sin fecha límite anterior, la fecha de inicio queda vacía", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const a = await makeTask(f, { title: "Sin límite", recurrence: "DAILY", columnId: f.columns.doing });
    await db.task.update({ where: { id: a.id }, data: { startDate: day("2999-01-07") } });
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    assert.equal((await nextOf(a.id)).startDate, null);
  });
});

describe("subtareas de tareas archivadas", () => {
  test("no se pueden editar, reordenar ni borrar", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const task = await makeTask(f, { subtasks: ["a", "b"] });
    const subs = await db.subtask.findMany({ where: { taskId: task.id }, orderBy: { position: "asc" } });
    expectOk(await archiveTask(task.id));
    expectFail(await updateSubtask(subs[0]!.id, { done: true }), /archivada/);
    expectFail(await reorderSubtask(subs[0]!.id, subs[1]!.id, null), /archivada/);
    expectFail(await deleteSubtask(subs[0]!.id), /archivada/);
    assert.equal(await db.subtask.count({ where: { taskId: task.id } }), 2);
  });
});

describe("destino de rutinas y borrado de columnas", () => {
  test("el destino no puede ser una columna terminada ni de rutinas", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectOk(await setColumnRole(f.columns.todo, "ROUTINES"));
    expectFail(await setColumnRoutineTarget(f.columns.todo, f.columns.done), /terminada/);
    expectOk(await setColumnRole(f.columns.doing, "ROUTINES"));
    expectFail(await setColumnRoutineTarget(f.columns.todo, f.columns.doing), /rutinas/);
  });

  test("deshacer el borrado de la columna destino la recrea con su destino y vuelve a apuntarla desde la de rutinas", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const extra = await db.column.create({ data: { projectId: f.project.id, name: "Destino", position: 4000 } });
    expectOk(await setColumnRole(f.columns.todo, "ROUTINES"));
    expectOk(await setColumnRoutineTarget(f.columns.todo, extra.id));
    expectOk(await deleteColumn(extra.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).routineTargetColumnId, null);
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.column.count({ where: { id: extra.id } }), 1);
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).routineTargetColumnId, extra.id);
  });

  test("deshacer el borrado de una columna de rutinas conserva su destino", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectOk(await setColumnRole(f.columns.todo, "ROUTINES"));
    expectOk(await setColumnRoutineTarget(f.columns.todo, f.columns.doing));
    expectOk(await deleteColumn(f.columns.todo));
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).routineTargetColumnId, f.columns.doing);
  });
});

describe("deshacer", () => {
  test("taskUpdateData ignora campos desconocidos de entradas antiguas", () => {
    const data = taskUpdateData({ title: "x", externalUrl: "https://example.com", loQueSea: 1 } as never) as Record<string, unknown>;
    assert.deepEqual(data, { title: "x" });
  });

  test("borrar una tarea recurrente y deshacer conserva de qué tarea salió y su columna de rutinas", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const a = await makeTask(f, { title: "Origen", recurrence: "DAILY", columnId: f.columns.doing });
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    const next = await nextOf(a.id);
    await db.task.update({ where: { id: next.id }, data: { routineColumnId: f.columns.todo } });
    expectOk(await deleteTask(next.id));
    expectOk(await undoLast(f.project.id));
    const back = await db.task.findUniqueOrThrow({ where: { id: next.id } });
    assert.equal(back.recurrenceFromId, a.id);
    assert.equal(back.routineColumnId, f.columns.todo);
  });
});

describe("consultas", () => {
  test("projectClients devuelve los clientes distintos en orden", async () => {
    const f = await makeProject({ members: [] });
    for (const client of ["Zeta", "Alfa", "Alfa", "Beta"]) {
      const t = await makeTask(f);
      await db.task.update({ where: { id: t.id }, data: { client } });
    }
    await makeTask(f);
    assert.deepEqual(await projectClients(f.project.id), ["Alfa", "Beta", "Zeta"]);
  });

  test("listProjectDocumentsOf / listTrashedDocumentsOf listan sin comprobar el acceso", async () => {
    const f = await makeProject({ members: [] });
    assert.deepEqual(await listProjectDocumentsOf(f.project.id), []);
    assert.deepEqual(await listTrashedDocumentsOf(f.project.id), []);
  });
});
