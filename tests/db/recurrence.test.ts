// Tareas recurrentes: la siguiente aparición (campos opcionales, fecha de inicio desplazada) y deshacer el borrado de
// una aparición sin perder de qué tarea salió ni su columna de rutinas.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { createTask, deleteTask, moveTask } from "../../src/actions/tasks";
import { undoLast } from "../../src/actions/undo";
import pg from "pg";
import { spawnRecurrences } from "../../src/lib/recurrence";
import { MAX_ACTIVE_TASKS_PER_PROJECT } from "../../src/lib/constants";

const nextOf = (taskId: string) => db.task.findFirstOrThrow({ where: { recurrenceFromId: taskId } });
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("siguiente aparición de una tarea recurrente", () => {
  test("copia coste, horas estimadas, prioridad y cliente; reinicia pagado y horas reales; desplaza la fecha de inicio", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const a = await makeTask(f, { title: "Mensual", recurrence: "DAILY", columnId: f.columns.doing, dueDate: day("2999-01-10") });
    await db.task.update({
      where: { id: a.id },
      data: { cost: "120.50", costPaid: true, estimatedHours: "3.5", actualHours: "4", priority: "ALTA", client: "Cliente SL", startDate: day("2999-01-07") },
    });
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    const next = await nextOf(a.id);
    assert.equal(next.cost?.toFixed(2), "120.50");
    assert.equal(next.costPaid, false);
    assert.equal(next.estimatedHours?.toFixed(2), "3.50");
    assert.equal(next.actualHours, null);
    assert.equal(next.priority, "ALTA");
    assert.equal(next.client, "Cliente SL");
    // Diaria con límite 2999-01-10 → 2999-01-11: el inicio se desplaza el mismo día (3 días antes del límite).
    assert.equal(next.dueDate?.toISOString().slice(0, 10), "2999-01-11");
    assert.equal(next.startDate?.toISOString().slice(0, 10), "2999-01-08");
  });

  test("sin fecha límite anterior, la fecha de inicio queda vacía", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const a = await makeTask(f, { title: "Sin límite", recurrence: "DAILY", columnId: f.columns.doing });
    await db.task.update({ where: { id: a.id }, data: { startDate: day("2999-01-07") } });
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    assert.equal((await nextOf(a.id)).startDate, null);
  });
});

describe("deshacer el borrado de una aparición", () => {
  test("borrar una tarea recurrente y deshacer conserva de qué tarea salió y su columna de rutinas", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const a = await makeTask(f, { title: "Origen", recurrence: "DAILY", columnId: f.columns.doing });
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    const next = await nextOf(a.id);
    await db.task.update({ where: { id: next.id }, data: { routineColumnId: f.columns.todo } });
    expectOk(await deleteTask(next.id));
    expectOk(await undoLast(f.project.id));
    const back = await db.task.findUniqueOrThrow({ where: { id: next.id } });
    assert.equal(back.recurrenceFromId, a.id);
    assert.equal(back.routineColumnId, f.columns.todo);
  });
});

describe("«Repetir» al crear la tarea", () => {
  test("guarda la regla y deja el día coherente (de la fecha límite si falta; sin día en la diaria)", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const base = { projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId };
    // 2999-01-07 es lunes.
    const weekly = expectOk(await createTask({ ...base, title: "Semanal", dueDate: "2999-01-07", recurrence: "WEEKLY" }));
    assert.deepEqual([weekly.recurrence, weekly.recurrenceDay], ["WEEKLY", 1]);
    const monthly = expectOk(await createTask({ ...base, title: "Mensual", dueDate: "2999-01-07", recurrence: "MONTHLY", recurrenceDay: 31 }));
    assert.deepEqual([monthly.recurrence, monthly.recurrenceDay], ["MONTHLY", 31]);
    // Día fuera de rango para la semana: se toma el de la fecha límite.
    const fixed = expectOk(await createTask({ ...base, title: "Corregida", dueDate: "2999-01-07", recurrence: "WEEKLY", recurrenceDay: 20 }));
    assert.equal(fixed.recurrenceDay, 1);
    const daily = expectOk(await createTask({ ...base, title: "Diaria", recurrence: "DAILY", recurrenceDay: 5 }));
    assert.deepEqual([daily.recurrence, daily.recurrenceDay], ["DAILY", null]);
    const plain = expectOk(await createTask({ ...base, title: "Normal" }));
    assert.deepEqual([plain.recurrence, plain.recurrenceDay], ["NONE", null]);
    // Y se comporta como una creada desde el detalle: al terminarla nace la siguiente.
    expectOk(await moveTask(weekly.id, f.columns.done, null, null));
    assert.equal((await nextOf(weekly.id)).dueDate?.toISOString().slice(0, 10), "2999-01-14");
  });
});

