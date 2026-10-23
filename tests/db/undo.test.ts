// Deshacer (undoLast) de punta a punta contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assign, db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { addComment, archiveTask, createTask, deleteComment, deleteTask, moveTask, updateTask } from "../../src/actions/tasks";
import { undoLast } from "../../src/actions/undo";
import { removeProjectMember } from "../../src/actions/projects";

async function setup() {
  const user = await makeUser();
  const f = await makeProject();
  await loginAs(user);
  return { user, f };
}

const NOTHING = /No hay nada que deshacer/;

describe("deshacer acciones propias", () => {
  test("crear una tarea con subtareas: deshacer la elimina con sus subtareas", async () => {
    const { f } = await setup();
    const created = expectOk(
      await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "Con subtareas", kindId: f.kindId, subtasks: ["uno", "dos", "tres"] }),
    );
    assert.equal(await db.subtask.count({ where: { taskId: created.id } }), 3);
    const res = expectOk(await undoLast(f.project.id));
    assert.equal(res.skipped, 0);
    assert.equal(res.remaining, 0);
    assert.equal(await db.task.count({ where: { id: created.id } }), 0);
    assert.equal(await db.subtask.count({ where: { taskId: created.id } }), 0);
    expectFail(await undoLast(f.project.id), NOTHING);
  });

  test("editar campos: deshacer restaura título, descripción, responsable y etiquetas", async () => {
    const { user, f } = await setup();
    const other = await makeUser();
    await assign(f, other);
    const label = await db.label.create({ data: { projectId: f.project.id, name: "L1", color: "blue" } });
    const task = await makeTask(f, { title: "Original" });
    await db.task.update({ where: { id: task.id }, data: { description: "desc original", assigneeId: user.id } });
    expectOk(await updateTask(task.id, { title: "Cambiado", description: "otra", assigneeId: other.id, labelIds: [label.id] }));
    const edited = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { labels: true } });
    assert.equal(edited.title, "Cambiado");
    assert.equal(edited.labels.length, 1);

    expectOk(await undoLast(f.project.id));
    const back = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { labels: true } });
    assert.equal(back.title, "Original");
    assert.equal(back.description, "desc original");
    assert.equal(back.assigneeId, user.id);
    assert.equal(back.labels.length, 0);
  });

  test("mover: deshacer devuelve la tarea a su columna y posición", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { position: 1000 });
    const b = await makeTask(f, { position: 2000 });
    const target = await makeTask(f, { columnId: f.columns.doing, position: 5000 });
    expectOk(await moveTask(a.id, f.columns.doing, target.id, null));
    const moved = await db.task.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(moved.columnId, f.columns.doing);
    assert.notEqual(moved.position, 1000);

    expectOk(await undoLast(f.project.id));
    const back = await db.task.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(back.columnId, f.columns.todo);
    assert.equal(back.position, 1000);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: b.id } })).position, 2000);
  });

  test("archivar una tarea recurrente: deshacer la recupera y quita la siguiente aparición", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { title: "Diaria", recurrence: "DAILY", dueDate: new Date("2026-01-10T00:00:00Z"), position: 1500 });
    const res = expectOk(await archiveTask(task.id));
    assert.equal(res.spawned.length, 1);
    const archived = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.ok(archived.archivedAt);
    assert.equal(archived.archivedFromColumnId, f.columns.todo);
    assert.equal(await db.task.count({ where: { recurrenceFromId: task.id } }), 1);

    expectOk(await undoLast(f.project.id));
    const back = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(back.archivedAt, null);
    assert.equal(back.archivedFromColumnId, null);
    assert.equal(back.columnId, f.columns.todo);
    assert.equal(back.position, 1500);
    assert.equal(await db.task.count({ where: { recurrenceFromId: task.id } }), 0);
    // Y se puede volver a archivar: vuelve a nacer una sola aparición siguiente.
    assert.equal(expectOk(await archiveTask(task.id)).spawned.length, 1);
  });

  test("mover una recurrente a «Hecho»: deshacer devuelve la tarea y quita la copia", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { recurrence: "WEEKLY", dueDate: new Date("2026-01-10T00:00:00Z") });
    const res = expectOk(await moveTask(task.id, f.columns.done, null, null));
    assert.equal(res.spawned.length, 1);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).columnId, f.columns.todo);
    assert.equal(await db.task.count({ where: { recurrenceFromId: task.id } }), 0);
  });

  test("borrar una tarea: deshacer la restaura con subtareas, comentarios y etiquetas", async () => {
    const { user, f } = await setup();
    const label = await db.label.create({ data: { projectId: f.project.id, name: "L2", color: "red" } });
    const task = await makeTask(f, { title: "A borrar", subtasks: ["s1", "s2"], createdById: user.id });
    await db.taskLabel.create({ data: { taskId: task.id, labelId: label.id } });
    await db.taskComment.create({ data: { taskId: task.id, authorId: user.id, body: "un comentario" } });
    await db.subtask.updateMany({ where: { taskId: task.id, title: "s1" }, data: { done: true } });

    expectOk(await deleteTask(task.id));
    assert.equal(await db.task.count({ where: { id: task.id } }), 0);

    const res = expectOk(await undoLast(f.project.id));
    assert.equal(res.skipped, 0);
    const back = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { subtasks: { orderBy: { position: "asc" } }, comments: true, labels: true },
    });
    assert.equal(back.title, "A borrar");
    assert.equal(back.createdById, user.id);
    assert.deepEqual(back.subtasks.map((s) => [s.title, s.done]), [["s1", true], ["s2", false]]);
    assert.deepEqual(back.comments.map((c) => c.body), ["un comentario"]);
    assert.equal(back.labels.length, 1);
  });

  test("comentar y borrar un comentario se deshacen", async () => {
    const { f } = await setup();
    const task = await makeTask(f);
    const comment = expectOk(await addComment(task.id, "hola"));
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.taskComment.count({ where: { id: comment.id } }), 0);

    const c2 = expectOk(await addComment(task.id, "adiós"));
    expectOk(await deleteComment(c2.id));
    assert.equal(await db.taskComment.count({ where: { id: c2.id } }), 0);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: c2.id } })).body, "adiós");
  });

  test("deshacer en orden inverso y con el contexto de una tarea", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "A" });
    const b = await makeTask(f, { title: "B" });
    expectOk(await updateTask(a.id, { title: "A1" }));
    expectOk(await updateTask(b.id, { title: "B1" }));
    expectOk(await updateTask(a.id, { title: "A2" }));

    // Con la tarea B abierta, solo cuentan sus acciones.
    expectOk(await undoLast(f.project.id, b.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: b.id } })).title, "B");
    expectFail(await undoLast(f.project.id, b.id), /nada que deshacer en esta tarea/);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: a.id } })).title, "A2");

    expectOk(await undoLast(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: a.id } })).title, "A1");
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: a.id } })).title, "A");
  });
});

