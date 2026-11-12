// Avisos de un comentario (comentario, respuesta y mención), contra PostgreSQL real: se localizan por su id al editar,
// deshacer, borrar o volver a mencionar (con la heurística de antes para los avisos sin commentId), el borrado relee
// el comentario bloqueado, las acciones devuelven el cid que publica el canal y deshacer o rehacer el alta o el borrado
// vacía o devuelve el extracto de sus avisos.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { addComment, deleteComment, editComment } from "../../src/actions/tasks";
import { redoLast, undoLast } from "../../src/actions/undo";
import { mentionToken } from "../../src/lib/mentions";
import { subscribeProject } from "../../src/lib/realtime";
import { applyUndo } from "../../src/lib/undo";

const secret = (taskId: string) => db.notification.count({ where: { taskId, excerpt: { contains: "secreto" } } });

/** Lleva el comentario y sus avisos `seconds` atrás (como si se hubiera escrito hace un rato). */
async function age(commentId: string, taskId: string, seconds: number) {
  await db.$executeRaw`UPDATE "TaskComment" SET "createdAt" = "createdAt" - make_interval(secs => ${seconds}) WHERE "id" = ${commentId}`;
  await db.$executeRaw`UPDATE "Notification" SET "createdAt" = "createdAt" - make_interval(secs => ${seconds}) WHERE "taskId" = ${taskId}`;
}

/** Extractos de los avisos de la tarea (todos los tipos). */
const excerpts = async (taskId: string) => (await db.notification.findMany({ where: { taskId }, select: { excerpt: true } })).map((n) => n.excerpt);

async function setup() {
  const author = await makeUser({ name: "Ana" });
  const bea = await makeUser({ name: "Bea" });
  const f = await makeProject({ members: [author, bea] });
  const task = await makeTask(f);
  await loginAs(author);
  return { author, bea, f, task, body: `${mentionToken("Bea", bea.id)} texto secreto` };
}

