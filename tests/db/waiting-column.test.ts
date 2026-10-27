// Columnas «Esperando»: recordatorio único tras N días y roles repetibles.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { moveTask } from "../../src/actions/tasks";
import { setColumnRole, setColumnWaitingDays } from "../../src/actions/columns";
import { undoLast } from "../../src/actions/undo";
import { deliverWaitingReminders } from "../../src/lib/waiting";

const DAY = 86_400_000;
const reminders = (taskId: string) => db.notification.findMany({ where: { taskId, type: "WAITING" } });

async function setup(opts: { days?: number } = {}) {
  // deliverWaitingReminders reparte las de todas las tareas: se descartan los restos de otros tests.
  await db.task.updateMany({ where: { waitingNotifiedAt: null }, data: { waitingNotifiedAt: new Date() } });
  const user = await makeUser();
  const assignee = await makeUser();
  const f = await makeProject({ members: [user, assignee] });
  await loginAs(user);
  await db.column.update({ where: { id: f.columns.doing }, data: { role: "WAITING", waitingDays: opts.days ?? null } });
  const task = await makeTask(f, { columnId: f.columns.doing, createdById: user.id });
  await db.task.update({ where: { id: task.id }, data: { assigneeId: assignee.id } });
  return { user, assignee, f, task };
}

describe("roles de columna repetibles", () => {
  test("WAITING y WEEKLY_PLAN se pueden poner en varias columnas; los únicos siguen siéndolo", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectOk(await setColumnRole(f.columns.todo, "WAITING"));
    expectOk(await setColumnRole(f.columns.doing, "WAITING"));
    expectOk(await setColumnRole(f.columns.done, "WEEKLY_PLAN"));
    const roles = async () => Object.fromEntries((await db.column.findMany({ where: { projectId: f.project.id } })).map((c) => [c.id, c.role]));
    assert.deepEqual(await roles(), { [f.columns.todo]: "WAITING", [f.columns.doing]: "WAITING", [f.columns.done]: "WEEKLY_PLAN" });

    expectOk(await setColumnRole(f.columns.todo, "NEXT_RELEASE"));
    expectOk(await setColumnRole(f.columns.doing, "NEXT_RELEASE"));
    const after = await roles();
    assert.equal(after[f.columns.todo], "NONE");
    assert.equal(after[f.columns.doing], "NEXT_RELEASE");
    // Deshacer devuelve el rol anterior a ambas.
    expectOk(await undoLast(f.project.id));
    assert.deepEqual(await roles(), { [f.columns.todo]: "NEXT_RELEASE", [f.columns.doing]: "WAITING", [f.columns.done]: "WEEKLY_PLAN" });
  });

  test("el plazo de espera solo se cambia en columnas Esperando y entre 1 y 365 días", async () => {
    const { f } = await setup();
    expectOk(await setColumnWaitingDays(f.columns.doing, 5));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.doing } })).waitingDays, 5);
    expectFail(await setColumnWaitingDays(f.columns.doing, 0), /Mínimo 1/);
    expectFail(await setColumnWaitingDays(f.columns.todo, 5), /Esperando/);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.doing } })).waitingDays, null);
  });
});

describe("recordatorio de tareas en espera", () => {
  test("avisa una vez a la persona asignada al cumplirse los días (3 por defecto), no antes ni dos veces", async () => {
    const { assignee, task } = await setup();
    const entered = new Date(Date.now() - 10 * DAY);
    await db.task.update({ where: { id: task.id }, data: { columnEnteredAt: entered } });
    // A los 2 días y medio todavía no.
    assert.equal(await deliverWaitingReminders(new Date(entered.getTime() + 2.5 * DAY)), 0);
    assert.equal((await reminders(task.id)).length, 0);
    // A los 3 días sale.
    const at = new Date(entered.getTime() + 3 * DAY);
    assert.equal(await deliverWaitingReminders(at), 1);
    const got = await reminders(task.id);
    assert.equal(got.length, 1);
    assert.equal(got[0]!.userId, assignee.id);
    assert.equal(got[0]!.actorId, null);
    assert.equal(got[0]!.excerpt, "3");
    // Otra pasada, ni ahora ni más tarde: nada.
    assert.equal(await deliverWaitingReminders(at), 0);
    assert.equal(await deliverWaitingReminders(new Date(entered.getTime() + 9 * DAY)), 0);
    assert.equal((await reminders(task.id)).length, 1);
  });

  test("respeta waitingDays de la columna y avisa al creador si no hay responsable", async () => {
    const { user, task } = await setup({ days: 7 });
    await db.task.update({ where: { id: task.id }, data: { assigneeId: null, columnEnteredAt: new Date(Date.now() - 5 * DAY) } });
    assert.equal(await deliverWaitingReminders(new Date()), 0);
    await db.task.update({ where: { id: task.id }, data: { columnEnteredAt: new Date(Date.now() - 8 * DAY) } });
    assert.equal(await deliverWaitingReminders(new Date()), 1);
    assert.equal((await reminders(task.id))[0]!.userId, user.id);
  });

  test("al salir y volver a entrar empieza otra estancia y se avisa de nuevo", async () => {
    const { f, task } = await setup();
    await db.task.update({ where: { id: task.id }, data: { columnEnteredAt: new Date(Date.now() - 4 * DAY) } });
    assert.equal(await deliverWaitingReminders(new Date()), 1);
    assert.ok((await db.task.findUniqueOrThrow({ where: { id: task.id } })).waitingNotifiedAt);

    expectOk(await moveTask(task.id, f.columns.todo, null, null));
    const out = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(out.waitingNotifiedAt, null);
    assert.ok(Date.now() - out.columnEnteredAt.getTime() < 60_000);
    expectOk(await moveTask(task.id, f.columns.doing, null, null));
    // Recién llegada: nada; pasados 3 días, otro aviso.
    assert.equal(await deliverWaitingReminders(new Date()), 0);
    assert.equal(await deliverWaitingReminders(new Date(Date.now() + 3 * DAY + 60_000)), 1);
    assert.equal((await reminders(task.id)).length, 2);
  });

  test("no avisa de tareas archivadas ni de columnas que cuentan como terminadas", async () => {
    const { f, task } = await setup();
    await db.task.update({ where: { id: task.id }, data: { columnEnteredAt: new Date(Date.now() - 9 * DAY), archivedAt: new Date() } });
    assert.equal(await deliverWaitingReminders(new Date()), 0);
    await db.task.update({ where: { id: task.id }, data: { archivedAt: null } });
    await db.column.update({ where: { id: f.columns.doing }, data: { isDone: true } });
    assert.equal(await deliverWaitingReminders(new Date()), 0);
    await db.column.update({ where: { id: f.columns.doing }, data: { isDone: false } });
    assert.equal(await deliverWaitingReminders(new Date()), 1);
  });
});
