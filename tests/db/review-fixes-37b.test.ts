// Correcciones de revisión: avisos de fecha obsoletos, acciones múltiples con ids que ya no existen, recuperar una
// tarea no archivada, archivadas paginadas, rehacer un despliegue y avisos de asignación en lote.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { archiveTasks, createTasks, deleteTasks, getArchivedTasks, restoreTask, updateTask } from "../../src/actions/tasks";
import { deployRelease } from "../../src/actions/releases";
import { redoLast, undoLast } from "../../src/actions/undo";
import { DUE_NOTIFY_DELAY_MS, deliverDueNotices } from "../../src/lib/due-notices";
import { notificationBody } from "../../src/lib/notification-text";
import { makeT } from "../../src/i18n/core";

describe("avisos de fecha", () => {
  test("si la fecha actual ya no es la del aviso pendiente, no se envía", async () => {
    await db.pendingDueNotice.deleteMany();
    const actor = await makeUser();
    const assignee = await makeUser();
    const f = await makeProject({ members: [actor, assignee] });
    const task = await makeTask(f, { dueDate: new Date("2026-11-01T00:00:00Z") });
    await db.task.update({ where: { id: task.id }, data: { assigneeId: assignee.id } });
    await loginAs(actor);
    expectOk(await updateTask(task.id, { dueDate: "2026-11-05" }));
    // La fecha cambia por otra vía (Cancelar, deshacer…) sin pasar por el aviso.
    await db.task.update({ where: { id: task.id }, data: { dueDate: new Date("2026-11-09T00:00:00Z") } });
    assert.equal(await deliverDueNotices(new Date(Date.now() + DUE_NOTIFY_DELAY_MS + 30_000)), 0);
    assert.equal(await db.notification.count({ where: { taskId: task.id, type: "DUE_CHANGED" } }), 0);
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

describe("rehacer un despliegue y asignación en lote", () => {
  test("deshacer un despliegue de release no deja entrada de rehacer", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await db.column.create({ data: { projectId: f.project.id, name: "En producción", position: 4000, role: "IN_PRODUCTION" } });
    await loginAs(user);
    const a = await makeTask(f, { columnId: f.columns.done, position: 1000 });
    expectOk(await deployRelease({ projectId: f.project.id, title: "R", content: "x", destination: "IN_PRODUCTION", taskIds: [a.id] }));
    expectOk(await undoLast(f.project.id));
    expectFail(await redoLast(f.project.id), /nada que rehacer/i);
  });

  test("createTasks avisa una sola vez al responsable", async () => {
    const actor = await makeUser();
    const assignee = await makeUser();
    const f = await makeProject({ members: [actor, assignee] });
    await loginAs(actor);
    const made = expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, assigneeId: assignee.id, tasks: [{ title: "Uno", kindId: f.kindId }, { title: "Dos", kindId: f.kindId }] }));
    const notes = await db.notification.findMany({ where: { userId: assignee.id, type: "ASSIGNED" } });
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.taskId, made[0]!.id);
    // Se guarda solo el número; «2 tareas» se pone al mostrarlo, en el idioma de quien lo lee.
    assert.equal(notificationBody("ASSIGNED", notes[0]!.excerpt, makeT("es"), "es-ES"), "2 tareas");
  });
});