describe("avisos de un comentario editado y borrado", () => {
  test("los avisos de comentario, respuesta y mención guardan el id del comentario", async () => {
    const author = await makeUser();
    const ana = await makeUser({ name: "Ana" });
    const luis = await makeUser({ name: "Luis" });
    const f = await makeProject({ members: [author, ana, luis] });
    const task = await makeTask(f);
    await loginAs(luis);
    const root = expectOk(await addComment(task.id, "primero"));
    await loginAs(author);
    const reply = expectOk(await addComment(task.id, `respuesta ${mentionToken("Ana", ana.id)}`, root.id));
    const rows = await db.notification.findMany({ where: { taskId: task.id }, select: { type: true, userId: true, commentId: true } });
    assert.deepEqual(
      rows.map((r) => `${r.type}:${r.userId === ana.id ? "ana" : r.userId === luis.id ? "luis" : "?"}:${r.commentId === reply.id}`).sort(),
      ["MENTION:ana:true", "REPLY:luis:true"],
    );
  });

  test("editar más de un minuto después mencionando a alguien y borrar: su aviso no conserva el texto", async () => {
    const author = await makeUser();
    const ana = await makeUser({ name: "Ana" });
    const f = await makeProject({ members: [author, ana] });
    const task = await makeTask(f);
    await loginAs(author);
    const c = expectOk(await addComment(task.id, "hola"));
    await age(c.id, task.id, 120);
    expectOk(await editComment(c.id, `hola ${mentionToken("Ana", ana.id)} secreto`));
    assert.equal(await db.notification.count({ where: { userId: ana.id, type: "MENTION", taskId: task.id } }), 1);
    assert.equal(await secret(task.id), 1);
    expectOk(await deleteComment(c.id));
    assert.equal(await secret(task.id), 0, "el aviso de Ana se vacía");
  });

  test("editar, deshacer la edición y borrar: no quedan avisos con el texto editado", async () => {
    const author = await makeUser();
    const ana = await makeUser({ name: "Ana" });
    const f = await makeProject({ members: [author, ana] });
    const task = await makeTask(f);
    await loginAs(author);
    const c = expectOk(await addComment(task.id, `hola ${mentionToken("Ana", ana.id)}`));
    expectOk(await editComment(c.id, `hola ${mentionToken("Ana", ana.id)} secreto`));
    assert.equal(await secret(task.id), 1);
    expectOk(await undoLast(f.project.id));
    assert.equal(await secret(task.id), 0, "deshacer devuelve también el extracto");
    assert.match((await db.notification.findFirstOrThrow({ where: { userId: ana.id, taskId: task.id } })).excerpt, /^hola @Ana$/);
    expectOk(await deleteComment(c.id));
    assert.equal(await db.notification.count({ where: { taskId: task.id, excerpt: { not: "" } } }), 0);
  });

  test("los avisos anteriores a la columna (sin commentId) siguen con la heurística de antes", async () => {
    const author = await makeUser();
    const ana = await makeUser({ name: "Ana" });
    const f = await makeProject({ members: [author, ana] });
    const task = await makeTask(f);
    await loginAs(author);
    const c = expectOk(await addComment(task.id, `hola ${mentionToken("Ana", ana.id)} secreto`));
    await db.notification.updateMany({ where: { taskId: task.id }, data: { commentId: null } });
    expectOk(await editComment(c.id, `hola ${mentionToken("Ana", ana.id)} secreto 2`));
    assert.match((await db.notification.findFirstOrThrow({ where: { userId: ana.id, taskId: task.id } })).excerpt, /secreto 2$/);
    expectOk(await deleteComment(c.id));
    assert.equal(await secret(task.id), 0);
  });

  test("quitar una mención y volver a ponerla no avisa otra vez", async () => {
    const author = await makeUser();
    const ana = await makeUser({ name: "Ana" });
    const luis = await makeUser({ name: "Luis" });
    const f = await makeProject({ members: [author, ana, luis] });
    const task = await makeTask(f);
    const mentions = (u: { id: string }) => db.notification.count({ where: { userId: u.id, taskId: task.id, type: "MENTION" } });
    await loginAs(author);
    const c = expectOk(await addComment(task.id, `hola ${mentionToken("Ana", ana.id)}`));
    expectOk(await editComment(c.id, "hola"));
    expectOk(await editComment(c.id, `hola ${mentionToken("Ana", ana.id)}`));
    assert.equal(await mentions(ana), 1);
    // Luis entra en una edición, sale y vuelve: un solo aviso.
    expectOk(await editComment(c.id, `hola ${mentionToken("Ana", ana.id)} ${mentionToken("Luis", luis.id)}`));
    expectOk(await editComment(c.id, "adiós"));
    expectOk(await editComment(c.id, `otra vez ${mentionToken("Luis", luis.id)}`));
    assert.equal(await mentions(luis), 1);
    // En otro comentario sí es una mención nueva.
    expectOk(await addComment(task.id, `y aquí ${mentionToken("Ana", ana.id)}`));
    assert.equal(await mentions(ana), 2);
  });

  test("borrar relee el comentario bloqueado: el deshacer guarda el texto vigente", async () => {
    const author = await makeUser();
    const f = await makeProject({ members: [author] });
    const task = await makeTask(f);
    await loginAs(author);
    const c = expectOk(await addComment(task.id, "versión vieja"));
    // Otra pestaña edita justo después de que el borrado compruebe el comentario (fuera de su transacción).
    const delegate = db.taskComment as unknown as { findFirst: (...a: unknown[]) => Promise<unknown> };
    const original = delegate.findFirst;
    let raced = false;
    delegate.findFirst = async (...args: unknown[]) => {
      const res = await original.apply(db.taskComment, args);
      if (!raced) {
        raced = true;
        await db.taskComment.update({ where: { id: c.id }, data: { body: "versión nueva", editedAt: new Date() } });
      }
      return res;
    };
    try {
      expectOk(await deleteComment(c.id));
    } finally {
      delegate.findFirst = original;
    }
    assert.ok(raced);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: c.id } })).body, "versión nueva");
  });

  test("las acciones de comentarios devuelven el cid que publica el canal (la propia pestaña no las vuelve a pedir)", async () => {
    const author = await makeUser();
    const f = await makeProject({ members: [author] });
    const task = await makeTask(f);
    await loginAs(author);
    const seen: (string | undefined)[] = [];
    const off = subscribeProject(f.project.id, (ch) => seen.push(ch.cid));
    const cids: (string | undefined)[] = [];
    try {
      const add = await addComment(task.id, "hola");
      assert.ok(add.ok);
      cids.push(add.cid);
      const edit = await editComment(add.data.id, "hola de nuevo");
      cids.push(edit.ok ? edit.cid : undefined);
      const del = await deleteComment(add.data.id);
      cids.push(del.ok ? del.cid : undefined);
    } finally {
      off();
    }
    assert.ok(cids.every(Boolean), "cada acción devuelve su cid");
    assert.deepEqual(seen, cids);
  });
});

