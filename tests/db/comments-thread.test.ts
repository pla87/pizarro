// Comentarios: paginación con cursor, máximo configurable y borrado que conserva el hilo, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { addComment, deleteComment, getOlderComments, getTaskDetail } from "../../src/actions/tasks";
import { saveMaxCommentsPerTask } from "../../src/actions/settings";
import { redoLast, undoLast } from "../../src/actions/undo";
import { mentionToken } from "../../src/lib/mentions";
import { COMMENT_LIMIT_DEFAULT, getMaxCommentsPerTask, invalidateAppSettings } from "../../src/lib/app-settings";

/** n comentarios con fechas crecientes (de 1 s en 1 s, para que el orden sea claro). */
async function seed(taskId: string, authorId: string, n: number, sameInstant = false) {
  const base = Date.now() - n * 1000 - 10_000;
  const rows = Array.from({ length: n }, (_, i) => ({ taskId, authorId, body: `c${i}`, createdAt: new Date(sameInstant ? base : base + i * 1000) }));
  await db.taskComment.createMany({ data: rows });
}

describe("paginación de comentarios", () => {
  test("al abrir trae los 20 más recientes y cada «Ver anteriores» 100, sin saltos ni repetidos", async () => {
    const user = await makeUser();
    const f = await makeProject();
    const task = await makeTask(f);
    await seed(task.id, user.id, 250);
    await loginAs(user);
    const detail = expectOk(await getTaskDetail(task.id));
    assert.equal(detail.comments.length, 20);
    assert.deepEqual(detail.comments.map((c) => c.body), Array.from({ length: 20 }, (_, i) => `c${230 + i}`));
    assert.equal(detail.olderComments, 230);
    assert.equal(detail.commentCount, 250);

    const seen = detail.comments.map((c) => c.body);
    let cursor = detail.comments[0]!;
    const sizes: number[] = [];
    for (let remaining = detail.olderComments; remaining > 0; ) {
      const page = expectOk(await getOlderComments(task.id, { createdAt: cursor.createdAt, id: cursor.id }));
      sizes.push(page.comments.length);
      seen.unshift(...page.comments.map((c) => c.body));
      remaining = page.olderComments;
      cursor = page.comments[0]!;
    }
    assert.deepEqual(sizes, [100, 100, 30]);
    assert.deepEqual(seen, Array.from({ length: 250 }, (_, i) => `c${i}`));
  });

  test("con la misma fecha en muchos comentarios el id desempata y no se pierde ni se repite ninguno", async () => {
    const user = await makeUser();
    const f = await makeProject();
    const task = await makeTask(f);
    await seed(task.id, user.id, 130, true);
    await loginAs(user);
    const detail = expectOk(await getTaskDetail(task.id));
    const ids = new Set(detail.comments.map((c) => c.id));
    let cursor = detail.comments[0]!;
    for (;;) {
      const page = expectOk(await getOlderComments(task.id, { createdAt: cursor.createdAt, id: cursor.id }));
      for (const c of page.comments) {
        assert.ok(!ids.has(c.id), "comentario repetido");
        ids.add(c.id);
      }
      if (!page.comments.length) break;
      cursor = page.comments[0]!;
    }
    assert.equal(ids.size, 130);
  });

  test("exige acceso a la tarea y valida el cursor", async () => {
    const user = await makeUser();
    const outsider = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner: user });
    const task = await makeTask(f);
    await seed(task.id, user.id, 30);
    await loginAs(user);
    const detail = expectOk(await getTaskDetail(task.id));
    const cursor = { createdAt: detail.comments[0]!.createdAt, id: detail.comments[0]!.id };
    assert.equal(expectOk(await getOlderComments(task.id, cursor)).comments.length, 10);
    expectFail(await getOlderComments(task.id, { createdAt: "no es fecha", id: cursor.id }));
    await loginAs(outsider);
    expectFail(await getOlderComments(task.id, cursor), NOT_FOUND);
  });

  test("una respuesta cuyo comentario aún no está cargado llega con su parentId", async () => {
    const user = await makeUser();
    const f = await makeProject();
    const task = await makeTask(f);
    await seed(task.id, user.id, 25);
    const first = await db.taskComment.findFirstOrThrow({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
    await db.taskComment.create({ data: { taskId: task.id, authorId: user.id, body: "respuesta", parentId: first.id } });
    await loginAs(user);
    const detail = expectOk(await getTaskDetail(task.id));
    const reply = detail.comments.find((c) => c.body === "respuesta");
    assert.equal(reply?.parentId, first.id);
    assert.ok(!detail.comments.some((c) => c.id === first.id));
  });
});

