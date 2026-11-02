// Revisión del núcleo del tablero, contra PostgreSQL real: «Cancelar» solo deshace lo propio (también la siguiente
// aparición de una recurrente), tareas fijas tras deshacer, topes en paralelo, deshacer el borrado de una recurrente,
// ficheros que retiene más de una entrada, autor de los comentarios importados y desempates de posición.
import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, type Fixture } from "./helpers";
import {
  addComment, addSubtask, deleteAttachment, deleteComment, deleteSubtask, deleteTask, moveTask, restoreTaskSnapshot, updateSubtask, updateTask,
  type TaskEditSnapshot,
} from "../../src/actions/tasks";
import { setColumnRole } from "../../src/actions/columns";
import { createKind } from "../../src/actions/kinds";
import { redoLast, undoEntry, undoLast } from "../../src/actions/undo";
import { discardEntries } from "../../src/lib/undo";
import { resolvePositionTies } from "../../src/lib/task-positions";
import { attachmentPath } from "../../src/lib/uploads";
import { invalidateAppSettings } from "../../src/lib/app-settings";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-core-review-"));

const att = (taskId: string, name: string, createdById: string | null = null) =>
  db.taskAttachment.create({ data: { taskId, originalName: name, mimeType: "text/plain", isImage: false, size: 10, createdById } });

/** Lo que el diálogo guarda al abrirse: la tarea tal como está en la base de datos y la hora de apertura. */
async function snapshotOf(taskId: string): Promise<TaskEditSnapshot> {
  const openedAt = new Date().toISOString();
  const t = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { labels: true, subtasks: { orderBy: { position: "asc" } }, attachments: true, links: true },
  });
  return {
    openedAt,
    title: t.title, description: t.description, kindId: t.kindId, color: t.color as never, linkUrl: t.linkUrl, assigneeId: t.assigneeId,
    labelIds: t.labels.map((l) => l.labelId), dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null, deliverableId: t.deliverableId,
    evergreen: t.evergreen, evergreenEvery: t.evergreenEvery, recurrence: t.recurrence, recurrenceDay: t.recurrenceDay, columnId: t.columnId, position: t.position,
    subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done, position: s.position })),
    attachmentIds: t.attachments.map((a) => a.id),
    links: t.links.map((l) => ({ id: l.id, kind: l.kind, title: l.title, url: l.url })),
  };
}

const undoCount = (userId: string, projectId: string) => db.undoEntry.count({ where: { userId, projectId, kind: "UNDO" } });
const exists = (file: string) => access(file).then(() => true, () => false);

/** Dos personas con acceso a un proyecto nuevo. */
async function twoPeople(): Promise<{ a: { id: string }; b: { id: string }; f: Fixture }> {
  const a = await makeUser();
  const b = await makeUser();
  const f = await makeProject({ members: [a, b] });
  return { a, b, f };
}

