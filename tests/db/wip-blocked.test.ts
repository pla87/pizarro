// Límite de tarjetas por columna (WIP) y tareas bloqueadas, contra PostgreSQL real.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { createTask, archiveTask, deleteTask, deleteTasks, duplicateTask, moveTask, restoreTaskSnapshot, updateTask } from "../../src/actions/tasks";
import { setColumnWipLimit } from "../../src/actions/columns";
import { blockProblem } from "../../src/lib/blocking";
import { redoLast, undoLast } from "../../src/actions/undo";
import { loadBoardTasks } from "../../src/lib/board";
import { buildProjectExport } from "../../src/lib/project-export/export";
import { importProjectFile, type ImportUser } from "../../src/lib/project-export/import";
import { streamZip } from "../../src/lib/zip-stream";
import { templateFromProject } from "../../src/actions/templates";
import { crc32 } from "node:zlib";
import { createHash } from "node:crypto";

process.env.UPLOAD_DIR ??= await mkdtemp(path.join(tmpdir(), "pz-wip-"));
const work = await mkdtemp(path.join(tmpdir(), "pz-wip-zip-"));
let seq = 0;

async function setup() {
  const user = await makeUser();
  const f = await makeProject({ members: [user] });
  await loginAs(user);
  return { user, f };
}

const blockerOf = async (id: string) => (await db.task.findUniqueOrThrow({ where: { id }, select: { blockedById: true } })).blockedById;

describe("límite de tarjetas por columna", () => {
  test("se guarda, se cambia y se quita (vacío)", async () => {
    const { f } = await setup();
    expectOk(await setColumnWipLimit(f.columns.todo, 3));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).wipLimit, 3);
    expectOk(await setColumnWipLimit(f.columns.todo, 999));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).wipLimit, 999);
    expectOk(await setColumnWipLimit(f.columns.todo, null));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).wipLimit, null);
  });

  test("solo enteros de 1 a 999", async () => {
    const { f } = await setup();
    for (const bad of [0, -1, 1000, 1.5]) expectFail(await setColumnWipLimit(f.columns.todo, bad));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).wipLimit, null);
  });

  test("la base de datos también rechaza valores fuera de rango", async () => {
    const { f } = await setup();
    await assert.rejects(db.column.update({ where: { id: f.columns.todo }, data: { wipLimit: 0 } }));
    await assert.rejects(db.column.update({ where: { id: f.columns.todo }, data: { wipLimit: 1000 } }));
  });

  test("una columna de otro proyecto (sin acceso) no se puede tocar", async () => {
    const { f } = await setup();
    const other = await makeProject({ members: [] });
    expectFail(await setColumnWipLimit(other.columns.todo, 2), NOT_FOUND);
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: other.columns.todo } })).wipLimit, null);
    void f;
  });

  test("deshacer y rehacer devuelven el límite anterior", async () => {
    const { f } = await setup();
    expectOk(await setColumnWipLimit(f.columns.todo, 4));
    expectOk(await setColumnWipLimit(f.columns.todo, 6));
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).wipLimit, 4);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).wipLimit, null);
    expectOk(await redoLast(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).wipLimit, 4);
  });

  test("nunca bloquea: se puede crear y mover por encima del límite", async () => {
    const { f } = await setup();
    expectOk(await setColumnWipLimit(f.columns.todo, 1));
    await makeTask(f);
    const created = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "Segunda", kindId: f.kindId }));
    const moved = await makeTask(f, { columnId: f.columns.doing });
    expectOk(await moveTask(moved.id, f.columns.todo, null, null));
    assert.equal(await db.task.count({ where: { columnId: f.columns.todo, archivedAt: null } }), 3);
    assert.ok(created.id);
  });

  test("al borrar la columna y deshacer vuelve con su límite", async () => {
    const { f } = await setup();
    const { deleteColumn } = await import("../../src/actions/columns");
    expectOk(await setColumnWipLimit(f.columns.doing, 5));
    expectOk(await deleteColumn(f.columns.doing));
    assert.equal(await db.column.count({ where: { id: f.columns.doing } }), 0);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.doing } })).wipLimit, 5);
  });

  test("una plantilla hecha desde el proyecto conserva el límite", async () => {
    const user = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [user] });
    await db.column.update({ where: { id: f.columns.todo }, data: { wipLimit: 3 } });
    await loginAs(user);
    const tpl = expectOk(await templateFromProject(f.project.id));
    assert.deepEqual(tpl.columns.map((c) => c.wipLimit ?? null), [3, null, null]);
  });
});

