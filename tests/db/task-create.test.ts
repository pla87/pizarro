// Crear una tarea («Nueva tarea») con etiquetas, color y enlace: lo que guarda y lo que rechaza.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { createTask } from "../../src/actions/tasks";

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
