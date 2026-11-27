// «Añadir columna»: va justo antes de la primera columna terminada («Hecho») o, si no hay ninguna, al final; el servidor
// devuelve las posiciones nuevas de las que corre y deshacer lo deja todo como estaba.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createColumn } from "../../src/actions/columns";
import { undoLast } from "../../src/actions/undo";
import { db, expectOk, loginAs, makeProject, makeUser } from "./helpers";

const order = async (projectId: string) =>
  (await db.column.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { name: true, position: true } }));

describe("añadir columna", () => {
  test("va antes de la primera terminada, corre las de detrás y deshacer las devuelve", async () => {
    const user = await makeUser();
    await loginAs(user);
    const f = await makeProject({ members: [user] });
    const created = expectOk(await createColumn(f.project.id, "Revisión"));
    assert.deepEqual((await order(f.project.id)).map((c) => c.name), ["Por hacer", "En curso", "Revisión", "Hecho"]);
    // «Hecho» (3000 antes) se ha corrido; el servidor lo dice para que el tablero no recargue.
    assert.equal(created.position, 3 * 1024);
    assert.deepEqual(created.moved.find((m) => m.id === f.columns.done), { id: f.columns.done, position: 4 * 1024 });
    expectOk(await undoLast(f.project.id));
    assert.deepEqual(await order(f.project.id), [{ name: "Por hacer", position: 1000 }, { name: "En curso", position: 2000 }, { name: "Hecho", position: 3000 }]);
  });

  test("sin ninguna terminada, al final", async () => {
    const user = await makeUser();
    await loginAs(user);
    const f = await makeProject({ members: [user] });
    await db.column.update({ where: { id: f.columns.done }, data: { isDone: false } });
    const created = expectOk(await createColumn(f.project.id, "Nueva"));
    assert.deepEqual((await order(f.project.id)).map((c) => c.name), ["Por hacer", "En curso", "Hecho", "Nueva"]);
    // Al final y sin correr ninguna (el deshacer no toca lo de otras personas).
    assert.deepEqual(created.moved, []);
    assert.equal(created.position, 3000 + 1024);
  });
});
