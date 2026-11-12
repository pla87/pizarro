// Despliegue de releases: tareas que ya no están y despliegues simultáneos, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { deployRelease } from "../../src/actions/releases";
import { redoLast, undoLast } from "../../src/actions/undo";

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

  test("rechaza el despliegue si otra persona movió alguna tarea de columna desde que se generó el texto", async () => {
    const { f, prod } = await setup();
    const a = await makeTask(f, { title: "A", columnId: f.columns.done });
    const b = await makeTask(f, { title: "B", columnId: f.columns.done });
    // Al generar, las dos estaban en la columna de la release; luego otra persona devuelve «B» a «En curso».
    const columns = [{ taskId: a.id, columnId: f.columns.done }, { taskId: b.id, columnId: f.columns.done }];
    await db.task.update({ where: { id: b.id }, data: { columnId: f.columns.doing } });
    const input = { projectId: f.project.id, title: "R", content: "Cambios", destination: "IN_PRODUCTION" as const, taskIds: [a.id, b.id] };
    expectFail(await deployRelease({ ...input, columns }), /Una de las tareas se ha movido a otra columna mientras tanto: vuelve a generar la release/);
    assert.equal(await db.release.count({ where: { projectId: f.project.id } }), 0);
    // Nada sale a producción ni se renombra.
    const rows = await db.task.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { title: "asc" } });
    assert.deepEqual(rows.map((r) => [r.title, r.columnId]), [["A", f.columns.done], ["B", f.columns.doing]]);
    await db.task.update({ where: { id: a.id }, data: { columnId: f.columns.todo } });
    expectFail(await deployRelease({ ...input, columns }), /2 de las tareas se han movido a otra columna/);
    // Con lo que hay ahora (texto generado de nuevo) sí se despliega.
    const fresh = [{ taskId: a.id, columnId: f.columns.todo }, { taskId: b.id, columnId: f.columns.doing }];
    expectOk(await deployRelease({ ...input, columns: fresh }));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: b.id } })).columnId, prod.id);
  });

  test("rechaza el despliegue si otra persona renombró alguna tarea desde que se generó el texto (título viejo en las notas)", async () => {
    const { f, prod } = await setup();
    const a = await makeTask(f, { title: "A", columnId: f.columns.done });
    const b = await makeTask(f, { title: "B", columnId: f.columns.done });
    const columns = [{ taskId: a.id, columnId: f.columns.done }, { taskId: b.id, columnId: f.columns.done }];
    const titles = [{ taskId: a.id, title: "A" }, { taskId: b.id, title: "B" }];
    // Al generar se llamaba «B»; luego otra persona la renombra.
    await db.task.update({ where: { id: b.id }, data: { title: "B renombrada" } });
    const input = { projectId: f.project.id, title: "R", content: "- A\n- B", destination: "IN_PRODUCTION" as const, taskIds: [a.id, b.id], columns };
    expectFail(await deployRelease({ ...input, titles }), /Una de las tareas ha cambiado de título mientras tanto: vuelve a generar la release/);
    assert.equal(await db.release.count({ where: { projectId: f.project.id } }), 0);
    await db.task.update({ where: { id: a.id }, data: { title: "A renombrada" } });
    expectFail(await deployRelease({ ...input, titles }), /2 de las tareas han cambiado de título/);
    // Nada sale a producción ni se renombra.
    const rows = await db.task.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { title: "asc" } });
    assert.deepEqual(rows.map((r) => [r.title, r.columnId]), [["A renombrada", f.columns.done], ["B renombrada", f.columns.done]]);
    // Con el texto generado de nuevo (títulos de ahora) sí se despliega, y el histórico lleva esos títulos.
    const fresh = [{ taskId: a.id, title: "A renombrada" }, { taskId: b.id, title: "B renombrada" }];
    const res = expectOk(await deployRelease({ ...input, titles: fresh }));
    const kept = await db.releaseTask.findMany({ where: { releaseId: res.releaseId }, orderBy: { title: "asc" } });
    assert.deepEqual(kept.map((k) => k.title), ["A renombrada", "B renombrada"]);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: b.id } })).columnId, prod.id);
  });

  test("los códigos del título no dependen del idioma de quien despliega (nombre guardado del tipo)", async () => {
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { locale: "EN" } });
    const f = await makeProject({ members: [user] });
    await db.column.create({ data: { projectId: f.project.id, name: "En producción", position: 4000, role: "IN_PRODUCTION" } });
    await loginAs(user);
    const fix = await makeTask(f, { title: "Arreglo", columnId: f.columns.done });
    await db.task.update({ where: { id: fix.id }, data: { kindId: "kind_correccion" } });
    expectOk(await deployRelease({ projectId: f.project.id, title: "R", content: "Cambios", destination: "IN_PRODUCTION", taskIds: [fix.id] }));
    // En inglés el tipo se ve como «Bug fix», pero el código sale de «Corrección» (R1C1, no R1B1), como en español.
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: fix.id } })).title, "R1C1: Arreglo");
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
    // Un código anterior se conserva detrás del nuevo; la fija no se renombra.
    assert.match(now[b.id]!, /^R1[A-Z]+2: R1F9: Dos$/);
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

describe("deshacer un despliegue", () => {
  test("deshacer un despliegue de release no deja entrada de rehacer", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await db.column.create({ data: { projectId: f.project.id, name: "En producción", position: 4000, role: "IN_PRODUCTION" } });
    await loginAs(user);
    const a = await makeTask(f, { columnId: f.columns.done, position: 1000 });
    expectOk(await deployRelease({ projectId: f.project.id, title: "R", content: "x", destination: "IN_PRODUCTION", taskIds: [a.id] }));
    expectOk(await undoLast(f.project.id));
    expectFail(await redoLast(f.project.id), /nada que rehacer/i);
  });
});