describe("máximo de comentarios por tarea", () => {
  test("por defecto 500; el admin lo cambia (1–1000) y addComment lo aplica con un mensaje claro", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const f = await makeProject();
    const task = await makeTask(f);
    await db.appState.deleteMany({ where: { key: "maxCommentsPerTask" } });
    invalidateAppSettings();
    assert.equal(await getMaxCommentsPerTask(), COMMENT_LIMIT_DEFAULT);

    await loginAs(member);
    expectFail(await saveMaxCommentsPerTask(5), /No tienes permiso/);
    await loginAs(admin);
    for (const bad of [0, 1001, 2.5, Number.NaN, -3]) expectFail(await saveMaxCommentsPerTask(bad));
    expectFail(await saveMaxCommentsPerTask("7" as unknown as number));
    assert.equal(await getMaxCommentsPerTask(), COMMENT_LIMIT_DEFAULT);
    assert.equal(expectOk(await saveMaxCommentsPerTask(2)).value, 2);
    assert.equal(await getMaxCommentsPerTask(), 2, "el guardado invalida la caché");
    assert.equal((await db.appState.findUniqueOrThrow({ where: { key: "maxCommentsPerTask" } })).value, "2");

    await loginAs(member);
    expectOk(await addComment(task.id, "uno"));
    expectOk(await addComment(task.id, "dos"));
    expectFail(await addComment(task.id, "tres"), /máximo de 2 comentarios/);
    assert.equal(await db.taskComment.count({ where: { taskId: task.id } }), 2);
    // Otra tarea tiene su propia cuenta.
    expectOk(await addComment((await makeTask(f)).id, "otra"));

    await loginAs(admin);
    assert.equal(expectOk(await saveMaxCommentsPerTask(1000)).value, 1000);
    await loginAs(member);
    expectOk(await addComment(task.id, "tres"));
    await db.appState.deleteMany({ where: { key: "maxCommentsPerTask" } });
    invalidateAppSettings();
  });

  test("un valor guardado corrupto vuelve al predeterminado", async () => {
    for (const raw of ["abc", "0", "1001", "3.5", ""]) {
      await db.appState.upsert({ where: { key: "maxCommentsPerTask" }, create: { key: "maxCommentsPerTask", value: raw }, update: { value: raw } });
      invalidateAppSettings();
      assert.equal(await getMaxCommentsPerTask(), COMMENT_LIMIT_DEFAULT, raw);
    }
    await db.appState.deleteMany({ where: { key: "maxCommentsPerTask" } });
    invalidateAppSettings();
  });

  test("los comentarios borrados que conservan respuestas no cuentan para el máximo", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const f = await makeProject();
    const task = await makeTask(f);
    await loginAs(admin);
    expectOk(await saveMaxCommentsPerTask(2));
    await loginAs(member);
    const parent = expectOk(await addComment(task.id, "padre"));
    expectOk(await addComment(task.id, "hija", parent.id));
    expectFail(await addComment(task.id, "otro"), /máximo de 2/);
    expectOk(await deleteComment(parent.id));
    expectOk(await addComment(task.id, "otro"));
    await db.appState.deleteMany({ where: { key: "maxCommentsPerTask" } });
    invalidateAppSettings();
  });
});

