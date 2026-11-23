// Asignar un rol de columna único: deshacer y rehacer devuelven el rol y las tareas fijas a su sitio (sin pisar el rol
// que otra persona puso entretanto).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser, expectApplied, type Fixture } from "./helpers";
import { deleteTask, moveTask } from "../../src/actions/tasks";
import { setColumnRole } from "../../src/actions/columns";
import { redoChecked, undoLast } from "../../src/actions/undo";
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

      const redo = expectApplied(await redoChecked(f.project.id));
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

describe("registro del cambio de rol y roles retirados", () => {
  test("el registro dice de qué rol a qué rol (plantilla traducible)", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await loginAs(user);
    const since = new Date();
    expectOk(await setColumnRole(f.columns.todo, "WAITING"));
    expectOk(await setColumnRole(f.columns.todo, "CHECKLIST"));
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { projectId: f.project.id, action: "columns.setColumnRole", createdAt: { gte: since } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { message: true, details: true } });
    assert.deepEqual(logs.map((l) => l.message), [
      "Cambió el rol de la columna «Por hacer» de «Sin rol» a «Esperando (avisa si tarda)»",
      "Cambió el rol de la columna «Por hacer» de «Esperando (avisa si tarda)» a «Lista consolidada»",
    ]);
    const label = (logs[1]!.details as Record<string, { k: string; p: Record<string, unknown> }>)["$msg"]!;
    assert.equal(label.k, "Cambió el rol de la columna «{name}» de «{from}» a «{to}»");
    assert.deepEqual([label.p.from, label.p.to], [{ k: "Esperando (avisa si tarda)" }, { k: "Lista consolidada" }]);
  });

  test("Agenda y Entrega al cliente ya no se escriben: pedirlos deja «Sin rol», y deshacer no los devuelve", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await loginAs(user);
    expectOk(await setColumnRole(f.columns.todo, "WAITING"));
    expectOk(await setColumnRole(f.columns.todo, "AGENDA"));
    assert.equal((await roles(f))[f.columns.todo], "NONE");
    // Una columna que aún lo tiene (de antes de la migración o tras volver a una versión anterior) y un deshacer guardado
    // con ese rol: vuelve como «Sin rol».
    await db.column.update({ where: { id: f.columns.doing }, data: { role: "DELIVERY" } });
    expectOk(await setColumnRole(f.columns.doing, "CHECKLIST"));
    expectOk(await undoLast(f.project.id));
    assert.equal((await roles(f))[f.columns.doing], "NONE");
  });
});

/** Dos personas con acceso a un proyecto nuevo. */
async function twoPeople(): Promise<{ a: { id: string }; b: { id: string }; f: Fixture }> {
  const a = await makeUser();
  const b = await makeUser();
  const f = await makeProject({ members: [a, b] });
  return { a, b, f };
}

describe("tareas fijas y roles de columna al deshacer", () => {
  test("deshacer el cambio de rol no pisa el rol que otra persona puso en otra columna", async () => {
    const { a, b, f } = await twoPeople();
    await db.column.update({ where: { id: f.columns.todo }, data: { role: "NEXT_RELEASE" } });
    await loginAs(a);
    expectOk(await setColumnRole(f.columns.doing, "NEXT_RELEASE"));
    const entry = await db.undoEntry.findFirstOrThrow({ where: { userId: a.id, projectId: f.project.id, kind: "UNDO" }, orderBy: { createdAt: "desc" } });
    const columnOps = (entry.ops as { t: string; id?: string }[]).filter((op) => op.t === "column.set").map((op) => op.id).sort();
    assert.deepEqual(columnOps, [f.columns.todo, f.columns.doing].sort(), "solo las dos columnas que cambian");
    await loginAs(b);
    expectOk(await setColumnRole(f.columns.done, "WAITING"));
    await loginAs(a);
    expectOk(await undoLast(f.project.id));
    const roles = Object.fromEntries((await db.column.findMany({ where: { projectId: f.project.id } })).map((c) => [c.id, c.role]));
    assert.deepEqual(roles, { [f.columns.todo]: "NEXT_RELEASE", [f.columns.doing]: "NONE", [f.columns.done]: "WAITING" });
  });

  test("una tarea fija que vuelve a una columna que ya no es la de la release pasa a normal", async () => {
    const { a, b, f } = await twoPeople();
    await db.column.update({ where: { id: f.columns.todo }, data: { role: "NEXT_RELEASE" } });
    const fixed = await makeTask(f, { title: "Fija", columnId: f.columns.todo });
    await db.task.update({ where: { id: fixed.id }, data: { evergreen: true, evergreenEvery: 2 } });
    const gone = await makeTask(f, { title: "Fija borrada", columnId: f.columns.todo, position: 3000 });
    await db.task.update({ where: { id: gone.id }, data: { evergreen: true } });
    await loginAs(a);
    expectOk(await moveTask(fixed.id, f.columns.doing, null, null));
    expectOk(await deleteTask(gone.id));
    // Entretanto, otra persona le quita el rol a la columna.
    await loginAs(b);
    expectOk(await setColumnRole(f.columns.todo, "NONE"));
    await loginAs(a);
    expectOk(await undoLast(f.project.id)); // borrado
    expectOk(await undoLast(f.project.id)); // movimiento
    for (const id of [fixed.id, gone.id]) {
      const t = await db.task.findUniqueOrThrow({ where: { id } });
      assert.equal(t.columnId, f.columns.todo);
      assert.deepEqual([t.evergreen, t.evergreenEvery], [false, 1]);
    }
  });
});
