// Mover columnas a la vez: moveColumn lee y renumera las posiciones con el bloqueo de las columnas del proyecto (el de
// crear y borrar columnas), así que un movimiento parte siempre de lo que dejó el anterior y ninguno se pierde.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import pg from "pg";
import { columnsLockName } from "../../src/lib/advisory-locks";
import { db, expectApplied, expectOk, loginAs, makeProject, makeUser, waitForLockWaiter } from "./helpers";
import { moveColumn, placeColumn } from "../../src/actions/columns";
import { undoChecked, undoLast } from "../../src/actions/undo";

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
  test("ocupa el sitio de la columna sobre la que se suelta, renumera, un solo deshacer; sobre sí misma no hace nada", async () => {
    const user = await makeUser();
    await loginAs(user);
    const f = await makeProject({ members: [user] });
    // De la derecha: delante de la de destino.
    expectOk(await placeColumn(f.columns.done, f.columns.todo));
    assert.deepEqual((await names(f.project.id)).map((r) => r.name), ["Hecho", "Por hacer", "En curso"]);
    // De la izquierda: detrás.
    expectOk(await placeColumn(f.columns.done, f.columns.doing));
    assert.deepEqual((await names(f.project.id)).map((r) => r.name), ["Por hacer", "En curso", "Hecho"]);
    const entries = await db.undoEntry.count({ where: { userId: user.id, projectId: f.project.id, kind: "UNDO" } });
    expectOk(await placeColumn(f.columns.done, f.columns.done));
    assert.equal(await db.undoEntry.count({ where: { userId: user.id, projectId: f.project.id, kind: "UNDO" } }), entries, "en su sitio: sin deshacer");
    expectOk(await undoLast(f.project.id));
    assert.deepEqual((await names(f.project.id)).map((r) => r.name), ["Hecho", "Por hacer", "En curso"]);
  });

  test("con columnas nuevas que el tablero aún no veía, acaba junto a la de destino", async () => {
    const user = await makeUser();
    await loginAs(user);
    const f = await makeProject({ members: [user] });
    // Otra persona crea una columna al principio (el tablero de quien arrastra todavía no la tiene).
    await db.column.create({ data: { projectId: f.project.id, name: "Nueva", position: 1 } });
    expectOk(await placeColumn(f.columns.done, f.columns.todo));
    assert.deepEqual((await names(f.project.id)).map((r) => r.name), ["Nueva", "Hecho", "Por hacer", "En curso"]);
    // Destino borrado entretanto: no se mueve nada.
    const gone = await db.column.create({ data: { projectId: f.project.id, name: "Borrada", position: 99_999 }, select: { id: true } });
    await db.column.delete({ where: { id: gone.id } });
    expectOk(await placeColumn(f.columns.doing, gone.id));
    assert.deepEqual((await names(f.project.id)).map((r) => r.name), ["Nueva", "Hecho", "Por hacer", "En curso"]);
  });
});

/** Las consultas SQL que se lanzan mientras corre `fn` (el adaptador de Prisma llama a pg.Client.query). */
async function sqlDuring(fn: () => Promise<unknown>): Promise<string[]> {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const orig = proto.query;
  const sql: string[] = [];
  proto.query = function (this: unknown, ...args: unknown[]) {
    const q = args[0];
    sql.push(typeof q === "string" ? q : String((q as { text?: string } | undefined)?.text ?? ""));
    return orig.apply(this, args);
  };
  try {
    await fn();
    return sql;
  } finally {
    proto.query = orig;
  }
}

describe("Alt+flechas sobre una columna (moveColumn): solo las que cambian", () => {
  test("con seis columnas, cambia y guarda en el deshacer solo las dos que se intercambian", async () => {
    const user = await makeUser();
    await loginAs(user);
    const f = await makeProject({ members: [user] });
    await db.column.deleteMany({ where: { projectId: f.project.id } });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await db.column.create({ data: { projectId: f.project.id, name: `C${i}`, position: (i + 1) * 1024 }, select: { id: true } })).id);
    const sql = await sqlDuring(async () => expectOk(await moveColumn(ids[2]!, 1)));
    assert.deepEqual((await names(f.project.id)).map((r) => r.name), ["C0", "C1", "C3", "C2", "C4", "C5"]);
    assert.equal(sql.filter((q) => /^\s*UPDATE "public"\."Column"/.test(q)).length, 2, "solo se escriben las dos");
    const entry = await db.undoEntry.findFirstOrThrow({ where: { userId: user.id, projectId: f.project.id, kind: "UNDO" }, orderBy: { createdAt: "desc" }, select: { ops: true } });
    const ops = entry.ops as { t: string; id: string; data: { position: number } }[];
    assert.deepEqual(ops.map((op) => [op.t, op.id, op.data.position]).sort(), [["column.set", ids[2]!, 3072], ["column.set", ids[3]!, 4096]].sort());
    expectOk(await undoLast(f.project.id));
    assert.deepEqual((await names(f.project.id)).map((r) => r.name), ["C0", "C1", "C2", "C3", "C4", "C5"]);
  });

  test("deshacer no devuelve a su sitio las columnas que otra persona movió después", async () => {
    const ana = await makeUser();
    const luis = await makeUser();
    const f = await makeProject({ members: [ana, luis] });
    // Posiciones ya numeradas (las de makeProject, 1000/2000/3000, se renumerarían todas al primer movimiento).
    for (const [i, id] of [f.columns.todo, f.columns.doing, f.columns.done].entries()) await db.column.update({ where: { id }, data: { position: (i + 1) * 1024 } });
    await db.column.create({ data: { projectId: f.project.id, name: "Cuarta", position: 4096 } });
    // Ana: «Por hacer» a la derecha. Luis: «Hecho» a la derecha (las dos últimas).
    await loginAs(ana);
    expectOk(await moveColumn(f.columns.todo, 1));
    await loginAs(luis);
    expectOk(await moveColumn(f.columns.done, 1));
    assert.deepEqual((await names(f.project.id)).map((r) => r.name), ["En curso", "Por hacer", "Cuarta", "Hecho"]);
    // Ana deshace sin que se le pregunte (Luis no tocó las suyas) y lo de Luis se queda.
    await loginAs(ana);
    expectApplied(await undoChecked(f.project.id));
    assert.deepEqual((await names(f.project.id)).map((r) => r.name), ["Por hacer", "En curso", "Cuarta", "Hecho"]);
  });
});
