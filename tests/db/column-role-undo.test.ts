// Asignar un rol de columna único: deshacer y rehacer devuelven el rol y las tareas fijas a su sitio.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { setColumnRole } from "../../src/actions/columns";
import { redoLast, undoLast } from "../../src/actions/undo";
import { flushLogs } from "../../src/lib/log";

const roles = async (f: Awaited<ReturnType<typeof makeProject>>) =>
  Object.fromEntries((await db.column.findMany({ where: { projectId: f.project.id } })).map((c) => [c.id, c.role]));

for (const role of ["NEXT_RELEASE", "IN_PRODUCTION"] as const) {
  describe(`rol ${role}: poner, deshacer, rehacer`, () => {
    test("el rol vuelve a la columna original y las tareas no se mueven", async () => {
      const user = await makeUser();
      const f = await makeProject();
      await loginAs(user);
      expectOk(await setColumnRole(f.columns.todo, role));
      const fixed = await makeTask(f, { title: "Fija", columnId: f.columns.todo, position: 1500 });
      if (role === "NEXT_RELEASE") await db.task.update({ where: { id: fixed.id }, data: { evergreen: true, evergreenEvery: 3 } });
      const other = await makeTask(f, { columnId: f.columns.doing, position: 2500 });
      const start = await roles(f);
      assert.equal(start[f.columns.todo], role);

      expectOk(await setColumnRole(f.columns.doing, role));
      const after = await roles(f);
      assert.equal(after[f.columns.todo], "NONE");
      assert.equal(after[f.columns.doing], role);
      if (role === "NEXT_RELEASE") assert.equal((await db.task.findUniqueOrThrow({ where: { id: fixed.id } })).evergreen, false);

      const res = expectOk(await undoLast(f.project.id));
      assert.equal(res.skipped, 0);
      assert.deepEqual(await roles(f), start);
      const back = await db.task.findUniqueOrThrow({ where: { id: fixed.id } });
      assert.equal(back.columnId, f.columns.todo);
      assert.equal(back.position, 1500);
      if (role === "NEXT_RELEASE") {
        assert.equal(back.evergreen, true);
        assert.equal(back.evergreenEvery, 3);
      }
      const o = await db.task.findUniqueOrThrow({ where: { id: other.id } });
      assert.equal(o.columnId, f.columns.doing);
      assert.equal(o.position, 2500);

      const redo = expectOk(await redoLast(f.project.id));
      assert.equal(redo.skipped, 0);
      assert.deepEqual(await roles(f), after);
      if (role === "NEXT_RELEASE") assert.equal((await db.task.findUniqueOrThrow({ where: { id: fixed.id } })).evergreen, false);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: fixed.id } })).columnId, f.columns.todo);

      expectOk(await undoLast(f.project.id));
      assert.deepEqual(await roles(f), start);
    });
  });
}

// Antes, elegir en el submenú el rol que la columna ya tenía anotaba «Cambió el rol de la columna» y creaba un deshacer
// que no deshacía nada.
describe("rol que la columna ya tiene", () => {
  test("no anota nada en el registro ni crea deshacer", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await loginAs(user);
    expectOk(await setColumnRole(f.columns.todo, "WAITING"));
    await flushLogs();
    const count = async () => ({
      undo: await db.undoEntry.count({ where: { projectId: f.project.id } }),
      logs: await db.appLog.count({ where: { projectId: f.project.id, action: "columns.setColumnRole", message: { contains: "Cambió el rol" } } }),
    });
    const before = await count();
    assert.deepEqual([before.undo, before.logs], [1, 1]);
    const res = expectOk(await setColumnRole(f.columns.todo, "WAITING"));
    assert.equal(res.costEnabled, false);
    await flushLogs();
    assert.deepEqual(await count(), before);
    assert.equal((await roles(f))[f.columns.todo], "WAITING");
  });
});