describe("tareas bloqueadas", () => {
  test("se bloquea por otra tarea del mismo proyecto y se quita", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "A" });
    const b = await makeTask(f, { title: "B" });
    const res = expectOk(await updateTask(a.id, { blockedById: b.id }));
    assert.deepEqual(res.blockedBy, { id: b.id, title: "B" });
    assert.equal(await blockerOf(a.id), b.id);
    const cleared = expectOk(await updateTask(a.id, { blockedById: null }));
    assert.equal(cleared.blockedBy, null);
    assert.equal(await blockerOf(a.id), null);
  });

  test("no vale una tarea de otro proyecto ni una inexistente", async () => {
    const { user, f } = await setup();
    const g = await makeProject({ members: [user] });
    const a = await makeTask(f);
    const foreign = await makeTask(g);
    expectFail(await updateTask(a.id, { blockedById: foreign.id }), /no existe en este proyecto/);
    expectFail(await updateTask(a.id, { blockedById: "no-existe" }), /no existe en este proyecto/);
    assert.equal(await blockerOf(a.id), null);
  });

  test("no puede bloquearse a sí misma", async () => {
    const { f } = await setup();
    const a = await makeTask(f);
    expectFail(await updateTask(a.id, { blockedById: a.id }), /sí misma/);
    // Tampoco la base de datos lo permite.
    await assert.rejects(db.task.update({ where: { id: a.id }, data: { blockedById: a.id } }));
  });

  test("sin ciclos: ni A→B→A directo ni más largos", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "A" });
    const b = await makeTask(f, { title: "B" });
    const c = await makeTask(f, { title: "C" });
    expectOk(await updateTask(a.id, { blockedById: b.id }));
    expectFail(await updateTask(b.id, { blockedById: a.id }), /círculo/);
    expectOk(await updateTask(b.id, { blockedById: c.id }));
    expectFail(await updateTask(c.id, { blockedById: a.id }), /círculo/);
    assert.equal(await blockerOf(c.id), null);
    // Una cadena larga sin vuelta sí vale.
    expectOk(await updateTask(a.id, { blockedById: c.id }));
  });

  test("queda en el historial de la tarea, con y sin bloqueo", async () => {
    const { f } = await setup();
    const a = await makeTask(f);
    const b = await makeTask(f, { title: "Base de datos" });
    expectOk(await updateTask(a.id, { blockedById: b.id }));
    expectOk(await updateTask(a.id, { blockedById: null }));
    const labels = (await db.taskEvent.findMany({ where: { taskId: a.id }, orderBy: { createdAt: "asc" } })).map((e) => e.label);
    assert.equal(labels.length, 2);
    assert.match(labels[0]!, /bloqueada por/);
    assert.match(labels[0]!, /Base de datos/);
    assert.match(labels[1]!, /Quitó el bloqueo/);
  });

  test("deshacer y rehacer el bloqueo", async () => {
    const { f } = await setup();
    const a = await makeTask(f);
    const b = await makeTask(f);
    expectOk(await updateTask(a.id, { blockedById: b.id }));
    expectOk(await undoLast(f.project.id));
    assert.equal(await blockerOf(a.id), null);
    expectOk(await redoLast(f.project.id));
    assert.equal(await blockerOf(a.id), b.id);
    // Y quitarlo también se deshace.
    expectOk(await updateTask(a.id, { blockedById: null }));
    expectOk(await undoLast(f.project.id));
    assert.equal(await blockerOf(a.id), b.id);
  });

  test("al archivar la que bloquea, el enlace se conserva (la tarjeta lo apaga en el cliente)", async () => {
    const { f } = await setup();
    const a = await makeTask(f);
    const b = await makeTask(f, { title: "Bloqueadora" });
    expectOk(await updateTask(a.id, { blockedById: b.id }));
    expectOk(await archiveTask(b.id));
    assert.equal(await blockerOf(a.id), b.id);
    // Sigue viajando con la tarjeta (id y título) para poder mostrar «(terminada)» en el detalle.
    const board = await loadBoardTasks(f.project.id);
    assert.deepEqual(board.find((t) => t.id === a.id)!.blockedBy, { id: b.id, title: "Bloqueadora" });
    assert.equal(board.some((t) => t.id === b.id), false);
  });

  test("al borrar la que bloquea, el enlace se quita; deshacer el borrado lo devuelve", async () => {
    const { f } = await setup();
    const a = await makeTask(f);
    const b = await makeTask(f);
    expectOk(await updateTask(a.id, { blockedById: b.id }));
    expectOk(await deleteTask(b.id));
    assert.equal(await blockerOf(a.id), null);
    expectOk(await undoLast(f.project.id));
    assert.equal(await blockerOf(a.id), b.id);
  });

  test("borrar varias a la vez (también las que se bloqueaban entre sí) y deshacer", async () => {
    const { f } = await setup();
    const a = await makeTask(f);
    const b = await makeTask(f);
    const c = await makeTask(f);
    expectOk(await updateTask(a.id, { blockedById: b.id })); // dentro del lote
    expectOk(await updateTask(c.id, { blockedById: a.id })); // fuera del lote
    expectOk(await deleteTasks([a.id, b.id]));
    assert.equal(await blockerOf(c.id), null);
    expectOk(await undoLast(f.project.id));
    assert.equal(await blockerOf(a.id), b.id);
    assert.equal(await blockerOf(c.id), a.id);
  });

  test("duplicar copia el bloqueo", async () => {
    const { f } = await setup();
    const a = await makeTask(f);
    const b = await makeTask(f);
    expectOk(await updateTask(a.id, { blockedById: b.id }));
    const copy = expectOk(await duplicateTask(a.id));
    assert.equal(copy.blockedBy?.id, b.id);
    assert.equal(await blockerOf(copy.id), b.id);
  });

  test("«Cancelar» en el detalle devuelve el bloqueo de al abrir", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "A" });
    const b = await makeTask(f);
    const snapshot = { title: "A", kindId: f.kindId, color: null, linkUrl: null, assigneeId: null, labelIds: [], dueDate: null, deliverableId: null, evergreen: false, evergreenEvery: 1, recurrence: "NONE" as const, recurrenceDay: null, columnId: f.columns.todo, position: 1000, blockedById: null };
    expectOk(await updateTask(a.id, { blockedById: b.id }));
    const res = expectOk(await restoreTaskSnapshot(a.id, snapshot));
    assert.equal(res.changed, true);
    assert.equal(await blockerOf(a.id), null);
  });

  test("el tablero trae solo id y título de la que bloquea", async () => {
    const { f } = await setup();
    const a = await makeTask(f);
    const b = await makeTask(f, { title: "Raíz" });
    await db.task.update({ where: { id: b.id }, data: { description: "texto largo ".repeat(100) } });
    expectOk(await updateTask(a.id, { blockedById: b.id }));
    const blockedBy = (await loadBoardTasks(f.project.id)).find((t) => t.id === a.id)!.blockedBy;
    assert.deepEqual(blockedBy, { id: b.id, title: "Raíz" });
    assert.deepEqual(Object.keys(blockedBy!).sort(), ["id", "title"]);
  });

  test("deshacer una edición posterior no devuelve un bloqueo que crearía un ciclo", async () => {
    const { f } = await setup();
    const a = await makeTask(f);
    const b = await makeTask(f);
    expectOk(await updateTask(a.id, { blockedById: b.id }));
    expectOk(await updateTask(a.id, { blockedById: null }));
    // Entretanto, B queda bloqueada por A (ya no hay ciclo posible porque A no depende de B).
    await db.task.update({ where: { id: b.id }, data: { blockedById: a.id } });
    expectOk(await undoLast(f.project.id)); // devolvería A→B, que cerraría un ciclo con B→A
    assert.equal(await blockerOf(a.id), null);
  });
});

