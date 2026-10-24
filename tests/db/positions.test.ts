// Posiciones sin empates: ninguna acción deja dos tareas de la misma columna con la misma posición
// (con un empate, su orden dependía de cómo devolviera las filas PostgreSQL y cambiaba tras cualquier
// refresco). También la migración que renumera los empates que ya existían.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser, type Fixture } from "./helpers";
import { archiveTask, createTask, createTasks, deleteTask, duplicateTask, makeEvergreen, moveTask, moveTasks, restoreTask } from "../../src/actions/tasks";
import { deleteColumn } from "../../src/actions/columns";
import { undoLast } from "../../src/actions/undo";
import { POSITION_STEP as STEP } from "../../src/lib/positions";

async function setup() {
  const user = await makeUser();
  const f = await makeProject({ members: [user] });
  await loginAs(user);
  return { user, f };
}

/** Todas las tareas de la columna (activas, fijas y archivadas) tienen posiciones distintas. */
async function assertNoTies(columnId: string) {
  const rows = await db.task.findMany({ where: { columnId }, select: { id: true, position: true } });
  const seen = new Map<number, string>();
  for (const r of rows) {
    assert.ok(!seen.has(r.position), `empate en la posición ${r.position}: ${seen.get(r.position)} y ${r.id}`);
    seen.set(r.position, r.id);
  }
}

/** Títulos de las tareas activas no fijas de la columna, en el orden del tablero. */
async function order(columnId: string) {
  const rows = await db.task.findMany({ where: { columnId, archivedAt: null, evergreen: false }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { title: true } });
  return rows.map((r) => r.title);
}

const task = (f: Fixture, title: string, position: number, columnId = f.columns.todo) => makeTask(f, { title, position, columnId });

describe("moveTask no crea empates", () => {
  test("vecinas con la misma posición: renumera y la deja entre ellas", async () => {
    const { f } = await setup();
    const p = await task(f, "P", 1000, f.columns.doing);
    const n = await task(f, "N", 1000, f.columns.doing);
    const a = await task(f, "A", 1000);
    const [first, second] = [p, n].sort((x, y) => (x.id < y.id ? -1 : 1));
    expectOk(await moveTask(a.id, f.columns.doing, first!.id, second!.id));
    await assertNoTies(f.columns.doing);
    assert.deepEqual(await order(f.columns.doing), [first!.title, "A", second!.title]);
  });

  test("al final, con una archivada justo detrás de la última visible (prev + 1024)", async () => {
    const { f } = await setup();
    const p = await task(f, "P", STEP, f.columns.doing);
    const x = await task(f, "X", 2 * STEP, f.columns.doing);
    await db.task.update({ where: { id: x.id }, data: { archivedAt: new Date(), archivedFromColumnId: f.columns.doing } });
    const a = await task(f, "A", STEP);
    const { position } = expectOk(await moveTask(a.id, f.columns.doing, p.id, null));
    assert.ok(position > STEP && position < 2 * STEP, `posición ${position}`);
    await assertNoTies(f.columns.doing);
    // Recuperar la archivada la deja al final, también sin empate.
    expectOk(await restoreTask(x.id));
    await assertNoTies(f.columns.doing);
    assert.deepEqual(await order(f.columns.doing), ["P", "A", "X"]);
  });

  test("al principio, con una fija delante de la primera visible", async () => {
    const { f } = await setup();
    const e = await task(f, "E", 0, f.columns.doing);
    await db.task.update({ where: { id: e.id }, data: { evergreen: true } });
    const n = await task(f, "N", STEP, f.columns.doing);
    const a = await task(f, "A", STEP);
    const { position } = expectOk(await moveTask(a.id, f.columns.doing, null, n.id));
    assert.ok(position > 0 && position < STEP, `posición ${position}`);
    await assertNoTies(f.columns.doing);
  });

  test("vista desactualizada: entre las vecinas hay otra justo en el punto medio", async () => {
    const { f } = await setup();
    const p = await task(f, "P", 1000, f.columns.doing);
    await task(f, "M", 1500, f.columns.doing); // llegó después de que el cliente cargara el tablero
    const n = await task(f, "N", 2000, f.columns.doing);
    const a = await task(f, "A", 1000);
    const { position } = expectOk(await moveTask(a.id, f.columns.doing, p.id, n.id));
    assert.equal(position, 1250); // justo detrás de P
    await assertNoTies(f.columns.doing);
    assert.deepEqual(await order(f.columns.doing), ["P", "A", "M", "N"]);
  });

  test("vecinas al revés: no reutiliza ninguna posición", async () => {
    const { f } = await setup();
    const p = await task(f, "P", 1000, f.columns.doing);
    const n = await task(f, "N", 2000, f.columns.doing);
    const a = await task(f, "A", 1000);
    expectOk(await moveTask(a.id, f.columns.doing, n.id, p.id));
    await assertNoTies(f.columns.doing);
    assert.deepEqual(await order(f.columns.doing), ["P", "N", "A"]);
  });

  test("varias personas soltando a la vez en el mismo hueco", async () => {
    const { f } = await setup();
    const p = await task(f, "P", 1000, f.columns.doing);
    const n = await task(f, "N", 2000, f.columns.doing);
    const moving = await Promise.all(["A", "B", "C", "D"].map((t) => task(f, t, 1000)));
    const results = await Promise.all(moving.map((m) => moveTask(m.id, f.columns.doing, p.id, n.id)));
    results.forEach(expectOk);
    await assertNoTies(f.columns.doing);
    const list = await order(f.columns.doing);
    assert.equal(list[0], "P");
    assert.equal(list.at(-1), "N");
  });
});

