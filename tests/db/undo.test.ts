// Deshacer (undoLast) de punta a punta contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assign, db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND, expectApplied } from "./helpers";
import { addComment, archiveTask, createTask, deleteComment, deleteTask, deleteTasks, moveTask, updateTask } from "../../src/actions/tasks";
import { redoChecked, undoChecked, undoLast } from "../../src/actions/undo";
import { removeProjectMember } from "../../src/actions/projects";
import { applyUndo, fingerprintsOf, snapshotTasks, taskUpdateData, type UndoOp } from "../../src/lib/undo";

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

  // updateTask solo lee la descripción (hasta 20 KB) si se edita: el deshacer de otro campo no la lleva.
  test("editar solo el título no guarda la descripción en el deshacer; editarla sí, y deshacer la devuelve", async () => {
    const { user, f } = await setup();
    const task = await makeTask(f, { title: "Original" });
    await db.task.update({ where: { id: task.id }, data: { description: "texto largo ".repeat(500) }, select: { id: true } });
    const lastOps = async () => (await db.undoEntry.findFirstOrThrow({ where: { userId: user.id, projectId: f.project.id }, orderBy: { createdAt: "desc" }, select: { ops: true } })).ops as { t: string; data?: Record<string, unknown> }[];

    expectOk(await updateTask(task.id, { title: "Cambiado" }));
    assert.deepEqual(Object.keys((await lastOps())[0]!.data!).sort(), ["contentUpdatedAt", "contentUpdatedById", "title"]);
    expectOk(await updateTask(task.id, { description: "nueva" }));
    assert.equal((await lastOps())[0]!.data!.description, "texto largo ".repeat(500));

    expectOk(await undoLast(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).description, "texto largo ".repeat(500));
    expectOk(await undoLast(f.project.id));
    const back = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.deepEqual([back.title, back.description], ["Original", "texto largo ".repeat(500)]);
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

  test("archivar una repetida ya terminada cuya siguiente aparición se borró: no vuelve a nacer", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { recurrence: "WEEKLY", dueDate: new Date("2026-01-10T00:00:00Z") });
    const [next] = expectOk(await moveTask(task.id, f.columns.done, null, null)).spawned;
    expectOk(await deleteTask(next!.id));
    assert.equal(expectOk(await archiveTask(task.id)).spawned.length, 0);
    assert.equal(await db.task.count({ where: { projectId: f.project.id, archivedAt: null } }), 0);
  });

  test("borrar una repetida que ya tiene siguiente: deshacer (y rehacer y deshacer) le devuelve la serie, sin duplicarla", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { recurrence: "WEEKLY", dueDate: new Date("2026-01-10T00:00:00Z") });
    const [next] = expectOk(await moveTask(task.id, f.columns.done, null, null)).spawned;
    assert.ok(next);
    const nextId = next.id;
    const fromOf = async () => (await db.task.findUniqueOrThrow({ where: { id: nextId }, select: { recurrenceFromId: true } })).recurrenceFromId;
    expectOk(await deleteTask(task.id));
    assert.equal(await fromOf(), null);
    assert.equal(expectOk(await undoLast(f.project.id)).skipped, 0);
    assert.equal(await fromOf(), task.id);
    expectApplied(await redoChecked(f.project.id));
    assert.equal(expectOk(await undoLast(f.project.id)).skipped, 0);
    assert.equal(await fromOf(), task.id);
    // Archivarla ya no crea otra siguiente aparición.
    assert.equal(expectOk(await archiveTask(task.id)).spawned.length, 0);
    assert.equal(await db.task.count({ where: { projectId: f.project.id, recurrence: "WEEKLY" } }), 2);
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

