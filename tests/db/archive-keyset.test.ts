// Archivadas: paginación por claves, archivado solo de las activas y recuperación idempotente.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { archiveTasks, getArchivedTasks, restoreTask } from "../../src/actions/tasks";
import { createColumn, moveColumn } from "../../src/actions/columns";

describe("tareas archivadas", () => {
  test("la paginación sigue bien si la fila del cursor se desarchiva", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const rows = Array.from({ length: 105 }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId, title: `T${i}`, position: (i + 1) * 10, archivedAt: new Date(Date.now() - i * 1000) }));
    await db.task.createMany({ data: rows });
    const p1 = expectOk(await getArchivedTasks(f.project.id));
    assert.equal(p1.items.length, 100);
    assert.ok(p1.nextCursor);
    // La última fila de la página 1 (la del cursor) se desarchiva antes de pedir la siguiente.
    await db.task.update({ where: { id: p1.items[99]!.id }, data: { archivedAt: null } });
    const p2 = expectOk(await getArchivedTasks(f.project.id, { cursor: p1.nextCursor }));
    assert.equal(p2.items.length, 5);
    assert.equal(p2.nextCursor, null);
    expectFail(await getArchivedTasks(f.project.id, { cursor: "no-valido" }));
  });

  test("archiveTasks ignora las ya archivadas y restoreTask no se repite", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const a = await makeTask(f);
    const b = await makeTask(f);
    await db.task.update({ where: { id: b.id }, data: { archivedAt: new Date() } });
    assert.equal(expectOk(await archiveTasks([b.id])).archived, 0);
    assert.equal(expectOk(await archiveTasks([a.id, b.id])).archived, 1);
    expectOk(await restoreTask(a.id));
    expectFail(await restoreTask(a.id), /no está archivada/);
  });
});

describe("columnas", () => {
  test("createColumn respeta el tope de 30 con altas simultáneas y moveColumn en el extremo no hace nada", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const existing = await db.column.count({ where: { projectId: f.project.id } });
    const results = await Promise.all(Array.from({ length: 35 - existing }, (_, i) => createColumn(f.project.id, `C${i}`)));
    assert.equal(results.filter((r) => r.ok).length, 30 - existing);
    assert.equal(await db.column.count({ where: { projectId: f.project.id } }), 30);
    const first = await db.column.findFirstOrThrow({ where: { projectId: f.project.id }, orderBy: { position: "asc" } });
    const undoBefore = await db.undoEntry.count({ where: { projectId: f.project.id } });
    expectOk(await moveColumn(first.id, -1));
    assert.equal(await db.undoEntry.count({ where: { projectId: f.project.id } }), undoBefore);
  });
});
