// Deshacer/rehacer por lotes (applyUndo, mirrorOps): el resultado debe ser el mismo que aplicando las operaciones una a
// una. Cada escenario se construye dos veces, en dos proyectos iguales; en uno se aplica por lotes y en el otro con
// `batch: false` (el camino de siempre), y se compara el estado final normalizado (ids sustituidos por nombres).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, makeProject, makeTask, makeUser, type Fixture } from "./helpers";
import { applyUndo, captureTasks, mirrorOps, snapshotTasks, type TaskField, type UndoOp } from "../../src/lib/undo";

const SET_FIELDS: TaskField[] = ["title", "columnId", "position", "archivedAt", "archivedFromColumnId", "assigneeId", "kindId", "deliverableId", "dueDate", "cost", "priority", "evergreen", "evergreenEvery", "costPaid", "contentUpdatedAt"];

/** Estado del proyecto sin ids: lo que se compara entre los dos caminos. */
async function stateOf(projectId: string) {
  const tasks = await db.task.findMany({
    where: { projectId },
    orderBy: { title: "asc" },
    include: {
      column: { select: { name: true } },
      kind: { select: { name: true } },
      deliverable: { select: { name: true } },
      labels: { select: { label: { select: { name: true } } } },
      blockedBy: { select: { title: true } },
      recurrenceFrom: { select: { title: true } },
      subtasks: { orderBy: { position: "asc" }, select: { title: true, done: true, position: true } },
      comments: { orderBy: { createdAt: "asc" }, select: { body: true, authorId: true, parent: { select: { body: true } } } },
      links: { orderBy: { title: "asc" }, select: { title: true, url: true, kind: true } },
      attachments: { orderBy: { originalName: "asc" }, select: { originalName: true, size: true } },
    },
  });
  const cols = new Map((await db.column.findMany({ where: { projectId } })).map((c) => [c.id, c.name]));
  return tasks.map((t) => ({
    title: t.title, column: t.column.name, position: t.position, archivedAt: t.archivedAt?.toISOString() ?? null,
    archivedFrom: t.archivedFromColumnId ? (cols.get(t.archivedFromColumnId) ?? "?") : null, assigneeId: t.assigneeId, kind: t.kind.name.replace(/ \w+$/, ""),
    deliverable: t.deliverable?.name ?? null, dueDate: t.dueDate?.toISOString() ?? null, cost: t.cost?.toFixed(2) ?? null, costPaid: t.costPaid, priority: t.priority,
    evergreen: t.evergreen, evergreenEvery: t.evergreenEvery, contentUpdatedAt: t.contentUpdatedAt?.toISOString() ?? null,
    labels: t.labels.map((l) => l.label.name).sort(), blockedBy: t.blockedBy?.title ?? null, recurrenceFrom: t.recurrenceFrom?.title ?? null,
    subtasks: t.subtasks, comments: t.comments.map((c) => ({ body: c.body, authorId: c.authorId, parent: c.parent?.body ?? null })), links: t.links, attachments: t.attachments,
  }));
}

/** Dos tipos («Tipo A» y «Tipo B»: el sufijo aleatorio se quita al comparar), etiquetas, un entregable y una columna extra. */
async function world(f: Fixture) {
  const kindA = await db.taskKind.create({ data: { name: `Tipo A ${f.project.id.slice(-4)}`, color: "#111111", position: 2, projectId: f.project.id } });
  const kindB = await db.taskKind.create({ data: { name: `Tipo B ${f.project.id.slice(-4)}`, color: "#222222", position: 3, projectId: f.project.id } });
  const labels = await Promise.all(["rojo", "verde", "azul"].map((name) => db.label.create({ data: { projectId: f.project.id, name, color: name } })));
  const deliverable = await db.deliverable.create({ data: { projectId: f.project.id, name: "Entrega", position: 1 } });
  const extra = await db.column.create({ data: { projectId: f.project.id, name: "Temporal", position: 1500 } });
  return { kindA, kindB, labels, deliverable, extra };
}

async function twice(build: (batch: boolean) => Promise<{ projectId: string; skipped: number; extra?: unknown }>) {
  const a = await build(true);
  const b = await build(false);
  assert.equal(a.skipped, b.skipped, "mismas operaciones saltadas");
  const [sa, sb] = [await stateOf(a.projectId), await stateOf(b.projectId)];
  assert.ok(sa.length > 0);
  assert.deepEqual(sa, sb);
  assert.deepEqual(a.extra, b.extra);
  return { a, b, state: sa };
}

