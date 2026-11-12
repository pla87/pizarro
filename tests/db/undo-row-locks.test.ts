// Deshacer muchas tarjetas a la vez bloquea sus filas en orden de id (lockTaskRows) antes de las sentencias por lotes
// (UPDATE … FROM (VALUES …), DELETE … ANY y la limpieza de tareas fijas fuera de su columna): otra persona que mueve o
// archiva esas mismas tarjetas en bloque (también en orden de id) espera en vez de cruzarse con él (40P01).
// Lo mismo para «Mover a…» y archivar en bloque (moveTasks, archiveTasks), y el tipo de bloqueo de lockTaskRows (FOR NO
// KEY UPDATE: no frena las altas que solo apuntan a la tarea). Contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import pg from "pg";
import { db, loginAs, makeProject, makeTask, makeUser, type Fixture } from "./helpers";
import { applyUndo, type UndoOp } from "../../src/lib/undo";
import { archiveTasks, moveTasks } from "../../src/actions/tasks";
import { lockTaskRows } from "../../src/lib/task-positions";

/**
 * Otra conexión bloquea la tarea de id menor y `run` se queda esperándola. Con el bloqueo en orden de id aún no ha
 * tocado la de id mayor; sin él, podría tenerla ya bloqueada (la recorre antes) y cruzarse con otra acción en bloque.
 * Devuelve si la de id mayor estaba bloqueada mientras `run` esperaba.
 */
async function locksHigherFirst([low, high]: [string, string], run: () => Promise<unknown>): Promise<boolean> {
  const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const probe = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await holder.connect();
  await probe.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(`SELECT 1 FROM "Task" WHERE "id" = $1 FOR UPDATE`, [low]);
    const pending = run();
    let waited = false;
    for (let i = 0; i < 250; i++) {
      const { rows } = await probe.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype IN ('transactionid', 'tuple') AND NOT granted`);
      if (rows[0].n > 0) { waited = true; break; }
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(waited, "la operación debería esperar a la fila bloqueada");
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
async function pair(f: Fixture, data: { evergreen?: boolean } = {}): Promise<[string, string]> {
  const a = await makeTask(f, { position: 1000 });
  const b = await makeTask(f, { position: 2000 });
  const [low, high] = [a.id, b.id].sort() as [string, string];
  await db.task.update({ where: { id: high }, data: { position: 500, ...data } });
  await db.task.update({ where: { id: low }, data: { position: 3000, ...data } });
  return [low, high];
}

describe("deshacer en bloque: filas bloqueadas en orden de id", () => {
  test("lote de task.set (UPDATE … FROM VALUES): espera a la de id menor sin haber tocado la otra", async () => {
    const f = await makeProject();
    const [low, high] = await pair(f);
    // applyUndo aplica de la última a la primera: la de id mayor va primero en el VALUES.
    const ops: UndoOp[] = [
      { t: "task.set", id: low, data: { columnId: f.columns.doing, position: 3000 } },
      { t: "task.set", id: high, data: { columnId: f.columns.doing, position: 500 } },
    ];
    assert.equal(await locksHigherFirst([low, high], () => applyUndo(f.project.id, ops)), false);
    assert.equal(await db.task.count({ where: { id: { in: [low, high] }, columnId: f.columns.doing } }), 2);
  });

  test("lote de task.remove (DELETE … ANY): espera a la de id menor sin haber tocado la otra", async () => {
    const f = await makeProject();
    const [low, high] = await pair(f);
    const ops: UndoOp[] = [{ t: "task.remove", id: low }, { t: "task.remove", id: high }];
    assert.equal(await locksHigherFirst([low, high], () => applyUndo(f.project.id, ops)), false);
    assert.equal(await db.task.count({ where: { id: { in: [low, high] } } }), 0);
  });

  test("lote de task.remove: bloquea con FOR UPDATE antes del DELETE (ninguna alta nueva apunta a lo que va a borrar)", async () => {
    const f = await makeProject();
    const [low, high] = await pair(f);
    const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const probe = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    await probe.connect();
    try {
      // Una alta en curso que apunta a la tarea de id mayor (un comentario: FOR KEY SHARE).
      await holder.query("BEGIN");
      await holder.query(`SELECT 1 FROM "Task" WHERE "id" = $1 FOR KEY SHARE`, [high]);
      const pending = applyUndo(f.project.id, [{ t: "task.remove", id: low }, { t: "task.remove", id: high }]);
      let waited = false;
      for (let i = 0; i < 250 && !waited; i++) {
        const { rows } = await probe.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype IN ('transactionid', 'tuple') AND NOT granted`);
        waited = rows[0].n > 0;
        if (!waited) await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(waited, "el deshacer debería esperar a la alta en curso");
      // Mientras espera, la de id menor ya está bloqueada para borrarla: otra alta sobre ella tiene que esperar.
      let blocked = false;
      await probe.query("BEGIN");
      try {
        await probe.query(`SELECT 1 FROM "Task" WHERE "id" = $1 FOR KEY SHARE NOWAIT`, [low]);
      } catch (err) {
        blocked = (err as { code?: string }).code === "55P03";
      }
      await probe.query("ROLLBACK");
      await holder.query("COMMIT");
      assert.equal(await pending, 0);
      assert.ok(blocked, "con FOR NO KEY UPDATE una alta podría colarse sobre una tarea a punto de borrarse");
      assert.equal(await db.task.count({ where: { id: { in: [low, high] } } }), 0);
    } finally {
      await holder.end();
      await probe.end();
    }
  });

  test("tareas fijas fuera de la columna de la release: se limpian bloqueando en orden de id", async () => {
    const f = await makeProject();
    // El proyecto de prueba no tiene columna «Siguiente salto»: las dos fijas están fuera de su sitio.
    const [low, high] = await pair(f, { evergreen: true });
    assert.equal(await locksHigherFirst([low, high], () => applyUndo(f.project.id, [])), false);
    assert.equal(await db.task.count({ where: { id: { in: [low, high] }, evergreen: true } }), 0);
  });

  test("dos deshacer en bloque cruzados sobre las mismas tarjetas terminan los dos (sin 40P01)", async () => {
    const f = await makeProject();
    const tasks = await Promise.all(Array.from({ length: 30 }, (_, i) => makeTask(f, { position: (i + 1) * 1000 })));
    const ids = tasks.map((t) => t.id);
    const forward: UndoOp[] = ids.map((id, i) => ({ t: "task.set", id, data: { columnId: f.columns.doing, position: (i + 1) * 1000 } }));
    const backward: UndoOp[] = [...ids].reverse().map((id, i) => ({ t: "task.set", id, data: { columnId: f.columns.done, position: (i + 1) * 1000 } }));
    for (let round = 0; round < 5; round++) {
      const skipped = await Promise.all([applyUndo(f.project.id, forward), applyUndo(f.project.id, backward)]);
      assert.deepEqual(skipped, [0, 0], `ronda ${round}`);
    }
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
