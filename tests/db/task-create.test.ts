// Crear una tarea («Nueva tarea») con etiquetas, color y enlace: lo que guarda y lo que rechaza.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { createTask, createTasks } from "../../src/actions/tasks";

async function setup() {
  const user = await makeUser();
  const f = await makeProject({ members: [user] });
  const other = await makeProject({ members: [user] });
  const [a, b] = await Promise.all(["Cliente", "Urgente"].map((name, i) => db.label.create({ data: { projectId: f.project.id, name, color: i ? "#ef4444" : "#22c55e" } })));
  const foreign = await db.label.create({ data: { projectId: other.project.id, name: "Ajena", color: "#6366f1" } });
  await loginAs(user);
  return { f, other, labels: { a: a!, b: b!, foreign } };
}

const base = (f: Awaited<ReturnType<typeof makeProject>>) => ({ projectId: f.project.id, columnId: f.columns.todo, title: "Con extras", kindId: f.kindId });

describe("createTask: etiquetas, color y enlace", () => {
  test("guarda las etiquetas del proyecto (sin repetir), el color de la paleta y el enlace normalizado", async () => {
    const { f, labels } = await setup();
    const t = expectOk(await createTask({ ...base(f), labelIds: [labels.b.id, labels.a.id, labels.b.id], color: "#ef4444", linkUrl: "example.com/doc" }));
    assert.deepEqual([...t.labelIds].sort(), [labels.a.id, labels.b.id].sort());
    assert.deepEqual([t.color, t.linkUrl], ["#ef4444", "https://example.com/doc"]);
    const row = await db.task.findUniqueOrThrow({ where: { id: t.id }, select: { color: true, linkUrl: true, labels: { select: { labelId: true } } } });
    assert.equal(row.labels.length, 2);
    assert.deepEqual([row.color, row.linkUrl], ["#ef4444", "https://example.com/doc"]);
    // Sin nada: sin etiquetas, sin color y sin enlace.
    const plain = expectOk(await createTask(base(f)));
    assert.deepEqual([plain.labelIds, plain.color, plain.linkUrl], [[], null, null]);
  });

  test("rechaza etiquetas de otro proyecto o inexistentes, más de 20, colores fuera de la paleta y enlaces que no son http(s)", async () => {
    const { f, labels } = await setup();
    const before = await db.task.count({ where: { projectId: f.project.id } });
    expectFail(await createTask({ ...base(f), labelIds: [labels.a.id, labels.foreign.id] }), /Etiqueta no válida/);
    expectFail(await createTask({ ...base(f), labelIds: ["no-existe-0000000000000"] }));
    expectFail(await createTask({ ...base(f), labelIds: Array.from({ length: 21 }, () => labels.a.id) }));
    expectFail(await createTask({ ...base(f), color: "#123456" as never }));
    for (const url of ["javascript:alert(1)", "ftp://example.com", "texto suelto"]) expectFail(await createTask({ ...base(f), linkUrl: url }), /http/);
    assert.equal(await db.task.count({ where: { projectId: f.project.id } }), before);
  });

  test("una etiqueta del proyecto de destino vale aunque se cree desde otro tablero; la del tablero abierto no", async () => {
    const { other, labels } = await setup();
    expectOk(await createTask({ ...base(other), labelIds: [labels.foreign.id] }));
    expectFail(await createTask({ ...base(other), labelIds: [labels.a.id] }), /Etiqueta no válida/);
  });
});

// Las comprobaciones van a la vez (antes, una detrás de otra): con varios datos mal, el error sigue siendo el primero
// en el orden de siempre (columna, etiquetas, responsable, entregable, tipo, campos), y sin acceso, «no encontrado».
describe("createTask y createTasks: orden de los errores con las comprobaciones a la vez", () => {
  test("gana la primera comprobación que falla, en el orden de siempre", async () => {
    const { f, other, labels } = await setup();
    const stranger = await makeUser();
    const foreignColumn = other.columns.todo;
    const wrong = { columnId: foreignColumn, labelIds: [labels.foreign.id], assigneeId: stranger.id, deliverableId: "no-existe-0000000000000", kindId: other.kindId, priority: "ALTA" as const };
    const steps: [Partial<typeof wrong>, RegExp][] = [
      [wrong, /La columna no existe/],
      [{ ...wrong, columnId: undefined }, /Etiqueta no válida/],
      [{ ...wrong, columnId: undefined, labelIds: undefined }, /No encontrado o sin acceso/],
      [{ ...wrong, columnId: undefined, labelIds: undefined, assigneeId: undefined }, /El entregable no existe/],
      [{ ...wrong, columnId: undefined, labelIds: undefined, assigneeId: undefined, deliverableId: undefined }, /El tipo de tarea no existe/],
      [{ priority: "ALTA" }, /no está activado en este proyecto/],
    ];
    for (const [patch, error] of steps) {
      const input = { ...base(f), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
      expectFail(await createTask(input), error);
      const { title: _title, kindId, ...rest } = input;
      expectFail(await createTasks({ ...rest, tasks: [{ title: "Una", kindId }] }), error);
    }
    assert.equal(await db.task.count({ where: { projectId: f.project.id } }), 0);
    // Sin acceso al proyecto: «no encontrado» antes que cualquier otra comprobación.
    await loginAs(stranger);
    expectFail(await createTask({ ...base(f), columnId: foreignColumn }), /No encontrado o sin acceso/);
  });
});

describe("createTasks: texto inicial del tipo", () => {
  test("cada tarea recibe la descripción de plantilla de su tipo, como en «Nueva tarea»", async () => {
    const { f } = await setup();
    const form = await db.taskKind.create({ data: { name: "Con formulario", color: "#3b82f6", position: 2, projectId: f.project.id, descriptionTemplate: "**Qué:**\n\n**Dónde:**\n" } });
    const rows = expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, tasks: [{ title: "Con plantilla", kindId: form.id }, { title: "Sin plantilla", kindId: f.kindId }] }));
    const saved = await db.task.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { title: true, description: true } });
    const by = new Map(saved.map((x) => [x.title, x.description]));
    assert.equal(by.get("Con plantilla"), "**Qué:**\n\n**Dónde:**\n");
    assert.equal(by.get("Sin plantilla"), "");
    assert.equal(rows.find((r) => r.title === "Con plantilla")?.hasDescription, true);
  });
});