describe("límites del deshacer", () => {
  test("no deshace las acciones de otra persona", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "Tarea" });
    expectOk(await updateTask(a.id, { title: "Editada por A" }));

    const b = await makeUser();
    await assign(f, b);
    await loginAs(b);
    expectFail(await undoLast(f.project.id), NOTHING);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: a.id } })).title, "Editada por A");
    assert.equal(await db.undoEntry.count({ where: { projectId: f.project.id } }), 1);
  });

  test("no deshace acciones de otro proyecto", async () => {
    const { user, f } = await setup();
    const g = await makeProject();
    const t1 = await makeTask(f, { title: "En F" });
    expectOk(await updateTask(t1.id, { title: "F editada" }));

    // En G no hay nada que deshacer aunque el usuario lo haya hecho en F.
    expectFail(await undoLast(g.project.id), NOTHING);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: t1.id } })).title, "F editada");
    assert.equal(await db.undoEntry.count({ where: { userId: user.id, projectId: f.project.id } }), 1);

    // Una entrada de F nunca se aplica con projectId de G: las operaciones se filtran por proyecto.
    const entry = await db.undoEntry.findFirstOrThrow({ where: { projectId: f.project.id } });
    const { applyUndo } = await import("../../src/lib/undo");
    const skipped = await applyUndo(g.project.id, entry.ops as never);
    assert.equal(skipped, 1);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: t1.id } })).title, "F editada");
  });

  test("si la tarea la borró otra persona, deshacer se salta esa parte sin fallar", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { title: "Se va" });
    expectOk(await updateTask(task.id, { title: "Editada" }));
    const other = await makeUser();
    await assign(f, other);
    await loginAs(other);
    expectOk(await deleteTask(task.id));

    const author = await db.undoEntry.findFirstOrThrow({ where: { projectId: f.project.id, NOT: { userId: other.id } } });
    await loginAs({ id: author.userId });
    const res = expectOk(await undoLast(f.project.id));
    assert.equal(res.skipped, 1);
    assert.equal(await db.task.count({ where: { id: task.id } }), 0);
  });

  test("si la tarea ya existe, restaurarla es una operación omitida (no duplica)", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { title: "Reaparece" });
    expectOk(await deleteTask(task.id));
    // Alguien la recrea con el mismo id antes de deshacer.
    await db.task.create({ data: { id: task.id, projectId: f.project.id, columnId: f.columns.todo, title: "Recreada", kindId: f.kindId, position: 1 } });
    const res = expectOk(await undoLast(f.project.id));
    assert.equal(res.skipped, 1);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Recreada");
  });

  test("la columna de origen borrada entretanto: la tarea restaurada va a la primera columna", async () => {
    const { f } = await setup();
    const col = await db.column.create({ data: { projectId: f.project.id, name: "Efímera", position: 500 + 4000 } });
    const task = await makeTask(f, { columnId: col.id });
    expectOk(await deleteTask(task.id));
    await db.column.delete({ where: { id: col.id } });
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).columnId, f.columns.todo);
  });

  test("quien pierde el acceso al proyecto no puede deshacer en él", async () => {
    const owner = await makeUser();
    const friend = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner, members: [friend] });
    const task = await makeTask(f);
    await loginAs(friend);
    expectOk(await updateTask(task.id, { title: "Hecho por el amigo" }));
    await loginAs(owner);
    expectOk(await removeProjectMember(f.project.id, friend.id));
    await loginAs(friend);
    expectFail(await undoLast(f.project.id), NOT_FOUND);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Hecho por el amigo");
  });

  test("solo se conservan las 10 últimas entradas por usuario y proyecto", async () => {
    const { user, f } = await setup();
    const task = await makeTask(f);
    for (let i = 0; i < 12; i++) expectOk(await updateTask(task.id, { title: `v${i}` }));
    assert.equal(await db.undoEntry.count({ where: { userId: user.id, projectId: f.project.id } }), 10);
  });
});
