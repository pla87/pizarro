// Borrar columnas a la vez: un proyecto nunca se queda sin columnas (bloqueo de las columnas del proyecto dentro de la
// transacción, el mismo que al crearlas), tampoco al deshacer la creación de una columna mientras se borra otra.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { createColumn, deleteColumn, moveColumn } from "../../src/actions/columns";
import { undoEntry, undoLast } from "../../src/actions/undo";

const columns = (projectId: string) => db.column.count({ where: { projectId } });

describe("borrar columnas a la vez", () => {
  test("borrar a la vez las dos últimas columnas: se borra una y la otra se queda", async () => {
    const user = await makeUser();
    await loginAs(user);
    for (let round = 0; round < 5; round++) {
      const f = await makeProject({ members: [user] });
      expectOk(await deleteColumn(f.columns.done));
      const results = await Promise.all([deleteColumn(f.columns.todo), deleteColumn(f.columns.doing)]);
      assert.equal(results.filter((r) => r.ok).length, 1, "solo una de las dos");
      const failed = results.find((r) => !r.ok);
      assert.ok(failed && !failed.ok && /al menos una columna/.test(failed.error), JSON.stringify(results));
      assert.equal(await columns(f.project.id), 1);
    }
  });

  test("deshacer la creación de una columna mientras se borra la otra: queda una", async () => {
    const user = await makeUser();
    await loginAs(user);
    for (let round = 0; round < 5; round++) {
      const f = await makeProject({ members: [user] });
      expectOk(await deleteColumn(f.columns.done));
      expectOk(await deleteColumn(f.columns.doing));
      const created = expectOk(await createColumn(f.project.id, "Nueva"));
      const entry = await db.undoEntry.findFirstOrThrow({ where: { userId: user.id, projectId: f.project.id, kind: "UNDO" }, orderBy: { createdAt: "desc" }, select: { id: true, ops: true } });
      assert.deepEqual(entry.ops, [{ t: "column.remove", id: created.id }]);
      await Promise.all([deleteColumn(f.columns.todo), undoEntry(entry.id)]);
      assert.equal(await columns(f.project.id), 1);
    }
  });
});

// Deshacer devuelve una columna a su posición guardada; si otra persona ha creado entretanto una columna que ocupa esa
// misma posición, se renumeran: sin empates (el tablero ordena por posición) y la que vuelve, en su sitio de antes.
describe("deshacer no deja columnas en la misma posición", () => {
  const order = async (projectId: string) => (await db.column.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { name: true, position: true } }));
  const noTies = (rows: { position: number }[]) => assert.equal(new Set(rows.map((r) => r.position)).size, rows.length, JSON.stringify(rows));

  test("borrar la última columna, otra persona crea una y deshacer", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const f = await makeProject({ members: [a, b] });
    await db.column.update({ where: { id: f.columns.done }, data: { position: 4096 } });
    await loginAs(a);
    expectOk(await deleteColumn(f.columns.done));
    await loginAs(b);
    const created = expectOk(await createColumn(f.project.id, "Revisión"));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: created.id } })).position, 2000 + 1024);
    await db.column.update({ where: { id: created.id }, data: { position: 4096 } });
    await loginAs(a);
    expectOk(await undoLast(f.project.id));
    const rows = await order(f.project.id);
    noTies(rows);
    assert.deepEqual(rows.map((r) => r.name), ["Por hacer", "En curso", "Hecho", "Revisión"]);
  });

  test("mover una columna, otra persona crea una y deshacer", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const f = await makeProject({ members: [a, b] });
    // Sin columna terminada, la nueva va al final (con una, iría antes: columns-create.test.ts).
    await db.column.update({ where: { id: f.columns.done }, data: { position: 4096, isDone: false } });
    await loginAs(a);
    expectOk(await moveColumn(f.columns.todo, 1));
    await loginAs(b);
    const created = expectOk(await createColumn(f.project.id, "Revisión"));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: created.id } })).position, 4096);
    await loginAs(a);
    expectOk(await undoLast(f.project.id));
    const rows = await order(f.project.id);
    noTies(rows);
    assert.deepEqual(rows.map((r) => r.name), ["Por hacer", "En curso", "Hecho", "Revisión"]);
  });
});
