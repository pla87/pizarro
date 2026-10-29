// Rol de columna BUDGET (Presupuesto): repetible, fuerza el campo Coste y lo bloquea mientras exista.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { setColumnRole } from "../../src/actions/columns";
import { createProject, setTaskFields } from "../../src/actions/projects";
import { redoLast, undoLast } from "../../src/actions/undo";
import { saveTemplate } from "../../src/actions/templates";

const fieldsOf = async (projectId: string) => (await db.project.findUniqueOrThrow({ where: { id: projectId } })).taskFields;

describe("columna Presupuesto", () => {
  test("asignarla activa el campo Coste (y avisa); es repetible", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await db.project.update({ where: { id: f.project.id }, data: { taskFields: ["priority"] } });
    await loginAs(admin);

    assert.equal(expectOk(await setColumnRole(f.columns.todo, "BUDGET")).costEnabled, true);
    assert.deepEqual(await fieldsOf(f.project.id), ["cost", "priority"]);
    // Una segunda columna de presupuesto: no se vuelve a avisar y la primera conserva el rol.
    assert.equal(expectOk(await setColumnRole(f.columns.doing, "BUDGET")).costEnabled, false);
    const roles = Object.fromEntries((await db.column.findMany({ where: { projectId: f.project.id } })).map((c) => [c.id, c.role]));
    assert.equal(roles[f.columns.todo], "BUDGET");
    assert.equal(roles[f.columns.doing], "BUDGET");
  });

  test("el coste no se puede desactivar mientras haya una columna de presupuesto (servidor)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    expectOk(await setColumnRole(f.columns.todo, "BUDGET"));
    expectFail(await setTaskFields(f.project.id, []), /presupuesto/);
    expectFail(await setTaskFields(f.project.id, ["priority"]), /presupuesto/);
    expectOk(await setTaskFields(f.project.id, ["cost", "client"]));
    assert.deepEqual(await fieldsOf(f.project.id), ["cost", "client"]);

    // Con otra columna de presupuesto basta con quitar una: sigue bloqueado hasta que no quede ninguna.
    expectOk(await setColumnRole(f.columns.doing, "BUDGET"));
    expectOk(await setColumnRole(f.columns.todo, "NONE"));
    expectFail(await setTaskFields(f.project.id, []), /presupuesto/);
    expectOk(await setColumnRole(f.columns.doing, "NONE"));
    expectOk(await setTaskFields(f.project.id, []));
    assert.deepEqual(await fieldsOf(f.project.id), []);
  });

  test("deshacer y rehacer el cambio de rol mantienen el coste activo si vuelve la columna de presupuesto", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    expectOk(await setColumnRole(f.columns.todo, "BUDGET"));
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).role, "NONE");
    // Mientras tanto se desactiva el coste (ya no hay columna de presupuesto) y se rehace el rol.
    expectOk(await setTaskFields(f.project.id, []));
    expectOk(await redoLast(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).role, "BUDGET");
    assert.ok((await fieldsOf(f.project.id)).includes("cost"));
  });

  test("quien no gestiona el proyecto no puede cambiar los campos", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    await db.project.update({ where: { id: f.project.id }, data: { taskFields: ["cost"] } });
    await loginAs(member);
    expectFail(await setTaskFields(f.project.id, []), /No tienes permiso/);
  });
});

describe("plantillas con campos opcionales", () => {
  const template = (over: object) => ({
    name: `Plantilla ${Math.random().toString(36).slice(2, 8)}`,
    columns: [{ name: "Ideas", role: "NONE" as const, isDone: false }, { name: "Presupuesto", role: "BUDGET" as const, isDone: false }],
    kinds: [], hiddenGeneralKinds: [], labels: [],
    ...over,
  });

  test("el proyecto creado activa los campos de la plantilla y el coste si hay columna de presupuesto", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const { id } = expectOk(await saveTemplate(template({ taskFields: ["client", "priority"] })));
    const stored = await db.projectTemplate.findUniqueOrThrow({ where: { id } });
    // El coste se añade solo porque la plantilla tiene una columna de presupuesto.
    assert.deepEqual(stored.taskFields, ["cost", "priority", "client"]);

    const project = expectOk(await createProject("Desde plantilla", { templateId: id }));
    assert.deepEqual(await fieldsOf(project.id), ["cost", "priority", "client"]);
    const roles = (await db.column.findMany({ where: { projectId: project.id }, orderBy: { position: "asc" } })).map((c) => c.role);
    assert.deepEqual(roles, ["NONE", "BUDGET"]);
  });

  test("sin campos ni presupuesto, el proyecto nace con todo desactivado", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const { id } = expectOk(await saveTemplate(template({ columns: [{ name: "Ideas", role: "NONE", isDone: false }] })));
    const project = expectOk(await createProject("Sin campos", { templateId: id }));
    assert.deepEqual(await fieldsOf(project.id), []);
  });
});
