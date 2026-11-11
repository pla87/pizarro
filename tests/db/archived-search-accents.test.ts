// Búsqueda de Archivadas: sin distinguir mayúsculas ni tildes, por título de la tarea o título/número de su release.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { getArchivedTasks } from "../../src/actions/tasks";

describe("búsqueda de archivadas", () => {
  test("ignora tildes y mayúsculas en los dos sentidos, y busca también por la release", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const base = { projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId };
    const at = (i: number) => new Date(Date.now() - i * 1000);
    const camion = await db.task.create({ data: { ...base, title: "Revisar el CAMIÓN de reparto", position: 10, archivedAt: at(1) } });
    const pinguino = await db.task.create({ data: { ...base, title: "Pingüino 50% listo_ya", position: 20, archivedAt: at(2) } });
    const viaRelease = await db.task.create({ data: { ...base, title: "Otra", position: 30, archivedAt: at(3) } });
    await db.task.create({ data: { ...base, title: "Camión sin archivar", position: 40 } });
    await db.release.create({ data: { projectId: f.project.id, number: 7, title: "Edición de otoño", content: "", tasks: { create: [{ taskId: viaRelease.id, title: "Otra", kindName: "X" }] } } });
    const titles = async (query: string) => expectOk(await getArchivedTasks(f.project.id, { query })).items.map((i) => i.id);

    assert.deepEqual(await titles("camion"), [camion.id]);
    assert.deepEqual(await titles("Camión"), [camion.id]);
    assert.deepEqual(await titles("PINGUINO"), [pinguino.id]);
    assert.deepEqual(await titles("edicion de OTOÑO"), [viaRelease.id]);
    assert.deepEqual(await titles("R7"), [viaRelease.id]);
    // % y _ se buscan como texto, no como comodines de LIKE.
    assert.deepEqual(await titles("50%"), [pinguino.id]);
    assert.deepEqual(await titles("ping_ino"), []);
    assert.deepEqual(await titles("listo_ya"), [pinguino.id]);
  });

  test("con búsqueda pagina igual por claves", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const rows = Array.from({ length: 103 }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId, title: i % 2 ? `Acción ${i}` : `Otra ${i}`, position: (i + 1) * 10, archivedAt: new Date(Date.now() - i * 1000) }));
    await db.task.createMany({ data: rows });
    const p1 = expectOk(await getArchivedTasks(f.project.id, { query: "accion" }));
    assert.equal(p1.items.length, 51);
    assert.equal(p1.nextCursor, null);
    const many = Array.from({ length: 150 }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId, title: `Reunión ${i}`, position: 5000 + i, archivedAt: new Date(Date.now() - 200_000 - i * 1000) }));
    await db.task.createMany({ data: many });
    const r1 = expectOk(await getArchivedTasks(f.project.id, { query: "reunion" }));
    assert.equal(r1.items.length, 100);
    assert.ok(r1.nextCursor);
    const r2 = expectOk(await getArchivedTasks(f.project.id, { query: "reunion", cursor: r1.nextCursor }));
    assert.equal(r2.items.length, 50);
    assert.equal(r2.nextCursor, null);
    assert.equal(new Set([...r1.items, ...r2.items].map((i) => i.id)).size, 150);
  });
});