describe("Cancelar solo deshace lo que hizo esa persona desde que abrió el detalle", () => {
  test("los cambios de otra persona a la vez se conservan", async () => {
    const { a, b, f } = await twoPeople();
    const task = await makeTask(f, { title: "Original", subtasks: ["uno", "dos", "tres"] });
    const [s1, s2, s3] = await db.subtask.findMany({ where: { taskId: task.id }, orderBy: { position: "asc" } });
    const before = await att(task.id, "de-antes.txt", b.id);
    await loginAs(a);
    const snap = await snapshotOf(task.id);

    // A edita…
    expectOk(await updateTask(task.id, { title: "De A" }));
    expectOk(await updateSubtask(s1!.id, { done: true }));
    // …y B, a la vez, otras cosas de la misma tarea.
    await loginAs(b);
    expectOk(await updateTask(task.id, { color: "#0ea5e9", assigneeId: b.id }));
    expectOk(await updateSubtask(s2!.id, { title: "dos (B)" }));
    expectOk(await deleteSubtask(s3!.id));
    const subB = expectOk(await addSubtask(task.id, "de B"));
    const attB = await att(task.id, "de-b.txt", b.id);
    expectOk(await deleteAttachment(before.id));

    await loginAs(a);
    const entries = await undoCount(a.id, f.project.id);
    const res = expectOk(await restoreTaskSnapshot(task.id, snap, null));
    assert.equal(res.changed, true);
    const back = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { subtasks: true, attachments: true } });
    // Lo de A vuelve a como estaba al abrir…
    assert.equal(back.title, "Original");
    assert.equal(back.subtasks.find((s) => s.id === s1!.id)?.done, false);
    // …y lo de B se queda.
    assert.equal(back.color, "#0ea5e9");
    assert.equal(back.assigneeId, b.id);
    assert.equal(back.subtasks.find((s) => s.id === s2!.id)?.title, "dos (B)");
    assert.ok(!back.subtasks.some((s) => s.id === s3!.id), "la subtarea que borró B no vuelve");
    assert.ok(back.subtasks.some((s) => s.id === subB.id), "la subtarea que añadió B no se quita");
    assert.deepEqual(back.attachments.map((x) => x.id), [attB.id]);
    assert.equal(await undoCount(a.id, f.project.id), entries + 1, "una sola entrada de deshacer");

    // Deshacer Cancelar devuelve lo de A.
    expectOk(await undoLast(f.project.id));
    const again = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { subtasks: true } });
    assert.equal(again.title, "De A");
    assert.equal(again.subtasks.find((s) => s.id === s1!.id)?.done, true);
    assert.equal(again.color, "#0ea5e9");
  });

  test("lo que esa persona borró vuelve aunque lo hubiera creado otra después de abrir; lo que creó ella se quita", async () => {
    const { a, b, f } = await twoPeople();
    const task = await makeTask(f);
    await loginAs(a);
    const snap = await snapshotOf(task.id);
    await loginAs(b);
    const subB = expectOk(await addSubtask(task.id, "de B"));
    const attB = await att(task.id, "de-b.txt", b.id);
    await loginAs(a);
    expectOk(await deleteSubtask(subB.id));
    expectOk(await deleteAttachment(attB.id));
    const subA = expectOk(await addSubtask(task.id, "de A"));
    const attA = await att(task.id, "de-a.txt", a.id);
    const linkA = await db.taskLink.create({ data: { taskId: task.id, kind: "GOOGLE_DOC", title: "Doc", url: "https://docs.google.com/document/d/x", createdById: a.id } });
    const linkB = await db.taskLink.create({ data: { taskId: task.id, kind: "GOOGLE_DOC", title: "Doc B", url: "https://docs.google.com/document/d/y", createdById: b.id } });

    expectOk(await restoreTaskSnapshot(task.id, snap, null));
    const back = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { subtasks: true, attachments: true, links: true } });
    assert.deepEqual(back.subtasks.map((s) => s.id), [subB.id]);
    assert.deepEqual(back.attachments.map((x) => x.id), [attB.id]);
    assert.deepEqual(back.links.map((l) => l.id), [linkB.id]);
    assert.equal(await db.subtask.count({ where: { id: subA.id } }), 0);
    assert.equal(await db.taskAttachment.count({ where: { id: attA.id } }), 0);
    assert.equal(await db.taskLink.count({ where: { id: linkA.id } }), 0);
  });

  test("con solo cambios de otras personas no hace nada ni deja entrada", async () => {
    const { a, b, f } = await twoPeople();
    const task = await makeTask(f, { title: "T" });
    await loginAs(a);
    const snap = await snapshotOf(task.id);
    await loginAs(b);
    expectOk(await updateTask(task.id, { title: "De B", color: "#ef4444" }));
    expectOk(await moveTask(task.id, f.columns.doing, null, null));
    await loginAs(a);
    const entries = await undoCount(a.id, f.project.id);
    const res = expectOk(await restoreTaskSnapshot(task.id, snap, null));
    assert.equal(res.changed, false);
    assert.equal(await undoCount(a.id, f.project.id), entries);
    const t = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.deepEqual([t.title, t.color, t.columnId], ["De B", "#ef4444", f.columns.doing]);
  });

  test("lo hecho antes de abrir el detalle no cuenta", async () => {
    const { a, f } = await twoPeople();
    const task = await makeTask(f, { title: "T" });
    await loginAs(a);
    const sub = expectOk(await addSubtask(task.id, "antes"));
    expectOk(await updateTask(task.id, { color: "#ef4444" }));
    const snap = await snapshotOf(task.id);
    expectOk(await updateTask(task.id, { title: "Después" }));
    expectOk(await restoreTaskSnapshot(task.id, snap, null));
    const t = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { subtasks: true } });
    assert.deepEqual([t.title, t.color, t.subtasks.map((s) => s.id)], ["T", "#ef4444", [sub.id]]);
  });

  test("si devuelve la tarjeta, retira la siguiente aparición que nació al terminarla (y deshacer la devuelve)", async () => {
    const { a, b, f } = await twoPeople();
    const task = await makeTask(f, { title: "Diaria", recurrence: "DAILY", dueDate: new Date("2026-11-02T00:00:00Z") });
    await loginAs(a);
    const snap = await snapshotOf(task.id);
    const moved = expectOk(await moveTask(task.id, f.columns.done, null, null));
    assert.equal(moved.spawned.length, 1);
    const next = moved.spawned[0]!.id;
    const entries = await undoCount(a.id, f.project.id);

    expectOk(await restoreTaskSnapshot(task.id, snap, null));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).columnId, f.columns.todo);
    assert.equal(await db.task.count({ where: { id: next } }), 0, "la siguiente aparición se retira");
    assert.equal(await undoCount(a.id, f.project.id), entries + 1, "una sola entrada de deshacer");

    expectOk(await undoLast(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).columnId, f.columns.done);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: next } })).recurrenceFromId, task.id);

    // La que nació por un movimiento de otra persona no se toca (Cancelar ni siquiera mueve la tarjeta).
    const other = await makeTask(f, { title: "Semanal", recurrence: "WEEKLY", dueDate: new Date("2026-11-02T00:00:00Z") });
    await loginAs(a);
    const snap2 = await snapshotOf(other.id);
    await loginAs(b);
    const byB = expectOk(await moveTask(other.id, f.columns.done, null, null)).spawned[0]!.id;
    await loginAs(a);
    assert.equal(expectOk(await restoreTaskSnapshot(other.id, snap2, null)).changed, false);
    assert.equal(await db.task.count({ where: { id: byB } }), 1);
  });
});

