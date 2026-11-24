// Cambiar el tipo de una tarea desde el detalle (changeTaskKind): tipo, título, descripción y subtareas de la plantilla
// en una sola acción, con un solo «Deshacer».
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
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
    assert.equal(res.kindSubtasks?.changed, 2);
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
});
