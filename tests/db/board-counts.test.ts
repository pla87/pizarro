// Recuentos de comentarios y enlaces de las tarjetas (tablero, creación múltiple y una sola tarea), contados aparte con
// groupBy filtrado por proyecto o por ids: deben coincidir con el `_count` de antes y no mezclar otros proyectos.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { createTasks } from "../../src/actions/tasks";
import { loadBoardTask, loadBoardTasks, loadBoardTasksByIds } from "../../src/lib/board";

async function comments(taskId: string, n: number, deleted = 0) {
  await db.taskComment.createMany({ data: Array.from({ length: n + deleted }, (_, i) => ({ taskId, body: `c${i}`, deletedAt: i < deleted ? new Date() : null })) });
}
async function links(taskId: string, n: number) {
  await db.taskLink.createMany({ data: Array.from({ length: n }, (_, i) => ({ taskId, kind: "GOOGLE_DOC" as const, title: `Doc ${i}`, url: `https://example.com/d/${i}` })) });
}

describe("recuentos de las tarjetas", () => {
  test("tablero: comentarios sin los borrados y enlaces, solo de sus tareas; las de otros proyectos no cuentan", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const other = await makeProject({ members: [user] });
    const a = await makeTask(f);
    const b = await makeTask(f, { position: 2000 });
    const c = await makeTask(f, { position: 3000 });
    const archived = await makeTask(f, { position: 4000 });
    const foreign = await makeTask(other);
    await comments(a.id, 3, 2);
    await links(a.id, 2);
    await comments(b.id, 0, 1); // solo borrados → 0
    await links(c.id, 1);
    await comments(archived.id, 5);
    await db.task.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    await comments(foreign.id, 7);
    await links(foreign.id, 4);

    const board = await loadBoardTasks(f.project.id);
    const counts = Object.fromEntries(board.map((t) => [t.id, [t.commentCount, t.linkCount]]));
    assert.deepEqual(counts, { [a.id]: [3, 2], [b.id]: [0, 0], [c.id]: [0, 1] });
    // Lo mismo que da una sola tarea (loadBoardTask, que sigue con `_count`) y la carga por ids.
    for (const t of [a, b, c]) {
      const one = await loadBoardTask(t.id);
      assert.deepEqual([one.commentCount, one.linkCount], counts[t.id]);
    }
    const byIds = await loadBoardTasksByIds([c.id, a.id, foreign.id]);
    assert.deepEqual(Object.fromEntries(byIds.map((t) => [t.id, [t.commentCount, t.linkCount]])), { [a.id]: [3, 2], [c.id]: [0, 1], [foreign.id]: [7, 4] });
    assert.deepEqual(await loadBoardTasksByIds([]), []);
  });

  test("creación múltiple: devuelve las tarjetas nuevas con sus recuentos a cero y en el orden del tablero", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const created = expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, tasks: [{ title: "Uno", kindId: f.kindId }, { title: "Dos", kindId: f.kindId }] }));
    assert.deepEqual(created.map((t) => [t.title, t.commentCount, t.linkCount, t.hasDescription]), [["Uno", 0, 0, false], ["Dos", 0, 0, false]]);
  });

  // Antes el tablero traía una fila por subtarea y por adjunto solo para contarlas; ahora son groupBy por tarea.
  test("subtareas (hechas y total) y adjuntos (imágenes, ficheros y bytes): lo mismo en el tablero, por ids y en una sola", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const other = await makeProject({ members: [user] });
    const a = await makeTask(f, { subtasks: ["s1", "s2", "s3"] });
    const b = await makeTask(f, { position: 2000 });
    const c = await makeTask(f, { position: 3000, subtasks: ["x"] });
    const foreign = await makeTask(other, { subtasks: ["y", "z"] });
    await db.subtask.updateMany({ where: { taskId: a.id, title: { in: ["s1", "s3"] } }, data: { done: true } });
    const att = (taskId: string, isImage: boolean, size: number) => ({ taskId, originalName: `f${size}`, mimeType: isImage ? "image/webp" : "text/plain", isImage, size });
    await db.taskAttachment.createMany({ data: [att(a.id, true, 100), att(a.id, true, 250), att(a.id, false, 7), att(c.id, false, 40), att(foreign.id, true, 9)] });
    const pick = (t: Awaited<ReturnType<typeof loadBoardTask>>) => [t.subtaskTotal, t.subtaskDone, t.imageCount, t.fileCount, t.attachBytes];
    const want = { [a.id]: [3, 2, 2, 1, 357], [b.id]: [0, 0, 0, 0, 0], [c.id]: [1, 0, 0, 1, 40] };
    assert.deepEqual(Object.fromEntries((await loadBoardTasks(f.project.id)).map((t) => [t.id, pick(t)])), want);
    for (const t of [a, b, c]) assert.deepEqual(pick(await loadBoardTask(t.id)), want[t.id]);
    assert.deepEqual(Object.fromEntries((await loadBoardTasksByIds([c.id, foreign.id])).map((t) => [t.id, pick(t)])), { [c.id]: want[c.id], [foreign.id]: [2, 0, 1, 0, 9] });
  });
});
