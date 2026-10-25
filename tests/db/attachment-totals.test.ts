// Contadores de adjuntos de la tarea (los de la tarjeta y el aviso «N / M MB en total») contra PostgreSQL real:
// solo cuentan las filas de TaskAttachment, no los ficheros que se conservan en disco para poder deshacer un borrado.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { deleteAttachment, restoreTaskSnapshot } from "../../src/actions/tasks";
import { redoLast, undoEntry } from "../../src/actions/undo";
import { attachmentTotals } from "../../src/lib/board";
import { createAttachmentWithinLimit } from "../../src/lib/attachment-limit";

const MB = 1024 * 1024;
const row = (taskId: string, size: number, isImage = false) => ({ taskId, originalName: "f", mimeType: "x/y", isImage, size });
const upload = (taskId: string, size: number) => createAttachmentWithinLimit(row(taskId, size), { id: true });

describe("contadores de adjuntos de la tarea", () => {
  test("attachmentTotals, borrar, deshacer, rehacer y el tope por tarea solo cuentan las filas existentes", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await db.project.update({ where: { id: f.project.id }, data: { taskAttachMaxMb: 10, fileMaxMb: 10 } });
    await loginAs(user);
    const task = await makeTask(f);
    assert.deepEqual(await attachmentTotals(task.id), { imageCount: 0, fileCount: 0, attachBytes: 0 });
    const a = await db.taskAttachment.create({ data: row(task.id, 6 * MB) });
    const b = await db.taskAttachment.create({ data: row(task.id, 3 * MB, true) });
    assert.deepEqual(await attachmentTotals(task.id), { imageCount: 1, fileCount: 1, attachBytes: 9 * MB });
    assert.equal((await upload(task.id, 2 * MB)).ok, false, "9 + 2 MB pasa del tope de 10");
    // Borrar devuelve los contadores reales; lo borrado no ocupa cupo aunque exista su entrada de deshacer.
    const delA = expectOk(await deleteAttachment(a.id));
    assert.deepEqual(delA.totals, { imageCount: 1, fileCount: 0, attachBytes: 3 * MB });
    const delB = expectOk(await deleteAttachment(b.id));
    assert.deepEqual(delB.totals, { imageCount: 0, fileCount: 0, attachBytes: 0 });
    const full = await upload(task.id, 10 * MB);
    assert.equal(full.ok, true, "con todo borrado caben los 10 MB enteros");
    await db.taskAttachment.deleteMany({ where: { taskId: task.id } });
    // Deshacer el borrado devuelve la fila y vuelve a contar; rehacer la quita otra vez.
    expectOk(await undoEntry(delB.undo.id!));
    assert.deepEqual(await attachmentTotals(task.id), { imageCount: 1, fileCount: 0, attachBytes: 3 * MB });
    expectOk(await redoLast(f.project.id, task.id));
    assert.deepEqual(await attachmentTotals(task.id), { imageCount: 0, fileCount: 0, attachBytes: 0 });
  });

  test("«Cancelar» (restoreTaskSnapshot) deja los contadores de la tarea como al abrir", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const task = await makeTask(f);
    const keep = await db.taskAttachment.create({ data: row(task.id, 2 * MB) });
    const gone = await db.taskAttachment.create({ data: row(task.id, 4 * MB, true) });
    const t0 = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    const snap = {
      title: t0.title, kindId: t0.kindId, color: t0.color as never, linkUrl: t0.linkUrl, assigneeId: t0.assigneeId, labelIds: [], dueDate: null,
      deliverableId: t0.deliverableId, evergreen: t0.evergreen, evergreenEvery: t0.evergreenEvery, recurrence: t0.recurrence, recurrenceDay: t0.recurrenceDay,
      columnId: t0.columnId, position: t0.position, attachmentIds: [keep.id, gone.id],
    };
    expectOk(await deleteAttachment(gone.id));
    await db.taskAttachment.create({ data: row(task.id, 1 * MB, true) }); // subido después de abrir
    const res = expectOk(await restoreTaskSnapshot(task.id, snap));
    assert.deepEqual([res.task.imageCount, res.task.fileCount, res.task.attachBytes], [1, 1, 6 * MB]);
    assert.deepEqual(await attachmentTotals(task.id), { imageCount: 1, fileCount: 1, attachBytes: 6 * MB });
  });
});
