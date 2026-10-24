// Acciones más usadas del tablero (mover, editar, desplegar): fijan su comportamiento observable
// (resultado, entrada de deshacer, historial de la tarea, texto del registro, recurrencias, errores)
// y cuentan las consultas a PostgreSQL de moveTask / updateTask (se imprimen con el test).
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import pg from "pg";
import sharp from "sharp";
import { afterDone, db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND, type Fixture } from "./helpers";
import { moveTask, moveTasks, updateTask } from "../../src/actions/tasks";
import { deployRelease } from "../../src/actions/releases";
import { flushLogs } from "../../src/lib/log";
import { attachmentPath } from "../../src/lib/uploads";
import { POSITION_STEP as STEP } from "../../src/lib/positions";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-hot-"));

// Cuenta las consultas que llegan a PostgreSQL (BEGIN/COMMIT incluidos); las del registro (AppLog) se escriben
// en segundo plano y no cuentan.
let queries = 0;
const origQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
  const q = args[0];
  const text = typeof q === "string" ? q : (q as { text?: string } | undefined)?.text ?? "";
  if (!/"AppLog"/.test(text)) queries++;
  return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
} as typeof pg.Client.prototype.query;

async function counted<T>(fn: () => Promise<T>): Promise<{ value: T; queries: number }> {
  const start = queries;
  const value = await fn();
  return { value, queries: queries - start };
}

/** Sustituye ids conocidos por nombres, ids nuevos por <id> y fechas por <iso>, para comparar con lo esperado. */
function norm(value: unknown, names: Record<string, string>): unknown {
  let s = JSON.stringify(value);
  for (const [id, name] of Object.entries(names)) s = s.split(id).join(name);
  s = s.replace(/\bc[a-z0-9]{24}\b/g, "<id>").replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<iso>");
  return JSON.parse(s);
}

function fixtureNames(f: Fixture): Record<string, string> {
  return { [f.columns.todo]: "TODO", [f.columns.doing]: "DOING", [f.columns.done]: "DONE", [f.project.id]: "PROJECT", [f.kindId]: "KIND" };
}

/** Lo que deja la acción: entrada de deshacer, historial de las tareas y texto del registro de actividad. */
async function traces(projectId: string, action: string, since: Date) {
  await flushLogs();
  const [undo, events, logs] = await Promise.all([
    db.undoEntry.findMany({ where: { projectId, createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, select: { kind: true, label: true, ops: true, taskId: true } }),
    db.taskEvent.findMany({ where: { projectId, createdAt: { gte: since } }, orderBy: [{ createdAt: "asc" }, { taskId: "asc" }], select: { taskId: true, code: true, label: true } }),
    db.appLog.findMany({ where: { action, projectId, createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, select: { level: true, message: true } }),
  ]);
  return { undo, events, logs };
}

const sorted = <T,>(list: T[]): T[] => [...list].sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1));

// Con varias tareas el orden de las ops y de los eventos sale de la BD (sin ORDER BY): se ordenan para comparar.
/** Como norm, pero con las ops de deshacer y los eventos ordenados (el orden entre tareas no es significativo). */
function normSorted(t: Awaited<ReturnType<typeof traces>>, names: Record<string, string>) {
  const n = norm({ undo: t.undo, events: t.events, logs: t.logs }, names) as { undo: { ops: unknown[] }[]; events: unknown[]; logs: unknown[] };
  return { ...n, undo: n.undo.map((u) => ({ ...u, ops: sorted(u.ops) })), events: sorted(n.events) };
}

async function setup() {
  const user = await makeUser({ name: "Usuaria Uno" });
  const f = await makeProject({ members: [user] });
  await loginAs(user);
  return { user, f };
}

const counts: Record<string, number> = {};
process.on("exit", () => console.log("[consultas]", JSON.stringify(counts)));