describe("tareas fijas y roles de columna al deshacer", () => {
  test("deshacer el cambio de rol no pisa el rol que otra persona puso en otra columna", async () => {
    const { a, b, f } = await twoPeople();
    await db.column.update({ where: { id: f.columns.todo }, data: { role: "NEXT_RELEASE" } });
    await loginAs(a);
    expectOk(await setColumnRole(f.columns.doing, "NEXT_RELEASE"));
    const entry = await db.undoEntry.findFirstOrThrow({ where: { userId: a.id, projectId: f.project.id, kind: "UNDO" }, orderBy: { createdAt: "desc" } });
    const columnOps = (entry.ops as { t: string; id?: string }[]).filter((op) => op.t === "column.set").map((op) => op.id).sort();
    assert.deepEqual(columnOps, [f.columns.todo, f.columns.doing].sort(), "solo las dos columnas que cambian");
    await loginAs(b);
    expectOk(await setColumnRole(f.columns.done, "WAITING"));
    await loginAs(a);
    expectOk(await undoLast(f.project.id));
    const roles = Object.fromEntries((await db.column.findMany({ where: { projectId: f.project.id } })).map((c) => [c.id, c.role]));
    assert.deepEqual(roles, { [f.columns.todo]: "NEXT_RELEASE", [f.columns.doing]: "NONE", [f.columns.done]: "WAITING" });
  });

  test("una tarea fija que vuelve a una columna que ya no es la de la release pasa a normal", async () => {
    const { a, b, f } = await twoPeople();
    await db.column.update({ where: { id: f.columns.todo }, data: { role: "NEXT_RELEASE" } });
    const fixed = await makeTask(f, { title: "Fija", columnId: f.columns.todo });
    await db.task.update({ where: { id: fixed.id }, data: { evergreen: true, evergreenEvery: 2 } });
    const gone = await makeTask(f, { title: "Fija borrada", columnId: f.columns.todo, position: 3000 });
    await db.task.update({ where: { id: gone.id }, data: { evergreen: true } });
    await loginAs(a);
    expectOk(await moveTask(fixed.id, f.columns.doing, null, null));
    expectOk(await deleteTask(gone.id));
    // Entretanto, otra persona le quita el rol a la columna.
    await loginAs(b);
    expectOk(await setColumnRole(f.columns.todo, "NONE"));
    await loginAs(a);
    expectOk(await undoLast(f.project.id)); // borrado
    expectOk(await undoLast(f.project.id)); // movimiento
    for (const id of [fixed.id, gone.id]) {
      const t = await db.task.findUniqueOrThrow({ where: { id } });
      assert.equal(t.columnId, f.columns.todo);
      assert.deepEqual([t.evergreen, t.evergreenEvery], [false, 1]);
    }
  });
});