describe("rehacer", () => {
  const NOTHING_REDO = /No hay nada que rehacer/;
  const title = async (id: string) => (await db.task.findUniqueOrThrow({ where: { id } })).title;

  test("los cambios propios no bloquean deshacer lo rehecho", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { title: "A" });
    expectOk(await updateTask(task.id, { title: "B" }));
    expectOk(await undoLast(f.project.id));
    expectApplied(await redoChecked(f.project.id));
    assert.equal(await title(task.id), "B");
    // Otra acción propia sobre la misma tarea y su deshacer: el estado vuelve a «B» y la entrada anterior sigue valiendo.
    expectOk(await updateTask(task.id, { title: "C" }));
    expectOk(await undoLast(f.project.id));
    assert.equal(await title(task.id), "B");
    expectOk(await undoLast(f.project.id));
    assert.equal(await title(task.id), "A");
  });

  test("deshacer y rehacer restauran el estado de antes de deshacer", async () => {
    const { f } = await setup();
    const label = await db.label.create({ data: { projectId: f.project.id, name: "R1", color: "blue" } });
    const task = await makeTask(f, { title: "Original" });
    expectFail(await redoChecked(f.project.id), NOTHING_REDO);
    expectOk(await updateTask(task.id, { title: "Cambiado", labelIds: [label.id] }));
    expectOk(await undoLast(f.project.id));
    assert.equal(await title(task.id), "Original");
    assert.equal(await db.taskLabel.count({ where: { taskId: task.id } }), 0);

    const res = expectApplied(await redoChecked(f.project.id));
    assert.equal(res.skipped, 0);
    assert.equal(await title(task.id), "Cambiado");
    assert.equal(await db.taskLabel.count({ where: { taskId: task.id } }), 1);
    expectFail(await redoChecked(f.project.id), NOTHING_REDO);
  });

  test("alterna deshacer, rehacer y deshacer", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { title: "A" });
    expectOk(await updateTask(task.id, { title: "B" }));
    for (let i = 0; i < 3; i++) {
      expectOk(await undoLast(f.project.id));
      assert.equal(await title(task.id), "A");
      expectApplied(await redoChecked(f.project.id));
      assert.equal(await title(task.id), "B");
    }
    expectOk(await undoLast(f.project.id));
    assert.equal(await title(task.id), "A");
    expectFail(await undoLast(f.project.id), NOTHING);
  });

  test("varias acciones: rehace en el orden en que se deshicieron", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { title: "v0" });
    for (const n of ["v1", "v2", "v3"]) expectOk(await updateTask(task.id, { title: n }));
    expectOk(await undoLast(f.project.id));
    expectOk(await undoLast(f.project.id));
    assert.equal(await title(task.id), "v1");
    expectApplied(await redoChecked(f.project.id));
    assert.equal(await title(task.id), "v2");
    expectApplied(await redoChecked(f.project.id));
    assert.equal(await title(task.id), "v3");
  });

  test("una acción nueva vacía la pila de rehacer", async () => {
    const { user, f } = await setup();
    const task = await makeTask(f, { title: "A" });
    expectOk(await updateTask(task.id, { title: "B" }));
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.undoEntry.count({ where: { userId: user.id, kind: "REDO" } }), 1);
    expectOk(await updateTask(task.id, { title: "C" }));
    assert.equal(await db.undoEntry.count({ where: { userId: user.id, kind: "REDO" } }), 0);
    expectFail(await redoChecked(f.project.id), NOTHING_REDO);
    assert.equal(await title(task.id), "C");
  });

  test("rehacer borrar y crear: borra y vuelve a crear con sus hijos", async () => {
    const { user, f } = await setup();
    const created = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "Nueva", kindId: f.kindId, subtasks: ["uno", "dos"] }));
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.task.count({ where: { id: created.id } }), 0);
    expectApplied(await redoChecked(f.project.id));
    const back = await db.task.findUniqueOrThrow({ where: { id: created.id }, include: { subtasks: true } });
    assert.equal(back.subtasks.length, 2);

    // Borrar → deshacer → rehacer (vuelve a borrar) → deshacer otra vez.
    const task = await makeTask(f, { title: "A borrar", subtasks: ["s1"], createdById: user.id });
    await db.taskComment.create({ data: { taskId: task.id, authorId: user.id, body: "c" } });
    expectOk(await deleteTask(task.id));
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.task.count({ where: { id: task.id } }), 1);
    expectApplied(await redoChecked(f.project.id));
    assert.equal(await db.task.count({ where: { id: task.id } }), 0);
    expectOk(await undoLast(f.project.id));
    const again = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { subtasks: true, comments: true } });
    assert.equal(again.subtasks.length, 1);
    assert.equal(again.comments.length, 1);
  });

  test("comentarios y movimientos se rehacen", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { position: 1000 });
    const c = expectOk(await addComment(task.id, "hola"));
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.taskComment.count({ where: { id: c.id } }), 0);
    expectApplied(await redoChecked(f.project.id));
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: c.id } })).body, "hola");

    expectOk(await moveTask(task.id, f.columns.doing, null, null));
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).columnId, f.columns.todo);
    expectApplied(await redoChecked(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).columnId, f.columns.doing);
  });

  test("con una tarea abierta rehace solo las de esa tarea", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "A" });
    const b = await makeTask(f, { title: "B" });
    expectOk(await updateTask(a.id, { title: "A1" }));
    expectOk(await updateTask(b.id, { title: "B1" }));
    expectOk(await undoLast(f.project.id));
    expectOk(await undoLast(f.project.id));
    // Contexto de B: rehace lo de B, no lo de A.
    expectApplied(await redoChecked(f.project.id, b.id));
    assert.equal(await title(b.id), "B1");
    assert.equal(await title(a.id), "A");
    expectFail(await redoChecked(f.project.id, b.id), /nada que rehacer en esta tarea/);
    // Sin contexto: lo que queda del tablero.
    expectApplied(await redoChecked(f.project.id));
    assert.equal(await title(a.id), "A1");
  });

  test("la pila de rehacer es de cada usuario y proyecto, y guarda 10", async () => {
    const { user, f } = await setup();
    const g = await makeProject();
    const task = await makeTask(f, { title: "A" });
    expectOk(await updateTask(task.id, { title: "B" }));
    expectOk(await undoLast(f.project.id));

    // Otro proyecto y otra persona no ven este rehacer.
    expectFail(await redoChecked(g.project.id), NOTHING_REDO);
    const second = await makeUser();
    await assign(f, second);
    await loginAs(second);
    expectFail(await redoChecked(f.project.id), NOTHING_REDO);
    // Una acción nueva de otra persona no vacía la pila del primero.
    const other = await makeTask(f, { title: "X" });
    expectOk(await updateTask(other.id, { title: "Y" }));
    await loginAs(user);
    expectApplied(await redoChecked(f.project.id));
    assert.equal(await title(task.id), "B");

    const t2 = await makeTask(f);
    for (let i = 0; i < 10; i++) expectOk(await updateTask(t2.id, { title: `n${i}` }));
    for (let i = 0; i < 10; i++) expectOk(await undoLast(f.project.id));
    assert.equal(await db.undoEntry.count({ where: { userId: user.id, projectId: f.project.id, kind: "REDO" } }), 10);
  });

  // Rehacer (botón y Ctrl+Y, redoChecked) no descarta la entrada si otra persona cambió lo mismo: pregunta antes.
  const ASKS_GENERIC = /^Otra persona ha cambiado esto después\. /;
  const BLOCKED_UNDO = /Otra persona ha cambiado esto después de rehacerlo: no se puede deshacer/;
  const redoStack = (userId: string, projectId: string, kind: "UNDO" | "REDO") => db.undoEntry.count({ where: { userId, projectId, kind } });

  test("si otra persona edita la tarea tras deshacer, rehacer pregunta antes y, sin confirmar, no aplica nada", async () => {
    const { user, f } = await setup();
    const task = await makeTask(f, { title: "A" });
    expectOk(await updateTask(task.id, { title: "B" }));
    expectOk(await undoLast(f.project.id));
    const second = await makeUser();
    await assign(f, second);
    await loginAs(second);
    expectOk(await updateTask(task.id, { title: "De otra persona" }));
    await loginAs(user);
    assert.match(expectOk(await redoChecked(f.project.id)).conflict?.message ?? "", /cambió esta tarea después/);
    assert.equal(await title(task.id), "De otra persona");
    assert.equal(await redoStack(user.id, f.project.id, "REDO"), 1, "sin confirmar, la entrada sigue en la pila");
  });

  test("un comentario ajeno tras deshacer también hace preguntar antes de rehacer (no toca Task.updatedAt)", async () => {
    const { user, f } = await setup();
    const task = await makeTask(f, { title: "A" });
    expectOk(await updateTask(task.id, { title: "B" }));
    expectOk(await undoLast(f.project.id));
    await db.taskComment.create({ data: { taskId: task.id, authorId: null, body: "ajeno" } });
    // Sin autor ni historial: lo delata la huella de la entrada.
    assert.match(expectOk(await redoChecked(f.project.id)).conflict?.message ?? "", ASKS_GENERIC);
    assert.equal(await title(task.id), "A");
    assert.equal(await redoStack(user.id, f.project.id, "REDO"), 1);
  });

  test("sin interferencias rehacer funciona; cambios en otra tarea no molestan", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { title: "A" });
    const other = await makeTask(f, { title: "X" });
    expectOk(await updateTask(task.id, { title: "B" }));
    expectOk(await undoLast(f.project.id));
    await db.task.update({ where: { id: other.id }, data: { title: "Y" } });
    expectApplied(await redoChecked(f.project.id));
    assert.equal(await title(task.id), "B");
  });

  test("varias entradas sobre la misma tarea se rehacen en cadena sin bloquearse a sí mismas", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { title: "A" });
    expectOk(await updateTask(task.id, { title: "B" }));
    expectOk(await updateTask(task.id, { title: "C" }));
    expectOk(await undoLast(f.project.id));
    expectOk(await undoLast(f.project.id));
    expectApplied(await redoChecked(f.project.id));
    expectApplied(await redoChecked(f.project.id));
    assert.equal(await title(task.id), "C");
  });

  test("deshacer tras rehacer: se rechaza si otra persona cambió algo, y funciona si no", async () => {
    const { user, f } = await setup();
    const task = await makeTask(f, { title: "A" });
    expectOk(await updateTask(task.id, { title: "B" }));
    expectOk(await undoLast(f.project.id));
    expectApplied(await redoChecked(f.project.id));
    // Sin interferencias: el deshacer resultante funciona.
    expectOk(await undoLast(f.project.id));
    assert.equal(await title(task.id), "A");
    expectApplied(await redoChecked(f.project.id));
    // Ahora otra persona edita y el deshacer de esa entrada se bloquea.
    const second = await makeUser();
    await assign(f, second);
    await loginAs(second);
    expectOk(await updateTask(task.id, { title: "Ajena" }));
    await loginAs(user);
    expectFail(await undoLast(f.project.id), BLOCKED_UNDO);
    assert.equal(await title(task.id), "Ajena");
    assert.equal(await redoStack(user.id, f.project.id, "UNDO"), 0);
  });

  test("si la tarea ya no existe al rehacer, se pregunta como ante un cambio ajeno", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { title: "A" });
    expectOk(await updateTask(task.id, { title: "B" }));
    expectOk(await undoLast(f.project.id));
    await db.task.delete({ where: { id: task.id } });
    assert.match(expectOk(await redoChecked(f.project.id)).conflict?.message ?? "", ASKS_GENERIC);
    assert.equal(await db.task.count({ where: { id: task.id } }), 0);
  });
});

