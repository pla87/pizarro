// Columnas «Rutinas»: destino de la siguiente aparición de una tarea recurrente.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { moveTask } from "../../src/actions/tasks";
import { deleteColumn, setColumnRole, setColumnRoutineTarget } from "../../src/actions/columns";
import { undoLast } from "../../src/actions/undo";

async function setup() {
  const user = await makeUser();
  const f = await makeProject({ members: [user] });
  await loginAs(user);
  // «Por hacer» es la columna de rutinas.
  expectOk(await setColumnRole(f.columns.todo, "ROUTINES"));
  return { user, f };
}

const nextOf = (taskId: string) => db.task.findFirstOrThrow({ where: { recurrenceFromId: taskId } });

describe("rutinas", () => {
  test("por defecto la siguiente aparición vuelve a la misma columna de rutinas", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "Rutina", recurrence: "DAILY", columnId: f.columns.todo });
    expectOk(await moveTask(a.id, f.columns.doing, null, null));
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    const next = await nextOf(a.id);
    assert.equal(next.columnId, f.columns.todo);
    assert.equal(next.routineColumnId, f.columns.todo);
  });

  test("con destino configurado, la siguiente aparición nace allí y lo recuerda", async () => {
    const { f } = await setup();
    expectOk(await setColumnRoutineTarget(f.columns.todo, f.columns.doing));
    const a = await makeTask(f, { title: "Rutina", recurrence: "WEEKLY", columnId: f.columns.todo });
    // Sale de la columna de rutinas hacia una normal y se termina desde ahí: sigue contando como rutina.
    expectOk(await moveTask(a.id, f.columns.doing, null, null));
    const res = expectOk(await moveTask(a.id, f.columns.done, null, null));
    assert.equal(res.spawned.length, 1);
    const next = await nextOf(a.id);
    assert.equal(next.columnId, f.columns.doing);
    assert.equal(next.routineColumnId, f.columns.todo);
    // Y la siguiente de la siguiente también va al destino.
    expectOk(await moveTask(next.id, f.columns.done, null, null));
    assert.equal((await nextOf(next.id)).columnId, f.columns.doing);
  });

  test("una tarea que nunca estuvo en rutinas sigue la regla general", async () => {
    const { f } = await setup();
    expectOk(await setColumnRoutineTarget(f.columns.todo, f.columns.doing));
    const a = await makeTask(f, { title: "Normal", recurrence: "DAILY", columnId: f.columns.doing });
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    // Primera columna no terminada, no el destino de rutinas.
    assert.equal((await nextOf(a.id)).columnId, f.columns.todo);
    // Al nacer en una columna de rutinas, la nueva aparición ya cuenta como rutina (lo marca el disparador).
    assert.equal((await nextOf(a.id)).routineColumnId, f.columns.todo);
  });

  test("si la columna deja de ser de rutinas, la tarea ya no se redirige", async () => {
    const { f } = await setup();
    expectOk(await setColumnRoutineTarget(f.columns.todo, f.columns.doing));
    const a = await makeTask(f, { title: "Rutina", recurrence: "DAILY", columnId: f.columns.todo });
    expectOk(await setColumnRole(f.columns.todo, "NONE"));
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    assert.equal((await nextOf(a.id)).columnId, f.columns.todo);
  });

  test("una columna de rutinas terminada sin destino usa la regla general", async () => {
    const { f } = await setup();
    expectOk(await setColumnRole(f.columns.done, "ROUTINES"));
    const a = await makeTask(f, { title: "Rutina", recurrence: "DAILY", columnId: f.columns.done });
    await db.task.update({ where: { id: a.id }, data: { archivedAt: new Date() } });
    const { spawnRecurrences } = await import("../../src/lib/recurrence");
    await spawnRecurrences([a.id], (await db.user.findFirstOrThrow()).id);
    assert.equal((await nextOf(a.id)).columnId, f.columns.todo);
  });

  test("setColumnRoutineTarget: solo en rutinas, solo del mismo proyecto, se deshace y borrar el destino lo limpia", async () => {
    const { f } = await setup();
    const other = await makeProject({ members: [] });
    expectFail(await setColumnRoutineTarget(f.columns.doing, f.columns.todo), /Rutinas/);
    expectFail(await setColumnRoutineTarget(f.columns.todo, other.columns.todo), /No encontrado/);
    expectOk(await setColumnRoutineTarget(f.columns.todo, f.columns.doing));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).routineTargetColumnId, f.columns.doing);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).routineTargetColumnId, null);
    // La propia columna equivale a «sin destino».
    expectOk(await setColumnRoutineTarget(f.columns.todo, f.columns.todo));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).routineTargetColumnId, null);
    expectOk(await setColumnRoutineTarget(f.columns.todo, f.columns.doing));
    expectOk(await deleteColumn(f.columns.doing));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).routineTargetColumnId, null);
  });

  test("los roles nuevos se pueden repetir en varias columnas", async () => {
    const { f } = await setup();
    for (const role of ["CHECKLIST", "REVIEW", "AGENDA", "DELIVERY"] as const) {
      expectOk(await setColumnRole(f.columns.doing, role));
      expectOk(await setColumnRole(f.columns.done, role));
      assert.equal((await db.column.count({ where: { projectId: f.project.id, role } })), 2);
    }
  });
});
