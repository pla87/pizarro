// Campos opcionales de las tareas: activación por proyecto, validación, permisos, historial y deshacer.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { setTaskFields } from "../../src/actions/projects";
import { createTask, createTasks, duplicateTask, restoreTaskSnapshot, updateTask } from "../../src/actions/tasks";
import { redoLast, undoLast } from "../../src/actions/undo";

/** Proyecto con todos los campos activados y una persona administradora que lo gestiona. */
async function setup(fields: string[] = ["cost", "hours", "priority", "client", "startDate"]) {
  const admin = await makeUser({ role: "ADMIN" });
  const f = await makeProject({ members: [] });
  await db.project.update({ where: { id: f.project.id }, data: { taskFields: fields } });
  await loginAs(admin);
  return { admin, f };
}

const base = (f: Awaited<ReturnType<typeof makeProject>>) => ({ projectId: f.project.id, columnId: f.columns.todo, title: "Con campos", kindId: f.kindId });

describe("activar campos en el proyecto", () => {
  test("todos desactivados por defecto; solo administradores (o miembros de un privado) los cambian", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const outsider = await makeUser();
    const f = await makeProject({ members: [member] });
    assert.deepEqual((await db.project.findUniqueOrThrow({ where: { id: f.project.id } })).taskFields, []);

    await loginAs(member);
    expectFail(await setTaskFields(f.project.id, ["cost"]), FORBIDDEN);
    await loginAs(outsider);
    expectFail(await setTaskFields(f.project.id, ["cost"]), NOT_FOUND);

    await loginAs(admin);
    expectOk(await setTaskFields(f.project.id, ["priority", "cost", "cost"]));
    // Sin repetidos y en el orden canónico.
    assert.deepEqual((await db.project.findUniqueOrThrow({ where: { id: f.project.id } })).taskFields, ["cost", "priority"]);
    expectFail(await setTaskFields(f.project.id, ["nope"]));

    // El dueño de un proyecto privado, aunque no sea administrador, también.
    const priv = await makeProject({ visibility: "PRIVATE", owner: member });
    await loginAs(member);
    expectOk(await setTaskFields(priv.project.id, ["client"]));
  });

  test("un campo desactivado se rechaza al escribir; al desactivarlo los datos se conservan", async () => {
    const { f } = await setup(["cost"]);
    expectFail(await createTask({ ...base(f), priority: "ALTA" }), /prioridad.*no está activado/);
    const t = expectOk(await createTask({ ...base(f), cost: "100" }));
    assert.equal(t.cost, "100.00");
    expectOk(await setTaskFields(f.project.id, []));
    expectFail(await updateTask(t.id, { cost: "5" }), /coste.*no está activado/);
    assert.equal(expectOk(await updateTask(t.id, { title: "Otro título" })).cost, "100.00");
    expectOk(await setTaskFields(f.project.id, ["cost"]));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: t.id } })).cost?.toFixed(2), "100.00");
  });
});

