// getProjectFormData: opciones de otro proyecto para «Nueva tarea», con control de acceso, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { asUser, db, expectFail, expectOk, makeKind, makeProject, makeUser, NOT_FOUND } from "./helpers";
import { createTask, createTasks, getProjectFormData } from "../../src/actions/tasks";

describe("getProjectFormData", () => {
  test("devuelve columnas, tipos (generales visibles + propios), personas, entregables y límite del proyecto", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    await db.project.update({ where: { id: f.project.id }, data: { taskAttachMaxMb: 33, fileMaxMb: 7 } });
    const general = await makeKind(null);
    const hidden = await makeKind(null);
    await db.projectHiddenKind.create({ data: { projectId: f.project.id, kindId: hidden.id } });
    const deliverable = await db.deliverable.create({ data: { projectId: f.project.id, name: "Entrega 1", position: 1 } });

    const data = expectOk(await asUser(member, () => getProjectFormData(f.project.id)));
    assert.equal(data.project.id, f.project.id);
    assert.equal(data.project.attachMaxMb, 33);
    assert.equal(data.project.fileMaxMb, 7);
    assert.deepEqual(data.columns.map((c) => c.id), [f.columns.todo, f.columns.doing, f.columns.done]);
    const kindIds = data.kinds.map((k) => k.id);
    assert.ok(kindIds.includes(f.kindId) && kindIds.includes(general.id));
    assert.ok(!kindIds.includes(hidden.id), "un tipo general oculto en el proyecto no sale");
    assert.deepEqual(data.deliverables.map((d) => d.id), [deliverable.id]);
    assert.ok(data.users.some((u) => u.id === member.id));
  });

  test("no da datos de un proyecto que el usuario no puede ver", async () => {
    const owner = await makeUser({ role: "ADMIN" });
    const outsider = await makeUser();
    const priv = await makeProject({ visibility: "PRIVATE", owner });
    const team = await makeProject({ members: [] });
    expectFail(await asUser(outsider, () => getProjectFormData(priv.project.id)), NOT_FOUND);
    expectFail(await asUser(outsider, () => getProjectFormData(team.project.id)), NOT_FOUND);
    // Otro administrador tampoco ve un privado ajeno.
    const otherAdmin = await makeUser({ role: "ADMIN" });
    expectFail(await asUser(otherAdmin, () => getProjectFormData(priv.project.id)), NOT_FOUND);
    expectOk(await asUser(owner, () => getProjectFormData(priv.project.id)));
  });

  test("una tarea se crea en el proyecto elegido y solo con sus columnas y tipos", async () => {
    const member = await makeUser();
    const a = await makeProject({ members: [member] });
    const b = await makeProject({ members: [member] });
    const task = expectOk(await asUser(member, () => createTask({ projectId: b.project.id, columnId: b.columns.todo, title: "En B", kindId: b.kindId })));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).projectId, b.project.id);
    // Columna o tipo de otro proyecto: rechazado.
    expectFail(await asUser(member, () => createTask({ projectId: b.project.id, columnId: a.columns.todo, title: "x", kindId: b.kindId })));
    expectFail(await asUser(member, () => createTask({ projectId: b.project.id, columnId: b.columns.todo, title: "x", kindId: a.kindId })));
  });

  test("varias tareas en otro proyecto: mismas reglas de acceso, columnas y tipos que una sola", async () => {
    const member = await makeUser();
    const outsider = await makeUser();
    const a = await makeProject({ members: [member] });
    const b = await makeProject({ members: [member] });
    const priv = await makeProject({ visibility: "PRIVATE", owner: await makeUser({ role: "ADMIN" }) });
    const rows = expectOk(await asUser(member, () => createTasks({ projectId: b.project.id, columnId: b.columns.todo, tasks: [{ title: "Uno", kindId: b.kindId }, { title: "Dos", kindId: b.kindId }] })));
    assert.equal(rows.length, 2);
    assert.equal(await db.task.count({ where: { projectId: b.project.id } }), 2);
    // Sin acceso al proyecto: no existe para quien pregunta.
    expectFail(await asUser(outsider, () => createTasks({ projectId: b.project.id, columnId: b.columns.todo, tasks: [{ title: "x", kindId: b.kindId }] })), NOT_FOUND);
    expectFail(await asUser(member, () => createTasks({ projectId: priv.project.id, columnId: priv.columns.todo, tasks: [{ title: "x", kindId: priv.kindId }] })), NOT_FOUND);
    // Columna o tipo de otro proyecto: rechazado.
    expectFail(await asUser(member, () => createTasks({ projectId: b.project.id, columnId: a.columns.todo, tasks: [{ title: "x", kindId: b.kindId }] })));
    expectFail(await asUser(member, () => createTasks({ projectId: b.project.id, columnId: b.columns.todo, tasks: [{ title: "x", kindId: a.kindId }] })));
    assert.equal(await db.task.count({ where: { projectId: b.project.id } }), 2);
  });

  test("getProjectFormData incluye las etiquetas del proyecto", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const label = await db.label.create({ data: { projectId: f.project.id, name: "Urgente", color: "#ff0000" } });
    const data = expectOk(await asUser(member, () => getProjectFormData(f.project.id)));
    assert.deepEqual(data.labels.map((l) => l.id), [label.id]);
  });
});