describe("altas, copias y movimientos en bloque no crean empates", () => {
  test("altas simultáneas en la misma columna", async () => {
    const { f } = await setup();
    await task(f, "Z", 1000);
    const created = await Promise.all(
      ["1", "2", "3", "4", "5"].map((title) => createTask({ projectId: f.project.id, columnId: f.columns.todo, title, kindId: f.kindId })),
    );
    created.forEach(expectOk);
    await assertNoTies(f.columns.todo);
  });

  test("alta en bloque y alta suelta a la vez, y un movimiento en bloque", async () => {
    const { f } = await setup();
    const other = await task(f, "O", 1000, f.columns.doing);
    const [bulk, single, many] = await Promise.all([
      createTasks({ projectId: f.project.id, columnId: f.columns.todo, tasks: [{ title: "b1", kindId: f.kindId }, { title: "b2", kindId: f.kindId }] }),
      createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "s", kindId: f.kindId }),
      moveTasks([other.id], f.columns.todo),
    ]);
    expectOk(bulk);
    expectOk(single);
    expectOk(many);
    await assertNoTies(f.columns.todo);
  });

  test("duplicar sin destino: justo detrás de la original, aunque la siguiente esté pegada", async () => {
    const { f } = await setup();
    const a = await task(f, "A", 1000);
    await task(f, "B", 1000 + 1e-7); // sin hueco: obliga a renumerar
    const copy = expectOk(await duplicateTask(a.id));
    await assertNoTies(f.columns.todo);
    assert.deepEqual(await order(f.columns.todo), ["A", copy.title, "B"]);
  });

  test("duplicar en otra columna entre dos vecinas (Ctrl al soltar); deshacer borra solo la copia", async () => {
    const { f } = await setup();
    const a = await task(f, "A", 1000);
    const p = await task(f, "P", 1000, f.columns.doing);
    const n = await task(f, "N", 2000, f.columns.doing);
    const copy = expectOk(await duplicateTask(a.id, { columnId: f.columns.doing, prevId: p.id, nextId: n.id }));
    assert.equal(copy.columnId, f.columns.doing);
    assert.equal(copy.position, 1500);
    assert.deepEqual(await order(f.columns.doing), ["P", copy.title, "N"]);
    assert.deepEqual(await order(f.columns.todo), ["A"]);
    const entry = await db.undoEntry.findFirstOrThrow({ where: { projectId: f.project.id }, orderBy: { createdAt: "desc" } });
    assert.deepEqual(entry.ops, [{ t: "task.remove", id: copy.id }]);
    assert.match(entry.label, /Duplicó «\{title\}» en «\{col\}»/);
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.task.count({ where: { id: copy.id } }), 0);
    assert.deepEqual(await order(f.columns.doing), ["P", "N"]);
    assert.deepEqual(await order(f.columns.todo), ["A"]);
  });

  test("duplicar en la misma columna, arriba del todo y con vecinas empatadas", async () => {
    const { f } = await setup();
    const a = await task(f, "A", 1000);
    const b = await task(f, "B", 2000);
    const c = await task(f, "C", 2000);
    const top = expectOk(await duplicateTask(b.id, { columnId: f.columns.todo, prevId: null, nextId: a.id }));
    assert.ok(top.position < 1000);
    const [first, second] = [b, c].sort((x, y) => (x.id < y.id ? -1 : 1));
    expectOk(await duplicateTask(a.id, { columnId: f.columns.todo, prevId: first!.id, nextId: second!.id }));
    await assertNoTies(f.columns.todo);
  });

  test("duplicar en una columna de otro proyecto falla", async () => {
    const { f } = await setup();
    const a = await task(f, "A", 1000);
    const other = await makeProject({ members: [] });
    const res = await duplicateTask(a.id, { columnId: other.columns.todo, prevId: null, nextId: null });
    assert.equal(res.ok, false);
  });

  test("marcar como fija y recuperar una archivada: al final, sin empates", async () => {
    const { f } = await setup();
    await db.column.update({ where: { id: f.columns.doing }, data: { role: "NEXT_RELEASE" } });
    await task(f, "R", 1000, f.columns.doing);
    const a = await task(f, "A", 1000);
    const b = await task(f, "B", 2000);
    const [ever, move] = await Promise.all([makeEvergreen(a.id), moveTask(b.id, f.columns.doing, null, null)]);
    expectOk(ever);
    expectOk(move);
    await assertNoTies(f.columns.doing);
    expectOk(await archiveTask(b.id));
    const c = await task(f, "C", 1000);
    expectOk(await moveTask(c.id, f.columns.doing, null, null));
    expectOk(await restoreTask(b.id));
    await assertNoTies(f.columns.doing);
  });

  test("repetitiva terminada: la siguiente aparición no comparte posición", async () => {
    const { f } = await setup();
    await task(f, "Z", 1000);
    const daily = await makeTask(f, { title: "Diaria", recurrence: "DAILY", position: 2000, columnId: f.columns.doing });
    const other = await makeTask(f, { title: "Semanal", recurrence: "WEEKLY", position: 3000, columnId: f.columns.doing });
    await Promise.all([moveTask(daily.id, f.columns.done, null, null), moveTask(other.id, f.columns.done, null, null)].map(async (p) => expectOk(await p)));
    assert.equal(await db.task.count({ where: { columnId: f.columns.todo } }), 3);
    await assertNoTies(f.columns.todo);
    await assertNoTies(f.columns.done);
  });

  test("borrar una columna: sus archivadas van al final de la otra sin empates", async () => {
    const { f } = await setup();
    await task(f, "T1", 1000);
    await task(f, "T2", 2000);
    const x = await task(f, "X", 1000, f.columns.doing);
    const y = await task(f, "Y", 2000, f.columns.doing);
    await db.task.updateMany({ where: { id: { in: [x.id, y.id] } }, data: { archivedAt: new Date(), archivedFromColumnId: f.columns.doing } });
    expectOk(await deleteColumn(f.columns.doing));
    await assertNoTies(f.columns.todo);
    const moved = await db.task.findMany({ where: { id: { in: [x.id, y.id] } }, orderBy: { position: "asc" }, select: { title: true, position: true } });
    assert.deepEqual(moved.map((m) => m.title), ["X", "Y"]);
    assert.ok(moved[0]!.position > 2000);
  });
});