describe("exportar e importar con límite y bloqueos", () => {
  const asImporter = (u: { id: string; name: string; email: string; role: "ADMIN" | "MEMBER" }): ImportUser => ({ id: u.id, name: u.name, email: u.email, role: u.role });
  async function toZip(build: Awaited<ReturnType<typeof buildProjectExport>>): Promise<string> {
    const parts: Buffer[] = [];
    for await (const c of streamZip(build.entries)) parts.push(c);
    const file = path.join(work, `e${++seq}.zip`);
    await writeFile(file, Buffer.concat(parts));
    return file;
  }

  test("ida y vuelta: el límite y el bloqueo se conservan por referencia", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [admin] });
    await db.column.update({ where: { id: f.columns.doing }, data: { wipLimit: 4 } });
    const a = await makeTask(f, { title: "Bloqueada" });
    const b = await makeTask(f, { title: "Bloqueadora" });
    await db.task.update({ where: { id: a.id }, data: { blockedById: b.id } });
    const build = await buildProjectExport(f.project.id, { attachments: false, scope: "all" });
    const s = await importProjectFile(await toZip(build), asImporter(admin), { isPrivate: false });
    const cols = await db.column.findMany({ where: { projectId: s.projectId }, orderBy: { position: "asc" } });
    assert.deepEqual(cols.map((c) => c.wipLimit), [null, 4, null]);
    const tasks = await db.task.findMany({ where: { projectId: s.projectId } });
    const na = tasks.find((t) => t.title === "Bloqueada")!;
    const nb = tasks.find((t) => t.title === "Bloqueadora")!;
    assert.equal(na.blockedById, nb.id);
    assert.notEqual(nb.id, b.id);
    assert.equal(tasks.find((t) => t.title === "Bloqueadora")!.blockedById, null);
  });

  test("exportar solo el tablero: si la que bloquea está archivada, el enlace no viaja", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [admin] });
    const a = await makeTask(f, { title: "Bloqueada" });
    const b = await makeTask(f, { title: "Archivada" });
    await db.task.update({ where: { id: a.id }, data: { blockedById: b.id } });
    await db.task.update({ where: { id: b.id }, data: { archivedAt: new Date() } });
    const build = await buildProjectExport(f.project.id, { attachments: false, scope: "board" });
    const s = await importProjectFile(await toZip(build), asImporter(admin), { isPrivate: false });
    const imported = await db.task.findMany({ where: { projectId: s.projectId } });
    assert.equal(imported.length, 1);
    assert.equal(imported[0]!.blockedById, null);
  });

  test("un archivo con bloqueos en círculo o hacia una tarea inexistente se rechaza", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [admin] });
    await makeTask(f, { title: "A" });
    await makeTask(f, { title: "B" });
    const good = await buildProjectExport(f.project.id, { attachments: false, scope: "all" });
    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    const tamper = async (edit: (data: { tasks: { ref: string; blockedByRef?: string | null }[] }) => void) => {
      const data = JSON.parse((good.entries[1]!.body as Buffer).toString("utf8"));
      edit(data);
      const pj = Buffer.from(JSON.stringify(data));
      const manifest = JSON.parse((good.entries[0]!.body as Buffer).toString("utf8"));
      manifest.checksums["project.json"] = sha(pj);
      const entries = [
        { name: "manifest.json", body: Buffer.from(JSON.stringify(manifest)) },
        { name: "project.json", body: pj },
      ].map((e) => ({ ...e, size: e.body.length, crc: crc32(e.body) }));
      const parts: Buffer[] = [];
      for await (const c of streamZip(entries)) parts.push(c);
      const file = path.join(work, `t${++seq}.zip`);
      await writeFile(file, Buffer.concat(parts));
      return file;
    };
    const cycle = await tamper((d) => { d.tasks[0]!.blockedByRef = d.tasks[1]!.ref; d.tasks[1]!.blockedByRef = d.tasks[0]!.ref; });
    await assert.rejects(importProjectFile(cycle, asImporter(admin), { isPrivate: false }), /en círculo/);
    const self = await tamper((d) => { d.tasks[0]!.blockedByRef = d.tasks[0]!.ref; });
    await assert.rejects(importProjectFile(self, asImporter(admin), { isPrivate: false }), /en círculo/);
    const missing = await tamper((d) => { d.tasks[0]!.blockedByRef = "t99"; });
    await assert.rejects(importProjectFile(missing, asImporter(admin), { isPrivate: false }), /no existe/);
  });
});

