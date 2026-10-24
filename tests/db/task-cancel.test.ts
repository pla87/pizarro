// «Cancelar» del detalle de la tarea (restoreTaskSnapshot) y borrado de adjuntos deshacible, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assign, db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { addSubtask, deleteAttachment, deleteSubtask, moveTask, restoreTaskSnapshot, updateSubtask, updateTask, type TaskEditSnapshot } from "../../src/actions/tasks";
import { undoLast } from "../../src/actions/undo";

const att = (taskId: string, name: string) =>
  db.taskAttachment.create({ data: { taskId, originalName: name, mimeType: "text/plain", isImage: false, size: 10 } });

/** Lo que el diálogo guarda al abrirse: la tarea tal como está en la base de datos. */
async function snapshotOf(taskId: string): Promise<TaskEditSnapshot> {
  const t = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { labels: true, subtasks: { orderBy: { position: "asc" } }, attachments: true, links: true },
  });
  return {
    title: t.title, description: t.description, kindId: t.kindId, color: t.color as never, linkUrl: t.linkUrl, assigneeId: t.assigneeId,
    labelIds: t.labels.map((l) => l.labelId), dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null, deliverableId: t.deliverableId,
    evergreen: t.evergreen, recurrence: t.recurrence, recurrenceDay: t.recurrenceDay, columnId: t.columnId, position: t.position,
    subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done, position: s.position })),
    attachmentIds: t.attachments.map((a) => a.id),
    links: t.links.map((l) => ({ id: l.id, kind: l.kind, title: l.title, url: l.url })),
  };
}

const undoCount = (userId: string, projectId: string) => db.undoEntry.count({ where: { userId, projectId, kind: "UNDO" } });

describe("borrar un adjunto se puede deshacer", () => {
  test("deshacer devuelve la fila del adjunto", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await loginAs(user);
    const task = await makeTask(f);
    const a = await att(task.id, "a.txt");
    expectOk(await deleteAttachment(a.id));
    assert.equal(await db.taskAttachment.count({ where: { taskId: task.id } }), 0);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.taskAttachment.findUniqueOrThrow({ where: { id: a.id } })).originalName, "a.txt");
  });
});

describe("Cancelar la edición (restoreTaskSnapshot)", () => {
  test("devuelve campos, subtareas, adjuntos y columna en una sola acción deshacible", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const f = await makeProject();
    await assign(f, other);
    await loginAs(user);
    const label = await db.label.create({ data: { projectId: f.project.id, name: "L", color: "blue" } });
    const task = await makeTask(f, { title: "Original", subtasks: ["uno", "dos"] });
    await db.task.update({ where: { id: task.id }, data: { description: "desc", color: "#ef4444" } });
    const keep = await att(task.id, "queda.txt");
    const removed = await att(task.id, "borrado.txt");
    const [s1, s2] = await db.subtask.findMany({ where: { taskId: task.id }, orderBy: { position: "asc" } });
    const snap = await snapshotOf(task.id);

    // Sesión de edición: cambios sueltos, cada uno con su propia entrada de deshacer.
    expectOk(await updateTask(task.id, { title: "Cambiado", description: "otra", assigneeId: other.id, labelIds: [label.id], color: "#0ea5e9" }));
    expectOk(await updateSubtask(s1!.id, { done: true, title: "uno!" }));
    expectOk(await deleteSubtask(s2!.id));
    const added = expectOk(await addSubtask(task.id, "nueva"));
    expectOk(await deleteAttachment(removed.id));
    const uploaded = await att(task.id, "subido.txt");
    expectOk(await moveTask(task.id, f.columns.doing, null, null));

    const before = await undoCount(user.id, f.project.id);
    const res = expectOk(await restoreTaskSnapshot(task.id, snap, null));
    assert.equal(res.changed, true);
    // Todo vuelve a como estaba.
    const back = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { labels: true, subtasks: { orderBy: { position: "asc" } }, attachments: true } });
    assert.equal(back.title, "Original");
    assert.equal(back.description, "desc");
    assert.equal(back.color, "#ef4444");
    assert.equal(back.assigneeId, null);
    assert.equal(back.labels.length, 0);
    assert.equal(back.columnId, f.columns.todo);
    assert.deepEqual(back.subtasks.map((s) => [s.title, s.done]), [["uno", false], ["dos", false]]);
    assert.deepEqual(back.attachments.map((a) => a.id).sort(), [keep.id, removed.id].sort());
    assert.equal(await db.subtask.count({ where: { id: added.id } }), 0);
    assert.equal(await db.taskAttachment.count({ where: { id: uploaded.id } }), 0);
    // Una sola entrada nueva, con su etiqueta, y quedó en el historial.
    assert.equal(await undoCount(user.id, f.project.id), before + 1);
    const entry = await db.undoEntry.findFirstOrThrow({ where: { userId: user.id, kind: "UNDO" }, orderBy: { createdAt: "desc" } });
    assert.match(entry.label, /Canceló los cambios en/);
    assert.equal(await db.taskEvent.count({ where: { taskId: task.id, label: { contains: "Canceló los cambios" } } }), 1);

    // Deshacer esa única entrada devuelve la edición.
    expectOk(await undoLast(f.project.id));
    const again = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { labels: true, subtasks: true, attachments: true } });
    assert.equal(again.title, "Cambiado");
    assert.equal(again.labels.length, 1);
    assert.equal(again.columnId, f.columns.doing);
    assert.equal(again.subtasks.length, 2);
    assert.ok(again.subtasks.some((s) => s.id === added.id));
    assert.ok(again.attachments.some((a) => a.id === uploaded.id));
    assert.ok(!again.attachments.some((a) => a.id === removed.id));
  });

  test("sin cambios no hace nada ni deja entrada de deshacer", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await loginAs(user);
    const task = await makeTask(f, { subtasks: ["a"] });
    const before = await undoCount(user.id, f.project.id);
    const res = expectOk(await restoreTaskSnapshot(task.id, await snapshotOf(task.id), null));
    assert.equal(res.changed, false);
    assert.equal(await undoCount(user.id, f.project.id), before);
  });

  test("no pisa el texto que otra persona cambió mientras se editaba", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const f = await makeProject();
    await assign(f, other);
    await loginAs(user);
    const task = await makeTask(f, { title: "Original" });
    const snap = await snapshotOf(task.id);
    const since = (await db.task.findUniqueOrThrow({ where: { id: task.id } })).contentUpdatedAt?.toISOString() ?? null;
    expectOk(await updateTask(task.id, { title: "Mío" }));
    await loginAs(other);
    expectOk(await updateTask(task.id, { title: "Ajeno" }));
    await loginAs(user);
    expectFail(await restoreTaskSnapshot(task.id, snap, since), /ha cambiado el texto/);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Ajeno");
  });
});
