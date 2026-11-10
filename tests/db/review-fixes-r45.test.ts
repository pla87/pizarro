// Revisión: avisos de comentarios localizados por su id (editar más tarde, deshacer la edición, borrar, volver a
// mencionar), borrado que relee el comentario bloqueado, bloqueos en orden de id de las acciones en bloque y cid de
// las acciones de comentarios. Contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import pg from "pg";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { addComment, archiveTasks, deleteComment, editComment, moveTasks } from "../../src/actions/tasks";
import { undoLast } from "../../src/actions/undo";
import { mentionToken } from "../../src/lib/mentions";
import { subscribeProject } from "../../src/lib/realtime";

const secret = (taskId: string) => db.notification.count({ where: { taskId, excerpt: { contains: "secreto" } } });

/** Lleva el comentario y sus avisos `seconds` atrás (como si se hubiera escrito hace un rato). */
async function age(commentId: string, taskId: string, seconds: number) {
  await db.$executeRaw`UPDATE "TaskComment" SET "createdAt" = "createdAt" - make_interval(secs => ${seconds}) WHERE "id" = ${commentId}`;
  await db.$executeRaw`UPDATE "Notification" SET "createdAt" = "createdAt" - make_interval(secs => ${seconds}) WHERE "taskId" = ${taskId}`;
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

describe("acciones en bloque: filas bloqueadas en orden de id", () => {
  /**
   * Otra conexión bloquea la tarea de id menor y la acción se queda esperándola. Con el bloqueo en orden de id aún no ha
   * tocado la de id mayor (que va antes en la columna y en el disco); sin él, ya la tendría bloqueada, y otra acción que
   * bloqueara en orden de id (el despliegue de una release) se cruzaría con ella (40P01).
   */
  async function locksHigherFirst([low, high]: [string, string], run: (ids: string[]) => Promise<unknown>): Promise<boolean> {
    const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const probe = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    await probe.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT 1 FROM "Task" WHERE "id" = $1 FOR UPDATE`, [low]);
      const pending = run([high, low]);
      // Hasta que la acción esté esperando la fila bloqueada.
      for (let i = 0; i < 200; i++) {
        const { rows } = await probe.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype IN ('transactionid', 'tuple') AND NOT granted`);
        if (rows[0].n > 0) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      let highLocked = false;
      await probe.query("BEGIN");
      try {
        await probe.query(`SELECT 1 FROM "Task" WHERE "id" = $1 FOR UPDATE NOWAIT`, [high]);
      } catch (err) {
        highLocked = (err as { code?: string }).code === "55P03";
      }
      await probe.query("ROLLBACK");
      await holder.query("COMMIT");
      await pending;
      return highLocked;
    } finally {
      await holder.end();
      await probe.end();
    }
  }

  /** Dos tareas: la de id mayor, primera en la columna y en el disco (la de id menor se reescribe después). */
  async function pair(f: Awaited<ReturnType<typeof makeProject>>): Promise<[string, string]> {
    const a = await makeTask(f, { position: 1000 });
    const b = await makeTask(f, { position: 2000 });
    const [low, high] = [a.id, b.id].sort() as [string, string];
    await db.task.update({ where: { id: high }, data: { position: 500 } });
    await db.task.update({ where: { id: low }, data: { position: 3000 } });
    return [low, high];
  }

  test("moveTasks y archiveTasks bloquean primero la de id menor", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const moving = await pair(f);
    assert.equal(await locksHigherFirst(moving, (ids) => moveTasks(ids, f.columns.doing)), false, "moveTasks");
    assert.equal(await db.task.count({ where: { id: { in: moving }, columnId: f.columns.doing } }), 2);
    const archiving = await pair(f);
    assert.equal(await locksHigherFirst(archiving, (ids) => archiveTasks(ids)), false, "archiveTasks");
    assert.equal(await db.task.count({ where: { id: { in: archiving }, archivedAt: { not: null } } }), 2);
  });
});