describe("borrar un comentario con respuestas", () => {
  test("se conserva vacío y marcado, las respuestas siguen colgando de él, y no filtra el texto", async () => {
    const author = await makeUser();
    const other = await makeUser();
    const f = await makeProject();
    const task = await makeTask(f);
    await loginAs(author);
    const parent = expectOk(await addComment(task.id, `hola ${mentionToken(other.name, other.id)} secreto del comentario`));
    await loginAs(other);
    const reply = expectOk(await addComment(task.id, "respuesta", parent.id));
    assert.equal(await db.notification.count({ where: { taskId: task.id, type: "MENTION", excerpt: { contains: "secreto" } } }), 1);

    await loginAs(author);
    const res = expectOk(await deleteComment(parent.id));
    assert.equal(res.soft, true);
    const row = await db.taskComment.findUniqueOrThrow({ where: { id: parent.id } });
    assert.equal(row.body, "");
    assert.ok(row.deletedAt);
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: reply.id } })).parentId, parent.id);
    assert.equal(await db.notification.count({ where: { taskId: task.id, excerpt: { contains: "secreto" } } }), 0);

    const detail = expectOk(await getTaskDetail(task.id));
    const shown = detail.comments.find((c) => c.id === parent.id)!;
    assert.deepEqual([shown.deleted, shown.body, shown.authorId, shown.authorName], [true, "", null, null]);
    assert.equal(detail.comments.find((c) => c.id === reply.id)!.parentId, parent.id);
    assert.equal(detail.commentCount, 1, "el borrado no cuenta");
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id }, select: { _count: { select: { comments: { where: { deletedAt: null } } } } } }))._count.comments, 1);

    // No se puede borrar dos veces ni responder a un comentario borrado.
    expectFail(await deleteComment(parent.id), NOT_FOUND);
    expectFail(await addComment(task.id, "tarde", parent.id), /ya no existe/);
  });

  test("deshacer devuelve el texto original y rehacer lo vuelve a borrar", async () => {
    const author = await makeUser();
    const other = await makeUser();
    const f = await makeProject();
    const task = await makeTask(f);
    await loginAs(author);
    const parent = expectOk(await addComment(task.id, "texto original @algo"));
    await loginAs(other);
    expectOk(await addComment(task.id, "hija", parent.id));
    await loginAs(author);
    expectOk(await deleteComment(parent.id));

    expectOk(await undoLast(f.project.id));
    let row = await db.taskComment.findUniqueOrThrow({ where: { id: parent.id } });
    assert.equal(row.body, "texto original @algo");
    assert.equal(row.deletedAt, null);
    expectOk(await redoLast(f.project.id));
    row = await db.taskComment.findUniqueOrThrow({ where: { id: parent.id } });
    assert.equal(row.body, "");
    assert.ok(row.deletedAt);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: parent.id } })).body, "texto original @algo");
  });

  test("sin respuestas se borra de verdad y deshacer lo recrea", async () => {
    const author = await makeUser();
    const f = await makeProject();
    const task = await makeTask(f);
    await loginAs(author);
    const c = expectOk(await addComment(task.id, "solo yo"));
    const res = expectOk(await deleteComment(c.id));
    assert.equal(res.soft, false);
    assert.equal(await db.taskComment.count({ where: { id: c.id } }), 0);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: c.id } })).body, "solo yo");
  });

  test("al borrar la última respuesta de un comentario borrado se retira también el marcador, y deshacer recompone ambos", async () => {
    const author = await makeUser();
    const other = await makeUser();
    const f = await makeProject();
    const task = await makeTask(f);
    await loginAs(author);
    const parent = expectOk(await addComment(task.id, "padre"));
    await loginAs(other);
    const r1 = expectOk(await addComment(task.id, "r1", parent.id));
    const r2 = expectOk(await addComment(task.id, "r2", parent.id));
    await loginAs(author);
    expectOk(await deleteComment(parent.id));
    await loginAs(other);
    // Queda otra respuesta: el marcador se queda.
    assert.deepEqual(expectOk(await deleteComment(r1.id)).removed, [r1.id]);
    assert.equal(await db.taskComment.count({ where: { id: parent.id } }), 1);
    // La última: se va con el marcador.
    expectOk(await deleteComment(r2.id));
    assert.equal(await db.taskComment.count({ where: { taskId: task.id } }), 0);
    expectOk(await undoLast(f.project.id));
    const back = await db.taskComment.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(back.map((c) => [c.body, !!c.deletedAt]), [["", true], ["r2", false]]);
    assert.equal(back[1]!.parentId, parent.id);
  });

  test("borrar una tarea con un comentario borrado y deshacer conserva la marca", async () => {
    const author = await makeUser();
    const f = await makeProject();
    const task = await makeTask(f);
    await loginAs(author);
    const parent = expectOk(await addComment(task.id, "padre"));
    expectOk(await addComment(task.id, "hija", parent.id));
    expectOk(await deleteComment(parent.id));
    const { deleteTask } = await import("../../src/actions/tasks");
    expectOk(await deleteTask(task.id));
    expectOk(await undoLast(f.project.id));
    const row = await db.taskComment.findUniqueOrThrow({ where: { id: parent.id } });
    assert.equal(row.body, "");
    assert.ok(row.deletedAt);
  });
});
