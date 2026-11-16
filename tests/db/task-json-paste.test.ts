// Copiar y pegar una tarea como JSON (getTaskJson / pasteTaskJson): ida y vuelta, un solo deshacer, permisos y límites.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assign, db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { getTaskJson, pasteTaskJson, restoreTaskSnapshot, type TaskEditSnapshot } from "../../src/actions/tasks";
import { redoLast, undoLast } from "../../src/actions/undo";

const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

/** Lo que el pegado puede cambiar de una tarea, en forma comparable. */
async function state(taskId: string) {
  const t = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      title: true, description: true, color: true, linkUrl: true, dueDate: true, startDate: true, priority: true, client: true, cost: true, costPaid: true,
      estimatedHours: true, actualHours: true, recurrence: true, recurrenceDay: true, assigneeId: true, blockedById: true, deliverableId: true, kindId: true, columnId: true,
      labels: { select: { label: { select: { name: true } } } },
      subtasks: { orderBy: { position: "asc" }, select: { title: true, done: true } },
      links: { orderBy: { url: "asc" }, select: { url: true, title: true, kind: true } },
    },
  });
  return {
    ...t, dueDate: day(t.dueDate), startDate: day(t.startDate), cost: t.cost?.toFixed(2) ?? null, estimatedHours: t.estimatedHours?.toFixed(2) ?? null, actualHours: t.actualHours?.toFixed(2) ?? null,
    labels: t.labels.map((l) => l.label.name).sort(),
  };
}

const undoCount = (projectId: string) => db.undoEntry.count({ where: { projectId, kind: "UNDO" } });
const paste = (taskId: string, json: unknown) => pasteTaskJson(taskId, typeof json === "string" ? json : JSON.stringify(json));

/** Proyecto con todos los campos opcionales, una tarea completa (origen) y otra vacía (destino). */
async function fullFixture() {
  const user = await makeUser({ name: "Ana Copia" });
  const f = await makeProject({ members: [user] });
  await db.project.update({ where: { id: f.project.id }, data: { taskFields: ["cost", "hours", "priority", "client", "startDate"] } });
  const otherKind = await db.taskKind.create({ data: { name: "Especial", color: "#ef4444", position: 2, projectId: f.project.id } });
  const deliverable = await db.deliverable.create({ data: { projectId: f.project.id, name: "Entrega 1", position: 1000 } });
  const labels = await Promise.all(["rojo", "verde"].map((name) => db.label.create({ data: { projectId: f.project.id, name, color: "#ef4444" } })));
  const blocker = await makeTask(f, { title: "Contratar la sala", position: 500 });
  const source = await db.task.create({
    data: {
      projectId: f.project.id, columnId: f.columns.doing, title: "Preparar la demo", description: "Texto **Markdown**", kindId: otherKind.id, position: 1000, createdById: user.id,
      color: "#ef4444", linkUrl: "https://example.com/x", assigneeId: user.id, dueDate: new Date("2026-12-01"), startDate: new Date("2026-11-20"), priority: "ALTA", client: "Acme",
      cost: "120.50", costPaid: true, estimatedHours: "8", actualHours: "2.5", recurrence: "WEEKLY", recurrenceDay: 2, deliverableId: deliverable.id, blockedById: blocker.id,
      labels: { create: labels.map((l) => ({ labelId: l.id })) },
      subtasks: { create: [{ title: "Guion", done: true, position: 1000 }, { title: "Ensayo", position: 2000 }] },
      links: { create: [{ kind: "GOOGLE_SHEET", title: "Presupuesto", url: "https://docs.google.com/spreadsheets/d/abc/edit", externalId: "abc" }] },
      attachments: { create: [{ originalName: "captura.png", size: 10 }] },
    },
  });
  const target = await makeTask(f, { title: "Destino", position: 2000, subtasks: ["vieja 1", "vieja 2", "vieja 3"] });
  return { user, f, source, target, blocker, otherKind, deliverable };
}

