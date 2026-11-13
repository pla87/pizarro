// Tareas recurrentes: la siguiente aparición (campos opcionales, fecha de inicio desplazada) y deshacer el borrado de
// una aparición sin perder de qué tarea salió ni su columna de rutinas.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { createTask, deleteTask, moveTask } from "../../src/actions/tasks";
import { undoLast } from "../../src/actions/undo";

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

describe("deshacer el borrado de una aparición", () => {
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

describe("«Repetir» al crear la tarea", () => {
  test("guarda la regla y deja el día coherente (de la fecha límite si falta; sin día en la diaria)", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const base = { projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId };
    // 2999-01-07 es lunes.
    const weekly = expectOk(await createTask({ ...base, title: "Semanal", dueDate: "2999-01-07", recurrence: "WEEKLY" }));
    assert.deepEqual([weekly.recurrence, weekly.recurrenceDay], ["WEEKLY", 1]);
    const monthly = expectOk(await createTask({ ...base, title: "Mensual", dueDate: "2999-01-07", recurrence: "MONTHLY", recurrenceDay: 31 }));
    assert.deepEqual([monthly.recurrence, monthly.recurrenceDay], ["MONTHLY", 31]);
    // Día fuera de rango para la semana: se toma el de la fecha límite.
    const fixed = expectOk(await createTask({ ...base, title: "Corregida", dueDate: "2999-01-07", recurrence: "WEEKLY", recurrenceDay: 20 }));
    assert.equal(fixed.recurrenceDay, 1);
    const daily = expectOk(await createTask({ ...base, title: "Diaria", recurrence: "DAILY", recurrenceDay: 5 }));
    assert.deepEqual([daily.recurrence, daily.recurrenceDay], ["DAILY", null]);
    const plain = expectOk(await createTask({ ...base, title: "Normal" }));
    assert.deepEqual([plain.recurrence, plain.recurrenceDay], ["NONE", null]);
    // Y se comporta como una creada desde el detalle: al terminarla nace la siguiente.
    expectOk(await moveTask(weekly.id, f.columns.done, null, null));
    assert.equal((await nextOf(weekly.id)).dueDate?.toISOString().slice(0, 10), "2999-01-14");
  });
});
