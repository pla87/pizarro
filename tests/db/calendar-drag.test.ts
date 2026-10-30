// Arrastrar en el calendario: rango de una tarea (una sola actualización con deshacer) y fecha de un entregable.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeUser, NOT_FOUND } from "./helpers";
import { moveDeliverable } from "../../src/actions/projects";
import { createTask, updateTask } from "../../src/actions/tasks";
import { undoLast } from "../../src/actions/undo";

const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

async function setup() {
  const admin = await makeUser({ role: "ADMIN" });
  const f = await makeProject({ members: [] });
  await db.project.update({ where: { id: f.project.id }, data: { taskFields: ["startDate"] } });
  await loginAs(admin);
  return { admin, f };
}

const range = (f: Awaited<ReturnType<typeof makeProject>>, title = "Rango") => ({ projectId: f.project.id, columnId: f.columns.todo, title, kindId: f.kindId, startDate: "2026-11-02", dueDate: "2026-11-06" });

describe("rango de una tarea", () => {
  test("mover cambia inicio y fin a la vez y se deshace de una vez", async () => {
    const { f } = await setup();
    const t = expectOk(await createTask(range(f)));
    expectOk(await updateTask(t.id, { startDate: "2026-11-09", dueDate: "2026-11-13" }));
    let row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    assert.deepEqual([day(row.startDate), day(row.dueDate)], ["2026-11-09", "2026-11-13"]);
    expectOk(await undoLast(f.project.id, t.id));
    row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    assert.deepEqual([day(row.startDate), day(row.dueDate)], ["2026-11-02", "2026-11-06"]);
  });

  test("redimensionar un borde; un inicio posterior al fin se rechaza sin cambiar nada", async () => {
    const { f } = await setup();
    const t = expectOk(await createTask(range(f)));
    expectOk(await updateTask(t.id, { startDate: "2026-11-04" }));
    expectOk(await updateTask(t.id, { dueDate: "2026-11-04" }));
    expectFail(await updateTask(t.id, { startDate: "2026-11-20", dueDate: "2026-11-10" }), /fecha de inicio/);
    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    assert.deepEqual([day(row.startDate), day(row.dueDate)], ["2026-11-04", "2026-11-04"]);
  });

  test("una tarea archivada no se puede mover", async () => {
    const { f } = await setup();
    const t = expectOk(await createTask(range(f, "Vieja")));
    await db.task.update({ where: { id: t.id }, data: { archivedAt: new Date() } });
    expectFail(await updateTask(t.id, { startDate: "2026-11-03", dueDate: "2026-11-07" }), /archivada/);
  });
});

describe("fecha de un entregable", () => {
  test("mueve solo la fecha, devuelve la anterior y respeta el acceso", async () => {
    const { f } = await setup();
    const d = await db.deliverable.create({ data: { projectId: f.project.id, name: "Hito", description: "texto", dueDate: new Date("2026-11-10T00:00:00Z"), position: 1000 } });
    const res = expectOk(await moveDeliverable(d.id, "2026-11-17"));
    assert.equal(res.from, "2026-11-10");
    const row = await db.deliverable.findUniqueOrThrow({ where: { id: d.id } });
    assert.deepEqual([day(row.dueDate), row.name, row.description], ["2026-11-17", "Hito", "texto"]);
    expectFail(await moveDeliverable(d.id, "2026-02-31"), /Fecha no válida/);

    // Quien no ve el proyecto no lo encuentra.
    const outsider = await makeUser();
    await loginAs(outsider);
    expectFail(await moveDeliverable(d.id, "2026-11-20"), NOT_FOUND);
    assert.equal(day((await db.deliverable.findUniqueOrThrow({ where: { id: d.id } })).dueDate), "2026-11-17");
  });
});
