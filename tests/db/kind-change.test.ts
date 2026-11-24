// Cambiar el tipo de una tarea desde el detalle (changeTaskKind): tipo, título, descripción y subtareas de la plantilla
// en una sola acción, con un solo «Deshacer».
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser, waitForLockWaiter } from "./helpers";
import { changeTaskKind } from "../../src/actions/tasks";
import { undoLast } from "../../src/actions/undo";

const subtasksOf = async (taskId: string) =>
  (await db.subtask.findMany({ where: { taskId }, orderBy: { position: "asc" }, select: { title: true, done: true } })).map((s) => `${s.done ? "x" : " "} ${s.title}`);

describe("cambiar de tipo en el detalle", () => {
  test("sustituye las subtareas sin tocar del tipo anterior y un deshacer lo devuelve todo", async () => {
    const me = await makeUser();
    const f = await makeProject({ members: [me] });
    await loginAs(me);
    await db.taskKind.update({ where: { id: f.kindId }, data: { subtaskTemplate: ["Pedir presupuesto", "Comparar", "Elegir"] } });
    const next = await db.taskKind.create({ data: { name: "Permiso", color: "#3b82f6", position: 2, projectId: f.project.id, subtaskTemplate: ["Solicitar permiso", "Pagar tasa"] } });
    const task = await makeTask(f, { title: "Presupuesto: baño", subtasks: ["Pedir presupuesto", "Comparar", "Elegir", "Llamar a Ana"] });
    await db.task.update({ where: { id: task.id }, data: { description: "Antes" } });
    await db.subtask.updateMany({ where: { taskId: task.id, title: "Pedir presupuesto" }, data: { done: true } });
    const undos = await db.undoEntry.count({ where: { projectId: f.project.id } });

    const res = expectOk(await changeTaskKind(task.id, { kindId: next.id, title: "Permiso: baño", description: "Después" }));
    assert.equal(res.kindId, next.id);
    assert.equal(res.title, "Permiso: baño");
    assert.equal(res.subtaskTotal, 4);
    assert.deepEqual([res.kindSubtasks?.removed, res.kindSubtasks?.added], [2, 2]);
    assert.ok(res.kindSubtasks?.undo.id);
    assert.deepEqual(res.kindSubtasks?.subtasks.map((s) => s.title), ["Pedir presupuesto", "Llamar a Ana", "Solicitar permiso", "Pagar tasa"]);
    // La marcada y la añadida a mano se quedan.
    assert.deepEqual(await subtasksOf(task.id), ["x Pedir presupuesto", "  Llamar a Ana", "  Solicitar permiso", "  Pagar tasa"]);
    assert.equal(await db.undoEntry.count({ where: { projectId: f.project.id } }), undos + 1);

    expectOk(await undoLast(f.project.id));
    const back = await db.task.findUniqueOrThrow({ where: { id: task.id }, select: { kindId: true, title: true, description: true } });
    assert.deepEqual(back, { kindId: f.kindId, title: "Presupuesto: baño", description: "Antes" });
    assert.deepEqual(await subtasksOf(task.id), ["x Pedir presupuesto", "  Comparar", "  Elegir", "  Llamar a Ana"]);
  });

  test("sin subtareas que cambiar (o el mismo tipo): no las toca ni avisa", async () => {
    const me = await makeUser();
    const f = await makeProject({ members: [me] });
    await loginAs(me);
    const plain = await db.taskKind.create({ data: { name: "Sin plantilla", color: "#3b82f6", position: 2, projectId: f.project.id } });
    const task = await makeTask(f, { subtasks: ["Mía"] });
    assert.equal(expectOk(await changeTaskKind(task.id, { kindId: plain.id })).kindSubtasks, undefined);
    assert.equal(expectOk(await changeTaskKind(task.id, { kindId: plain.id })).kindSubtasks, undefined);
    assert.deepEqual(await subtasksOf(task.id), ["  Mía"]);
  });

  test("solo añade o solo quita: lo dice por separado", async () => {
    const me = await makeUser();
    const f = await makeProject({ members: [me] });
    await loginAs(me);
    const plain = await db.taskKind.create({ data: { name: "Sin plantilla", color: "#3b82f6", position: 2, projectId: f.project.id } });
    const full = await db.taskKind.create({ data: { name: "Con plantilla", color: "#3b82f6", position: 3, projectId: f.project.id, subtaskTemplate: ["Uno", "Dos", "Tres"] } });
    const task = await makeTask(f, { subtasks: [] });
    expectOk(await changeTaskKind(task.id, { kindId: plain.id }));
    const added = expectOk(await changeTaskKind(task.id, { kindId: full.id })).kindSubtasks;
    assert.deepEqual([added?.removed, added?.added], [0, 3]);
    const removed = expectOk(await changeTaskKind(task.id, { kindId: plain.id })).kindSubtasks;
    assert.deepEqual([removed?.removed, removed?.added], [3, 0]);
  });

  test("el título largo recortado lo avisa (titleClipped)", async () => {
    const me = await makeUser();
    const f = await makeProject({ members: [me] });
    await loginAs(me);
    const other = await db.taskKind.create({ data: { name: "Otro", color: "#3b82f6", position: 2, projectId: f.project.id } });
    const task = await makeTask(f);
    const res = expectOk(await changeTaskKind(task.id, { kindId: other.id, title: "x".repeat(400) }));
    assert.ok(res.titleClipped);
  });
});