describe("getTaskJson", () => {
  test("copia toda la tarea con nombres, enlaces absolutos, el id del responsable y de la dependencia (sin email)", async () => {
    const { user, f, source, blocker } = await fullFixture();
    await loginAs(user);
    const text = expectOk(await getTaskJson(source.id));
    const json = JSON.parse(text);
    const att = await db.taskAttachment.findFirstOrThrow({ where: { taskId: source.id } });
    assert.deepEqual({ ...json, info: { ...json.info, createdAt: "", updatedAt: "" } }, {
      format: "pizarro.task", version: 1, title: "Preparar la demo", description: "Texto **Markdown**", type: "Especial", column: "En curso", labels: ["rojo", "verde"],
      assignee: { id: user.id, name: "Ana Copia" }, dueDate: "2026-12-01", startDate: "2026-11-20", priority: "high", client: "Acme", cost: 120.5, costPaid: true,
      estimatedHours: 8, actualHours: 2.5, recurrence: { rule: "weekly", day: 2 }, color: "#ef4444", deliverable: "Entrega 1", link: "https://example.com/x",
      subtasks: [{ text: "Guion", done: true }, { text: "Ensayo", done: false }], dependsOn: { id: blocker.id, title: "Contratar la sala" },
      googleDocs: [{ kind: "sheet", title: "Presupuesto", url: "https://docs.google.com/spreadsheets/d/abc/edit" }],
      attachments: [{ name: "captura.png", url: `http://localhost:3000/api/attachments/${att.id}` }],
      info: { id: source.id, project: f.project.name, projectId: f.project.id, url: `http://localhost:3000/p/${f.project.id}?task=${source.id}`, createdAt: "", updatedAt: "", createdBy: "Ana Copia" },
    });
    // Copiar no cambia nada ni deja entrada de deshacer ni historial.
    assert.equal(await undoCount(f.project.id), 0);
    assert.equal(await db.taskEvent.count({ where: { taskId: source.id } }), 0);
  });

  test("sin acceso al proyecto no se puede copiar", async () => {
    const { source } = await fullFixture();
    await loginAs(await makeUser());
    expectFail(await getTaskJson(source.id), NOT_FOUND);
  });

  test("el email del responsable no se copia nunca (ni para él ni para un administrador): va su id, y se pega por el id", async () => {
    const { user, f, source, target } = await fullFixture();
    const mate = await makeUser({ name: "Compa Curioso" });
    await assign(f, mate);
    for (const who of [mate, user, await makeUser({ role: "ADMIN" })]) {
      await loginAs(who);
      const text = expectOk(await getTaskJson(source.id));
      assert.deepEqual(JSON.parse(text).assignee, { id: user.id, name: "Ana Copia" });
      assert.ok(!text.includes(user.email) && !text.includes("@example"), "ningún email en el texto");
    }
    // Se pega por el id, aunque el nombre haya cambiado entretanto.
    await loginAs(mate);
    const text = expectOk(await getTaskJson(source.id));
    await db.user.update({ where: { id: user.id }, data: { name: "Ana Renombrada" } });
    expectOk(await paste(target.id, text));
    assert.equal((await state(target.id)).assigneeId, user.id);
  });

  test("responsable por email (JSON escrito a mano): solo si quien pega es administrador o es su propio email", async () => {
    const { user, f, target } = await fullFixture();
    const mate = await makeUser({ name: "Compa Curioso" });
    await assign(f, mate);
    // Un miembro no puede averiguar a quién pertenece un email: el de otra persona no se acepta…
    await loginAs(mate);
    assert.deepEqual(expectOk(await paste(target.id, { format: "pizarro.task", assignee: user.email })).skipped, [`responsable «${user.email.slice(0, 40)}${user.email.length > 40 ? "…" : ""}» (sin acceso al proyecto)`]);
    assert.equal((await state(target.id)).assigneeId, null);
    // …el suyo sí…
    expectOk(await paste(target.id, { format: "pizarro.task", assignee: mate.email.toUpperCase() }));
    assert.equal((await state(target.id)).assigneeId, mate.id);
    // …y un administrador puede usar cualquiera.
    await loginAs(await makeUser({ role: "ADMIN" }));
    assert.deepEqual(expectOk(await paste(target.id, { format: "pizarro.task", assignee: { email: user.email } })).skipped, []);
    assert.equal((await state(target.id)).assigneeId, user.id);
  });
});

