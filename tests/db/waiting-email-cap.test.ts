// Tope de envíos externos por hora: los recordatorios de «Esperando» (del sistema) cuentan por destinatario, así que
// muchos recordatorios a una persona no dejan sin email a las demás; los avisos de una persona siguen con tope por autor.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { db, makeProject, makeTask, makeUser } from "./helpers";
import { notifyTask } from "../../src/lib/notify";
import { deliverWaitingReminders } from "../../src/lib/waiting";

const DAY = 86_400_000;

async function withOutbox<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pz-outbox-"));
  const prev = process.env.MAIL_OUTBOX_DIR;
  process.env.MAIL_OUTBOX_DIR = dir;
  try {
    return await fn();
  } finally {
    process.env.MAIL_OUTBOX_DIR = prev ?? "";
    await rm(dir, { recursive: true, force: true });
  }
}

const emailed = async (userId: string, type: "WAITING" | "MENTION") => {
  const rows = await db.notification.findMany({ where: { userId, type }, select: { emailSentAt: true } });
  return { total: rows.length, sent: rows.filter((r) => r.emailSentAt).length };
};

describe("tope de emails por hora", () => {
  test("recordatorios de «Esperando»: con más de 40 para una persona, las demás siguen recibiendo el suyo", async () => {
    // deliverWaitingReminders reparte las de todas las tareas: se descartan los restos de otros tests.
    await db.task.updateMany({ where: { waitingNotifiedAt: null }, data: { waitingNotifiedAt: new Date() } });
    const busy = await makeUser();
    const other = await makeUser();
    const f = await makeProject({ members: [busy, other] });
    await db.column.update({ where: { id: f.columns.doing }, data: { role: "WAITING" } });
    // 42 tareas de la persona ocupada, más antiguas (se procesan antes) que las 2 de la otra.
    const old = new Date(Date.now() - 20 * DAY);
    await db.task.createMany({
      data: Array.from({ length: 42 }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.doing, title: `Espera ${i}`, kindId: f.kindId, position: 1000 + i, assigneeId: busy.id, columnEnteredAt: old })),
    });
    for (let i = 0; i < 2; i++) {
      const t = await makeTask(f, { columnId: f.columns.doing, position: 5000 + i });
      await db.task.update({ where: { id: t.id }, data: { assigneeId: other.id, columnEnteredAt: new Date(Date.now() - 10 * DAY) } });
    }
    const sent = await withOutbox(() => deliverWaitingReminders(new Date()));
    assert.equal(sent, 44, "en la app se avisa siempre");
    assert.deepEqual(await emailed(busy.id, "WAITING"), { total: 42, sent: 40 });
    assert.deepEqual(await emailed(other.id, "WAITING"), { total: 2, sent: 2 });
  });

  test("avisos de una persona: el tope sigue siendo por autor", async () => {
    const author = await makeUser();
    const people = await Promise.all(Array.from({ length: 42 }, () => makeUser()));
    const f = await makeProject({ members: [author, ...people] });
    const task = await makeTask(f, { createdById: author.id });
    await withOutbox(() => notifyTask({ type: "MENTION", actorId: author.id, taskId: task.id, projectId: f.project.id, recipientIds: people.map((p) => p.id), excerpt: "x", immediate: true }));
    const counts = await Promise.all(people.map((p) => emailed(p.id, "MENTION")));
    assert.equal(counts.reduce((n, c) => n + c.total, 0), 42);
    assert.equal(counts.reduce((n, c) => n + c.sent, 0), 40);
  });
});
