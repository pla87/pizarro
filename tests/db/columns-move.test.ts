// Mover columnas a la vez: moveColumn lee y renumera las posiciones con el bloqueo de las columnas del proyecto (el de
// crear y borrar columnas), así que un movimiento parte siempre de lo que dejó el anterior y ninguno se pierde.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { columnsLockName } from "../../src/lib/advisory-locks";
import { db, expectOk, loginAs, makeProject, makeUser, waitForLockWaiter } from "./helpers";
import { moveColumn, placeColumn } from "../../src/actions/columns";
import { undoLast } from "../../src/actions/undo";

const names = async (projectId: string) =>
  (await db.column.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { name: true, position: true } }));

describe("mover columnas a la vez", () => {
  test("un movimiento espera al que está en curso y parte de sus posiciones (también su deshacer)", async () => {
    const user = await makeUser();
    await loginAs(user);
    const f = await makeProject({ members: [user] });
    let pending: ReturnType<typeof moveColumn> | null = null;
    await db.$transaction(async (tx) => {
      // Otro movimiento en curso: «Hecho» pasa delante de «En curso», todavía sin confirmar.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${columnsLockName(f.project.id)}))`;
      await tx.column.update({ where: { id: f.columns.doing }, data: { position: 3000 }, select: { id: true } });
      await tx.column.update({ where: { id: f.columns.done }, data: { position: 2000 }, select: { id: true } });
      pending = moveColumn(f.columns.todo, 1);
      await waitForLockWaiter();
    }, { timeout: 10_000 });
    expectOk(await pending!);
    const rows = await names(f.project.id);
    assert.deepEqual(rows.map((r) => r.name), ["Hecho", "Por hacer", "En curso"]);
    assert.deepEqual(rows.map((r) => r.position), [1024, 2048, 3072]);
    const entry = await db.undoEntry.findFirstOrThrow({ where: { userId: user.id, projectId: f.project.id, kind: "UNDO" }, orderBy: { createdAt: "desc" }, select: { ops: true } });
    const saved = new Map((entry.ops as { id: string; data: { position: number } }[]).map((op) => [op.id, op.data.position]));
    assert.deepEqual([saved.get(f.columns.todo), saved.get(f.columns.done), saved.get(f.columns.doing)], [1000, 2000, 3000]);
  });

  test("dos movimientos a la vez: se aplican los dos, uno tras otro, sin posiciones repetidas", async () => {
    const user = await makeUser();
    await loginAs(user);
    for (let round = 0; round < 3; round++) {
      const f = await makeProject({ members: [user] });
      let pending: Promise<unknown>[] = [];
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${columnsLockName(f.project.id)}))`;
        pending = [moveColumn(f.columns.todo, 1), moveColumn(f.columns.done, -1)];
        await waitForLockWaiter();
      }, { timeout: 10_000 });
      for (const r of await Promise.all(pending)) expectOk(r as Awaited<ReturnType<typeof moveColumn>>);
      const rows = await names(f.project.id);
      assert.equal(new Set(rows.map((r) => r.position)).size, rows.length, JSON.stringify(rows));
      // «Por hacer» a la derecha y luego «Hecho» a la izquierda, o al revés.
      const order = rows.map((r) => r.name).join(" | ");
      assert.ok(["En curso | Hecho | Por hacer", "Hecho | Por hacer | En curso"].includes(order), order);
    }
  });
});

describe("arrastrar una columna a otro sitio (placeColumn)", () => {
  test("la lleva a esa posición, renumera, un solo deshacer; en su sitio no hace nada", async () => {
    const user = await makeUser();
    await loginAs(user);
    const f = await makeProject({ members: [user] });
    expectOk(await placeColumn(f.columns.done, 0));
    assert.deepEqual((await names(f.project.id)).map((r) => r.name), ["Hecho", "Por hacer", "En curso"]);
    expectOk(await placeColumn(f.columns.done, 7));
    assert.deepEqual((await names(f.project.id)).map((r) => r.name), ["Por hacer", "En curso", "Hecho"]);
    const entries = await db.undoEntry.count({ where: { userId: user.id, projectId: f.project.id, kind: "UNDO" } });
    expectOk(await placeColumn(f.columns.done, 2));
    assert.equal(await db.undoEntry.count({ where: { userId: user.id, projectId: f.project.id, kind: "UNDO" } }), entries, "en su sitio: sin deshacer");
    expectOk(await undoLast(f.project.id));
    assert.deepEqual((await names(f.project.id)).map((r) => r.name), ["Hecho", "Por hacer", "En curso"]);
  });
});