describe("bloqueos entre tareas que vuelven juntas", () => {
  const blockerOf = async (id: string) => (await db.task.findUniqueOrThrow({ where: { id }, select: { blockedById: true } })).blockedById;

  test("borrar varias con una que bloquea a otra: deshacer, rehacer y volver a deshacer conserva el bloqueo", async () => {
    const { f } = await setup();
    // En los dos órdenes de creación: la que bloquea antes y después de la bloqueada.
    const a = await makeTask(f, { title: "Bloquea", position: 1000 });
    const b = await makeTask(f, { title: "Bloqueada", position: 2000 });
    const c = await makeTask(f, { title: "Bloqueada antes", position: 3000 });
    const d = await makeTask(f, { title: "Bloquea después", position: 4000 });
    const outside = await makeTask(f, { title: "Fuera", position: 5000 });
    await db.task.update({ where: { id: b.id }, data: { blockedById: a.id } });
    await db.task.update({ where: { id: c.id }, data: { blockedById: d.id } });
    await db.task.update({ where: { id: outside.id }, data: { blockedById: a.id } });
    const ids = [a.id, b.id, c.id, d.id];
    const check = async () => {
      assert.equal(await blockerOf(b.id), a.id);
      assert.equal(await blockerOf(c.id), d.id);
      assert.equal(await blockerOf(outside.id), a.id);
    };
    expectOk(await deleteTasks(ids));
    assert.equal(await blockerOf(outside.id), null);
    assert.equal(expectOk(await undoLast(f.project.id)).skipped, 0);
    await check();
    expectApplied(await redoChecked(f.project.id));
    assert.equal(await db.task.count({ where: { id: { in: ids } } }), 0);
    // La entrada de este segundo deshacer sale de mirrorOps: solo trae las tareas, sin operaciones de bloqueo.
    assert.equal(expectOk(await undoLast(f.project.id)).skipped, 0);
    await check();
    expectApplied(await redoChecked(f.project.id));
    expectOk(await undoLast(f.project.id));
    await check();
  });

  test("task.restore en cualquier orden: la bloqueada espera a que vuelva la que la bloquea", async () => {
    const { f } = await setup();
    for (const batch of [true, false]) {
      const tasks = [];
      for (let i = 0; i < 6; i++) tasks.push(await makeTask(f, { title: `O${i}`, position: (i + 1) * 1000 }));
      const [a, b, c] = tasks as [typeof tasks[0], typeof tasks[0], typeof tasks[0]];
      // Cadena c → b → a, y un ciclo imposible de restaurar entero no debe aparecer.
      await db.task.update({ where: { id: b.id }, data: { blockedById: a.id } });
      await db.task.update({ where: { id: c.id }, data: { blockedById: b.id } });
      const ids = tasks.map((t) => t.id);
      const ops = await snapshotTasks(ids);
      // snapshotTasks devuelve las tareas en el orden pedido (determinista).
      assert.deepEqual(ops.map((op) => (op.t === "task.restore" ? op.snap.task.id : "")), ids);
      for (const order of [ops, [...ops].reverse()]) {
        await db.task.deleteMany({ where: { id: { in: ids } } });
        assert.equal(await applyUndo(f.project.id, order, { batch, keepFiles: true }), 0);
        assert.equal(await blockerOf(b.id), a.id);
        assert.equal(await blockerOf(c.id), b.id);
        assert.equal(await blockerOf(a.id), null);
      }
      await db.task.deleteMany({ where: { id: { in: ids } } });
    }
  });
});

