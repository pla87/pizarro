// Borrar columnas a la vez: un proyecto nunca se queda sin columnas (bloqueo de las columnas del proyecto dentro de la
// transacción, el mismo que al crearlas), tampoco al deshacer la creación de una columna mientras se borra otra.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { createColumn, deleteColumn } from "../../src/actions/columns";
import { undoEntry } from "../../src/actions/undo";

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
