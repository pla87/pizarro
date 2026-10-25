// Despliegue de releases: tareas que ya no están y despliegues simultáneos, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { deployRelease } from "../../src/actions/releases";
import { undoLast } from "../../src/actions/undo";

async function setup() {
  const user = await makeUser();
  const f = await makeProject({ members: [user] });
  const prod = await db.column.create({ data: { projectId: f.project.id, name: "En producción", position: 4000, role: "IN_PRODUCTION" } });
  await loginAs(user);
  return { f, prod };
}

describe("deployRelease", () => {
  test("rechaza el despliegue si alguna tarea se archivó o borró mientras tanto (y no crea la release)", async () => {
    const { f } = await setup();
    const ok = await makeTask(f, { columnId: f.columns.done });
    const archived = await makeTask(f, { columnId: f.columns.done });
    const deleted = await makeTask(f, { columnId: f.columns.done });
    await db.task.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    await db.task.delete({ where: { id: deleted.id } });
    const input = { projectId: f.project.id, title: "R", content: "Cambios", destination: "IN_PRODUCTION" as const };
    expectFail(await deployRelease({ ...input, taskIds: [ok.id, archived.id] }), /Una de las tareas ya no está en el tablero/);
    expectFail(await deployRelease({ ...input, taskIds: [ok.id, archived.id, deleted.id] }), /2 de las tareas ya no están/);
    assert.equal(await db.release.count({ where: { projectId: f.project.id } }), 0);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: ok.id } })).columnId, f.columns.done);
    // Una tarea repetida en la lista no cuenta como perdida.
    expectOk(await deployRelease({ ...input, taskIds: [ok.id, ok.id] }));
  });

  test("dos despliegues a la vez del mismo proyecto salen con números consecutivos", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { columnId: f.columns.done });
    const b = await makeTask(f, { columnId: f.columns.done });
    const input = { projectId: f.project.id, content: "Cambios", destination: "IN_PRODUCTION" as const };
    const results = await Promise.all([
      deployRelease({ ...input, title: "A", taskIds: [a.id] }),
      deployRelease({ ...input, title: "B", taskIds: [b.id] }),
    ]);
    for (const r of results) expectOk(r);
    const numbers = (await db.release.findMany({ where: { projectId: f.project.id }, select: { number: true } })).map((r) => r.number).sort();
    assert.deepEqual(numbers, [1, 2]);
  });

  test("al desplegar, las tareas que salen llevan el código de la release en el título y deshacer lo restaura", async () => {
    const { f, prod } = await setup();
    const a = await makeTask(f, { title: "Uno", columnId: f.columns.done, position: 1000 });
    const b = await makeTask(f, { title: "R1F9: Dos", columnId: f.columns.done, position: 2000 });
    const fija = await makeTask(f, { title: "Fija", columnId: f.columns.done, position: 3000 });
    await db.task.update({ where: { id: fija.id }, data: { evergreen: true } });
    const res = expectOk(await deployRelease({ projectId: f.project.id, title: "R", content: "Cambios", destination: "IN_PRODUCTION", taskIds: [a.id, b.id, fija.id] }));
    const titles = async () => Object.fromEntries((await db.task.findMany({ where: { id: { in: [a.id, b.id, fija.id] } } })).map((t) => [t.id, t.title]));
    let now = await titles();
    assert.match(now[a.id]!, /^R1[A-Z]+1: Uno$/);
    // Un código anterior se sustituye, no se acumula; la fija no se renombra.
    assert.match(now[b.id]!, /^R1[A-Z]+2: Dos$/);
    assert.equal(now[fija.id], "Fija");
    // El texto del histórico conserva el título tal cual lo vio la release.
    const rts = await db.releaseTask.findMany({ where: { releaseId: res.releaseId }, orderBy: { title: "asc" } });
    assert.deepEqual(rts.map((r) => r.title).sort(), ["Fija", "R1F9: Dos", "Uno"]);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: a.id } })).columnId, prod.id);
    expectOk(await undoLast(f.project.id));
    now = await titles();
    assert.deepEqual(now, { [a.id]: "Uno", [b.id]: "R1F9: Dos", [fija.id]: "Fija" });
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: a.id } })).columnId, f.columns.done);
  });
});
