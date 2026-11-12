// Tareas archivadas: subtareas que ya no se pueden tocar, acciones múltiples con ids que ya no existen, recuperar una
// tarea que no está archivada y la lista de archivadas paginada y con búsqueda en el servidor.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { archiveTask, archiveTasks, deleteSubtask, deleteTasks, getArchivedTasks, reorderSubtask, restoreTask, updateSubtask } from "../../src/actions/tasks";

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
