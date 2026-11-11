// Avisos de cambio de fecha agrupados (debounce): varios cambios seguidos → un único aviso con la fecha final.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { updateTask } from "../../src/actions/tasks";
import { DUE_NOTICE_CLAIM_MS, DUE_NOTICE_GIVE_UP_MS, DUE_NOTIFY_DELAY_MS, deliverDueNotices, queueDueChange } from "../../src/lib/due-notices";
import { flushLogs } from "../../src/lib/log";
import { notifyTask } from "../../src/lib/notify";

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

  test("si el aviso falla, la fila no se pierde: queda reclamada y se reintenta al pasar el reclamo", async () => {
    const { assignee, task } = await setup();
    expectOk(await updateTask(task.id, { dueDate: "2026-11-15" }));
    const due = after(DUE_NOTIFY_DELAY_MS + 30_000);
    let calls = 0;
    const failing: typeof notifyTask = async () => {
      calls++;
      throw new Error("fallo simulado (SMTP caído, proceso detenido…)");
    };
    assert.equal(await deliverDueNotices(due, failing), 0);
    assert.equal(calls, 1);
    const claimed = await db.pendingDueNotice.findFirstOrThrow({ where: { taskId: task.id } });
    assert.equal(claimed.sendAfter.getTime(), due.getTime() + DUE_NOTICE_CLAIM_MS);
    // Mientras dura el reclamo, otra pasada (u otro proceso) no la toca.
    assert.equal(await deliverDueNotices(new Date(due.getTime() + 60_000), failing), 0);
    assert.equal(calls, 1);
    // Pasado el reclamo se envía (una vez) y se borra.
    assert.equal(await deliverDueNotices(new Date(due.getTime() + DUE_NOTICE_CLAIM_MS + 1000)), 1);
    const got = await dueNotices(task.id);
    assert.deepEqual(got.map((n) => [n.userId, n.excerpt]), [[assignee.id, "2026-11-01>2026-11-15"]]);
    assert.equal(await db.pendingDueNotice.count({ where: { taskId: task.id } }), 0);
  });

  test("un cambio de fecha mientras se envía no se borra con la fila reclamada: sale después con la fecha nueva", async () => {
    const { actor, assignee, task } = await setup();
    expectOk(await updateTask(task.id, { dueDate: "2026-11-15" }));
    const due = after(DUE_NOTIFY_DELAY_MS + 30_000);
    const racing: typeof notifyTask = async (opts) => {
      const r = await notifyTask(opts);
      // Justo entonces alguien vuelve a mover la fecha (como haría updateTask).
      await db.task.update({ where: { id: task.id }, data: { dueDate: new Date("2026-11-20T00:00:00Z") } });
      await queueDueChange({ taskId: task.id, recipientId: assignee.id, actorId: actor.id, from: "2026-11-15", to: "2026-11-20", now: due });
      return r;
    };
    assert.equal(await deliverDueNotices(due, racing), 1);
    const pending = await db.pendingDueNotice.findFirstOrThrow({ where: { taskId: task.id } });
    assert.equal(pending.toDue, "2026-11-20");
    assert.equal(await deliverDueNotices(new Date(due.getTime() + DUE_NOTICE_CLAIM_MS + 1000)), 1);
    assert.deepEqual((await dueNotices(task.id)).map((n) => n.excerpt).sort(), ["2026-11-01>2026-11-15", "2026-11-01>2026-11-20"]);
    assert.equal(await db.pendingDueNotice.count({ where: { taskId: task.id } }), 0);
  });

  test("una fila que lleva más de un día fallando desde su primer intento se descarta sin avisar", async () => {
    const { actor, assignee, task } = await setup();
    const start = after(DUE_NOTIFY_DELAY_MS + 30_000);
    await db.pendingDueNotice.create({
      data: { taskId: task.id, recipientId: assignee.id, actorId: actor.id, fromDue: "2026-10-01", toDue: "2026-11-01", sendAfter: new Date(start.getTime() - 60_000) },
    });
    let calls = 0;
    const failing: typeof notifyTask = async () => {
      calls++;
      throw new Error("fallo simulado");
    };
    assert.equal(await deliverDueNotices(start, failing), 0);
    const claimed = await db.pendingDueNotice.findFirstOrThrow({ where: { taskId: task.id } });
    assert.equal(claimed.claimedAt?.getTime(), start.getTime(), "el primer reclamo queda anotado");
    // Los reintentos no lo mueven.
    assert.equal(await deliverDueNotices(new Date(start.getTime() + DUE_NOTICE_CLAIM_MS + 1000), failing), 0);
    assert.equal(calls, 2);
    assert.equal((await db.pendingDueNotice.findFirstOrThrow({ where: { taskId: task.id } })).claimedAt?.getTime(), start.getTime());
    // Más de un día después del primer intento: se descarta sin llamar a notify y queda en el registro.
    const late = new Date(start.getTime() + DUE_NOTICE_GIVE_UP_MS + 60_000);
    assert.equal(await deliverDueNotices(late, failing), 0);
    assert.equal(calls, 2);
    assert.equal(await db.pendingDueNotice.count({ where: { taskId: task.id } }), 0);
    await flushLogs();
    const log = await db.appLog.findFirst({ where: { action: "notify.dueGaveUp", details: { path: ["taskId"], equals: task.id } } });
    assert.match(log?.message ?? "", /más de un día fallando desde el primer intento/);
  });

  test("tras un apagado de más de un día, los avisos que esperaban se envían (el plazo cuenta desde el primer intento)", async () => {
    const { actor, assignee, task } = await setup();
    // Cambio de fecha hace dos días; el servidor estuvo apagado y nunca llegó a intentarlo.
    const changed = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    await db.task.update({ where: { id: task.id }, data: { dueDate: new Date("2026-11-20T00:00:00Z") } });
    await db.pendingDueNotice.create({
      data: { taskId: task.id, recipientId: assignee.id, actorId: actor.id, fromDue: "2026-11-01", toDue: "2026-11-20", sendAfter: new Date(changed.getTime() + DUE_NOTIFY_DELAY_MS), createdAt: changed },
    });
    assert.equal(await deliverDueNotices(new Date()), 1);
    assert.deepEqual((await dueNotices(task.id)).map((n) => [n.userId, n.excerpt]), [[assignee.id, "2026-11-01>2026-11-20"]]);
    assert.equal(await db.pendingDueNotice.count({ where: { taskId: task.id } }), 0);
  });

  test("un cambio de fecha nuevo reinicia el plazo de reintentos", async () => {
    const { actor, assignee, task } = await setup();
    expectOk(await updateTask(task.id, { dueDate: "2026-11-15" }));
    const due = after(DUE_NOTIFY_DELAY_MS + 30_000);
    assert.equal(await deliverDueNotices(due, async () => { throw new Error("fallo simulado"); }), 0);
    assert.ok((await db.pendingDueNotice.findFirstOrThrow({ where: { taskId: task.id } })).claimedAt);
    await queueDueChange({ taskId: task.id, recipientId: assignee.id, actorId: actor.id, from: "2026-11-15", to: "2026-11-18", now: due });
    assert.equal((await db.pendingDueNotice.findFirstOrThrow({ where: { taskId: task.id } })).claimedAt, null);
  });
});