describe("deshacer por lotes = una a una", () => {
  test("task.set: campos, etiquetas, columna/tipo/entregable borrados, responsable sin acceso, repetidas, bloqueos y tareas borradas", async () => {
    const member = await makeUser();
    const gone = await makeUser();
    const { state } = await twice(async (batch) => {
      const f = await makeProject({ members: [member, gone] });
      const w = await world(f);
      const tasks = [];
      for (let i = 0; i < 40; i++) {
        tasks.push(await makeTask(f, { title: `T${String(i).padStart(2, "0")}`, columnId: i % 3 === 0 ? w.extra.id : f.columns.todo, position: (i + 1) * 1000 }));
      }
      for (const [i, t] of tasks.entries()) {
        await db.task.update({
          where: { id: t.id },
          data: {
            kindId: i % 2 ? w.kindA.id : f.kindId, assigneeId: i % 4 === 0 ? gone.id : member.id, deliverableId: i % 5 === 0 ? w.deliverable.id : null,
            dueDate: i % 3 ? new Date(Date.UTC(2026, 10, 1 + i)) : null, cost: i % 2 ? "12.50" : null, priority: i % 2 ? "ALTA" : null, contentUpdatedAt: new Date(Date.UTC(2026, 9, 1, 10, i, 7, 123)),
            labels: { create: w.labels.filter((_, k) => (i + k) % 2 === 0).map((l) => ({ labelId: l.id })) },
            blockedById: i === 7 ? tasks[3]!.id : null,
          },
        });
      }
      const ids = tasks.map((t) => t.id);
      // Lo que se deshace: todos los campos con etiquetas, más una segunda operación sobre la misma tarea con otros
      // campos y un bloqueo que vuelve (se aplica solo, en su sitio).
      const ops: UndoOp[] = [
        { t: "task.set", id: tasks[9]!.id, data: { blockedById: tasks[8]!.id } },
        ...(await captureTasks(ids, SET_FIELDS, true)),
        { t: "task.set", id: tasks[1]!.id, data: { title: "T01-bis" } },
        { t: "task.set", id: tasks[7]!.id, data: { blockedById: tasks[3]!.id } },
        { t: "task.set", id: "noexiste0000000000000000", data: { title: "x" } },
      ];
      // Cambios posteriores: todo se mueve, archiva y cambia; luego desaparecen la columna extra, el tipo A, el entregable,
      // una etiqueta, el acceso de `gone` y dos tareas.
      await db.task.updateMany({ where: { id: { in: ids } }, data: { columnId: f.columns.done, position: 1, archivedAt: new Date(), archivedFromColumnId: f.columns.done, kindId: w.kindB.id, assigneeId: null, cost: "1.00", priority: "BAJA", blockedById: null } });
      await db.taskLabel.deleteMany({ where: { taskId: { in: ids } } });
      await db.taskLabel.createMany({ data: ids.map((taskId) => ({ taskId, labelId: w.labels[2]!.id })) });
      await db.column.delete({ where: { id: w.extra.id } });
      await db.taskKind.delete({ where: { id: w.kindA.id } });
      await db.deliverable.delete({ where: { id: w.deliverable.id } });
      await db.label.delete({ where: { id: w.labels[1]!.id } });
      await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: gone.id } });
      await db.task.deleteMany({ where: { id: { in: [tasks[20]!.id, tasks[21]!.id] } } });
      const skipped = await applyUndo(f.project.id, ops, { batch });
      return { projectId: f.project.id, skipped };
    });
    // Comprobaciones de sentido sobre el resultado (igual en ambos caminos).
    const t0 = state.find((t) => t.title === "T00")!;
    assert.equal(t0.column, "Por hacer"); // su columna se borró: va a la primera
    assert.equal(t0.assigneeId, null); // ya no tiene acceso
    assert.equal(t0.deliverable, null);
    assert.equal(t0.archivedAt, null);
    assert.equal(state.find((t) => t.title === "T01")!.kind, "Tipo B"); // el tipo A ya no existe: se queda el actual
    assert.equal(state.find((t) => t.title === "T07")!.blockedBy, "T03");
    assert.equal(state.find((t) => t.title === "T09")!.blockedBy, "T08");
    assert.ok(!state.some((t) => t.title === "T01-bis")); // se aplicó antes y la captura completa la pisó
    assert.ok(state.every((t) => !t.labels.includes("verde")));
  });

  test("task.remove: borra las que existen, salta las que no y no toca otros proyectos", async () => {
    const other = await makeProject();
    const foreign = await makeTask(other, { title: "Ajena" });
    let files: unknown;
    await twice(async (batch) => {
      const f = await makeProject();
      const tasks = [];
      for (let i = 0; i < 12; i++) tasks.push(await makeTask(f, { title: `R${i}`, position: (i + 1) * 1000 }));
      await db.taskAttachment.createMany({ data: tasks.slice(0, 4).map((t, i) => ({ taskId: t.id, originalName: `a${i}.png`, size: 10 })) });
      const ops: UndoOp[] = [...tasks.slice(0, 8), foreign].map((t) => ({ t: "task.remove" as const, id: t.id }));
      ops.push({ t: "task.remove", id: tasks[0]!.id });
      const skipped = await applyUndo(f.project.id, ops, { batch, keepFiles: true });
      files = await db.taskAttachment.count({ where: { task: { projectId: f.project.id } } });
      return { projectId: f.project.id, skipped, extra: files };
    });
    assert.equal(await db.task.count({ where: { id: foreign.id } }), 1);
  });

  test("task.restore: hijos, etiquetas y columna borradas; bloqueos y recurrentes van solos; la que ya existe se salta", async () => {
    const author = await makeUser();
    await twice(async (batch) => {
      const f = await makeProject({ members: [author] });
      const w = await world(f);
      const tasks = [];
      for (let i = 0; i < 15; i++) tasks.push(await makeTask(f, { title: `S${String(i).padStart(2, "0")}`, columnId: i === 2 ? w.extra.id : f.columns.doing, position: (i + 1) * 1000, subtasks: [`s${i}a`, `s${i}b`] }));
      for (const [i, t] of tasks.entries()) {
        const root = await db.taskComment.create({ data: { taskId: t.id, authorId: author.id, body: `c${i}` } });
        await db.taskComment.create({ data: { taskId: t.id, authorId: author.id, body: `r${i}`, parentId: root.id } });
        await db.taskLink.create({ data: { taskId: t.id, kind: "GOOGLE_DOC", title: `doc${i}`, url: `https://docs.example.com/${i}` } });
        await db.taskAttachment.create({ data: { taskId: t.id, originalName: `f${i}.png`, size: i + 1 } });
        await db.taskLabel.createMany({ data: w.labels.slice(0, 1 + (i % 3)).map((l) => ({ taskId: t.id, labelId: l.id })) });
      }
      await db.task.update({ where: { id: tasks[5]!.id }, data: { blockedById: tasks[4]!.id } });
      await db.task.update({ where: { id: tasks[6]!.id }, data: { recurrenceFromId: tasks[1]!.id } });
      const ops = await snapshotTasks(tasks.map((t) => t.id));
      await db.task.deleteMany({ where: { id: { in: tasks.map((t) => t.id) } } });
      await db.column.delete({ where: { id: w.extra.id } });
      await db.label.delete({ where: { id: w.labels[0]!.id } });
      // Una vuelve a existir antes de deshacer (otra pestaña la recreó): se salta.
      const back = (ops.find((op) => op.t === "task.restore" && op.snap.task.title === "S10") as Extract<UndoOp, { t: "task.restore" }>).snap.task;
      await db.task.create({ data: { id: back.id, projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId, title: "S10", position: 1 } });
      const skipped = await applyUndo(f.project.id, ops, { batch, keepFiles: true });
      return { projectId: f.project.id, skipped };
    });
  });

  test("mirrorOps por lotes: lo mismo que leer tarea a tarea", async () => {
    const f = await makeProject();
    const tasks = [];
    for (let i = 0; i < 10; i++) tasks.push(await makeTask(f, { title: `M${i}`, position: (i + 1) * 1000, subtasks: ["x"] }));
    const sub = await db.subtask.findFirstOrThrow({ where: { taskId: tasks[0]!.id } });
    const ops: UndoOp[] = [
      ...(await captureTasks(tasks.map((t) => t.id), ["columnId", "position"])),
      { t: "subtask.set", id: sub.id, data: { done: true } },
      ...(await captureTasks(tasks.slice(0, 3).map((t) => t.id), ["title"], true)),
      { t: "task.set", id: tasks[0]!.id, data: { columnId: f.columns.done, position: 5 } }, // repetida: se ignora
      ...(await snapshotTasks([tasks[9]!.id])),
      ...tasks.slice(5).map((t) => ({ t: "task.remove" as const, id: t.id })), // la 9 ya la reclamó su task.restore
      { t: "task.remove", id: "noexiste0000000000000000" },
    ];
    // Referencia: la lectura de antes, una a una.
    const seen = new Set<string>();
    const expected: UndoOp[] = [];
    for (const op of ops) {
      if (op.t === "task.set") {
        const key = `task.set:${op.id}:${Object.keys(op.data).join(",")}:${!!op.labelIds}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (await db.task.count({ where: { id: op.id, projectId: f.project.id } })) expected.push(...(await captureTasks([op.id], Object.keys(op.data) as TaskField[], !!op.labelIds)));
      } else if (op.t === "task.remove") {
        if (seen.has(`task:${op.id}`)) continue;
        seen.add(`task:${op.id}`);
        if (await db.task.count({ where: { id: op.id, projectId: f.project.id } })) expected.push(...(await snapshotTasks([op.id])));
      } else if (op.t === "task.restore") {
        seen.add(`task:${op.snap.task.id}`);
        expected.push({ t: "task.remove", id: op.snap.task.id });
      } else expected.push(...(await mirrorOps(f.project.id, [op])));
    }
    assert.deepEqual(await mirrorOps(f.project.id, ops), expected);
  });

  test("un lote que falla se repite una a una (sin dejar nada a medias)", async () => {
    const f = await makeProject();
    const a = await makeTask(f, { title: "A", position: 1000 });
    const b = await makeTask(f, { title: "B", position: 2000 });
    // Un valor que la BD no acepta (prioridad inexistente, p. ej. de una entrada antigua) hace fallar el lote entero;
    // una a una solo falla esa.
    const ops: UndoOp[] = [
      { t: "task.set", id: a.id, data: { title: "A2", priority: "NOPE" as never } },
      { t: "task.set", id: b.id, data: { title: "B2", priority: "ALTA" } },
    ];
    const skipped = await applyUndo(f.project.id, ops);
    assert.equal(skipped, 1);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: a.id } })).title, "A");
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: b.id } })).title, "B2");
  });
});