describe("deshacer comentarios: el extracto de sus avisos", () => {
  test("deshacer el alta lo vacía y rehacerla lo devuelve", async () => {
    const { f, task, body } = await setup();
    expectOk(await addComment(task.id, body));
    assert.deepEqual(await excerpts(task.id), ["@Bea texto secreto"]);
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.taskComment.count({ where: { taskId: task.id } }), 0);
    assert.deepEqual(await excerpts(task.id), [""], "el aviso no muestra el texto deshecho");
    expectOk(await redoLast(f.project.id));
    assert.deepEqual(await excerpts(task.id), ["@Bea texto secreto"]);
  });

  test("deshacer un borrado lo devuelve y rehacerlo lo vacía otra vez", async () => {
    const { f, task, body } = await setup();
    const c = expectOk(await addComment(task.id, body));
    expectOk(await deleteComment(c.id));
    assert.deepEqual(await excerpts(task.id), [""]);
    expectOk(await undoLast(f.project.id));
    assert.deepEqual(await excerpts(task.id), ["@Bea texto secreto"]);
    expectOk(await redoLast(f.project.id));
    assert.equal(await db.taskComment.count({ where: { id: c.id } }), 0);
    assert.deepEqual(await excerpts(task.id), [""]);
  });

  test("con respuestas (borrado que deja el marcador): deshacer lo devuelve y rehacer lo vacía", async () => {
    const { author, bea, f, task, body } = await setup();
    const c = expectOk(await addComment(task.id, body));
    await loginAs(bea);
    expectOk(await addComment(task.id, "respuesta", c.id));
    await loginAs(author);
    const mine = () => db.notification.findFirstOrThrow({ where: { commentId: c.id }, select: { excerpt: true } }).then((n) => n.excerpt);
    expectOk(await deleteComment(c.id));
    assert.ok((await db.taskComment.findUniqueOrThrow({ where: { id: c.id } })).deletedAt, "queda el marcador");
    assert.equal(await mine(), "");
    expectOk(await undoLast(f.project.id));
    assert.equal(await mine(), "@Bea texto secreto");
    expectOk(await redoLast(f.project.id));
    assert.equal(await mine(), "");
  });

  test("avisos antiguos sin commentId: se localizan por la heurística (autor, minuto y extracto)", async () => {
    const { f, task, body } = await setup();
    const c = expectOk(await addComment(task.id, body));
    await db.notification.updateMany({ where: { commentId: c.id }, data: { commentId: null } });
    expectOk(await deleteComment(c.id));
    assert.deepEqual(await excerpts(task.id), [""]);
    expectOk(await undoLast(f.project.id));
    assert.deepEqual(await excerpts(task.id), ["@Bea texto secreto"]);
    expectOk(await redoLast(f.project.id));
    assert.deepEqual(await excerpts(task.id), [""]);
  });

  test("deshacer el alta de una tarea con comentarios: sus avisos se van con ella (clave ajena en cascada)", async () => {
    const { f, task, body } = await setup();
    const c = expectOk(await addComment(task.id, body));
    assert.equal(await db.notification.count({ where: { commentId: c.id } }), 1);
    await applyUndo(f.project.id, [{ t: "task.remove", id: task.id }]);
    assert.equal(await db.task.count({ where: { id: task.id } }), 0);
    assert.equal(await db.notification.count({ where: { commentId: c.id } }), 0);
  });
});
