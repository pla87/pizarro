// Editar comentarios propios: permisos (solo el autor, tampoco un admin), validación, menciones nuevas, historial,
// deshacer, aviso en vivo con la tarea, y el refresco de comentarios del detalle abierto. Contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { addComment, archiveTask, deleteComment, editComment, getRecentComments, getTaskDetail } from "../../src/actions/tasks";
import { redoLast, undoLast } from "../../src/actions/undo";
import { mentionToken } from "../../src/lib/mentions";
import { subscribeProject } from "../../src/lib/realtime";

describe("editar un comentario", () => {
  test("solo su autor; un admin tampoco (aunque sí puede borrarlo) y alguien sin acceso no lo ve", async () => {
    const author = await makeUser();
    const other = await makeUser();
    const admin = await makeUser({ role: "ADMIN" });
    const outsider = await makeUser();
    const f = await makeProject({ members: [author, other] });
    const task = await makeTask(f);
    await loginAs(author);
    const c = expectOk(await addComment(task.id, "original"));

    await loginAs(other);
    expectFail(await editComment(c.id, "pisado"), /Solo puedes editar tus comentarios/);
    await loginAs(admin);
    expectFail(await editComment(c.id, "pisado por admin"), /Solo puedes editar tus comentarios/);
    await loginAs(outsider);
    expectFail(await editComment(c.id, "pisado"), NOT_FOUND);
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: c.id } })).body, "original");

    await loginAs(author);
    const edited = expectOk(await editComment(c.id, "  corregido  "));
    assert.equal(edited.body, "corregido");
    assert.ok(edited.editedAt, "lleva la marca de editado");
    const row = await db.taskComment.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.body, "corregido");
    assert.ok(row.editedAt && row.editedAt >= row.createdAt);
    // El detalle (y el refresco) traen la fecha de edición.
    const detail = expectOk(await getTaskDetail(task.id));
    assert.equal(detail.comments.find((x) => x.id === c.id)?.editedAt, row.editedAt!.toISOString());
  });

  test("valida como al crear: vacío, demasiado largo, borrado y tarea archivada", async () => {
    const author = await makeUser();
    const f = await makeProject({ members: [author] });
    const task = await makeTask(f);
    await loginAs(author);
    const c = expectOk(await addComment(task.id, "hola"));
    expectFail(await editComment(c.id, "   "), /vacío/);
    expectFail(await editComment(c.id, "x".repeat(10_001)), /demasiado largo/);
    expectOk(await editComment(c.id, "x".repeat(10_000)));
    expectFail(await editComment("no-es-un-id!", "x"));
    // Sin cambios: no hay entrada de deshacer ni marca nueva.
    const before = await db.taskComment.findUniqueOrThrow({ where: { id: c.id } });
    const undos = await db.undoEntry.count();
    expectOk(await editComment(c.id, "x".repeat(10_000)));
    assert.equal(await db.undoEntry.count(), undos);
    assert.deepEqual((await db.taskComment.findUniqueOrThrow({ where: { id: c.id } })).editedAt, before.editedAt);

    const gone = expectOk(await addComment(task.id, "lo borro"));
    expectOk(await deleteComment(gone.id));
    expectFail(await editComment(gone.id, "tarde"), NOT_FOUND);

    expectOk(await archiveTask(task.id));
    expectFail(await editComment(c.id, "archivada"));
  });

  test("las menciones nuevas avisan como al crear, sin repetir a quien ya estaba mencionado", async () => {
    const author = await makeUser();
    const ana = await makeUser({ name: "Ana" });
    const luis = await makeUser({ name: "Luis" });
    const f = await makeProject({ members: [author, ana, luis] });
    const task = await makeTask(f);
    const mentions = async (u: { id: string }) => db.notification.count({ where: { userId: u.id, taskId: task.id, type: "MENTION" } });
    await loginAs(author);
    const c = expectOk(await addComment(task.id, `hola ${mentionToken("Ana", ana.id)}`));
    assert.equal(await mentions(ana), 1);
    assert.equal(await mentions(luis), 0);

    expectOk(await editComment(c.id, `hola ${mentionToken("Ana", ana.id)} y ${mentionToken("Luis", luis.id)}`));
    assert.equal(await mentions(ana), 1, "Ana ya estaba mencionada");
    assert.equal(await mentions(luis), 1, "Luis es nuevo");
    assert.ok(await db.taskFollower.count({ where: { taskId: task.id, userId: luis.id } }), "quien se menciona pasa a seguir la tarea");
    // Editar otra vez sin menciones nuevas no avisa a nadie.
    expectOk(await editComment(c.id, `adiós ${mentionToken("Ana", ana.id)} y ${mentionToken("Luis", luis.id)}`));
    assert.equal(await mentions(ana), 1);
    assert.equal(await mentions(luis), 1);
    // El extracto del aviso que creó el comentario se actualiza con el texto nuevo.
    const n = await db.notification.findFirstOrThrow({ where: { userId: ana.id, taskId: task.id, type: "MENTION" } });
    assert.match(n.excerpt, /^adiós @Ana/);
  });

  test("queda en el historial, deshacer devuelve el texto y la marca anteriores, rehacer la edición", async () => {
    const author = await makeUser();
    const f = await makeProject({ members: [author] });
    const task = await makeTask(f);
    await loginAs(author);
    const c = expectOk(await addComment(task.id, "primera versión"));
    expectOk(await editComment(c.id, "segunda versión"));
    const events = await db.taskEvent.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(events.map((e) => e.code), ["comment", "comment"]);
    assert.match(events[1]!.label, /Editó un comentario/);

    expectOk(await undoLast(f.project.id));
    let row = await db.taskComment.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.body, "primera versión");
    assert.equal(row.editedAt, null);
    expectOk(await redoLast(f.project.id));
    row = await db.taskComment.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.body, "segunda versión");
    assert.ok(row.editedAt);
  });

  test("se anuncia en el canal en vivo con la tarea (para refrescar los comentarios abiertos)", async () => {
    const author = await makeUser();
    const f = await makeProject({ members: [author] });
    const task = await makeTask(f);
    await loginAs(author);
    const c = expectOk(await addComment(task.id, "hola"));
    const seen: { action: string; taskId?: string | null }[] = [];
    const off = subscribeProject(f.project.id, (ch) => seen.push({ action: ch.action, taskId: ch.taskId }));
    try {
      expectOk(await editComment(c.id, "hola de nuevo"));
      // Las lecturas no se anuncian (si lo hicieran, cada refresco provocaría otro).
      expectOk(await getRecentComments(task.id, null));
    } finally {
      off();
    }
    assert.deepEqual(seen, [{ action: "tasks.editComment", taskId: task.id }]);
  });
});

