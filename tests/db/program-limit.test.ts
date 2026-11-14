// Tope de sesiones de una columna «Programa del curso» (rol PROGRAM) contra PostgreSQL real: como mucho 100 tareas no
// archivadas, en todas las vías que meten tareas en una columna (crear, crear varias, duplicar, mover, mover en bloque,
// recuperar archivada, repetición, cambiar el rol, aplicar plantilla), también con dos peticiones a la vez. El deshacer
// sí puede pasarse (column-capacity.ts explica por qué).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, type Fixture } from "./helpers";
import { archiveTask, createTask, createTasks, duplicateTask, moveTask, moveTasks, restoreTask } from "../../src/actions/tasks";
import { setColumnRole } from "../../src/actions/columns";
import { undoLast } from "../../src/actions/undo";
import { applyTemplateChange, undoTemplateChange } from "../../src/actions/template-apply";
import { resetRateLimit } from "../../src/lib/rate-limit";
import { PROGRAM_MAX_SESSIONS } from "../../src/lib/program-limit";

const FULL = /La columna «Por hacer» admite como mucho 100 sesiones/;

/** Proyecto con «Por hacer» como columna «Programa del curso» y `sessions` tareas activas en ella. */
async function setup(sessions = 0) {
  const user = await makeUser();
  const f = await makeProject({ members: [user] });
  await db.column.update({ where: { id: f.columns.todo }, data: { role: "PROGRAM" } });
  await fill(f, f.columns.todo, sessions);
  await loginAs(user);
  resetRateLimit(`create-task:${user.id}`);
  resetRateLimit(`duplicate:${user.id}`);
  return { user, f, program: f.columns.todo };
}

/** Añade `n` tareas activas a la columna directamente en la BD (detrás de las que haya). */
async function fill(f: Fixture, columnId: string, n: number, extra: { archivedAt?: Date } = {}) {
  if (n <= 0) return;
  const last = (await db.task.findFirst({ where: { columnId }, orderBy: { position: "desc" }, select: { position: true } }))?.position ?? 0;
  await db.task.createMany({
    data: Array.from({ length: n }, (_, i) => ({ projectId: f.project.id, columnId, kindId: f.kindId, title: `Sesión ${i + 1}`, position: last + (i + 1) * 1000, ...extra })),
  });
}

const active = (columnId: string) => db.task.count({ where: { columnId, archivedAt: null } });