describe("validación de los campos", () => {
  test("coste y horas: decimales con coma o punto, no negativos, máximo dos decimales", async () => {
    const { f } = await setup();
    const t = expectOk(await createTask({ ...base(f), cost: "1234,5", estimatedHours: 1.25, actualHours: "0.5", costPaid: true }));
    assert.deepEqual([t.cost, t.estimatedHours, t.actualHours, t.costPaid], ["1234.50", "1.25", "0.50", true]);
    for (const bad of ["-1", "abc", "1.234", "1e5", "99999999999"]) expectFail(await createTask({ ...base(f), cost: bad }), /coste/i);
    expectFail(await createTask({ ...base(f), estimatedHours: "100000" }), /horas/i);
    // Vacío quita el valor.
    assert.equal(expectOk(await updateTask(t.id, { cost: "" })).cost, null);
    assert.equal(expectOk(await updateTask(t.id, { actualHours: null })).actualHours, null);
  });

  test("prioridad solo BAJA/MEDIA/ALTA/URGENTE; cliente hasta 120 caracteres; enlace solo http(s)", async () => {
    const { f } = await setup();
    const t = expectOk(await createTask({ ...base(f), priority: "URGENTE", client: "  Acme  ", linkUrl: "https://example.com/x" }));
    assert.deepEqual([t.priority, t.client, t.linkUrl], ["URGENTE", "Acme", "https://example.com/x"]);
    expectFail(await createTask({ ...base(f), priority: "NOPE" as never }));
    expectFail(await createTask({ ...base(f), client: "x".repeat(121) }), /120/);
    assert.equal(expectOk(await createTask({ ...base(f), client: "x".repeat(120) })).client?.length, 120);
    for (const url of ["javascript:alert(1)", "ftp://example.com", "example.com", "data:text/html,hi"]) {
      expectFail(await updateTask(t.id, { linkUrl: url }), /http/);
    }
    assert.equal(expectOk(await updateTask(t.id, { client: "", linkUrl: "" })).client, null);
  });

  test("la fecha de inicio no puede ser posterior a la fecha límite (al crear y al editar cualquiera de las dos)", async () => {
    const { f } = await setup();
    expectFail(await createTask({ ...base(f), startDate: "2026-12-10", dueDate: "2026-12-01" }), /fecha de inicio/);
    const t = expectOk(await createTask({ ...base(f), startDate: "2026-12-01", dueDate: "2026-12-10" }));
    assert.equal(t.startDate, "2026-12-01");
    expectFail(await updateTask(t.id, { startDate: "2026-12-11" }), /fecha de inicio/);
    expectFail(await updateTask(t.id, { dueDate: "2026-11-30" }), /fecha de inicio/);
    // Cambiar las dos a la vez es válido; con solo una de las dos no hay comparación.
    expectOk(await updateTask(t.id, { startDate: "2026-11-01", dueDate: "2026-11-05" }));
    const solo = expectOk(await createTask({ ...base(f), startDate: "2030-01-01" }));
    assert.equal(solo.dueDate, null);
    expectOk(await updateTask(solo.id, { startDate: null }));
  });

  test("alta masiva: prioridad y cliente para todas, si están activados", async () => {
    const { f } = await setup(["priority", "client"]);
    const tasks = expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, tasks: [{ title: "A", kindId: f.kindId }, { title: "B", kindId: f.kindId }], priority: "BAJA", client: "Acme" }));
    assert.deepEqual(tasks.map((t) => [t.priority, t.client]), [["BAJA", "Acme"], ["BAJA", "Acme"]]);
    await db.project.update({ where: { id: f.project.id }, data: { taskFields: ["client"] } });
    expectFail(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, tasks: [{ title: "C", kindId: f.kindId }], priority: "ALTA" }), /prioridad.*no está activado/);
  });

  test("duplicar una tarea copia sus campos opcionales", async () => {
    const { f } = await setup();
    const t = expectOk(await createTask({ ...base(f), cost: "10", costPaid: true, priority: "ALTA", client: "Acme" }));
    const copy = expectOk(await duplicateTask(t.id));
    assert.deepEqual([copy.cost, copy.costPaid, copy.priority, copy.client], ["10.00", true, "ALTA", "Acme"]);
  });
});

describe("permisos", () => {
  test("quien no ve el proyecto no puede editar los campos de sus tareas", async () => {
    const { f } = await setup();
    const t = await makeTask(f);
    await loginAs(await makeUser());
    expectFail(await updateTask(t.id, { cost: "5" }), NOT_FOUND);
    expectFail(await createTask({ ...base(f), cost: "5" }), NOT_FOUND);
  });

  test("una persona asignada al proyecto (no administradora) edita los campos", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    await db.project.update({ where: { id: f.project.id }, data: { taskFields: ["priority"] } });
    await loginAs(member);
    const t = expectOk(await createTask({ ...base(f), priority: "MEDIA" }));
    assert.equal(expectOk(await updateTask(t.id, { priority: "ALTA" })).priority, "ALTA");
  });
});

