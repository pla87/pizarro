// Recordatorios de espera en lotes (sin inanición) y limpieza de la configuración al cambiar el rol de una columna.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { setColumnRole, setColumnRoutineTarget } from "../../src/actions/columns";
import { redoLast, undoLast } from "../../src/actions/undo";
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

describe("recordatorios en lotes (sin inanición)", () => {
  test("las tareas recientes no ocupan sitio: se avisa a las vencidas aunque haya más de un lote de recientes", async () => {
    const { f, user, assignee } = await setup();
    const now = new Date();
    const data = Array.from({ length: 530 }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.doing, title: `Reciente ${i}`, kindId: f.kindId, position: 10_000 + i, createdById: user.id, assigneeId: assignee.id, columnEnteredAt: now }));
    await db.task.createMany({ data });
    const old = [];
    for (let i = 0; i < 3; i++) {
      const t = await makeTask(f, { columnId: f.columns.doing, createdById: user.id });
      await db.task.update({ where: { id: t.id }, data: { assigneeId: assignee.id, columnEnteredAt: new Date(Date.now() - (10 + i) * DAY) } });
      old.push(t.id);
    }
    assert.equal(await deliverWaitingReminders(now), 3);
    for (const id of old) assert.equal((await reminders(id)).length, 1);
  });

  test("más de un lote de vencidas: se procesan todas en una pasada", async () => {
    const { f, user, assignee } = await setup();
    const at = new Date(Date.now() - 20 * DAY);
    await db.task.createMany({ data: Array.from({ length: 620 }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.doing, title: `Vencida ${i}`, kindId: f.kindId, position: 20_000 + i, createdById: user.id, assigneeId: assignee.id, columnEnteredAt: at })) });
    assert.equal(await deliverWaitingReminders(new Date()), 620);
    // Solo queda sin avisar la tarea del setup (entró hoy).
    assert.equal(await db.task.count({ where: { columnId: f.columns.doing, waitingNotifiedAt: null } }), 1);
  });

  test("respeta el plazo propio de la columna y la regla de días naturales en SQL", async () => {
    const { task } = await setup({ days: 7 });
    const entered = new Date(Date.now() - 10 * DAY);
    entered.setUTCHours(12, 0, 0, 0);
    await db.task.update({ where: { id: task.id }, data: { columnEnteredAt: entered } });
    assert.equal(await deliverWaitingReminders(new Date(entered.getTime() + 6.2 * DAY)), 0);
    assert.equal(await deliverWaitingReminders(new Date(entered.getTime() + 7 * DAY)), 1);
  });
});

describe("cambiar el rol de una columna limpia su configuración", () => {
  test("dejar de ser Esperando borra waitingDays y deshacer/rehacer lo devuelven", async () => {
    const { f } = await setup({ days: 6 });
    const days = async () => (await db.column.findUniqueOrThrow({ where: { id: f.columns.doing } })).waitingDays;
    expectOk(await setColumnRole(f.columns.doing, "NONE"));
    assert.equal(await days(), null);
    expectOk(await undoLast(f.project.id));
    assert.equal(await days(), 6);
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.doing } })).role, "WAITING");
    expectOk(await redoLast(f.project.id));
    assert.equal(await days(), null);
  });

  test("dejar de ser Rutinas borra el destino y deshacer lo devuelve; WAITING a WAITING no toca nada", async () => {
    const { f } = await setup({ days: 4 });
    expectOk(await setColumnRole(f.columns.todo, "ROUTINES"));
    expectOk(await setColumnRoutineTarget(f.columns.todo, f.columns.doing));
    expectOk(await setColumnRole(f.columns.todo, "REVIEW"));
    const col = () => db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.equal((await col()).routineTargetColumnId, null);
    expectOk(await undoLast(f.project.id));
    assert.equal((await col()).role, "ROUTINES");
    assert.equal((await col()).routineTargetColumnId, f.columns.doing);
    expectOk(await setColumnRole(f.columns.doing, "WAITING"));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.doing } })).waitingDays, 4);
  });
});
