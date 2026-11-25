// «Cancelar» del detalle de la tarea (restoreTaskSnapshot: solo deshace lo de quien cancela) y borrado de adjuntos
// deshacible, con ficheros que retienen varias entradas de deshacer, contra PostgreSQL real.
import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { assign, db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, type Fixture } from "./helpers";
import { addSubtask, deleteAttachment, deleteSubtask, moveTask, restoreTaskSnapshot, updateSubtask, updateTask, type TaskEditSnapshot } from "../../src/actions/tasks";
import { undoEntry, undoLast } from "../../src/actions/undo";
import { discardEntries } from "../../src/lib/undo";
import { attachmentPath } from "../../src/lib/uploads";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-task-cancel-"));

/** Adjunto creado directamente (como la subida, que anota quién lo sube). */
const att = (taskId: string, name: string, createdById: string | null = null) =>
  db.taskAttachment.create({ data: { taskId, originalName: name, mimeType: "text/plain", isImage: false, size: 10, createdById } });

/** Lo que el diálogo guarda al abrirse: la tarea tal como está en la base de datos (y la hora de apertura). */
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

describe("borrar un adjunto se puede deshacer", () => {
  test("deshacer devuelve la fila del adjunto", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await loginAs(user);
    const task = await makeTask(f);
    const a = await att(task.id, "a.txt");
    expectOk(await deleteAttachment(a.id));
    assert.equal(await db.taskAttachment.count({ where: { taskId: task.id } }), 0);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.taskAttachment.findUniqueOrThrow({ where: { id: a.id } })).originalName, "a.txt");
  });
});

