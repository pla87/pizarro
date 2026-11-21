// Tareas recurrentes: la siguiente aparición (campos opcionales, fecha de inicio desplazada) y deshacer el borrado de
// una aparición sin perder de qué tarea salió ni su columna de rutinas.
import assert from "node:assert/strict";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser, waitForLockWaiter, type Fixture } from "./helpers";
import { createTask, deleteTask, moveTask } from "../../src/actions/tasks";
import { undoLast } from "../../src/actions/undo";
import pg from "pg";
import { spawnRecurrences } from "../../src/lib/recurrence";
import { MAX_ACTIVE_TASKS_PER_PROJECT } from "../../src/lib/constants";
import { PROGRAM_MAX_SESSIONS } from "../../src/lib/program-limit";
import { lockColumns } from "../../src/lib/task-positions";
import { flushLogs } from "../../src/lib/log";
import { attachmentPath } from "../../src/lib/uploads";
import { addDaysIso, todayIso } from "../../src/lib/dates";
import { appTimeZone } from "../../src/lib/format";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-recurrence-"));

const nextOf = (taskId: string) => db.task.findFirstOrThrow({ where: { recurrenceFromId: taskId } });
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

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

describe("entregable de la siguiente aparición", () => {
  /** Tarea recurrente de un entregable con esa fecha (o sin fecha); la termina y devuelve el entregable de la siguiente. */
  async function nextDeliverable(due: string | null): Promise<{ deliverableId: string; next: string | null }> {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const d = await db.deliverable.create({ data: { projectId: f.project.id, name: "Entrega", position: 1000, dueDate: due ? day(due) : null } });
    const a = await makeTask(f, { title: "Semanal", recurrence: "WEEKLY", columnId: f.columns.doing, dueDate: day("2999-01-10") });
    await db.task.update({ where: { id: a.id }, data: { deliverableId: d.id } });
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    return { deliverableId: d.id, next: (await nextOf(a.id)).deliverableId };
  }

  test("lo hereda si no ha vencido (sin fecha, en el futuro o hoy) y no si ya venció", async () => {
    const today = todayIso(appTimeZone());
    for (const due of [null, "2999-01-01", today]) {
      const { deliverableId, next } = await nextDeliverable(due);
      assert.equal(next, deliverableId, `con fecha ${due}`);
    }
    for (const due of [addDaysIso(today, -1), "2000-01-01"]) {
      assert.equal((await nextDeliverable(due)).next, null, `con fecha ${due}`);
    }
  });

  test("«vencido» con el día de la zona de la app", async () => {
    const prev = process.env.APP_TIMEZONE;
    // Entre UTC−12 y UTC+14 hay 26 horas: el día de UTC−12 es siempre anterior al de Kiritimati.
    const due = todayIso("Etc/GMT+12");
    try {
      process.env.APP_TIMEZONE = "Etc/GMT+12";
      const west = await nextDeliverable(due);
      assert.equal(west.next, west.deliverableId, "en UTC−12 vence hoy: lo hereda");
      process.env.APP_TIMEZONE = "Pacific/Kiritimati";
      assert.equal((await nextDeliverable(due)).next, null, "en UTC+14 ya venció ayer");
    } finally {
      if (prev === undefined) delete process.env.APP_TIMEZONE;
      else process.env.APP_TIMEZONE = prev;
    }
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

  test("una columna que pasa a «Programa del curso» (en el tope) mientras se reparten: no nace ninguna allí", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    // «Por hacer» llena hasta el tope de sesiones, aún sin el rol: el reparto la lee como columna sin tope.
    await db.task.createMany({
      data: Array.from({ length: PROGRAM_MAX_SESSIONS }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId, title: `S${i}`, position: (i + 1) * 1000 })),
    });
    const reps: { id: string }[] = [];
    for (let i = 0; i < 3; i++) reps.push(await makeTask(f, { title: `Rep ${i}`, columnId: f.columns.done, recurrence: "DAILY" }));
    // Con la columna bloqueada (como setColumnRole), el reparto espera al candado; entonces la columna pasa a PROGRAM.
    let spawning: ReturnType<typeof spawnRecurrences> | undefined;
    await db.$transaction(async (tx) => {
      await lockColumns(tx, [f.columns.todo]);
      spawning = spawnRecurrences(reps.map((t) => t.id), user.id);
      await waitForLockWaiter();
      await tx.column.update({ where: { id: f.columns.todo }, data: { role: "PROGRAM" } });
    }, { timeout: 20_000 });
    const spawned = await spawning!;
    assert.equal(spawned.length, 0);
    assert.equal(await db.task.count({ where: { columnId: f.columns.todo, archivedAt: null } }), PROGRAM_MAX_SESSIONS);
  });
});

