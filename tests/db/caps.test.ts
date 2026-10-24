// Topes por proyecto (etiquetas, entregables, tareas activas) y tareas archivadas de solo lectura.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, type Fixture } from "./helpers";
import {
  addComment, addSubtask, archiveTask, createTask, createTasks, deleteComment, deleteSubtask, deleteTask, duplicateTask,
  moveTask, reorderSubtask, restoreTask, updateSubtask,
} from "../../src/actions/tasks";
import { createDeliverable, createLabel } from "../../src/actions/projects";
import { undoLast } from "../../src/actions/undo";
import { MAX_ACTIVE_TASKS_PER_PROJECT, MAX_DELIVERABLES_PER_PROJECT, MAX_LABELS_PER_PROJECT } from "../../src/lib/constants";

async function setup() {
  const user = await makeUser();
  const f = await makeProject();
  await loginAs(user);
  return { user, f };
}

/** Rellena el proyecto con tareas activas directamente en la BD hasta `total` (cuenta las que ya tiene). */
async function fillTasks(f: Fixture, total = MAX_ACTIVE_TASKS_PER_PROJECT) {
  const have = await db.task.count({ where: { projectId: f.project.id, archivedAt: null } });
  await db.task.createMany({
    data: Array.from({ length: total - have }, (_, i) => ({
      projectId: f.project.id, columnId: f.columns.doing, kindId: f.kindId, title: `Relleno ${i}`, position: (i + 1) * 1000,
    })),
  });
}

const TASK_CAP = /máximo de 1000 tareas activas/;

describe("tope de etiquetas", () => {
  test("la etiqueta 51 se rechaza con el límite en el mensaje; otro proyecto no se ve afectado", async () => {
    const { f } = await setup();
    await db.label.createMany({ data: Array.from({ length: MAX_LABELS_PER_PROJECT }, (_, i) => ({ projectId: f.project.id, name: `L${i}`, color: "#64748b" })) });
    expectFail(await createLabel(f.project.id, { name: "una más", color: "#64748b" }), /máximo de 50 etiquetas/);
    assert.equal(await db.label.count({ where: { projectId: f.project.id } }), MAX_LABELS_PER_PROJECT);
    const other = await makeProject();
    expectOk(await createLabel(other.project.id, { name: "ok", color: "#64748b" }));
  });

  test("con 49 todavía cabe la última", async () => {
    const { f } = await setup();
    await db.label.createMany({ data: Array.from({ length: MAX_LABELS_PER_PROJECT - 1 }, (_, i) => ({ projectId: f.project.id, name: `L${i}`, color: "#64748b" })) });
    expectOk(await createLabel(f.project.id, { name: "la 50", color: "#64748b" }));
    expectFail(await createLabel(f.project.id, { name: "la 51", color: "#64748b" }), /máximo de 50 etiquetas/);
  });
});

describe("tope de entregables", () => {
  test("el entregable 101 se rechaza", async () => {
    const { f } = await setup();
    await db.deliverable.createMany({ data: Array.from({ length: MAX_DELIVERABLES_PER_PROJECT }, (_, i) => ({ projectId: f.project.id, name: `E${i}`, position: (i + 1) * 1000 })) });
    expectFail(await createDeliverable(f.project.id, { name: "uno más" }), /máximo de 100 entregables/);
    assert.equal(await db.deliverable.count({ where: { projectId: f.project.id } }), MAX_DELIVERABLES_PER_PROJECT);
  });
});