describe("pasteTaskJson", () => {
  test("ida y vuelta: pega lo copiado en otra tarea, en una sola entrada que se deshace y se rehace de una vez", async () => {
    const { user, f, source, target } = await fullFixture();
    await loginAs(user);
    const text = expectOk(await getTaskJson(source.id));
    const before = await state(target.id);
    const res = expectOk(await pasteTaskJson(target.id, text));
    assert.deepEqual(res.skipped, []);
    assert.equal(res.task.id, target.id);
    assert.deepEqual(await state(target.id), await state(source.id));
    assert.equal(await undoCount(f.project.id), 1, "una sola entrada de deshacer");
    // Los adjuntos no se copian; el id y el proyecto no cambian.
    assert.equal(await db.taskAttachment.count({ where: { taskId: target.id } }), 0);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: target.id } })).projectId, f.project.id);
    const events = await db.taskEvent.findMany({ where: { taskId: target.id } });
    assert.ok(events.some((e) => e.label.includes("Pegó el contenido de una tarea en JSON")), "queda en el historial");

    expectOk(await undoLast(f.project.id, target.id));
    assert.deepEqual(await state(target.id), before, "un solo deshacer lo devuelve todo");
    assert.equal(await undoCount(f.project.id), 0);
    expectOk(await redoLast(f.project.id, target.id));
    assert.deepEqual(await state(target.id), await state(source.id), "rehacer lo vuelve a pegar");
  });

  test("solo se tocan los campos que trae el JSON; null los vacía", async () => {
    const { user, source } = await fullFixture();
    await loginAs(user);
    const before = await state(source.id);
    expectOk(await paste(source.id, { format: "pizarro.task", dueDate: "2027-01-10" }));
    assert.deepEqual(await state(source.id), { ...before, dueDate: "2027-01-10" });
    const res = expectOk(await paste(source.id, { title: "Otra", assignee: null, labels: [], subtasks: [], dependsOn: null, link: null, color: null, deliverable: null, priority: null, cost: null, recurrence: "none", googleDocs: [] }));
    assert.deepEqual(res.skipped, []);
    assert.deepEqual(await state(source.id), {
      ...before, dueDate: "2027-01-10", title: "Otra", assigneeId: null, labels: [], subtasks: [], blockedById: null, linkUrl: null, color: null, deliverableId: null, priority: null,
      cost: null, recurrence: "NONE", recurrenceDay: null,
    });
  });

  test("JSON de una IA: nombres sin mayúsculas ni tildes, etiquetas nuevas que se crean y lo que no existe se avisa", async () => {
    const { user, f, target, blocker, otherKind } = await fullFixture();
    await loginAs(user);
    const ai = "```json\n" + JSON.stringify({
      Título: "Llamar al proveedor", Tipo: "ESPECIAL", Estado: "hecho", Etiquetas: ["ROJO", "nueva etiqueta"], Responsable: { email: user.email.toUpperCase() },
      fecha_limite: "2026-12-24T10:00:00Z", Prioridad: "urgente", Coste: "99,9", Subtareas: ["[x] Una", "Dos"], "depende de": "contratar la SALA",
      entregable: "No existe", cliente: "  Cliente S.L. ",
    }) + "\n```";
    const res = expectOk(await pasteTaskJson(target.id, ai));
    assert.deepEqual(res.skipped, ["entregable «No existe» (no existe)"]);
    const s = await state(target.id);
    assert.deepEqual(
      { title: s.title, kindId: s.kindId, columnId: s.columnId, labels: s.labels, assigneeId: s.assigneeId, dueDate: s.dueDate, priority: s.priority, cost: s.cost, subtasks: s.subtasks, blockedById: s.blockedById, client: s.client },
      {
        title: "Llamar al proveedor", kindId: otherKind.id, columnId: f.columns.done, labels: ["nueva etiqueta", "rojo"], assigneeId: user.id, dueDate: "2026-12-24", priority: "URGENTE",
        cost: "99.90", subtasks: [{ title: "Una", done: true }, { title: "Dos", done: false }], blockedById: blocker.id, client: "Cliente S.L.",
      },
    );
    assert.equal(await db.label.count({ where: { projectId: f.project.id } }), 3, "se crea solo la etiqueta que faltaba");
    assert.equal(await undoCount(f.project.id), 1);
    // Deshacer devuelve la tarea (columna incluida) y borra la etiqueta que creó el pegado (nadie más la usa).
    expectOk(await undoLast(f.project.id, target.id));
    const back = await state(target.id);
    assert.deepEqual([back.title, back.columnId, back.labels, back.subtasks.map((x) => x.title)], ["Destino", f.columns.todo, [], ["vieja 1", "vieja 2", "vieja 3"]]);
    assert.deepEqual((await db.label.findMany({ where: { projectId: f.project.id }, orderBy: { name: "asc" } })).map((l) => l.name), ["rojo", "verde"]);
    // Rehacer la vuelve a crear y a poner.
    expectOk(await redoLast(f.project.id, target.id));
    assert.deepEqual((await state(target.id)).labels, ["nueva etiqueta", "rojo"]);
  });

  test("permisos: sin acceso a la tarea no se pega nada, y el JSON no alcanza nada de otros proyectos", async () => {
    const { user, f, target } = await fullFixture();
    const outsider = await makeUser({ name: "Persona Ajena" });
    const other = await makeProject({ members: [outsider] });
    const foreignTask = await makeTask(other, { title: "Tarea ajena" });
    const foreignLabel = await db.label.create({ data: { projectId: other.project.id, name: "secreta", color: "#ef4444" } });
    const foreignKind = await db.taskKind.create({ data: { name: "Tipo ajeno", color: "#ef4444", position: 3, projectId: other.project.id } });
    await db.column.create({ data: { projectId: other.project.id, name: "Columna ajena", position: 9000 } });
    const before = await state(target.id);

    await loginAs(outsider);
    expectFail(await paste(target.id, { format: "pizarro.task", title: "Intruso" }), NOT_FOUND);
    assert.deepEqual(await state(target.id), before);

    await loginAs(user);
    const res = expectOk(await paste(target.id, {
      format: "pizarro.task", title: "Mía", type: "Tipo ajeno", column: "Columna ajena", labels: ["secreta"], assignee: { name: "Persona Ajena", email: outsider.email },
      dependsOn: { id: foreignTask.id, title: "Tarea ajena" }, info: { id: foreignTask.id, project: other.project.name }, id: foreignTask.id, projectId: other.project.id,
    }));
    assert.deepEqual(res.skipped, [
      "tipo «Tipo ajeno» (no existe)", "responsable «Persona Ajena» (sin acceso al proyecto)", "dependencia «Tarea ajena»", "columna «Columna ajena» (no existe)",
    ]);
    const now = await db.task.findUniqueOrThrow({ where: { id: target.id }, include: { labels: { include: { label: true } } } });
    assert.deepEqual([now.title, now.projectId, now.kindId, now.columnId, now.assigneeId, now.blockedById], ["Mía", f.project.id, before.kindId, before.columnId, null, null]);
    // «secreta» se crea en ESTE proyecto: no se reutiliza la etiqueta del otro.
    assert.equal(now.labels.length, 1);
    assert.notEqual(now.labels[0]!.labelId, foreignLabel.id);
    assert.equal(now.labels[0]!.label.projectId, f.project.id);
    assert.notEqual(now.kindId, foreignKind.id);
    assert.deepEqual((await db.task.findUniqueOrThrow({ where: { id: foreignTask.id } })).title, "Tarea ajena");
  });

  test("límites: 100 subtareas, 20 etiquetas, tope de etiquetas del proyecto, descripción y títulos largos", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f, { title: "Límites" });
    await db.task.update({ where: { id: task.id }, data: { description: "se queda" } });
    await db.label.createMany({ data: Array.from({ length: 48 }, (_, i) => ({ projectId: f.project.id, name: `e${i}`, color: "#ef4444" })) });
    await loginAs(user);
    const res = expectOk(await paste(task.id, {
      format: "pizarro.task", title: "x".repeat(300), description: "d".repeat(20_001),
      subtasks: Array.from({ length: 130 }, (_, i) => `s${i} ${"y".repeat(i === 0 ? 400 : 0)}`),
      labels: ["e1", "nueva 1", "nueva 2", "nueva 3", "z".repeat(41)],
    }));
    assert.deepEqual(res.skipped, [
      "descripción (demasiado larga)", "etiqueta «nueva 3» (no se ha podido crear)", `etiqueta «${"z".repeat(40)}…» (no se ha podido crear)`, "subtareas (máximo 100 por tarea)",
    ]);
    const s = await state(task.id);
    assert.equal(s.title.length, 210, "el título se recorta, como al escribirlo");
    assert.equal(s.description, "se queda");
    assert.equal(s.subtasks.length, 100);
    assert.ok(s.subtasks[0]!.title.length <= 210);
    assert.deepEqual(s.labels, ["e1", "nueva 1", "nueva 2"]);
    assert.equal(await db.label.count({ where: { projectId: f.project.id } }), 50);

    const many = expectOk(await paste(task.id, { format: "pizarro.task", labels: Array.from({ length: 30 }, (_, i) => `e${i}`) }));
    assert.deepEqual(many.skipped, ["etiquetas (máximo 20 por tarea)"]);
    assert.equal((await state(task.id)).labels.length, 20);
  });

  test("campos opcionales: solo los activados en el proyecto; la fecha de inicio no puede pasar de la límite", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await db.project.update({ where: { id: f.project.id }, data: { taskFields: ["priority", "startDate"] } });
    const task = await makeTask(f, { title: "Campos", dueDate: new Date("2026-12-10") });
    await loginAs(user);
    const res = expectOk(await paste(task.id, { format: "pizarro.task", priority: "low", cost: 10, costPaid: true, client: "Acme", estimatedHours: 2, startDate: "2026-12-20" }));
    assert.deepEqual(res.skipped, ["cliente (campo no activado)", "coste (campo no activado)", "pago (campo no activado)", "horas estimadas (campo no activado)", "fecha de inicio (posterior a la fecha límite)"]);
    const s = await state(task.id);
    assert.deepEqual([s.priority, s.cost, s.costPaid, s.client, s.estimatedHours, s.startDate, s.dueDate], ["BAJA", null, false, null, null, null, "2026-12-10"]);
    const bad = expectOk(await paste(task.id, { format: "pizarro.task", cost: "abc", priority: "URGENTE", link: "javascript:alert(1)", color: "#123456" }));
    assert.deepEqual(bad.skipped, ["coste", "color", "enlace"]);
    assert.deepEqual([(await state(task.id)).priority, (await state(task.id)).linkUrl, (await state(task.id)).color], ["URGENTE", null, null]);
  });

  test("no se pega en una tarea archivada, ni un texto que no es una tarea; no deja entrada de deshacer", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f, { title: "Intacta" });
    const archived = await makeTask(f, { title: "Archivada" });
    await db.task.update({ where: { id: archived.id }, data: { archivedAt: new Date(), archivedFromColumnId: f.columns.todo } });
    await loginAs(user);
    expectFail(await paste(archived.id, { format: "pizarro.task", title: "No" }), /archivada/);
    for (const text of ["hola", '{"a":1}', '{"format":"pizarro.task"}', '{"format":"pizarro.task","title":"sin cerrar"', "x".repeat(200_001)]) {
      expectFail(await pasteTaskJson(task.id, text), /JSON de la tarea/);
    }
    assert.equal((await state(task.id)).title, "Intacta");
    assert.equal(await undoCount(f.project.id), 0);
  });

  test("dependencias: no se bloquea a sí misma ni cierra un círculo; un título repetido no se adivina", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const a = await makeTask(f, { title: "A" });
    const b = await makeTask(f, { title: "B" });
    await makeTask(f, { title: "Repetida" });
    await makeTask(f, { title: "Repetida" });
    await db.task.update({ where: { id: b.id }, data: { blockedById: a.id } });
    await loginAs(user);
    assert.deepEqual(expectOk(await paste(a.id, { format: "pizarro.task", dependsOn: "B" })).skipped, ["dependencia «B»"]);
    assert.deepEqual(expectOk(await paste(a.id, { format: "pizarro.task", dependsOn: "A" })).skipped, ["dependencia «A»"]);
    assert.deepEqual(expectOk(await paste(a.id, { format: "pizarro.task", dependsOn: "Repetida" })).skipped, ["dependencia «Repetida»"]);
    assert.equal((await state(a.id)).blockedById, null);
  });

  test("documentos de Google: se añaden los que faltan (solo de Google), sin duplicar, y deshacer los quita", async () => {
    const { user, f, target } = await fullFixture();
    const mate = await makeUser();
    await assign(f, mate);
    await loginAs(user);
    const docs = [
      { kind: "doc", title: "Acta", url: "https://docs.google.com/document/d/1/edit" },
      { kind: "slides", title: "Diapos", url: "https://docs.google.com/presentation/d/2/edit" },
      { kind: "doc", title: "Malo", url: "https://evil.example.com/document/d/3" },
      { kind: "doc", title: "Otro esquema", url: "javascript:alert(1)" },
    ];
    expectOk(await paste(target.id, { format: "pizarro.task", googleDocs: docs }));
    expectOk(await paste(target.id, { format: "pizarro.task", googleDocs: docs }));
    assert.deepEqual((await state(target.id)).links, [
      { url: "https://docs.google.com/document/d/1/edit", title: "Acta", kind: "GOOGLE_DOC" },
      { url: "https://docs.google.com/presentation/d/2/edit", title: "Diapos", kind: "GOOGLE_SLIDES" },
    ]);
    // El segundo pegado no cambió nada: no deja entrada de deshacer.
    assert.equal(await undoCount(f.project.id), 1);
    expectOk(await undoLast(f.project.id, target.id));
    assert.deepEqual((await state(target.id)).links, []);
  });

  test("texto cambiado por otra persona mientras tanto: no se pisa (409) y no se aplica nada", async () => {
    const { user, f, target } = await fullFixture();
    const mate = await makeUser();
    await assign(f, mate);
    await db.task.update({ where: { id: target.id }, data: { title: "Cambiado por otra persona", contentUpdatedAt: new Date(), contentUpdatedById: mate.id } });
    await loginAs(user);
    const labelsBefore = await db.label.count({ where: { projectId: f.project.id } });
    const res = await pasteTaskJson(target.id, JSON.stringify({ format: "pizarro.task", title: "El mío", labels: ["recién creada"], subtasks: ["a"] }), null);
    expectFail(res, /ha cambiado el texto de esta tarea/);
    const s = await state(target.id);
    assert.deepEqual([s.title, s.labels, s.subtasks.length], ["Cambiado por otra persona", [], 3]);
    assert.equal(await db.label.count({ where: { projectId: f.project.id } }), labelsBefore, "la etiqueta creada para el pegado no se queda");
    assert.equal(await undoCount(f.project.id), 0);
  });
});