describe("deshacer no crea empates", () => {
  test("deshacer un borrado cuando otra tarjeta ya ocupa su posición: vuelve justo delante", async () => {
    const { f } = await setup();
    const a = await task(f, "A", STEP);
    const b = await task(f, "B", 2 * STEP);
    const c = await task(f, "C", STEP, f.columns.doing);
    expectOk(await deleteTask(b.id));
    const { position } = expectOk(await moveTask(c.id, f.columns.todo, a.id, null));
    assert.equal(position, 2 * STEP); // el hueco que dejó B
    // Deshacer el movimiento de C y después el borrado de B: B vuelve a 2 * STEP, libre de nuevo.
    expectOk(await undoLast(f.project.id));
    expectOk(await undoLast(f.project.id));
    await assertNoTies(f.columns.todo);
    // Ahora al revés: borrar, mover otra a su sitio y deshacer solo el borrado (la entrada más antigua no se puede
    // saltar, así que se recrea con la acción de otra persona: una tarjeta movida a su posición por SQL).
    expectOk(await deleteTask(b.id));
    await db.task.update({ where: { id: c.id }, data: { columnId: f.columns.todo, position: 2 * STEP } });
    expectOk(await undoLast(f.project.id));
    await assertNoTies(f.columns.todo);
    assert.deepEqual(await order(f.columns.todo), ["A", "B", "C"]);
  });

  test("deshacer un archivado cuando su sitio está ocupado", async () => {
    const { f } = await setup();
    await task(f, "A", STEP);
    const b = await task(f, "B", 2 * STEP);
    expectOk(await archiveTask(b.id));
    // Otra persona deja una tarjeta exactamente en la posición de la archivada.
    await task(f, "Otra", 2 * STEP);
    expectOk(await undoLast(f.project.id));
    await assertNoTies(f.columns.todo);
    assert.deepEqual(await order(f.columns.todo), ["A", "B", "Otra"]);
  });
});