describe("dependencias que otra persona puso en una tarea que se quita al deshacer", () => {
  const blockerOf = async (id: string) => (await db.task.findUniqueOrThrow({ where: { id }, select: { blockedById: true } })).blockedById;
  async function pair() {
    const u1 = await makeUser({ name: "Persona Uno" });
    const u2 = await makeUser({ name: "Persona Dos" });
    const f = await makeProject({ members: [u1, u2] });
    const y = await makeTask(f, { title: "Y", position: 5000 });
    return { u1, u2, f, y };
  }
  /** U1 crea X, U2 hace que Y dependa de X y U1 deshace la creación (X se borra y Y pierde la dependencia). */
  async function createDependUndo() {
    const p = await pair();
    await loginAs(p.u1);
    const x = expectOk(await createTask({ projectId: p.f.project.id, columnId: p.f.columns.todo, title: "X", kindId: p.f.kindId }));
    await loginAs(p.u2);
    expectOk(await updateTask(p.y.id, { blockedById: x.id }));
    await loginAs(p.u1);
    expectOk(await undoLast(p.f.project.id));
    assert.equal(await db.task.count({ where: { id: x.id } }), 0);
    assert.equal(await blockerOf(p.y.id), null);
    return { ...p, x };
  }

  test("U1 crea X, U2 hace que Y dependa de X, U1 deshace y rehace: Y vuelve a depender de X (también en cadena)", async () => {
    const { f, x, y } = await createDependUndo();
    const redo = expectOk(await redoChecked(f.project.id));
    assert.equal(redo.conflict, undefined);
    assert.equal(redo.applied?.skipped, 0);
    assert.equal(await db.task.count({ where: { id: x.id } }), 1);
    assert.equal(await blockerOf(y.id), x.id);
    // Deshacer y rehacer otra vez: las entradas que salen de mirrorOps siguen llevando la dependencia.
    assert.equal(expectOk(await undoChecked(f.project.id)).conflict, undefined);
    assert.equal(await blockerOf(y.id), null);
    assert.equal(expectOk(await redoChecked(f.project.id)).conflict, undefined);
    assert.equal(await blockerOf(y.id), x.id);
  });

  test("si entretanto Y pasó a depender de otra, rehacer lo delata (huella) y, aunque se confirme, no lo pisa", async () => {
    for (const confirm of [false, true]) {
      const { u1, u2, f, x, y } = await createDependUndo();
      const z = await makeTask(f, { title: "Z" });
      await loginAs(u2);
      expectOk(await updateTask(y.id, { blockedById: z.id }));
      await loginAs(u1);
      if (!confirm) {
        // Sin confirmar: la huella de la entrada de rehacer cubre el bloqueo de Y (ya no coincide) y no se aplica nada.
        const entry = await db.undoEntry.findFirstOrThrow({ where: { userId: u1.id, projectId: f.project.id, kind: "REDO" }, orderBy: { createdAt: "desc" } });
        assert.ok(entry.fingerprint);
        assert.notEqual((await fingerprintsOf(f.project.id, [{ ops: entry.ops as unknown as UndoOp[] }]))[0], entry.fingerprint);
        assert.match(expectOk(await redoChecked(f.project.id)).conflict?.message ?? "", /Persona Dos cambió/);
        assert.equal(await db.task.count({ where: { id: x.id } }), 0);
      } else {
        const res = expectOk(await redoChecked(f.project.id));
        assert.match(res.conflict?.message ?? "", /Persona Dos cambió/);
        expectOk(await redoChecked(f.project.id, null, res.conflict!.entryId));
        assert.equal(await db.task.count({ where: { id: x.id } }), 1);
      }
      assert.equal(await blockerOf(y.id), z.id);
    }
  });

  test("si volver a depender de X cerraría un ciclo, X vuelve y Y se queda sin dependencia", async () => {
    const p = await pair();
    const w = await makeTask(p.f, { title: "W" });
    await loginAs(p.u1);
    const x = expectOk(await createTask({ projectId: p.f.project.id, columnId: p.f.columns.todo, title: "X", kindId: p.f.kindId }));
    expectOk(await updateTask(x.id, { blockedById: w.id }));
    await loginAs(p.u2);
    expectOk(await updateTask(p.y.id, { blockedById: x.id }));
    await loginAs(p.u1);
    expectOk(await undoLast(p.f.project.id)); // el bloqueo de X por W
    expectOk(await undoLast(p.f.project.id)); // la creación de X
    // Rehacer la creación primero: después, W pasa a depender de Y (X no existe: no hay ciclo).
    expectApplied(await redoChecked(p.f.project.id));
    assert.equal(await blockerOf(p.y.id), x.id);
    expectOk(await undoLast(p.f.project.id));
    await loginAs(p.u2);
    expectOk(await updateTask(w.id, { blockedById: p.y.id }));
    await loginAs(p.u1);
    // W no está en la entrada (su cambio no cuenta como conflicto). X vuelve sin bloqueo (aún no se ha rehecho el de W);
    // Y → X no cierra ciclo todavía: Y vuelve a depender de X.
    expectApplied(await redoChecked(p.f.project.id));
    assert.equal(await blockerOf(p.y.id), x.id);
    // Rehacer «X depende de W» cerraría X → W → Y → X: no se pone.
    expectApplied(await redoChecked(p.f.project.id));
    assert.equal(await blockerOf(x.id), null);
    // Y al revés: X ya depende de W (vuelve en su instantánea) y Y → X cerraría el ciclo.
    await db.task.update({ where: { id: x.id }, data: { blockedById: w.id } });
    await db.task.update({ where: { id: w.id }, data: { blockedById: null } });
    await db.task.update({ where: { id: p.y.id }, data: { blockedById: x.id } });
    expectOk(await deleteTask(x.id));
    assert.equal(await blockerOf(p.y.id), null);
    await db.task.update({ where: { id: w.id }, data: { blockedById: p.y.id } });
    const res = expectOk(await undoLast(p.f.project.id));
    assert.equal(res.skipped, 0);
    assert.equal(await blockerOf(x.id), w.id);
    assert.equal(await blockerOf(p.y.id), null, "Y → X cerraría Y → X → W → Y");
  });

  test("borrar X con Ctrl+Z: si Y pasó a depender de otra, deshacer no lo pisa; si no, se lo devuelve", async () => {
    const { u1, u2, f, y } = await pair();
    const x = await makeTask(f, { title: "X" });
    const z = await makeTask(f, { title: "Z" });
    const v = await makeTask(f, { title: "V" });
    await db.task.update({ where: { id: y.id }, data: { blockedById: x.id } });
    await db.task.update({ where: { id: v.id }, data: { blockedById: x.id } });
    await loginAs(u1);
    expectOk(await deleteTask(x.id));
    await loginAs(u2);
    expectOk(await updateTask(y.id, { blockedById: z.id }));
    await loginAs(u1);
    const res = expectOk(await undoChecked(f.project.id));
    assert.ok(res.conflict, "el cambio de U2 en Y se pregunta");
    expectOk(await undoChecked(f.project.id, null, res.conflict.entryId));
    assert.equal(await db.task.count({ where: { id: x.id } }), 1);
    assert.equal(await blockerOf(y.id), z.id);
    assert.equal(await blockerOf(v.id), x.id);
  });
});

describe("entradas guardadas por versiones anteriores", () => {
  test("taskUpdateData ignora campos desconocidos de entradas antiguas", () => {
    const data = taskUpdateData({ title: "x", externalUrl: "https://example.com", loQueSea: 1 } as never) as Record<string, unknown>;
    assert.deepEqual(data, { title: "x" });
  });
});

describe("comentarios importados (sin usuario en Pizarro)", () => {
  test("deshacer y rehacer conservan el nombre del autor", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject();
    const task = await makeTask(f);
    const imported = await db.taskComment.create({ data: { taskId: task.id, authorId: null, authorName: "Persona de otra herramienta", body: "importado" } });
    await loginAs(admin);
    expectOk(await deleteComment(imported.id));
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: imported.id } })).authorName, "Persona de otra herramienta");
    expectApplied(await redoChecked(f.project.id));
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: imported.id } })).authorName, "Persona de otra herramienta");

    // Con la tarea entera: borrar y deshacer.
    expectOk(await deleteTask(task.id));
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: imported.id } })).authorName, "Persona de otra herramienta");
  });
});