describe("pasteTaskJson: dependencias de otro proyecto, etiquetas al deshacer, topes y errores claros", () => {
  test("un pegado que no cambia nada no deja línea en el historial ni entrada de deshacer", async () => {
    const { user, f, source } = await fullFixture();
    await loginAs(user);
    const text = expectOk(await getTaskJson(source.id));
    const events = await db.taskEvent.count({ where: { taskId: source.id } });
    const res = expectOk(await pasteTaskJson(source.id, text));
    assert.equal(res.changed, false);
    assert.deepEqual(res.skipped, []);
    assert.equal(await db.taskEvent.count({ where: { taskId: source.id } }), events);
    assert.equal(await undoCount(f.project.id), 0);
    // Con un cambio, sí.
    expectOk(await paste(source.id, { format: "pizarro.task", title: "Otro título" }));
    const lines = await db.taskEvent.findMany({ where: { taskId: source.id } });
    assert.ok(lines.some((e) => e.label.includes("Pegó el contenido de una tarea en JSON")));
    assert.equal(await undoCount(f.project.id), 1);
  });

  test("errores claros: más de 5000 subtareas, varias tareas, un campo que no se entiende", async () => {
    const { user, target } = await fullFixture();
    await loginAs(user);
    expectFail(await paste(target.id, { format: "pizarro.task", subtasks: Array.from({ length: 5001 }, (_, i) => `s${i}`) }), /trae 5001 subtareas y se leen como mucho 5000/);
    const two = JSON.stringify({ format: "pizarro.task", title: "Una" }) + "\n" + JSON.stringify({ format: "pizarro.task", title: "Dos" });
    expectFail(await pasteTaskJson(target.id, two), /Hay 2 tareas\. Para importar varias, usa «Importar» en el tablero\./);
    expectFail(await paste(target.id, { format: "pizarro.task", type: "x".repeat(600) }), /«tipo» es demasiado largo o no se entiende/);
    assert.equal((await state(target.id)).title, "Destino");
  });

  test("la importación explícita es tolerante: un solo JSON con texto alrededor se pega", async () => {
    const { user, target } = await fullFixture();
    await loginAs(user);
    const text = "Aquí tienes la tarea:\n\n```json\n" + JSON.stringify({ title: "Desde una IA", dueDate: "2027-02-01" }) + "\n```\n¿Algo más?";
    expectOk(await pasteTaskJson(target.id, text));
    const s = await state(target.id);
    assert.deepEqual([s.title, s.dueDate], ["Desde una IA", "2027-02-01"]);
  });

  test("dependencia: de otro proyecto (según info) se ignora sin avisar; sin info, por título entre las activas y después las archivadas", async () => {
    const { user, f, source, target, blocker } = await fullFixture();
    await loginAs(user);
    const json = JSON.parse(expectOk(await getTaskJson(source.id)));
    // El mismo JSON, como si viniera de otro proyecto: la dependencia no se toca y no se avisa.
    const foreign = { ...json, info: { ...json.info, projectId: "otroproyecto", url: "https://pizarro.example.com/p/otroproyecto?task=x" } };
    const res = expectOk(await paste(target.id, foreign));
    assert.deepEqual(res.skipped, []);
    assert.equal((await state(target.id)).blockedById, null);
    // Solo el enlace (sin projectId) también dice de qué proyecto viene.
    const viaUrl = { format: "pizarro.task", dependsOn: { id: blocker.id, title: "Contratar la sala" }, info: { url: "https://pizarro.example.com/p/otro?task=x" } };
    assert.deepEqual(expectOk(await paste(target.id, viaUrl)).skipped, []);
    assert.equal((await state(target.id)).blockedById, null);
    // Del mismo proyecto: por id.
    expectOk(await paste(target.id, { format: "pizarro.task", dependsOn: { id: blocker.id, title: "otro título" }, info: { projectId: f.project.id } }));
    assert.equal((await state(target.id)).blockedById, blocker.id);
    // Sin info (JSON de una IA): por título. Con una activa y una archivada del mismo título, la activa.
    const old = await makeTask(f, { title: "Repetida en archivo" });
    await db.task.update({ where: { id: old.id }, data: { archivedAt: new Date(), archivedFromColumnId: f.columns.todo } });
    const alive = await makeTask(f, { title: "Repetida en archivo" });
    expectOk(await paste(target.id, { format: "pizarro.task", dependsOn: "repetida EN archivo" }));
    assert.equal((await state(target.id)).blockedById, alive.id);
    // Si solo hay archivada con ese título, la archivada.
    const gone = await makeTask(f, { title: "Solo archivada" });
    await db.task.update({ where: { id: gone.id }, data: { archivedAt: new Date(), archivedFromColumnId: f.columns.todo } });
    expectOk(await paste(target.id, { format: "pizarro.task", dependsOn: "solo archivada" }));
    assert.equal((await state(target.id)).blockedById, gone.id);
  });

  test("Cancelar del detalle tras pegar borra las etiquetas que creó el pegado (si nadie más las usa); deshacer Cancelar las devuelve", async () => {
    const { user, f, target } = await fullFixture();
    await loginAs(user);
    const t0 = await db.task.findUniqueOrThrow({ where: { id: target.id }, include: { labels: true, subtasks: { orderBy: { position: "asc" } } } });
    const snap: TaskEditSnapshot = {
      openedAt: new Date(Date.now() - 1000).toISOString(),
      title: t0.title, description: t0.description, kindId: t0.kindId, color: t0.color as never, linkUrl: t0.linkUrl, assigneeId: t0.assigneeId,
      labelIds: t0.labels.map((l) => l.labelId), dueDate: null, deliverableId: t0.deliverableId, evergreen: t0.evergreen, recurrence: t0.recurrence,
      recurrenceDay: t0.recurrenceDay, columnId: t0.columnId, position: t0.position,
      subtasks: t0.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done, position: s.position })), attachmentIds: [], links: [],
    };
    expectOk(await paste(target.id, { format: "pizarro.task", labels: ["rojo", "solo del pegado", "compartida"] }));
    // «compartida» la pone también otra tarea: no se borra.
    const other = await makeTask(f, { title: "Otra" });
    const shared = await db.label.findFirstOrThrow({ where: { projectId: f.project.id, name: "compartida" } });
    await db.taskLabel.create({ data: { taskId: other.id, labelId: shared.id } });
    expectOk(await restoreTaskSnapshot(target.id, snap, null));
    const names = async () => (await db.label.findMany({ where: { projectId: f.project.id }, orderBy: { name: "asc" } })).map((l) => l.name);
    assert.deepEqual(await names(), ["compartida", "rojo", "verde"]);
    assert.deepEqual((await state(target.id)).labels, []);
    // Deshacer «Cancelar» devuelve la etiqueta y la vuelve a poner.
    expectOk(await undoLast(f.project.id, target.id));
    assert.deepEqual(await names(), ["compartida", "rojo", "solo del pegado", "verde"]);
    assert.deepEqual((await state(target.id)).labels, ["compartida", "rojo", "solo del pegado"]);
  });

  test("documentos de Google: dos pegados a la vez no pasan del tope de 100 por tarea", async () => {
    const { user, target } = await fullFixture();
    await loginAs(user);
    const docs = (from: number) => Array.from({ length: 70 }, (_, i) => ({ kind: "doc", title: `D${from + i}`, url: `https://docs.google.com/document/d/x${from + i}/edit` }));
    const [a, b] = await Promise.all([paste(target.id, { format: "pizarro.task", googleDocs: docs(0) }), paste(target.id, { format: "pizarro.task", googleDocs: docs(100) })]);
    assert.equal(await db.taskLink.count({ where: { taskId: target.id } }), 100);
    assert.ok([...expectOk(a).skipped, ...expectOk(b).skipped].includes("documentos de Google (máximo 100 por tarea)"));
  });
});