describe("Cancelar la edición (restoreTaskSnapshot)", () => {
  test("devuelve campos, subtareas, adjuntos y columna en una sola acción deshacible", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const f = await makeProject();
    await assign(f, other);
    await loginAs(user);
    const label = await db.label.create({ data: { projectId: f.project.id, name: "L", color: "blue" } });
    const task = await makeTask(f, { title: "Original", subtasks: ["uno", "dos"] });
    await db.task.update({ where: { id: task.id }, data: { description: "desc", color: "#ef4444" } });
    const keep = await att(task.id, "queda.txt");
    const removed = await att(task.id, "borrado.txt");
    const [s1, s2] = await db.subtask.findMany({ where: { taskId: task.id }, orderBy: { position: "asc" } });
    const snap = await snapshotOf(task.id);

    // Sesión de edición: cambios sueltos, cada uno con su propia entrada de deshacer.
    // El diálogo Cancela con la versión del texto de su último guardado (ver TaskDialog).
    const own = expectOk(await updateTask(task.id, { title: "Cambiado", description: "otra", assigneeId: other.id, labelIds: [label.id], color: "#0ea5e9" })).textVersion;
    expectOk(await updateSubtask(s1!.id, { done: true, title: "uno!" }));
    expectOk(await deleteSubtask(s2!.id));
    const added = expectOk(await addSubtask(task.id, "nueva"));
    expectOk(await deleteAttachment(removed.id));
    const uploaded = await att(task.id, "subido.txt", user.id);
    expectOk(await moveTask(task.id, f.columns.doing, null, null));

    const before = await undoCount(user.id, f.project.id);
    const res = expectOk(await restoreTaskSnapshot(task.id, snap, own));
    assert.equal(res.changed, true);
    // Todo vuelve a como estaba.
    const back = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { labels: true, subtasks: { orderBy: { position: "asc" } }, attachments: true } });
    assert.equal(back.title, "Original");
    assert.equal(back.description, "desc");
    assert.equal(back.color, "#ef4444");
    assert.equal(back.assigneeId, null);
    assert.equal(back.labels.length, 0);
    assert.equal(back.columnId, f.columns.todo);
    assert.deepEqual(back.subtasks.map((s) => [s.title, s.done]), [["uno", false], ["dos", false]]);
    assert.deepEqual(back.attachments.map((a) => a.id).sort(), [keep.id, removed.id].sort());
    assert.equal(await db.subtask.count({ where: { id: added.id } }), 0);
    assert.equal(await db.taskAttachment.count({ where: { id: uploaded.id } }), 0);
    // Una sola entrada nueva, con su etiqueta, y quedó en el historial.
    assert.equal(await undoCount(user.id, f.project.id), before + 1);
    const entry = await db.undoEntry.findFirstOrThrow({ where: { userId: user.id, kind: "UNDO" }, orderBy: { createdAt: "desc" } });
    assert.match(entry.label, /Canceló los cambios en/);
    // Devuelve el id de esa entrada: el «Deshacer» del aviso «Cambios descartados» deshace eso (undoEntry), no otra cosa.
    assert.equal(res.undo?.id, entry.id);
    assert.equal(await db.taskEvent.count({ where: { taskId: task.id, label: { contains: "Canceló los cambios" } } }), 1);

    // Deshacer esa única entrada devuelve la edición.
    expectOk(await undoLast(f.project.id));
    const again = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { labels: true, subtasks: true, attachments: true } });
    assert.equal(again.title, "Cambiado");
    assert.equal(again.labels.length, 1);
    assert.equal(again.columnId, f.columns.doing);
    assert.equal(again.subtasks.length, 2);
    assert.ok(again.subtasks.some((s) => s.id === added.id));
    assert.ok(again.attachments.some((a) => a.id === uploaded.id));
    assert.ok(!again.attachments.some((a) => a.id === removed.id));
  });

  test("sin cambios no hace nada ni deja entrada de deshacer", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await loginAs(user);
    const task = await makeTask(f, { subtasks: ["a"] });
    const before = await undoCount(user.id, f.project.id);
    const res = expectOk(await restoreTaskSnapshot(task.id, await snapshotOf(task.id), null));
    assert.equal(res.changed, false);
    assert.equal(await undoCount(user.id, f.project.id), before);
  });

  test("no pisa el texto que otra persona cambió mientras se editaba", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const f = await makeProject();
    await assign(f, other);
    await loginAs(user);
    const task = await makeTask(f, { title: "Original" });
    const snap = await snapshotOf(task.id);
    const since = (await db.task.findUniqueOrThrow({ where: { id: task.id } })).contentUpdatedAt?.toISOString() ?? null;
    expectOk(await updateTask(task.id, { title: "Mío" }));
    await loginAs(other);
    expectOk(await updateTask(task.id, { title: "Ajeno" }));
    await loginAs(user);
    expectFail(await restoreTaskSnapshot(task.id, snap, since), /ha cambiado el texto/);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Ajeno");
  });

  test("Cancelar tras guardar el texto aquí no choca; lo guardado después desde otra pestaña de la misma persona no se pisa", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await assign(f, user);
    await loginAs(user);
    const task = await makeTask(f, { title: "Original" });
    const snap = await snapshotOf(task.id);
    const opened = (await db.task.findUniqueOrThrow({ where: { id: task.id } })).contentUpdatedAt?.toISOString() ?? null;
    // Este diálogo guarda el título y Cancela con la versión de su último guardado (ver TaskDialog): vuelve el original.
    const own = expectOk(await updateTask(task.id, { title: "Mío" }, opened)).textVersion;
    expectOk(await restoreTaskSnapshot(task.id, snap, own));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Original");
    // Otra vez, pero después la misma persona cambia el título desde otra pestaña: Cancelar aquí no lo pisa.
    const snap2 = await snapshotOf(task.id);
    const v1 = (await db.task.findUniqueOrThrow({ where: { id: task.id } })).contentUpdatedAt?.toISOString() ?? null;
    const own2 = expectOk(await updateTask(task.id, { title: "Mío otra vez" }, v1)).textVersion;
    await new Promise((r) => setTimeout(r, 5));
    expectOk(await updateTask(task.id, { title: "Desde la otra pestaña" }, own2));
    expectFail(await restoreTaskSnapshot(task.id, snap2, own2), /otra pestaña u otro dispositivo/);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Desde la otra pestaña");
  });

  test("con más acciones que entradas guarda la pila (12 subtareas marcadas), Cancelar lo devuelve todo, no solo las 10 últimas", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await loginAs(user);
    const titles = Array.from({ length: 12 }, (_, i) => `sub ${i + 1}`);
    const task = await makeTask(f, { title: "Muchas", subtasks: titles });
    const snap = await snapshotOf(task.id);
    // La primera acción del rato (el título) y luego 12 marcas: las entradas más antiguas se descartan de la pila.
    const own = expectOk(await updateTask(task.id, { title: "Muchas (editada)" })).textVersion;
    for (const s of await db.subtask.findMany({ where: { taskId: task.id }, orderBy: { position: "asc" } })) expectOk(await updateSubtask(s.id, { done: true }));
    const extra = expectOk(await addSubtask(task.id, "añadida al final"));
    assert.equal(await undoCount(user.id, f.project.id), 10);

    const res = expectOk(await restoreTaskSnapshot(task.id, snap, own));
    assert.equal(res.changed, true);
    const back = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { subtasks: { orderBy: { position: "asc" } } } });
    assert.equal(back.title, "Muchas");
    assert.deepEqual(back.subtasks.map((s) => [s.title, s.done]), titles.map((t) => [t, false]));
    assert.ok(!back.subtasks.some((s) => s.id === (extra as { id: string }).id));
    // Sigue siendo una sola acción deshacible: deshacer el Cancelar devuelve las 12 marcas.
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.subtask.count({ where: { taskId: task.id, done: true } }), 12);
  });
});

