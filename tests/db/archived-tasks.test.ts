// Tareas archivadas: subtareas que ya no se pueden tocar, acciones múltiples con ids que ya no existen, recuperar una
// tarea que no está archivada, la lista de archivadas paginada y con búsqueda en el servidor, y archivar, mover o
// recuperar mientras otra persona cambia la misma tarea.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, waitForLockWaiter } from "./helpers";
import { archiveTask, archiveTasks, deleteSubtask, deleteTask, deleteTasks, getArchivedTasks, makeEvergreen, moveTask, moveTasks, reorderSubtask, restoreTask, updateSubtask } from "../../src/actions/tasks";

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

describe("acciones múltiples y recuperar", () => {
  test("archivar/borrar ignora ids que ya no existen", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const a = await makeTask(f);
    const b = await makeTask(f);
    const c = await makeTask(f);
    await db.task.delete({ where: { id: b.id } });
    const res = expectOk(await archiveTasks([a.id, b.id]));
    assert.equal(res.archived, 1);
    assert.ok((await db.task.findUniqueOrThrow({ where: { id: a.id } })).archivedAt);
    expectOk(await deleteTasks([c.id, b.id]));
    assert.equal(await db.task.count({ where: { id: c.id } }), 0);
    assert.equal(expectOk(await deleteTasks([b.id])).deleted, 0);
  });

  test("restoreTask de una tarea no archivada falla y no la mueve", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const t = await makeTask(f, { columnId: f.columns.done });
    expectFail(await restoreTask(t.id), /no está archivada/);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: t.id } })).columnId, f.columns.done);
  });

  test("archivadas: páginas con cursor y búsqueda en el servidor", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const rows = Array.from({ length: 103 }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId, title: i === 7 ? "Aguja especial" : `Tarea ${i}`, position: (i + 1) * 10, archivedAt: new Date(Date.now() - i * 1000) }));
    await db.task.createMany({ data: rows });
    const p1 = expectOk(await getArchivedTasks(f.project.id));
    assert.equal(p1.items.length, 100);
    assert.ok(p1.nextCursor);
    const p2 = expectOk(await getArchivedTasks(f.project.id, { cursor: p1.nextCursor }));
    assert.equal(p2.items.length, 3);
    assert.equal(p2.nextCursor, null);
    assert.equal(new Set([...p1.items, ...p2.items].map((i) => i.id)).size, 103);
    const found = expectOk(await getArchivedTasks(f.project.id, { query: "aguja" }));
    assert.deepEqual(found.items.map((i) => i.title), ["Aguja especial"]);
  });
});

// La acción de la prueba pasa sus comprobaciones con la fila tal como estaba y espera al candado de la de la otra persona
// (una transacción abierta con el cambio sin confirmar); al confirmarse, debe tener en cuenta ese cambio.
describe("archivar, mover y recuperar a la vez", () => {
  async function setup() {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    return { f, task: await makeTask(f) };
  }

  test("archivar mientras otra persona la mueve: el origen es la columna en la que queda, no la leída antes", async () => {
    const { f, task } = await setup();
    let pending: ReturnType<typeof archiveTask> | null = null;
    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: task.id }, data: { columnId: f.columns.doing }, select: { id: true } });
      pending = archiveTask(task.id);
      await waitForLockWaiter();
    }, { timeout: 10_000 });
    expectOk(await pending!);
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.ok(row.archivedAt);
    assert.deepEqual([row.columnId, row.archivedFromColumnId], [f.columns.doing, f.columns.doing]);
  });

  test("mover mientras otra persona la archiva: no se mueve y sigue archivada con su origen", async () => {
    const { f, task } = await setup();
    let pending: ReturnType<typeof moveTask> | null = null;
    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: task.id }, data: { archivedAt: new Date(), archivedFromColumnId: f.columns.todo }, select: { id: true } });
      pending = moveTask(task.id, f.columns.doing, null, null);
      await waitForLockWaiter();
    }, { timeout: 10_000 });
    expectFail(await pending!, /archivada/);
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.ok(row.archivedAt);
    assert.deepEqual([row.columnId, row.archivedFromColumnId], [f.columns.todo, f.columns.todo]);
  });

  test("marcar como fija mientras otra persona la archiva: falla y sigue archivada, sin ser fija", async () => {
    const { f, task } = await setup();
    await db.column.update({ where: { id: f.columns.done }, data: { role: "NEXT_RELEASE", isDone: false } });
    let pending: ReturnType<typeof makeEvergreen> | null = null;
    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: task.id }, data: { archivedAt: new Date(), archivedFromColumnId: f.columns.todo }, select: { id: true } });
      pending = makeEvergreen(task.id);
      await waitForLockWaiter();
    }, { timeout: 10_000 });
    expectFail(await pending!, /archivada/);
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.ok(row.archivedAt);
    assert.deepEqual([row.columnId, row.archivedFromColumnId, row.evergreen], [f.columns.todo, f.columns.todo, false]);
  });

  test("recuperar mientras otra pestaña la recupera: la segunda falla y no la mueve otra vez", async () => {
    const { f, task } = await setup();
    await db.task.update({ where: { id: task.id }, data: { archivedAt: new Date(), archivedFromColumnId: f.columns.todo }, select: { id: true } });
    let pending: ReturnType<typeof restoreTask> | null = null;
    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: task.id }, data: { archivedAt: null, archivedFromColumnId: null, position: 777 }, select: { id: true } });
      pending = restoreTask(task.id);
      await waitForLockWaiter();
    }, { timeout: 10_000 });
    expectFail(await pending!, /no está archivada/);
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.deepEqual([row.archivedAt, row.columnId, row.position], [null, f.columns.todo, 777]);
  });
});

describe("borrar tareas mientras otra persona las mueve", () => {
  test("deleteTask y deleteTasks esperan a la fila bloqueada y borran después", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const [a, b, c] = [await makeTask(f), await makeTask(f), await makeTask(f)];
    let one: ReturnType<typeof deleteTask> | null = null;
    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: a.id }, data: { title: "movida" }, select: { id: true } });
      one = deleteTask(a.id);
      await waitForLockWaiter();
      assert.equal(await db.task.count({ where: { id: a.id } }), 1, "sigue ahí mientras espera");
    }, { timeout: 10_000 });
    expectOk(await one!);
    assert.equal(await db.task.count({ where: { id: a.id } }), 0);
    let many: ReturnType<typeof deleteTasks> | null = null;
    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: c.id }, data: { title: "movida" }, select: { id: true } });
      many = deleteTasks([b.id, c.id]);
      await waitForLockWaiter();
    }, { timeout: 10_000 });
    assert.equal(expectOk(await many!).deleted, 2);
    assert.equal(await db.task.count({ where: { projectId: f.project.id } }), 0);
  });

  test("borrar varias a la vez que otra persona las mueve: nunca interbloqueo (40P01)", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    for (let round = 0; round < 4; round++) {
      const tasks = [];
      for (let i = 0; i < 12; i++) tasks.push(await makeTask(f));
      const ids = tasks.map((t) => t.id);
      const results = await Promise.all([deleteTasks([...ids].reverse()), moveTasks(ids, f.columns.doing), deleteTasks(ids)]);
      for (const r of results) if (!r.ok) assert.doesNotMatch(r.error, /40P01|deadlock|interbloqueo/i, r.error);
      assert.equal(await db.task.count({ where: { id: { in: ids } } }), 0);
    }
  });
});
