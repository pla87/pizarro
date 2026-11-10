// Revisión: deshacer y rehacer altas y borrados de comentarios vacía o devuelve el extracto de sus avisos (como
// deleteComment), también en los avisos antiguos sin commentId; y el bloqueo de filas de las acciones en bloque no
// frena las altas que solo apuntan a la tarea. Contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import pg from "pg";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { addComment, deleteComment } from "../../src/actions/tasks";
import { redoLast, undoLast } from "../../src/actions/undo";
import { mentionToken } from "../../src/lib/mentions";
import { lockTaskRows } from "../../src/lib/task-positions";
import { applyUndo } from "../../src/lib/undo";

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

describe("lockTaskRows", () => {
  test("FOR NO KEY UPDATE: no frena las altas que apuntan a la tarea (FOR KEY SHARE) y sí otro bloqueo de la fila", async () => {
    const f = await makeProject();
    const task = await makeTask(f);
    const probe = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await probe.connect();
    try {
      await db.$transaction(async (tx) => {
        await lockTaskRows(tx, [task.id]);
        await probe.query("BEGIN");
        try {
          await probe.query(`SELECT 1 FROM "Task" WHERE "id" = $1 FOR KEY SHARE NOWAIT`, [task.id]);
        } finally {
          await probe.query("ROLLBACK");
        }
        await probe.query("BEGIN");
        let code: string | undefined;
        try {
          await probe.query(`SELECT 1 FROM "Task" WHERE "id" = $1 FOR NO KEY UPDATE NOWAIT`, [task.id]);
        } catch (err) {
          code = (err as { code?: string }).code;
        } finally {
          await probe.query("ROLLBACK");
        }
        assert.equal(code, "55P03", "la fila sigue bloqueada para otra acción que la modifique");
      });
    } finally {
      await probe.end();
    }
  });
});