describe("refresco de los comentarios que se ven", () => {
  test("desde el más antiguo cargado hasta el último, con los recuentos; exige acceso", async () => {
    const author = await makeUser();
    const outsider = await makeUser();
    const f = await makeProject({ members: [author] });
    const task = await makeTask(f);
    const base = Date.now() - 100_000;
    await db.taskComment.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ taskId: task.id, authorId: author.id, body: `c${i}`, createdAt: new Date(base + i * 1000) })) });
    await loginAs(author);
    const detail = expectOk(await getTaskDetail(task.id));
    assert.equal(detail.comments.length, 20);
    const first = detail.comments[0]!;

    // Otra persona comenta, edita y borra: el refresco lo trae todo, y no se pierde lo ya cargado.
    const newest = expectOk(await addComment(task.id, "nuevo"));
    expectOk(await editComment(detail.comments[5]!.id, "editado"));
    expectOk(await deleteComment(detail.comments[6]!.id));
    const r = expectOk(await getRecentComments(task.id, { createdAt: first.createdAt, id: first.id }));
    assert.equal(r.comments[0]!.id, first.id, "incluye el cursor");
    assert.equal(r.comments.at(-1)!.id, newest.id);
    assert.equal(r.comments.length, 20);
    assert.equal(r.comments.find((x) => x.id === detail.comments[5]!.id)?.body, "editado");
    assert.ok(!r.comments.some((x) => x.id === detail.comments[6]!.id));
    assert.equal(r.olderComments, 10);
    assert.equal(r.commentCount, 30);
    // Sin cursor (no había ninguno cargado): la primera página.
    assert.equal(expectOk(await getRecentComments(task.id, null)).comments.length, 20);

    await loginAs(outsider);
    expectFail(await getRecentComments(task.id, null), NOT_FOUND);
  });
});