describe("Cancelar con la pila llena no pisa el trabajo de otras personas", () => {
  test("Ana abre, Beto cambia el responsable, añade y borra subtareas; Ana hace 12 acciones y Cancela: lo de Beto se queda", async () => {
    const ana = await makeUser({ name: "Ana" });
    const beto = await makeUser({ name: "Beto" });
    const f = await makeProject();
    await assign(f, beto);
    await loginAs(ana);
    const titles = Array.from({ length: 12 }, (_, i) => `sub ${i + 1}`);
    const task = await makeTask(f, { title: "Compartida", subtasks: [...titles, "la borra Beto"] });
    const snap = await snapshotOf(task.id);
    const subs = await db.subtask.findMany({ where: { taskId: task.id }, orderBy: { position: "asc" } });

    // Beto, con el detalle de Ana abierto: responsable, una subtarea nueva, borra otra y renombra la primera.
    await loginAs(beto);
    expectOk(await updateTask(task.id, { assigneeId: beto.id }));
    const deBeto = expectOk(await addSubtask(task.id, "de Beto"));
    expectOk(await deleteSubtask(subs[12]!.id));
    expectOk(await updateSubtask(subs[0]!.id, { title: "sub 1 (Beto)" }));

    // Ana: el título y 12 marcas (la pila se llena y las primeras entradas se descartan).
    await loginAs(ana);
    const own = expectOk(await updateTask(task.id, { title: "Compartida (Ana)" })).textVersion;
    for (const s of subs.slice(0, 12)) expectOk(await updateSubtask(s.id, { done: true }));
    const deAna = expectOk(await addSubtask(task.id, "de Ana"));
    assert.equal(await undoCount(ana.id, f.project.id), 10);

    expectOk(await restoreTaskSnapshot(task.id, snap, own));
    const back = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { subtasks: { orderBy: { position: "asc" } } } });
    // Lo de Ana vuelve…
    assert.equal(back.title, "Compartida");
    assert.ok(back.subtasks.every((s) => !s.done));
    assert.ok(!back.subtasks.some((s) => s.id === (deAna as { id: string }).id));
    // …y lo de Beto se queda.
    assert.equal(back.assigneeId, beto.id);
    assert.ok(back.subtasks.some((s) => s.id === (deBeto as { id: string }).id), "la subtarea de Beto sigue");
    assert.ok(!back.subtasks.some((s) => s.id === subs[12]!.id), "la que borró Beto no resucita");
    assert.equal(back.subtasks.find((s) => s.id === subs[0]!.id)?.title, "sub 1 (Beto)");
  });

  test("si no se sabe qué hizo la otra persona (su pila también se llenó), solo vuelve lo atribuible a quien cancela", async () => {
    const ana = await makeUser({ name: "Ana" });
    const beto = await makeUser({ name: "Beto" });
    const f = await makeProject();
    await assign(f, beto);
    await loginAs(ana);
    const task = await makeTask(f, { title: "Otra", subtasks: Array.from({ length: 12 }, (_, i) => `s${i}`) });
    const other = await makeTask(f, { title: "Ajena" });
    const snap = await snapshotOf(task.id);
    const subs = await db.subtask.findMany({ where: { taskId: task.id }, orderBy: { position: "asc" } });

    await loginAs(beto);
    expectOk(await updateTask(task.id, { assigneeId: beto.id }));
    const deBeto = expectOk(await addSubtask(task.id, "de Beto"));
    // Beto sigue trabajando en otra tarea hasta llenar su pila: sus primeras entradas (las de esta tarea) se pierden.
    for (let i = 0; i < 11; i++) expectOk(await updateTask(other.id, { title: `Ajena ${i}` }));

    await loginAs(ana);
    for (const s of subs) expectOk(await updateSubtask(s.id, { done: true }));
    expectOk(await restoreTaskSnapshot(task.id, snap, null));
    const back = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { subtasks: true } });
    assert.equal(back.assigneeId, beto.id, "el responsable que puso Beto se queda");
    assert.ok(back.subtasks.some((s) => s.id === (deBeto as { id: string }).id), "la subtarea de Beto se queda");
    // Las marcas de Ana que siguen en su pila (las 10 últimas) sí se deshacen.
    assert.ok(back.subtasks.filter((s) => s.done).length <= 2);
  });
});

