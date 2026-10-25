// Avisos de cambio de fecha agrupados (debounce): varios cambios seguidos → un único aviso con la fecha final.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { updateTask } from "../../src/actions/tasks";
import { DUE_NOTIFY_DELAY_MS, deliverDueNotices } from "../../src/lib/due-notices";

const dueNotices = (taskId: string) => db.notification.findMany({ where: { taskId, type: "DUE_CHANGED" } });
const after = (ms: number) => new Date(Date.now() + ms);

async function setup() {
  await db.pendingDueNotice.deleteMany(); // restos de otros tests: deliverDueNotices reparte las de todas las tareas
  const actor = await makeUser();
  const assignee = await makeUser();
  const f = await makeProject({ members: [actor, assignee] });
  const task = await makeTask(f, { dueDate: new Date("2026-11-01T00:00:00Z") });
  await db.task.update({ where: { id: task.id }, data: { assigneeId: assignee.id } });
  await loginAs(actor);
  return { actor, assignee, f, task };
}

describe("avisos de cambio de fecha agrupados", () => {
  test("varios cambios seguidos: nada al instante y un solo aviso con la fecha final tras la espera", async () => {
    const { actor, assignee, task } = await setup();
    for (const d of ["2026-11-02", "2026-11-05", "2026-11-12"]) expectOk(await updateTask(task.id, { dueDate: d }));
    assert.equal((await dueNotices(task.id)).length, 0);
    const pending = await db.pendingDueNotice.findMany({ where: { taskId: task.id } });
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.fromDue, "2026-11-01");
    assert.equal(pending[0]!.toDue, "2026-11-12");

    // Aún dentro del plazo: no sale.
    assert.equal(await deliverDueNotices(after(DUE_NOTIFY_DELAY_MS - 30_000)), 0);
    assert.equal((await dueNotices(task.id)).length, 0);

    assert.equal(await deliverDueNotices(after(DUE_NOTIFY_DELAY_MS + 30_000)), 1);
    const got = await dueNotices(task.id);
    assert.equal(got.length, 1);
    assert.equal(got[0]!.userId, assignee.id);
    assert.equal(got[0]!.actorId, actor.id);
    assert.equal(got[0]!.excerpt, "2026-11-01>2026-11-12");
    assert.equal(await db.pendingDueNotice.count({ where: { taskId: task.id } }), 0);
    // Una segunda pasada no repite nada.
    assert.equal(await deliverDueNotices(after(2 * DUE_NOTIFY_DELAY_MS)), 0);
    assert.equal((await dueNotices(task.id)).length, 1);
  });

  test("cada cambio retrasa el envío (debounce)", async () => {
    const { task } = await setup();
    expectOk(await updateTask(task.id, { dueDate: "2026-11-03" }));
    const first = (await db.pendingDueNotice.findFirstOrThrow({ where: { taskId: task.id } })).sendAfter;
    await new Promise((r) => setTimeout(r, 20));
    expectOk(await updateTask(task.id, { dueDate: "2026-11-04" }));
    const second = (await db.pendingDueNotice.findFirstOrThrow({ where: { taskId: task.id } })).sendAfter;
    assert.ok(second.getTime() > first.getTime());
  });

  test("si la fecha final es la original, no se avisa", async () => {
    const { task } = await setup();
    expectOk(await updateTask(task.id, { dueDate: "2026-11-09" }));
    expectOk(await updateTask(task.id, { dueDate: "2026-11-01" }));
    assert.equal(await deliverDueNotices(after(DUE_NOTIFY_DELAY_MS + 30_000)), 0);
    assert.equal((await dueNotices(task.id)).length, 0);
    assert.equal(await db.pendingDueNotice.count({ where: { taskId: task.id } }), 0);
  });

  test("tarea borrada o archivada: no se avisa", async () => {
    const a = await setup();
    expectOk(await updateTask(a.task.id, { dueDate: "2026-11-09" }));
    await db.task.delete({ where: { id: a.task.id } });
    assert.equal(await db.pendingDueNotice.count({ where: { taskId: a.task.id } }), 0); // cae en cascada
    assert.equal(await deliverDueNotices(after(DUE_NOTIFY_DELAY_MS + 30_000)), 0);

    const b = await setup();
    expectOk(await updateTask(b.task.id, { dueDate: "2026-11-09" }));
    await db.task.update({ where: { id: b.task.id }, data: { archivedAt: new Date() } });
    assert.equal(await deliverDueNotices(after(DUE_NOTIFY_DELAY_MS + 30_000)), 0);
    assert.equal((await dueNotices(b.task.id)).length, 0);
  });

  test("desasignada o reasignada: no se avisa a quien dejó de ser responsable", async () => {
    const { actor, f, task } = await setup();
    expectOk(await updateTask(task.id, { dueDate: "2026-11-09" }));
    const other = await makeUser();
    await db.projectMember.create({ data: { projectId: f.project.id, userId: other.id } });
    expectOk(await updateTask(task.id, { assigneeId: other.id }));
    assert.equal(await db.pendingDueNotice.count({ where: { taskId: task.id } }), 0);
    assert.equal(await deliverDueNotices(after(DUE_NOTIFY_DELAY_MS + 30_000)), 0);
    assert.deepEqual((await db.notification.findMany({ where: { taskId: task.id } })).map((n) => [n.type, n.userId]), [["ASSIGNED", other.id]]);

    // Desasignada directamente en BD con una fila pendiente: tampoco sale.
    await db.pendingDueNotice.create({ data: { taskId: task.id, recipientId: other.id, actorId: actor.id, fromDue: "2026-11-01", toDue: "2026-11-02", sendAfter: new Date() } });
    await db.task.update({ where: { id: task.id }, data: { assigneeId: null } });
    assert.equal(await deliverDueNotices(after(DUE_NOTIFY_DELAY_MS)), 0);
  });

  test("si la persona asignada cambia la fecha, se descarta lo pendiente", async () => {
    const { assignee, task } = await setup();
    expectOk(await updateTask(task.id, { dueDate: "2026-11-09" }));
    await loginAs(assignee);
    expectOk(await updateTask(task.id, { dueDate: "2026-11-20" }));
    assert.equal(await deliverDueNotices(after(DUE_NOTIFY_DELAY_MS + 30_000)), 0);
    assert.equal((await dueNotices(task.id)).length, 0);
  });
});