describe("topes que no se pueden saltar en paralelo", () => {
  test("subtareas: el máximo por tarea y el ritmo por persona", async () => {
    const { a, f } = await twoPeople();
    const task = await makeTask(f, { subtasks: Array.from({ length: 98 }, (_, i) => `s${i}`) });
    await loginAs(a);
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => addSubtask(task.id, `nueva ${i}`)));
    assert.equal(results.filter((r) => r.ok).length, 2);
    assert.equal(await db.subtask.count({ where: { taskId: task.id } }), 100);
    // Las que entraron no comparten posición.
    const positions = (await db.subtask.findMany({ where: { taskId: task.id }, select: { position: true } })).map((s) => s.position);
    assert.equal(new Set(positions).size, positions.length);

    const fresh = await makeUser();
    const g = await makeProject({ members: [fresh] });
    const t2 = await makeTask(g);
    const t3 = await makeTask(g);
    await loginAs(fresh);
    for (let i = 0; i < 60; i++) expectOk(await addSubtask(i < 50 ? t2.id : t3.id, `s${i}`));
    expectFail(await addSubtask(t3.id, "una más"), /Demasiadas subtareas seguidas/);
  });

  test("tipos de tarea: el máximo y el nombre único por ámbito", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject();
    // makeProject ya crea un tipo propio: hasta 29 y tres altas a la vez.
    await db.taskKind.createMany({ data: Array.from({ length: 28 }, (_, i) => ({ projectId: f.project.id, name: `K${i}`, color: "#3b82f6", position: i + 2 })) });
    await loginAs(admin);
    const many = await Promise.all(["Uno", "Dos", "Tres"].map((name) => createKind({ name, color: "#ef4444" }, f.project.id)));
    assert.equal(many.filter((r) => r.ok).length, 1);
    assert.equal(await db.taskKind.count({ where: { projectId: f.project.id } }), 30);

    const g = await makeProject();
    const same = await Promise.all(Array.from({ length: 3 }, () => createKind({ name: "Repetido", color: "#ef4444" }, g.project.id)));
    assert.equal(same.filter((r) => r.ok).length, 1);
    assert.equal(await db.taskKind.count({ where: { projectId: g.project.id, name: "Repetido" } }), 1);
  });

  test("comentarios: el máximo por tarea", async () => {
    const { a, f } = await twoPeople();
    const task = await makeTask(f);
    await db.appState.upsert({ where: { key: "maxCommentsPerTask" }, create: { key: "maxCommentsPerTask", value: "3" }, update: { value: "3" } });
    invalidateAppSettings();
    try {
      await db.taskComment.create({ data: { taskId: task.id, authorId: a.id, body: "antes" } });
      await loginAs(a);
      const results = await Promise.all(Array.from({ length: 4 }, (_, i) => addComment(task.id, `nuevo ${i}`)));
      assert.equal(results.filter((r) => r.ok).length, 2);
      assert.equal(await db.taskComment.count({ where: { taskId: task.id, deletedAt: null } }), 3);
    } finally {
      await db.appState.deleteMany({ where: { key: "maxCommentsPerTask" } });
      invalidateAppSettings();
    }
  });
});

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

