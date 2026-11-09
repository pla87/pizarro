// Subtareas pegadas con varias líneas (addSubtasks): al final de la lista, una sola entrada de deshacer, una línea de
// historial y el tope de subtareas por tarea.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { addSubtask, addSubtasks } from "../../src/actions/tasks";
import { undoLast } from "../../src/actions/undo";

const titles = (taskId: string) => db.subtask.findMany({ where: { taskId }, orderBy: { position: "asc" } }).then((l) => l.map((s) => s.title));

describe("addSubtasks", () => {
  test("añade al final, en orden, y un solo deshacer las quita todas", async () => {
    const u = await makeUser();
    const f = await makeProject({ members: [u] });
    const task = await makeTask(f, { title: "Pegar" });
    await loginAs(u);
    expectOk(await addSubtask(task.id, "Ya estaba"));
    const before = await db.undoEntry.count({ where: { projectId: f.project.id } });
    const res = expectOk(await addSubtasks(task.id, ["uno", "dos", "tres"]));
    assert.deepEqual([res.created.map((s) => s.title), res.skipped], [["uno", "dos", "tres"], 0]);
    assert.ok(res.undo.id, "devuelve la entrada de deshacer");
    assert.deepEqual(await titles(task.id), ["Ya estaba", "uno", "dos", "tres"]);
    assert.equal(await db.undoEntry.count({ where: { projectId: f.project.id } }), before + 1, "una sola entrada de deshacer");
    const events = await db.taskEvent.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
    assert.equal(events.filter((e) => e.code === "subtask").length, 2, "una línea de historial por acción");
    expectOk(await undoLast(f.project.id, task.id));
    assert.deepEqual(await titles(task.id), ["Ya estaba"]);
  });

  test("respeta el máximo de 100 subtareas: añade las que caben y dice cuántas no", async () => {
    const u = await makeUser();
    const f = await makeProject({ members: [u] });
    const task = await makeTask(f, { title: "Llena", subtasks: Array.from({ length: 98 }, (_, i) => `s${i}`) });
    await loginAs(u);
    const res = expectOk(await addSubtasks(task.id, ["a", "b", "c", "d"]));
    assert.deepEqual([res.created.map((s) => s.title), res.skipped], [["a", "b"], 2]);
    assert.equal(await db.subtask.count({ where: { taskId: task.id } }), 100);
    expectFail(await addSubtasks(task.id, ["x", "y"]), /100 subtareas/);
  });

  test("rechaza títulos vacíos o demasiado largos y listas vacías", async () => {
    const u = await makeUser();
    const f = await makeProject({ members: [u] });
    const task = await makeTask(f, { title: "Validar" });
    await loginAs(u);
    expectFail(await addSubtasks(task.id, []));
    expectFail(await addSubtasks(task.id, ["bien", " "]));
    expectFail(await addSubtasks(task.id, ["x".repeat(211)]));
    assert.equal(await db.subtask.count({ where: { taskId: task.id } }), 0);
  });

  test("sin acceso a la tarea no añade nada", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const f = await makeProject({ members: [owner] });
    const task = await makeTask(f, { title: "Ajena" });
    await loginAs(other);
    expectFail(await addSubtasks(task.id, ["a", "b"]));
    assert.equal(await db.subtask.count({ where: { taskId: task.id } }), 0);
  });
});
