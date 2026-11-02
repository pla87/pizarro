// La limpieza vuelve a comprobar el estado dentro del DELETE y la confirmación del cliente se contrasta en el servidor.
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { asUser, db, expectFail, makeProject, makeTask, makeUser } from "./helpers";
import { runStorageCleanup } from "../../src/actions/storage";
import { createAttachmentWithinLimit } from "../../src/lib/attachment-limit";
import { createDocumentWithinLimit, purgeTrashedDocuments } from "../../src/lib/documents";
import { cleanupArchivedTaskAttachments, deleteDocumentsForever, deleteTaskAttachments } from "../../src/lib/storage-cleanup";
import { attachmentPath, documentPath, saveDocumentFile, saveRawAttachmentFile } from "../../src/lib/uploads";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-recheck-"));
const MB = 1024 * 1024;
const exists = (file: string) => stat(file).then(() => true, () => false);

async function attach(taskId: string, size: number) {
  const r = await createAttachmentWithinLimit({ taskId, originalName: "f.bin", mimeType: "application/octet-stream", isImage: false, size }, { id: true });
  assert.ok(r.ok);
  await saveRawAttachmentFile(r.attachment.id, Buffer.alloc(size));
  return r.attachment.id;
}

async function doc(projectId: string, userId: string, size: number) {
  const r = await createDocumentWithinLimit({ projectId, name: "d.txt", mimeType: "text/plain", size, kind: "TEXT", createdById: userId });
  assert.ok(r.ok);
  await saveDocumentFile(r.document.id, Buffer.alloc(size));
  return r.document.id;
}

describe("limpieza: estado vuelto a comprobar al borrar", () => {
  test("confirmación obsoleta: si hay más de lo confirmado no se borra nada", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const task = await makeTask(f);
    await db.task.update({ where: { id: task.id }, data: { archivedAt: new Date() } });
    const id = await attach(task.id, MB);
    await asUser(admin, async () => {
      expectFail(await runStorageCleanup(f.project.id, "archivedTasks", 0, 0), /El contenido ha cambiado/);
    });
    assert.equal(await exists(attachmentPath(id, "file")), true);
    assert.equal(await db.taskAttachment.count({ where: { id } }), 1);
  });

  test("max: nunca se borra más de lo confirmado", async () => {
    const f = await makeProject({ members: [] });
    const task = await makeTask(f);
    await db.task.update({ where: { id: task.id }, data: { archivedAt: new Date() } });
    for (let i = 0; i < 3; i++) await attach(task.id, MB);
    const r = await cleanupArchivedTaskAttachments(f.project.id, 0, new Date(), 2);
    assert.equal(r.count, 2);
    assert.equal(await db.taskAttachment.count({ where: { taskId: task.id } }), 1);
  });

  test("onlyArchived / onlyTrashed: lo desarchivado o restaurado no se borra", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const task = await makeTask(f); // activa
    const att = await attach(task.id, MB);
    assert.equal((await deleteTaskAttachments(f.project.id, [att], { onlyArchived: true })).count, 0);
    assert.equal(await exists(attachmentPath(att, "file")), true);

    const d = await doc(f.project.id, admin.id, MB);
    assert.equal((await deleteDocumentsForever(f.project.id, [d], { onlyTrashed: true })).count, 0);
    assert.equal(await exists(documentPath(d)), true);
    // Sin la opción sí se borra (borrado individual de un documento vivo).
    assert.equal((await deleteDocumentsForever(f.project.id, [d])).count, 1);
    assert.equal(await exists(documentPath(d)), false);
  });

  test("purgeTrashedDocuments solo borra del disco lo realmente eliminado", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const gone = await doc(f.project.id, admin.id, 1024);
    const restored = await doc(f.project.id, admin.id, 1024);
    await db.projectDocument.update({ where: { id: gone }, data: { deletedAt: old, deletedById: admin.id } });
    // «restored» nunca estuvo en la papelera (restaurado): su fichero debe seguir.
    assert.ok((await purgeTrashedDocuments(new Date())) >= 1);
    assert.equal(await exists(documentPath(gone)), false);
    assert.equal(await exists(documentPath(restored)), true);
    assert.equal(await db.projectDocument.count({ where: { id: restored } }), 1);
  });
});