describe("adjuntos citados en la descripción", () => {
  /** Adjunto de imagen con sus ficheros (WebP y miniatura) en UPLOAD_DIR. */
  async function image(taskId: string, name: string, size = 4) {
    const att = await db.taskAttachment.create({ data: { taskId, originalName: name, size, isImage: true, mimeType: "image/webp" } });
    await writeFile(attachmentPath(att.id, "full"), "full");
    await writeFile(attachmentPath(att.id, "thumb"), "mini");
    return att;
  }
  const exists = (file: string) => stat(file).then(() => true, () => false);

  test("la siguiente copia solo los adjuntos que cita y su descripción apunta a las copias; sobrevive a borrar la anterior", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const other = await makeTask(f, { title: "Otra" });
    const foreign = await image(other.id, "ajena.png");
    const a = await makeTask(f, { title: "Semanal", recurrence: "WEEKLY", columnId: f.columns.doing });
    const cited = await image(a.id, "captura.png");
    await image(a.id, "sin-citar.png");
    const description = `Mira ![captura](/api/attachments/${cited.id}) y [ajena](/api/attachments/${foreign.id}?thumb=1) y otra vez ![](/api/attachments/${cited.id}?thumb=1)`;
    await db.task.update({ where: { id: a.id }, data: { description } });
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    const next = await db.task.findFirstOrThrow({ where: { recurrenceFromId: a.id }, include: { attachments: true } });
    assert.equal(next.attachments.length, 1, "solo el citado");
    const copy = next.attachments[0]!;
    assert.equal(copy.originalName, "captura.png");
    assert.notEqual(copy.id, cited.id);
    assert.equal(next.description, `Mira ![captura](/api/attachments/${copy.id}) y [ajena](/api/attachments/${foreign.id}?thumb=1) y otra vez ![](/api/attachments/${copy.id}?thumb=1)`);
    expectOk(await deleteTask(a.id));
    assert.ok(await exists(attachmentPath(copy.id, "full")));
    assert.ok(await exists(attachmentPath(copy.id, "thumb")));
  });

  test("si no cabe (tope de adjuntos de la tarea), deja la referencia a la anterior y lo anota", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await db.project.update({ where: { id: f.project.id }, data: { taskAttachMaxMb: 1 } });
    await loginAs(user);
    const a = await makeTask(f, { title: "Diaria grande", recurrence: "DAILY", columnId: f.columns.doing });
    const big = await image(a.id, "grande.png", 2 * 1024 * 1024);
    const description = `![grande](/api/attachments/${big.id})`;
    await db.task.update({ where: { id: a.id }, data: { description } });
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    const next = await db.task.findFirstOrThrow({ where: { recurrenceFromId: a.id }, include: { attachments: true } });
    assert.equal(next.attachments.length, 0);
    assert.equal(next.description, description);
    await flushLogs();
    const log = await db.appLog.findFirstOrThrow({ where: { action: "recurrence.attachmentsSkipped", projectId: f.project.id } });
    assert.match(JSON.stringify(log.details), /task_total/);
  });

  test("300 a la vez: los adjuntos se copian en lote (pocas consultas más que sin ellos)", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const N = 300;
    await db.task.createMany({
      data: Array.from({ length: N }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.done, kindId: f.kindId, title: `A${i}`, position: (i + 1) * 1000, recurrence: "DAILY" as const })),
    });
    const sources = await db.task.findMany({ where: { projectId: f.project.id }, orderBy: { position: "asc" }, select: { id: true } });
    const atts = await db.taskAttachment.createManyAndReturn({ data: sources.map((t) => ({ taskId: t.id, originalName: "a.png", size: 4, isImage: true, mimeType: "image/webp" })), select: { id: true, taskId: true } });
    for (const att of atts) {
      await writeFile(attachmentPath(att.id, "full"), "full");
      await writeFile(attachmentPath(att.id, "thumb"), "mini");
    }
    const ids = atts.map((x) => x.id);
    const tasks = atts.map((x) => x.taskId);
    await db.$executeRaw`UPDATE "Task" AS t SET "description" = '![](/api/attachments/' || d.a || ')' FROM unnest(${tasks}::text[], ${ids}::text[]) AS d(id, a) WHERE t."id" = d.id`;
    const { value: spawned, queries } = await counted(() => spawnRecurrences(sources.map((t) => t.id), user.id));
    assert.equal(spawned.length, N);
    // Unas 55 (medido): los adjuntos suman un número fijo de consultas para todo el lote, no uno por tarea.
    assert.ok(queries < 80, `demasiadas consultas: ${queries}`);
    const next = await db.task.findMany({ where: { recurrenceFromId: { in: sources.map((t) => t.id) } }, select: { description: true, attachments: { select: { id: true } } } });
    assert.ok(next.every((t) => t.attachments.length === 1 && t.description === `![](/api/attachments/${t.attachments[0]!.id})`));
  });
});

/** Dos personas con acceso a un proyecto nuevo. */
async function twoPeople(): Promise<{ a: { id: string }; b: { id: string }; f: Fixture }> {
  const a = await makeUser();
  const b = await makeUser();
  const f = await makeProject({ members: [a, b] });
  return { a, b, f };
}

describe("deshacer el borrado de una tarea recurrente", () => {
  test("si entretanto nació otra siguiente aparición, vuelve sin origen en vez de perderse", async () => {
    const { a, b, f } = await twoPeople();
    const source = await makeTask(f, { title: "Diaria", recurrence: "DAILY", dueDate: new Date("2026-11-02T00:00:00Z") });
    await loginAs(a);
    const first = expectOk(await moveTask(source.id, f.columns.done, null, null)).spawned[0]!.id;
    expectOk(await deleteTask(first));
    // Otra persona la saca de «Hecho» y la vuelve a terminar: nace otra siguiente aparición.
    await loginAs(b);
    expectOk(await moveTask(source.id, f.columns.todo, null, null));
    const second = expectOk(await moveTask(source.id, f.columns.done, null, null)).spawned[0]!.id;
    await loginAs(a);
    const res = expectOk(await undoLast(f.project.id));
    assert.equal(res.skipped, 0);
    const back = await db.task.findUniqueOrThrow({ where: { id: first } });
    assert.equal(back.recurrenceFromId, null);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: second } })).recurrenceFromId, source.id);
  });
});