describe("muchas apariciones a la vez", () => {
  /** Consultas SQL que hace `fn` (las del registro de actividad aparte). */
  async function counted<T>(fn: () => Promise<T>): Promise<{ value: T; queries: number }> {
    const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
    const orig = proto.query;
    let queries = 0;
    proto.query = function (this: unknown, ...args: unknown[]) {
      const q = args[0];
      const text = typeof q === "string" ? q : ((q as { text?: string } | undefined)?.text ?? "");
      if (!/"AppLog"/.test(text)) queries++;
      return orig.apply(this, args);
    };
    try {
      return { value: await fn(), queries };
    } finally {
      proto.query = orig;
    }
  }

  // Antes, varias consultas y una transacción por tarea: con 500, unas 6.000 consultas y varios segundos.
  // (Con 500 de origen, terminadas pero activas, y 1 más, solo caben 499 por el tope de 1000 tareas activas: 450.)
  test("450 tareas: lecturas una vez por lote, mismas columnas, posiciones, responsables, etiquetas y subtareas", async () => {
    const user = await makeUser();
    const gone = await makeUser({ active: false });
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const label = await db.label.create({ data: { projectId: f.project.id, name: "Etiqueta", color: "#123456" } });
    const N = 450;
    await db.task.createMany({
      data: Array.from({ length: N }, (_, i) => ({
        projectId: f.project.id, columnId: f.columns.done, kindId: f.kindId, title: `R${i}`, position: (i + 1) * 1000,
        recurrence: "DAILY" as const, assigneeId: i % 2 ? user.id : gone.id,
      })),
    });
    const sources = await db.task.findMany({ where: { projectId: f.project.id }, orderBy: { position: "asc" }, select: { id: true } });
    await db.subtask.createMany({ data: sources.flatMap((t) => [1, 2].map((p) => ({ taskId: t.id, title: `s${p}`, position: p, done: true }))) });
    await db.taskLabel.createMany({ data: sources.map((t) => ({ taskId: t.id, labelId: label.id })) });
    await db.task.create({ data: { projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId, title: "Ya estaba", position: 5000 } });
    const { value: spawned, queries } = await counted(() => spawnRecurrences(sources.map((t) => t.id), user.id));
    assert.equal(spawned.length, N);
    assert.ok(queries < 200, `demasiadas consultas: ${queries}`);
    const next = await db.task.findMany({
      where: { recurrenceFromId: { in: sources.map((t) => t.id) } },
      orderBy: { position: "asc" },
      select: { id: true, title: true, columnId: true, position: true, assigneeId: true, labels: { select: { labelId: true } }, subtasks: { select: { done: true } } },
    });
    // En el orden de las de origen, al final de «Por hacer» (detrás de la que ya estaba), de 1024 en 1024.
    assert.deepEqual(next.map((t) => t.title), sources.map((_, i) => `R${i}`));
    assert.ok(next.every((t, i) => t.columnId === f.columns.todo && t.position === 5000 + (i + 1) * 1024));
    assert.ok(next.every((t, i) => t.assigneeId === (i % 2 ? user.id : null)));
    assert.ok(next.every((t) => t.labels.length === 1 && t.subtasks.length === 2 && t.subtasks.every((s) => !s.done)));
    assert.deepEqual(spawned.map((t) => t.id), next.map((t) => t.id));
    assert.ok(spawned.every((t) => t.subtaskTotal === 2 && t.subtaskDone === 0 && t.labelIds.length === 1));
  });

  test("con el proyecto cerca del tope de tareas activas solo nacen las que caben", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    await db.task.createMany({
      data: Array.from({ length: MAX_ACTIVE_TASKS_PER_PROJECT - 7 }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId, title: `F${i}`, position: i })),
    });
    const reps = [];
    for (let i = 0; i < 5; i++) reps.push(await makeTask(f, { title: `Rep ${i}`, columnId: f.columns.done, recurrence: "DAILY" }));
    const spawned = await spawnRecurrences(reps.map((t) => t.id), user.id);
    assert.equal(spawned.length, 2);
    assert.equal(await db.task.count({ where: { projectId: f.project.id, archivedAt: null } }), MAX_ACTIVE_TASKS_PER_PROJECT);
  });

  test("dos peticiones a la vez sobre las mismas tareas: de cada una sale una sola siguiente", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const reps = [];
    for (let i = 0; i < 6; i++) reps.push(await makeTask(f, { title: `Rep ${i}`, columnId: f.columns.done, recurrence: "DAILY" }));
    const ids = reps.map((t) => t.id);
    const [a, b] = await Promise.all([spawnRecurrences(ids, user.id), spawnRecurrences(ids, user.id)]);
    assert.equal(a.length + b.length, 6);
    assert.equal(await db.task.count({ where: { recurrenceFromId: { in: ids } } }), 6);
  });
});