describe("moveTask", () => {
  test("entre columnas: posición, deshacer, historial y registro", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "Mover @[Ana](user:u1) esto", position: 1000 });
    const p = await makeTask(f, { columnId: f.columns.doing, position: 1000 });
    const n = await makeTask(f, { columnId: f.columns.doing, position: 2000 });
    const since = new Date();
    const { value: res, queries: q } = await counted(() => moveTask(a.id, f.columns.doing, p.id, n.id));
    counts.moveTaskAcross = q;
    assert.deepEqual(expectOk(res), { position: 1500, spawned: [] });
    const row = await db.task.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(row.columnId, f.columns.doing);
    assert.equal(row.position, 1500);
    assert.deepEqual(norm(await traces(f.project.id, "tasks.moveTask", since), { ...fixtureNames(f), [a.id]: "A" }), {
      undo: [{ kind: "UNDO", label: "{\"k\":\"Movió «{title}» de «{from}» a «{to}»\",\"p\":{\"title\":\"Mover @Ana esto\",\"from\":\"Por hacer\",\"to\":\"En curso\"}}", ops: [{ t: "task.set", id: "A", data: { columnId: "TODO", position: 1000, evergreen: false } }], taskId: "A" }],
      events: [{ taskId: "A", code: "move", label: "{\"k\":\"Movió la tarea de «{from}» a «{to}»\",\"p\":{\"from\":\"Por hacer\",\"to\":\"En curso\"}}" }],
      logs: [{ level: "info", message: "Movió «Mover @Ana esto» de «Por hacer» a «En curso»" }],
    });
  });

  test("reordenar en la misma columna no deja historial", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "A", position: 1000 });
    await makeTask(f, { title: "B", position: 2000 });
    const since = new Date();
    const { value: res, queries: q } = await counted(() => moveTask(a.id, f.columns.todo, null, null));
    counts.moveTaskReorder = q;
    // Sin vecinas («stale» con prev/next nulos no aplica): entre null y null.
    const data = expectOk(res);
    assert.deepEqual(norm(await traces(f.project.id, "tasks.moveTask", since), { ...fixtureNames(f), [a.id]: "A" }), {
      undo: [{ kind: "UNDO", label: "{\"k\":\"Reordenó «{title}» en «{to}»\",\"p\":{\"title\":\"A\",\"from\":\"Por hacer\",\"to\":\"Por hacer\"}}", ops: [{ t: "task.set", id: "A", data: { columnId: "TODO", position: 1000, evergreen: false } }], taskId: "A" }],
      events: [],
      logs: [{ level: "info", message: "Reordenó «A» en «Por hacer»" }],
    });
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: a.id } })).position, data.position);
  });

  test("vecina que ya no está en la columna: va al final", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { position: 1000 });
    const gone = await makeTask(f, { position: 2000 }); // sigue en «Por hacer», no en «En curso»
    await makeTask(f, { columnId: f.columns.doing, position: 7000 });
    const res = expectOk(await moveTask(a.id, f.columns.doing, gone.id, null));
    assert.equal(res.position, 7000 + STEP);
  });

  test("a una columna terminada: código «done» y nace la siguiente aparición", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "Diaria", recurrence: "DAILY", dueDate: new Date("2026-01-10T00:00:00Z"), position: 1000 });
    const since = new Date();
    const { value: res, queries: q } = await counted(() => moveTask(a.id, f.columns.done, null, null));
    counts.moveTaskToDoneRecurring = q;
    const data = expectOk(res);
    assert.equal(data.spawned.length, 1);
    const next = await db.task.findFirstOrThrow({ where: { recurrenceFromId: a.id } });
    assert.equal(next.columnId, f.columns.todo);
    assert.equal(data.spawned[0]!.id, next.id);
    assert.deepEqual(norm(await traces(f.project.id, "tasks.moveTask", since), { ...fixtureNames(f), [a.id]: "A", [next.id]: "NEXT" }), {
      undo: [{ kind: "UNDO", label: "{\"k\":\"Movió «{title}» de «{from}» a «{to}»\",\"p\":{\"title\":\"Diaria\",\"from\":\"Por hacer\",\"to\":\"Hecho\"}}", ops: [{ t: "task.set", id: "A", data: { columnId: "TODO", position: 1000, evergreen: false } }, { t: "task.remove", id: "NEXT" }], taskId: "A" }],
      events: [{ taskId: "A", code: "done", label: "{\"k\":\"Movió la tarea de «{from}» a «{to}»\",\"p\":{\"from\":\"Por hacer\",\"to\":\"Hecho\"}}" }],
      logs: [{ level: "info", message: "Movió «Diaria» de «Por hacer» a «Hecho»" }],
    });
  });

  test("dentro de la columna terminada no vuelve a nacer", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "Diaria", recurrence: "DAILY", columnId: f.columns.done, position: 1000 });
    const res = expectOk(await moveTask(a.id, f.columns.done, null, null));
    assert.equal(res.spawned.length, 0);
  });

  test("errores: archivada, columna de otro proyecto, sin acceso", async () => {
    const { f } = await setup();
    const a = await makeTask(f);
    const other = await makeProject({ members: [] });
    expectFail(await moveTask(a.id, other.columns.doing, null, null), /La columna no existe/);
    const foreign = await makeTask(other);
    expectFail(await moveTask(foreign.id, other.columns.doing, null, null), NOT_FOUND);
    expectFail(await moveTask("nope", f.columns.doing, null, null), NOT_FOUND);
    await db.task.update({ where: { id: a.id }, data: { archivedAt: new Date() } });
    expectFail(await moveTask(a.id, f.columns.doing, null, null), /La tarea está archivada/);
  });
});