describe("historial y deshacer", () => {
  test("cada cambio queda en el historial y se deshace y rehace de una vez", async () => {
    const { f } = await setup();
    const t = expectOk(await createTask({ ...base(f), cost: "10", priority: "BAJA", startDate: "2026-12-01" }));
    expectOk(await updateTask(t.id, { cost: "25.5", costPaid: true, priority: "URGENTE", client: "Acme", startDate: "2026-12-02" }));
    const row = () => db.task.findUniqueOrThrow({ where: { id: t.id } });
    let r = await row();
    assert.deepEqual([r.cost?.toFixed(2), r.costPaid, r.priority, r.client, r.startDate?.toISOString().slice(0, 10)], ["25.50", true, "URGENTE", "Acme", "2026-12-02"]);
    const events = await db.taskEvent.findMany({ where: { taskId: t.id, code: "update" } });
    assert.ok(events.some((e) => /coste/.test(JSON.stringify(e.label)) && /prioridad/.test(JSON.stringify(e.label))), JSON.stringify(events.map((e) => e.label)));

    expectOk(await undoLast(f.project.id));
    r = await row();
    assert.deepEqual([r.cost?.toFixed(2), r.costPaid, r.priority, r.client, r.startDate?.toISOString().slice(0, 10)], ["10.00", false, "BAJA", null, "2026-12-01"]);
    expectOk(await redoLast(f.project.id));
    r = await row();
    assert.deepEqual([r.cost?.toFixed(2), r.priority, r.client], ["25.50", "URGENTE", "Acme"]);
  });

  test("guardar el mismo valor no deja entrada de historial", async () => {
    const { f } = await setup();
    const t = expectOk(await createTask({ ...base(f), cost: "10" }));
    const before = await db.taskEvent.count({ where: { taskId: t.id } });
    expectOk(await updateTask(t.id, { cost: "10,00" }));
    assert.equal(await db.taskEvent.count({ where: { taskId: t.id } }), before);
  });

  test("borrar la tarea y deshacer recupera los campos opcionales", async () => {
    const { f } = await setup();
    const t = expectOk(await createTask({ ...base(f), cost: "7.25", estimatedHours: "2", priority: "ALTA", client: "Acme", linkUrl: "https://example.com", startDate: "2026-12-01" }));
    const { deleteTask } = await import("../../src/actions/tasks");
    expectOk(await deleteTask(t.id));
    assert.equal(await db.task.count({ where: { id: t.id } }), 0);
    expectOk(await undoLast(f.project.id));
    const r = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    assert.deepEqual([r.cost?.toFixed(2), r.estimatedHours?.toFixed(2), r.priority, r.client, r.linkUrl, r.startDate?.toISOString().slice(0, 10)], ["7.25", "2.00", "ALTA", "Acme", "https://example.com", "2026-12-01"]);
  });

  test("«Cancelar» en el detalle devuelve también los campos opcionales", async () => {
    const { f } = await setup();
    const t = expectOk(await createTask({ ...base(f), cost: "10", priority: "BAJA" }));
    const open = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expectOk(await updateTask(t.id, { cost: "99", priority: "URGENTE", client: "Acme" }));
    const res = expectOk(await restoreTaskSnapshot(t.id, {
      title: open.title, kindId: open.kindId, color: null, linkUrl: null, assigneeId: null, labelIds: [], dueDate: null, deliverableId: null, evergreen: false,
      recurrence: "NONE", recurrenceDay: null, columnId: open.columnId, position: open.position,
      cost: "10.00", costPaid: false, estimatedHours: null, actualHours: null, priority: "BAJA", client: null, startDate: null,
    }));
    assert.equal(res.changed, true);
    assert.deepEqual([res.task.cost, res.task.priority, res.task.client], ["10.00", "BAJA", null]);
  });
});