describe("ficheros de adjuntos retenidos por varias entradas de deshacer", () => {
  test("descartar una entrada no borra el fichero que otra aún puede devolver", async () => {
    const { a, f } = await twoPeople();
    const task = await makeTask(f);
    const x = await att(task.id, "x.txt", a.id);
    await writeFile(attachmentPath(x.id, "file"), "contenido");
    await loginAs(a);
    const snap = await snapshotOf(task.id);
    const first = expectOk(await deleteAttachment(x.id)).undo.id!;
    // Cancelar lo devuelve (la primera entrada sigue en la pila) y se vuelve a borrar: dos entradas lo retienen.
    expectOk(await restoreTaskSnapshot(task.id, snap, null));
    const second = expectOk(await deleteAttachment(x.id)).undo.id!;
    const e1 = await db.undoEntry.findUniqueOrThrow({ where: { id: first }, select: { id: true, ops: true } });
    await discardEntries([e1]);
    assert.ok(await exists(attachmentPath(x.id, "file")), "la otra entrada aún lo necesita");
    expectOk(await undoEntry(second));
    assert.equal((await db.taskAttachment.findUniqueOrThrow({ where: { id: x.id } })).originalName, "x.txt");
    assert.ok(await exists(attachmentPath(x.id, "file")));

    // Sin ninguna otra entrada que lo retenga, el fichero sí se borra.
    const third = expectOk(await deleteAttachment(x.id)).undo.id!;
    await db.undoEntry.deleteMany({ where: { userId: a.id, id: { not: third } } });
    await discardEntries([await db.undoEntry.findUniqueOrThrow({ where: { id: third }, select: { id: true, ops: true } })]);
    assert.equal(await exists(attachmentPath(x.id, "file")), false);
  });
});

describe("comentarios importados (sin usuario en Pizarro)", () => {
  test("deshacer y rehacer conservan el nombre del autor", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject();
    const task = await makeTask(f);
    const imported = await db.taskComment.create({ data: { taskId: task.id, authorId: null, authorName: "Persona de otra herramienta", body: "importado" } });
    await loginAs(admin);
    expectOk(await deleteComment(imported.id));
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: imported.id } })).authorName, "Persona de otra herramienta");
    expectOk(await redoLast(f.project.id));
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: imported.id } })).authorName, "Persona de otra herramienta");

    // Con la tarea entera: borrar y deshacer.
    expectOk(await deleteTask(task.id));
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: imported.id } })).authorName, "Persona de otra herramienta");
  });
});

describe("resolvePositionTies", () => {
  test("solo mueve las que empatan; renumera la columna si no hay hueco", async () => {
    const f = await makeProject();
    const lo = await makeTask(f, { title: "lo", position: 500 });
    const a = await makeTask(f, { title: "a", position: 1000 });
    const b = await makeTask(f, { title: "b", position: 1000 });
    const c = await makeTask(f, { title: "c", position: 2000 });
    const other = await makeTask(f, { title: "otra", columnId: f.columns.doing, position: 1000 });
    await resolvePositionTies([a.id, c.id, other.id]);
    const pos = async (id: string) => (await db.task.findUniqueOrThrow({ where: { id } })).position;
    assert.ok((await pos(lo.id)) < (await pos(a.id)) && (await pos(a.id)) < (await pos(b.id)), "a pasa justo delante de la que ocupaba su sitio");
    assert.equal(await pos(b.id), 1000);
    assert.equal(await pos(c.id), 2000, "sin empate no se toca");
    assert.equal(await pos(other.id), 1000, "otra columna, sin empate");

    // Sin hueco entre la anterior y el empate: se renumera la columna entera, sin empates.
    const g = await makeProject();
    const p1 = await makeTask(g, { position: 1000 });
    await makeTask(g, { position: 1000.0000001 });
    const p3 = await makeTask(g, { position: 1000.0000001 });
    await resolvePositionTies([p3.id]);
    const ordered = await db.task.findMany({ where: { columnId: g.columns.todo }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, position: true } });
    assert.equal(new Set(ordered.map((t) => t.position)).size, 3);
    assert.equal(ordered[0]!.id, p1.id);
    assert.ok(ordered.every((t) => t.position % 1024 === 0), "renumerada en múltiplos del paso");
  });
});