describe("moveTasks", () => {
  test("varias a la columna terminada: posiciones, recurrencias, deshacer, historial y registro", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "A", position: 1000 });
    const b = await makeTask(f, { title: "B", recurrence: "WEEKLY", columnId: f.columns.doing, position: 1000 });
    const c = await makeTask(f, { title: "C", columnId: f.columns.done, position: 3000 });
    const since = new Date();
    const { value: res, queries: q } = await counted(() => moveTasks([b.id, a.id, c.id], f.columns.done));
    counts.moveTasks = q;
    const data = expectOk(res);
    const next = await db.task.findFirstOrThrow({ where: { recurrenceFromId: b.id } });
    assert.deepEqual(norm({ ...data, spawned: data.spawned.map((s) => s.id) }, { ...fixtureNames(f), [a.id]: "A", [b.id]: "B", [next.id]: "NEXT" }), {
      columnId: "DONE", moved: [{ id: "A", position: 3000 + STEP }, { id: "B", position: 3000 + 2 * STEP }], spawned: ["NEXT"],
    });
    assert.deepEqual(normSorted(await traces(f.project.id, "tasks.moveTasks", since), { ...fixtureNames(f), [a.id]: "A", [b.id]: "B", [next.id]: "NEXT" }), {
      undo: [{ kind: "UNDO", label: "{\"k\":\"Movió {count} a «{col}»\",\"p\":{\"count\":{\"k\":\"{n} tareas\",\"p\":{\"n\":2}},\"col\":\"Hecho\"}}", ops: sorted([{ t: "task.set", id: "A", data: { columnId: "TODO", position: 1000, evergreen: false } }, { t: "task.set", id: "B", data: { columnId: "DOING", position: 1000, evergreen: false } }, { t: "task.remove", id: "NEXT" }]), taskId: null }],
      events: sorted([
        { taskId: "A", code: "done", label: "{\"k\":\"Movió la tarea a «{to}»\",\"p\":{\"to\":\"Hecho\"}}" },
        { taskId: "B", code: "done", label: "{\"k\":\"Movió la tarea a «{to}»\",\"p\":{\"to\":\"Hecho\"}}" },
      ]),
      logs: [{ level: "info", message: "Movió 2 tareas a «Hecho»" }],
    });
  });
});

