// Máximo de adjuntos por tarea (Project.taskAttachMaxMb) contra PostgreSQL real, también con subidas simultáneas.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, makeProject, makeTask } from "./helpers";
import { createAttachmentWithinLimit } from "../../src/lib/attachment-limit";

const MB = 1024 * 1024;
const sel = { id: true, size: true } as const;
const data = (taskId: string, size: number) => ({ taskId, originalName: "f.bin", mimeType: "application/octet-stream", isImage: false, size });

describe("máximo de adjuntos por tarea", () => {
  test("rechaza lo que pasa del tope del proyecto y acepta lo que justo cabe", async () => {
    const f = await makeProject({ members: [] });
    await db.project.update({ where: { id: f.project.id }, data: { taskAttachMaxMb: 10 } });
    const task = await makeTask(f);
    const other = await makeTask(f);
    assert.equal((await createAttachmentWithinLimit(data(task.id, 6 * MB), sel)).ok, true);
    const over = await createAttachmentWithinLimit(data(task.id, 5 * MB), sel);
    assert.equal(over.ok, false);
    if (!over.ok) {
      assert.equal(over.limitMb, 10);
      assert.equal(over.usedBytes, 6 * MB);
    }
    // Justo el tope: cabe. Otra tarea tiene su propia cuenta.
    assert.equal((await createAttachmentWithinLimit(data(task.id, 4 * MB), sel)).ok, true);
    assert.equal((await createAttachmentWithinLimit(data(other.id, 10 * MB), sel)).ok, true);
    assert.equal((await createAttachmentWithinLimit(data(task.id, 1), sel)).ok, false);
    assert.equal(await db.taskAttachment.count({ where: { taskId: task.id } }), 2);
  });

  test("subidas simultáneas no pasan del tope entre todas", async () => {
    const f = await makeProject({ members: [] });
    await db.project.update({ where: { id: f.project.id }, data: { taskAttachMaxMb: 10 } });
    const task = await makeTask(f);
    const results = await Promise.all(Array.from({ length: 6 }, () => createAttachmentWithinLimit(data(task.id, 4 * MB), sel)));
    assert.equal(results.filter((r) => r.ok).length, 2);
    const sum = await db.taskAttachment.aggregate({ _sum: { size: true }, where: { taskId: task.id } });
    assert.ok((sum._sum.size ?? 0) <= 10 * MB);
  });
});