describe("bloqueos: carrera de ciclos y detección con una sola consulta", () => {
  test("dos bloqueos opuestos A→B y B→A a la vez: como mucho uno se guarda y nunca queda un ciclo", async () => {
    const { f } = await setup();
    let wins = 0;
    for (let round = 0; round < 12; round++) {
      const a = await makeTask(f, { title: `A${round}` });
      const b = await makeTask(f, { title: `B${round}` });
      const res = await Promise.all([updateTask(a.id, { blockedById: b.id }), updateTask(b.id, { blockedById: a.id })]);
      const oks = res.filter((r) => r.ok).length;
      assert.equal(oks, 1, `ronda ${round}: debía ganar exactamente una (ganaron ${oks})`);
      wins += oks;
      const [ba, bb] = [await blockerOf(a.id), await blockerOf(b.id)];
      assert.ok(!(ba === b.id && bb === a.id), "no puede haber un ciclo");
      const lost = res.find((r) => !r.ok) as { ok: false; error: string };
      assert.match(lost.error, /círculo/);
    }
    assert.equal(wins, 12);
  });

  test("la restauración de una instantánea (cancelar cambios) también respeta el candado", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "A" });
    const b = await makeTask(f, { title: "B" });
    expectOk(await updateTask(a.id, { blockedById: b.id }));
    // B pide quedar bloqueada por A mediante una instantánea: se ignora el campo (cerraría un ciclo) sin fallar.
    const snap = {
      title: "B", description: "", color: null, linkUrl: null, evergreen: false, evergreenEvery: 1, recurrence: "NONE" as const, recurrenceDay: null,
      kindId: f.kindId, assigneeId: null, deliverableId: null, blockedById: a.id, dueDate: null, columnId: f.columns.todo, position: 1000, labelIds: [],
    };
    const res = await restoreTaskSnapshot(b.id, snap as never);
    if (res.ok) assert.equal(await blockerOf(b.id), null);
    assert.equal(await blockerOf(a.id), b.id);
  });

  test("blockProblem con cadena larga, ciclo previo, otro proyecto y casos básicos", async () => {
    const { f } = await setup();
    const N = 3000;
    const ids = Array.from({ length: N }, (_, i) => `chain-${seq++}-${i}`);
    // t[i] está bloqueada por t[i+1]; se insertan del final al principio para que la que bloquea ya exista.
    await db.task.createMany({
      data: ids.map((id, i) => ({ id, projectId: f.project.id, columnId: f.columns.todo, title: id, kindId: f.kindId, position: 1000 + i, blockedById: ids[i + 1] ?? null })).reverse(),
    });
    const extra = await makeTask(f, { title: "extra" });
    const t0 = Date.now();
    assert.equal(await blockProblem(extra.id, ids[0]!, f.project.id), null);
    assert.equal(await blockProblem(ids[N - 1]!, ids[0]!, f.project.id), "cycle"); // t0 → … → t(N-1)
    assert.equal(await blockProblem(ids[0]!, ids[N - 1]!, f.project.id), null); // el final de la cadena no vuelve a t0
    assert.ok(Date.now() - t0 < 5000, "la detección debe ser una consulta, no miles");
    // Ciclo previo (A ↔ B, escrito por SQL): termina y no se confunde.
    const a = await makeTask(f, { title: "PA" });
    const b = await makeTask(f, { title: "PB" });
    await db.task.update({ where: { id: a.id }, data: { blockedById: b.id } });
    await db.task.update({ where: { id: b.id }, data: { blockedById: a.id } });
    assert.equal(await blockProblem(extra.id, a.id, f.project.id), null);
    assert.equal(await blockProblem(a.id, b.id, f.project.id), "cycle");
    // Básicos.
    assert.equal(await blockProblem(extra.id, extra.id, f.project.id), "self");
    assert.equal(await blockProblem(extra.id, "no-existe", f.project.id), "missing");
    const other = await makeProject({ members: [] });
    const foreign = await makeTask(other);
    assert.equal(await blockProblem(extra.id, foreign.id, f.project.id), "missing");
  });
});