describe("tope de tareas activas", () => {
  test("createTask y duplicateTask se rechazan en el tope", async () => {
    const { f } = await setup();
    await fillTasks(f);
    const base = await db.task.findFirstOrThrow({ where: { projectId: f.project.id } });
    expectFail(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "Nueva", kindId: f.kindId }), TASK_CAP);
    expectFail(await duplicateTask(base.id), TASK_CAP);
    assert.equal(await db.task.count({ where: { projectId: f.project.id } }), MAX_ACTIVE_TASKS_PER_PROJECT);
  });

  test("las archivadas no cuentan para el tope", async () => {
    const { f } = await setup();
    await fillTasks(f);
    const first = await db.task.findFirstOrThrow({ where: { projectId: f.project.id } });
    expectOk(await archiveTask(first.id));
    expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "Cabe", kindId: f.kindId }));
  });

  test("createTasks: si el lote no cabe, no se crea ninguna (y si cabe justo, sí)", async () => {
    const { f } = await setup();
    await fillTasks(f, MAX_ACTIVE_TASKS_PER_PROJECT - 3);
    const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Línea ${i}`, kindId: f.kindId }));
    expectFail(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, tasks: lines(4) }), /no caben 4 más/);
    assert.equal(await db.task.count({ where: { projectId: f.project.id } }), MAX_ACTIVE_TASKS_PER_PROJECT - 3);
    expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, tasks: lines(3) }));
    assert.equal(await db.task.count({ where: { projectId: f.project.id } }), MAX_ACTIVE_TASKS_PER_PROJECT);
    expectFail(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, tasks: lines(1) }), TASK_CAP);
  });

  test("restoreTask en el tope falla con un mensaje claro y la tarea sigue archivada", async () => {
    const { f } = await setup();
    const task = await makeTask(f);
    expectOk(await archiveTask(task.id));
    await fillTasks(f);
    expectFail(await restoreTask(task.id), TASK_CAP);
    assert.ok((await db.task.findUniqueOrThrow({ where: { id: task.id } })).archivedAt);
    // Al hacer sitio, se recupera.
    await db.task.delete({ where: { id: (await db.task.findFirstOrThrow({ where: { projectId: f.project.id, archivedAt: null } })).id } });
    expectOk(await restoreTask(task.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).archivedAt, null);
  });

  test("deshacer un borrado o un archivado en el tope falla y conserva la entrada", async () => {
    const { f } = await setup();
    const a = await makeTask(f);
    const b = await makeTask(f);
    expectOk(await deleteTask(a.id));
    expectOk(await archiveTask(b.id));
    await fillTasks(f);
    // Última acción: archivar b → deshacer la desarchiva.
    expectFail(await undoLast(f.project.id), TASK_CAP);
    assert.ok((await db.task.findUniqueOrThrow({ where: { id: b.id } })).archivedAt);
    await db.task.delete({ where: { id: (await db.task.findFirstOrThrow({ where: { projectId: f.project.id, archivedAt: null } })).id } });
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: b.id } })).archivedAt, null);
    // Siguiente: borrar a → deshacer la recrea, pero otra vez estamos en el tope.
    expectFail(await undoLast(f.project.id), TASK_CAP);
    assert.equal(await db.task.count({ where: { id: a.id } }), 0);
  });

  test("la repetición no crea la siguiente aparición en el tope, pero mover la tarjeta no falla", async () => {
    const { f } = await setup();
    const rec = await makeTask(f, { recurrence: "DAILY", dueDate: new Date("2026-10-01") });
    await fillTasks(f);
    const res = expectOk(await moveTask(rec.id, f.columns.done, null, null));
    assert.equal(res.spawned.length, 0);
    assert.equal(await db.task.count({ where: { projectId: f.project.id, recurrenceFromId: rec.id } }), 0);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: rec.id } })).columnId, f.columns.done);
  });
});

describe("tareas archivadas de solo lectura", () => {
  test("subtareas, comentarios y adjuntos se bloquean; recuperar y borrar siguen funcionando", async () => {
    const { user, f } = await setup();
    const task = await makeTask(f, { subtasks: ["uno"] });
    const sub = await db.subtask.findFirstOrThrow({ where: { taskId: task.id } });
    const comment = await db.taskComment.create({ data: { taskId: task.id, authorId: user.id, body: "hola" } });
    expectOk(await archiveTask(task.id));

    const ARCHIVED = /está archivada/;
    expectFail(await addSubtask(task.id, "dos"), ARCHIVED);
    expectFail(await updateSubtask(sub.id, { done: true }), ARCHIVED);
    expectFail(await reorderSubtask(sub.id, null, null), ARCHIVED);
    expectFail(await deleteSubtask(sub.id), ARCHIVED);
    expectFail(await addComment(task.id, "otro"), ARCHIVED);
    expectFail(await deleteComment(comment.id), ARCHIVED);
    assert.equal(await db.subtask.count({ where: { taskId: task.id } }), 1);
    assert.equal(await db.taskComment.count({ where: { taskId: task.id } }), 1);

    expectOk(await restoreTask(task.id));
    expectOk(await addSubtask(task.id, "dos"));
    expectOk(await addComment(task.id, "otro"));

    expectOk(await archiveTask(task.id));
    expectOk(await deleteTask(task.id));
  });
});