describe("Cancelar solo deshace lo que hizo esa persona desde que abrió el detalle", () => {
  test("los cambios de otra persona a la vez se conservan", async () => {
    const { a, b, f } = await twoPeople();
    const task = await makeTask(f, { title: "Original", subtasks: ["uno", "dos", "tres"] });
    const [s1, s2, s3] = await db.subtask.findMany({ where: { taskId: task.id }, orderBy: { position: "asc" } });
    const before = await att(task.id, "de-antes.txt", b.id);
    await loginAs(a);
    const snap = await snapshotOf(task.id);

    // A edita… (el diálogo Cancela con la versión del texto de su último guardado, ver TaskDialog)
    const own = expectOk(await updateTask(task.id, { title: "De A" })).textVersion;
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
    const res = expectOk(await restoreTaskSnapshot(task.id, snap, own));
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
    const own = expectOk(await updateTask(task.id, { title: "Después" })).textVersion;
    expectOk(await restoreTaskSnapshot(task.id, snap, own));
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

  test("la limpieza no borra el fichero de una entrada que un deshacer en curso ya ha retirado", async () => {
    const { a, f } = await twoPeople();
    const task = await makeTask(f);
    const x = await att(task.id, "y.txt", a.id);
    await writeFile(attachmentPath(x.id, "file"), "contenido");
    await loginAs(a);
    const id = expectOk(await deleteAttachment(x.id)).undo.id!;
    // La limpieza de entradas viejas la lee (límite de 7 días)…
    const stale = await db.undoEntry.findUniqueOrThrow({ where: { id }, select: { id: true, ops: true } });
    // …y entre medias la persona pulsa «Deshacer»: applyEntry retira la entrada antes de devolver el adjunto.
    await db.undoEntry.deleteMany({ where: { id } });
    await discardEntries([stale]);
    assert.ok(await exists(attachmentPath(x.id, "file")), "el deshacer en curso aún lo necesita");
  });
});