describe("updateTask", () => {
  test("varios campos: deshacer, historial y registro", async () => {
    const { user, f } = await setup();
    const label = await db.label.create({ data: { projectId: f.project.id, name: "L", color: "blue" } });
    const kind2 = await db.taskKind.create({ data: { name: "Otro tipo", color: "#000000", position: 2, projectId: f.project.id } });
    const a = await makeTask(f, { title: "Viejo", dueDate: new Date("2026-03-01T00:00:00Z") });
    const since = new Date();
    const { value: res, queries: q } = await counted(() =>
      updateTask(a.id, { title: "Nuevo", description: "<p>d</p>", kindId: kind2.id, assigneeId: user.id, labelIds: [label.id], dueDate: "2026-03-05", recurrence: "MONTHLY" }, null),
    );
    counts.updateTaskMany = q;
    const data = expectOk(res);
    assert.equal(data.title, "Nuevo");
    const row = await db.task.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(row.recurrence, "MONTHLY");
    assert.equal(row.recurrenceDay, 5);
    assert.equal(row.contentUpdatedById, user.id);
    const names = { ...fixtureNames(f), [a.id]: "A", [user.id]: "USER", [kind2.id]: "KIND2", [label.id]: "LABEL" };
    assert.deepEqual(norm(await traces(f.project.id, "tasks.updateTask", since), names), {
      undo: [{
        kind: "UNDO",
        label: "{\"k\":\"Modificó «{title}»: {changes}\",\"p\":{\"title\":\"Nuevo\",\"changes\":{\"k\":\"{list} y {last}\",\"p\":{\"list\":[{\"k\":\"título\"},{\"k\":\"descripción\"},{\"k\":\"tipo\"},{\"k\":\"responsable\"},{\"k\":\"etiquetas\"},{\"k\":\"fecha límite\"}],\"last\":{\"k\":\"repetición\"}}}}}",
        ops: [{ t: "task.set", id: "A", data: { title: "Viejo", description: "", kindId: "KIND", assigneeId: null, recurrence: "NONE", recurrenceDay: null, dueDate: "<iso>", contentUpdatedAt: null, contentUpdatedById: null }, labelIds: [] }],
        taskId: "A",
      }],
      events: [
        { taskId: "A", code: "update", label: "{\"k\":\"Cambió el título de «{from}» a «{to}»\",\"p\":{\"from\":\"Viejo\",\"to\":\"Nuevo\"}}" },
        { taskId: "A", code: "update", label: "{\"k\":\"Editó la descripción\"}" },
        { taskId: "A", code: "update", label: "{\"k\":\"Cambió el tipo de «{from}» a «{to}»\",\"p\":{\"from\":\"" + (await db.taskKind.findUniqueOrThrow({ where: { id: f.kindId } })).name + "\",\"to\":\"Otro tipo\"}}" },
        { taskId: "A", code: "update", label: "{\"k\":\"Asignó la tarea a {name}\",\"p\":{\"name\":\"Usuaria Uno\"}}" },
        { taskId: "A", code: "update", label: "{\"k\":\"Puso la fecha límite el {date}\",\"p\":{\"date\":\"2026-03-05\"}}" },
        { taskId: "A", code: "update", label: "{\"k\":\"Cambió {changes}\",\"p\":{\"changes\":{\"k\":\"etiquetas\"}}}" },
      ],
      logs: [{ level: "info", message: "Modificó «Nuevo»: título, descripción, tipo, responsable, etiquetas, fecha límite y repetición" }],
    });
  });

  test("solo la repetición: el día sale de la fecha límite", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { dueDate: new Date("2026-03-04T00:00:00Z") }); // miércoles
    const { value: res, queries: q } = await counted(() => updateTask(a.id, { recurrence: "WEEKLY" }));
    counts.updateTaskRecurrence = q;
    expectOk(res);
    const row = await db.task.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(row.recurrence, "WEEKLY");
    assert.equal(row.recurrenceDay, 3);
  });

  test("solo el título (el caso más frecuente)", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "x" });
    const { value: res, queries: q } = await counted(() => updateTask(a.id, { title: "y" }, new Date().toISOString()));
    counts.updateTaskTitle = q;
    expectOk(res);
  });

  test("conflicto: otra persona cambió el texto después de cargarlo", async () => {
    const { user, f } = await setup();
    const other = await makeUser({ name: "Otra Persona" });
    const a = await makeTask(f, { title: "x" });
    const loaded = new Date(Date.now() - 60_000).toISOString();
    await db.task.update({ where: { id: a.id }, data: { contentUpdatedAt: new Date(), contentUpdatedById: other.id } });
    const err = expectFail(await updateTask(a.id, { title: "mía" }, loaded));
    assert.equal(err, "Otra Persona ha cambiado el texto de esta tarea mientras la editabas. Se ha recargado con sus cambios: vuelve a aplicar los tuyos.");
    // Sin `since` explícito (null = nunca cargado) también hay conflicto; sin argumento no se comprueba.
    expectFail(await updateTask(a.id, { description: "d" }, null), /ha cambiado el texto/);
    expectOk(await updateTask(a.id, { color: "#ef4444" }, loaded)); // no toca el texto
    expectOk(await updateTask(a.id, { title: "sin since" }));
    // Mi propio cambio no es conflicto.
    await db.task.update({ where: { id: a.id }, data: { contentUpdatedAt: new Date(), contentUpdatedById: user.id } });
    expectOk(await updateTask(a.id, { title: "mía otra vez" }, loaded));
    // Cargado después del último cambio: tampoco.
    await db.task.update({ where: { id: a.id }, data: { contentUpdatedAt: new Date(Date.now() - 120_000), contentUpdatedById: other.id } });
    expectOk(await updateTask(a.id, { title: "posterior" }, loaded));
    // Autor borrado: texto genérico.
    await db.task.update({ where: { id: a.id }, data: { contentUpdatedAt: new Date(), contentUpdatedById: null } });
    const anon = await makeUser();
    await db.task.update({ where: { id: a.id }, data: { contentUpdatedById: anon.id } });
    await db.user.delete({ where: { id: anon.id } });
    expectFail(await updateTask(a.id, { title: "z" }, loaded), /^Otra persona ha cambiado el texto/);
  });

  test("errores: archivada, evergreen fuera de la release, sin acceso", async () => {
    const { f } = await setup();
    const a = await makeTask(f);
    expectFail(await updateTask(a.id, { evergreen: true }), /Solo las tareas de la columna de la release/);
    await db.task.update({ where: { id: a.id }, data: { archivedAt: new Date() } });
    expectFail(await updateTask(a.id, { title: "x" }), /La tarea está archivada/);
    const other = await makeProject({ members: [] });
    expectFail(await updateTask((await makeTask(other)).id, { title: "x" }), NOT_FOUND);
  });
});