describe("cambiar de tipo mientras otra persona toca la tarea", () => {
  async function setup() {
    const me = await makeUser();
    const f = await makeProject({ members: [me] });
    await loginAs(me);
    await db.taskKind.update({ where: { id: f.kindId }, data: { subtaskTemplate: ["Pedir", "Revisar"] } });
    const b = await db.taskKind.create({ data: { name: "B", color: "#3b82f6", position: 2, projectId: f.project.id, subtaskTemplate: ["De B"] } });
    const c = await db.taskKind.create({ data: { name: "C", color: "#3b82f6", position: 3, projectId: f.project.id, subtaskTemplate: ["De C"] } });
    const task = await makeTask(f, { subtasks: ["Pedir", "Revisar"] });
    return { f, b, c, task };
  }

  test("una subtarea que otra persona marca a la vez no se borra", async () => {
    const { b, task } = await setup();
    let pending: ReturnType<typeof changeTaskKind> | null = null;
    await db.$transaction(async (tx) => {
      await tx.subtask.updateMany({ where: { taskId: task.id, title: "Revisar" }, data: { done: true } });
      pending = changeTaskKind(task.id, { kindId: b.id });
      await waitForLockWaiter();
    }, { timeout: 10_000 });
    const res = expectOk(await pending!);
    assert.deepEqual([res.kindSubtasks?.removed, res.kindSubtasks?.added], [1, 1]);
    assert.deepEqual(await subtasksOf(task.id), ["x Revisar", "  De B"]);
  });

  test("dos cambios de tipo seguidos: el segundo quita las subtareas del primero, no las mezcla", async () => {
    const { f, b, c, task } = await setup();
    let pending: ReturnType<typeof changeTaskKind> | null = null;
    // La primera petición (A → B) sigue sin confirmar cuando la segunda (B → C) ya ha leído la tarea con el tipo A.
    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: task.id }, data: { kindId: b.id }, select: { id: true } });
      await tx.subtask.deleteMany({ where: { taskId: task.id } });
      await tx.subtask.create({ data: { taskId: task.id, title: "De B", position: 1 } });
      pending = changeTaskKind(task.id, { kindId: c.id });
      await waitForLockWaiter();
    }, { timeout: 10_000 });
    expectOk(await pending!);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).kindId, c.id);
    assert.notEqual(c.id, f.kindId);
    assert.deepEqual(await subtasksOf(task.id), ["  De C"]);
  });
});