describe("tope de 100 sesiones en una columna «Programa del curso»", () => {
  test("crear: la 100 entra, la 101 no; las archivadas no cuentan y las demás columnas no tienen tope", async () => {
    const { f, program } = await setup(99);
    await fill(f, program, 5, { archivedAt: new Date() });
    expectOk(await createTask({ projectId: f.project.id, columnId: program, title: "La cien", kindId: f.kindId }));
    assert.equal(await active(program), PROGRAM_MAX_SESSIONS);
    const err = expectFail(await createTask({ projectId: f.project.id, columnId: program, title: "La 101", kindId: f.kindId }), FULL);
    assert.equal(err, "La columna «Por hacer» admite como mucho 100 sesiones.");
    assert.equal(await active(program), PROGRAM_MAX_SESSIONS);
    // Otra columna, aunque tenga más de 100, sin tope.
    await fill(f, f.columns.doing, 120);
    expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.doing, title: "Sin tope", kindId: f.kindId }));
  });

  test("crear varias (pegar líneas): todo o nada, con cuántas tiene y cuántas no caben", async () => {
    const { f, program } = await setup(97);
    const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Línea ${i}`, kindId: f.kindId }));
    expectFail(await createTasks({ projectId: f.project.id, columnId: program, tasks: lines(5) }), /admite como mucho 100 sesiones: tiene 97 y no caben 5 más/);
    assert.equal(await active(program), 97);
    expectOk(await createTasks({ projectId: f.project.id, columnId: program, tasks: lines(3) }));
    assert.equal(await active(program), 100);
    expectFail(await createTasks({ projectId: f.project.id, columnId: program, tasks: lines(2) }), /^La columna «Por hacer» admite como mucho 100 sesiones\.$/);
  });

  test("duplicar: en la misma columna llena o soltando la copia en ella (Ctrl al arrastrar) se rechaza", async () => {
    const { f, program } = await setup(100);
    const inside = await db.task.findFirstOrThrow({ where: { columnId: program } });
    expectFail(await duplicateTask(inside.id), FULL);
    const outside = await makeTask(f, { columnId: f.columns.doing });
    expectFail(await duplicateTask(outside.id, { columnId: program, prevId: null, nextId: null }), FULL);
    expectOk(await duplicateTask(outside.id));
    assert.equal(await active(program), 100);
  });

  test("mover: entrar en la columna llena no se puede; reordenar dentro sí, aunque esté por encima por datos antiguos", async () => {
    const { f, program } = await setup(100);
    const outside = await makeTask(f, { columnId: f.columns.doing });
    expectFail(await moveTask(outside.id, program, null, null), FULL);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: outside.id } })).columnId, f.columns.doing);
    // Datos de antes del límite: 103 en la columna. Reordenar no suma.
    await fill(f, program, 3);
    const [first, second] = await db.task.findMany({ where: { columnId: program }, orderBy: { position: "asc" }, take: 2 });
    expectOk(await moveTask(first!.id, program, second!.id, null));
    // Sacar una sí (y aun así sigue por encima: tampoco entra otra).
    expectOk(await moveTask(first!.id, f.columns.doing, null, null));
    expectFail(await moveTask(first!.id, program, null, null), FULL);
  });

  test("mover en bloque (Mover a… y arrastrar la selección con prevId/nextId): todo o nada, solo cuentan las que llegan", async () => {
    const { f, program } = await setup(98);
    const a = await makeTask(f, { columnId: f.columns.doing, position: 1000 });
    const b = await makeTask(f, { columnId: f.columns.doing, position: 2000 });
    const c = await makeTask(f, { columnId: f.columns.doing, position: 3000 });
    expectFail(await moveTasks([a.id, b.id, c.id], program), /admite como mucho 100 sesiones: tiene 98 y no caben 3 más/);
    const [p1, p2] = await db.task.findMany({ where: { columnId: program }, orderBy: { position: "asc" }, take: 2 });
    expectFail(await moveTasks([a.id, b.id, c.id], program, { prevId: p1!.id, nextId: p2!.id }), /no caben 3 más/);
    assert.equal(await db.task.count({ where: { columnId: f.columns.doing } }), 3);
    // Dos sí caben; con una de la propia columna en la selección, esa no suma (98 + 2 = 100).
    expectOk(await moveTasks([a.id, b.id, p2!.id], program, { prevId: p1!.id, nextId: null }));
    assert.equal(await active(program), 100);
    // Llena: reordenar un bloque de la propia columna sigue funcionando.
    const [q1, q2, q3] = await db.task.findMany({ where: { columnId: program }, orderBy: { position: "asc" }, take: 3 });
    expectOk(await moveTasks([q1!.id, q2!.id], program, { prevId: q3!.id, nextId: null }));
    expectFail(await moveTasks([c.id], program, { prevId: q3!.id, nextId: null }), FULL);
  });

  test("recuperar una archivada a la columna llena se rechaza; con hueco, vuelve", async () => {
    const { f, program } = await setup(99);
    const t = await makeTask(f, { columnId: program, position: 999_999 });
    expectOk(await archiveTask(t.id));
    await fill(f, program, 1);
    expectFail(await restoreTask(t.id), FULL);
    assert.ok((await db.task.findUniqueOrThrow({ where: { id: t.id } })).archivedAt);
    const other = await db.task.findFirstOrThrow({ where: { columnId: program, archivedAt: null, id: { not: t.id } } });
    expectOk(await archiveTask(other.id));
    expectOk(await restoreTask(t.id));
    assert.equal(await active(program), 100);
  });

  test("repetición: la siguiente aparición no nace en una columna llena (y archivar no falla)", async () => {
    const { f, program } = await setup(100);
    // 101 por datos antiguos; al archivar la recurrente quedan 100: su siguiente aparición no cabe.
    const rec = await makeTask(f, { columnId: program, position: 999_999, recurrence: "WEEKLY", dueDate: new Date("2027-01-04") });
    const res = expectOk(await archiveTask(rec.id));
    assert.equal(res.spawned.length, 0);
    assert.equal(await db.task.count({ where: { recurrenceFromId: rec.id } }), 0);
    assert.equal(await active(program), 100);
    // Con hueco (otra columna), sí nace.
    const free = await makeTask(f, { columnId: f.columns.doing, recurrence: "WEEKLY", dueDate: new Date("2027-01-04") });
    assert.equal(expectOk(await archiveTask(free.id)).spawned.length, 1);
  });

  test("cambiar el rol: una columna con más de 100 no puede pasar a «Programa del curso»; con 100, sí", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    await fill(f, f.columns.doing, 101);
    await fill(f, f.columns.doing, 10, { archivedAt: new Date() });
    expectFail(await setColumnRole(f.columns.doing, "PROGRAM"), /La columna «En curso» tiene 101 tareas y una columna «Programa del curso» admite como mucho 100 sesiones/);
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.doing } })).role, "NONE");
    await fill(f, f.columns.todo, 100);
    expectOk(await setColumnRole(f.columns.todo, "PROGRAM"));
    // Una que ya lo es (datos antiguos por encima) puede volver a ponerse el mismo rol o quitárselo.
    await fill(f, f.columns.todo, 5);
    expectOk(await setColumnRole(f.columns.todo, "PROGRAM"));
    expectOk(await setColumnRole(f.columns.todo, "NONE"));
  });

  test("dos altas a la vez con 99: solo entra una", async () => {
    const { f, program } = await setup(99);
    const results = await Promise.all([1, 2].map((i) => createTask({ projectId: f.project.id, columnId: program, title: `A la vez ${i}`, kindId: f.kindId })));
    assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
    assert.equal(await active(program), 100);
  });

  test("un alta y un cambio de rol a la vez no dejan la columna por encima", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    await fill(f, f.columns.doing, 100);
    const [created, role] = await Promise.all([
      createTask({ projectId: f.project.id, columnId: f.columns.doing, title: "Una más", kindId: f.kindId }),
      setColumnRole(f.columns.doing, "PROGRAM"),
    ]);
    // O entra la tarea y el rol se rechaza (101), o cambia el rol y la tarea se rechaza: nunca las dos.
    assert.equal(created.ok !== role.ok, true, JSON.stringify({ created: created.ok, role: role.ok }));
    const col = await db.column.findUniqueOrThrow({ where: { id: f.columns.doing } });
    assert.ok(col.role !== "PROGRAM" || (await active(f.columns.doing)) <= 100);
  });

  test("deshacer puede pasar del tope: devuelve la tarea a donde estaba", async () => {
    const { f, program } = await setup(100);
    const t = await db.task.findFirstOrThrow({ where: { columnId: program }, orderBy: { position: "asc" } });
    expectOk(await moveTask(t.id, f.columns.doing, null, null));
    // Mientras tanto otra persona llena el hueco.
    await fill(f, program, 1);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: t.id } })).columnId, program);
    assert.equal(await active(program), 101);
    // Pero no entra nada más hasta bajar del tope.
    expectFail(await createTask({ projectId: f.project.id, columnId: program, title: "No", kindId: f.kindId }), FULL);
  });

  test("aplicar plantilla: no da el rol «Programa» a una columna con más de 100 (todo o nada); con 100, sí", async () => {
    const owner = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner });
    await fill(f, f.columns.todo, 101);
    const tpl = await db.projectTemplate.create({
      data: {
        name: `Curso ${Math.random().toString(36).slice(2, 7)}`, description: "", position: 1, kinds: [], hiddenGeneralKinds: [], labels: [], taskFields: [], releaseTemplates: [],
        columns: [{ name: "Por hacer", role: "PROGRAM", isDone: false }, { name: "En curso", role: "NONE", isDone: false }, { name: "Hecho", role: "NONE", isDone: true }],
      },
    });
    const admin = await makeUser({ role: "ADMIN" });
    await db.projectMember.create({ data: { projectId: f.project.id, userId: admin.id } });
    await loginAs(admin);
    expectFail(await applyTemplateChange(f.project.id, { source: "template", id: tpl.id }, "REPLACE"), /La columna «Por hacer» tiene 101 tareas y una columna «Programa del curso» admite como mucho 100 sesiones/);
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).role, "NONE");
    assert.equal(await db.projectTemplateChange.count({ where: { projectId: f.project.id } }), 0);
    const one = await db.task.findFirstOrThrow({ where: { columnId: f.columns.todo } });
    await db.task.update({ where: { id: one.id }, data: { archivedAt: new Date(), archivedFromColumnId: f.columns.todo } });
    expectOk(await applyTemplateChange(f.project.id, { source: "template", id: tpl.id }, "REPLACE"));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).role, "PROGRAM");
  });

  test("aplicar plantilla: un cambio que falla al final por el tope gasta el límite de cambios (no se puede repetir sin fin)", async () => {
    const owner = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner });
    await fill(f, f.columns.todo, 101);
    const tpl = await db.projectTemplate.create({
      data: {
        name: `Curso ${Math.random().toString(36).slice(2, 7)}`, description: "", position: 1, kinds: [], hiddenGeneralKinds: [], labels: [], taskFields: [], releaseTemplates: [],
        columns: [{ name: "Por hacer", role: "PROGRAM", isDone: false }, { name: "En curso", role: "NONE", isDone: false }, { name: "Hecho", role: "NONE", isDone: true }],
      },
    });
    const admin = await makeUser({ role: "ADMIN" });
    await db.projectMember.create({ data: { projectId: f.project.id, userId: admin.id } });
    await loginAs(admin);
    // Cada intento ejecuta el cambio entero (con el tablero bloqueado) y lo deshace al final: cuenta como un cambio.
    for (let i = 0; i < 5; i++) expectFail(await applyTemplateChange(f.project.id, { source: "template", id: tpl.id }, "REPLACE"), /admite como mucho 100 sesiones/);
    expectFail(await applyTemplateChange(f.project.id, { source: "template", id: tpl.id }, "REPLACE"), /Este proyecto ya ha cambiado de plantilla 5 veces/);
    // Un aviso de antes de empezar (no hay nada que deshacer) sí devuelve su reserva.
    resetRateLimit(`template-change:project:${f.project.id}`);
    resetRateLimit(`template-change:user:${admin.id}`);
    for (let i = 0; i < 7; i++) expectFail(await undoTemplateChange(f.project.id), /No hay ningún cambio de plantilla que deshacer/);
  });
});