describe("deployRelease", () => {
  async function releaseSetup() {
    const { user, f } = await setup();
    const prod = await db.column.create({ data: { projectId: f.project.id, name: "En producción", position: 4000, role: "IN_PRODUCTION" } });
    return { user, f, prod };
  }

  test("a «En producción»: posiciones, fijas, deshacer y registro; los adjuntos se guardan después", async () => {
    const { user, f, prod } = await releaseSetup();
    await makeTask(f, { columnId: prod.id, position: 9000 });
    const a = await makeTask(f, { title: "A", columnId: f.columns.doing, position: 1000 });
    const b = await makeTask(f, { title: "B", columnId: f.columns.todo, position: 2000 });
    const e = await makeTask(f, { title: "Fija", columnId: f.columns.doing, position: 3000 });
    await db.task.update({ where: { id: e.id }, data: { evergreen: true } });
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#336699" } }).png().toBuffer();
    const img = await db.taskAttachment.create({ data: { taskId: a.id, originalName: "captura.png", isImage: true, size: png.length, createdById: user.id } });
    await sharp(png).webp().toFile(attachmentPath(img.id, "full")).catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(process.env.UPLOAD_DIR!, { recursive: true });
      await sharp(png).webp().toFile(attachmentPath(img.id, "full"));
    });
    const missing = await db.taskAttachment.create({ data: { taskId: b.id, originalName: "nada.pdf", isImage: false, mimeType: "application/pdf", size: 3 } });
    const since = new Date();
    const res = await deployRelease({
      projectId: f.project.id, title: "R uno", content: "Cambios", taskIds: [a.id, b.id, e.id], destination: "IN_PRODUCTION",
      attachments: [{ taskId: a.id, code: "F1" }, { taskId: b.id, code: "F2" }],
    });
    const data = expectOk(res);
    assert.deepEqual(norm(data, { ...fixtureNames(f), [prod.id]: "PROD", [a.id]: "A", [b.id]: "B" }), {
      releaseId: "<id>", moved: [{ id: "B", columnId: "PROD", position: 9000 + STEP }, { id: "A", columnId: "PROD", position: 9000 + 2 * STEP }], archived: [], spawned: [],
    });
    const rows = await db.task.findMany({ where: { id: { in: [a.id, b.id, e.id] } }, select: { id: true, columnId: true, position: true, evergreen: true, archivedAt: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.deepEqual(byId.get(a.id), { id: a.id, columnId: prod.id, position: 9000 + 2 * STEP, evergreen: false, archivedAt: null });
    assert.deepEqual(byId.get(b.id), { id: b.id, columnId: prod.id, position: 9000 + STEP, evergreen: false, archivedAt: null });
    assert.deepEqual(byId.get(e.id), { id: e.id, columnId: f.columns.doing, position: 3000, evergreen: true, archivedAt: null });
    const t = await traces(f.project.id, "releases.deployRelease", since);
    assert.deepEqual(normSorted(t, { ...fixtureNames(f), [prod.id]: "PROD", [a.id]: "A", [b.id]: "B", [e.id]: "E", [data.releaseId]: "REL" }), {
      undo: [{
        kind: "UNDO",
        label: "{\"k\":\"Desplegó la release «{title}» con {count}{archived}{fixed}\",\"p\":{\"title\":\"R uno\",\"count\":{\"k\":\"{n} tareas\",\"p\":{\"n\":3}},\"archived\":\"\",\"fixed\":{\"k\":\" (1 fija se queda)\"}}}",
        ops: sorted(
          [
          { t: "task.set", id: "B", data: { columnId: "TODO", position: 2000, archivedAt: null, archivedFromColumnId: null, evergreen: false } },
          { t: "task.set", id: "A", data: { columnId: "DOING", position: 1000, archivedAt: null, archivedFromColumnId: null, evergreen: false } },
          { t: "task.set", id: "E", data: { columnId: "DOING", position: 3000, archivedAt: null, archivedFromColumnId: null, evergreen: true } },
          { t: "release.remove", id: "REL" },
        ],
        ),
        taskId: null,
      }],
      events: [],
      logs: [{ level: "info", message: "Desplegó la release «R uno» con 3 tareas (1 fija se queda)" }],
    });
    // La copia del adjunto que existe se guarda (en segundo plano); la del que falta se omite y queda en el registro.
    await afterDone();
    const atts = await db.releaseAttachment.findMany({ where: { releaseId: data.releaseId }, select: { id: true, fileName: true, isImage: true, position: true } });
    assert.deepEqual(atts.map(({ fileName, isImage, position }) => ({ fileName, isImage, position })), [{ fileName: "F1_captura.webp", isImage: true, position: 0 }]);
    assert.deepEqual(await readdir(path.join(process.env.UPLOAD_DIR!, "releases")), [`${atts[0]!.id}.webp`]);
    void missing;
  });

  test("archivar: marca archivadas recordando la columna y nacen las recurrentes", async () => {
    const { f } = await releaseSetup();
    const a = await makeTask(f, { title: "A", columnId: f.columns.doing, recurrence: "DAILY" });
    const res = expectOk(await deployRelease({ projectId: f.project.id, title: "R", content: "c", taskIds: [a.id], destination: "ARCHIVE" }));
    assert.deepEqual(res.archived, [a.id]);
    assert.equal(res.spawned.length, 1);
    const row = await db.task.findUniqueOrThrow({ where: { id: a.id } });
    assert.ok(row.archivedAt);
    assert.equal(row.archivedFromColumnId, f.columns.doing);
  });

  test("muchas tareas en una sola release", async () => {
    const { f, prod } = await releaseSetup();
    const ids: string[] = [];
    const created = await db.task.createManyAndReturn({
      data: Array.from({ length: 300 }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.doing, title: `T${i}`, kindId: f.kindId, position: (i + 1) * 10 })),
      select: { id: true },
    });
    ids.push(...created.map((c) => c.id));
    const { value: res, queries: q } = await counted(() => deployRelease({ projectId: f.project.id, title: "Grande", content: "c", taskIds: ids, destination: "IN_PRODUCTION" }));
    counts.deployRelease300 = q;
    const data = expectOk(res);
    assert.equal(data.moved.length, 300);
    const rows = await db.task.findMany({ where: { id: { in: ids } }, orderBy: { position: "asc" }, select: { id: true, columnId: true, position: true } });
    assert.ok(rows.every((r) => r.columnId === prod.id));
    assert.deepEqual(rows.map((r) => r.position), Array.from({ length: 300 }, (_, i) => (i + 1) * STEP));
    assert.deepEqual(rows.map((r) => r.id), ids);
  });
});