describe("migración 20261028110000_posiciones_sin_empates", () => {
  test("renumera solo las columnas con empates, en orden (posición, creación, id), archivadas y fijas incluidas", async () => {
    const { f } = await setup();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const at = (s: number) => new Date(t0.getTime() + s * 1000);
    const mk = async (title: string, position: number, createdAt: Date, extra: { archived?: boolean; evergreen?: boolean } = {}, columnId = f.columns.todo) => {
      const t = await makeTask(f, { title, position, columnId });
      await db.task.update({ where: { id: t.id }, data: { createdAt, ...(extra.archived ? { archivedAt: new Date(), archivedFromColumnId: columnId } : {}), evergreen: !!extra.evergreen } });
      return t;
    };
    await mk("first", 1024, at(5)); // el problema real: una movida a 1024 con el selector «Columna»
    await mk("moved", 1024, at(9));
    await mk("arch", 1536, at(1), { archived: true });
    await mk("ever", 1536, at(2), { evergreen: true });
    await mk("last", 4096, at(0));
    // Columna sin empates: no se toca.
    await mk("u1", 100, at(0), {}, f.columns.doing);
    await mk("u2", 300.5, at(0), {}, f.columns.doing);
    const sql = await readFile(new URL("../../prisma/migrations/20261028110000_posiciones_sin_empates/migration.sql", import.meta.url), "utf8");
    // Limitada a este proyecto (la base de pruebas tiene empates a propósito en otros tests).
    const scoped = sql.replace(`FROM "Task" GROUP BY`, `FROM "Task" WHERE "projectId" = '${f.project.id}' GROUP BY`);
    assert.notEqual(scoped, sql);
    await db.$executeRawUnsafe(scoped);
    const rows = await db.task.findMany({ where: { columnId: f.columns.todo }, orderBy: { position: "asc" }, select: { title: true, position: true } });
    assert.deepEqual(rows.map((r) => [r.title, r.position]), [["first", 1024], ["moved", 2048], ["arch", 3072], ["ever", 4096], ["last", 5120]]);
    const untouched = await db.task.findMany({ where: { columnId: f.columns.doing }, orderBy: { position: "asc" }, select: { position: true } });
    assert.deepEqual(untouched.map((r) => r.position), [100, 300.5]);
  });
});
