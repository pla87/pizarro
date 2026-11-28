// «Notificaciones por email» simplificadas (v1.79), contra PostgreSQL real: la conversión de las cuentas existentes, lo que
// llega al momento y en el resumen, la casilla principal apagada, los emails de administración y la baja desde el email.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { addComment } from "../../src/actions/tasks";
import { afterDone, asUser, db, expectOk, makeProject, makeTask, makeUser } from "./helpers";
import { mentionToken } from "../../src/lib/mentions";
import { deliver } from "../../src/lib/notify";
import { gatherDigest, sendDueDigests } from "../../src/lib/periodic-mail";
import { applyUnsubscribe } from "../../src/lib/unsubscribe";
import { unsubscribeToken } from "../../src/lib/unsubscribe-core";

let outbox = "";
const prevOutbox = process.env.MAIL_OUTBOX_DIR;
before(async () => {
  outbox = await mkdtemp(path.join(tmpdir(), "pz-emailprefs-"));
  process.env.MAIL_OUTBOX_DIR = outbox;
});
after(async () => {
  if (prevOutbox === undefined) delete process.env.MAIL_OUTBOX_DIR;
  else process.env.MAIL_OUTBOX_DIR = prevOutbox;
  await rm(outbox, { recursive: true, force: true });
});
const clearOutbox = async () => {
  for (const f of await readdir(outbox)) await rm(path.join(outbox, f), { force: true });
};
beforeEach(clearOutbox);
type Mail = { to: string; subject: string; text: string };
async function mails(): Promise<Mail[]> {
  const files = (await readdir(outbox)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(outbox, f), "utf8")) as Mail));
}
const at = (u: { id: string; name: string }) => mentionToken(u.name, u.id);

describe("conversión de las cuentas existentes (migración 20261210100000)", () => {
  test("casilla principal, administración y resumen: nadie recibe lo que no recibía ni pierde lo que tenía", async () => {
    const sql = await readFile(path.join(process.cwd(), "prisma/migrations/20261210100000_avisos_email_simples/migration.sql"), "utf8");
    const updates = sql.split("\n").filter((l) => l.startsWith("UPDATE"));
    assert.equal(updates.length, 3);
    // Estado anterior a la migración de cuatro personas, escrito a mano (las columnas nuevas se vuelven a calcular).
    const mk = async (data: Record<string, unknown>) => {
      const u = await makeUser();
      await db.user.update({ where: { id: u.id }, data: { emailNotices: true, notifyAdminEmail: true, ...data } });
      return u.id;
    };
    const mentionsOnly = await mk({ notifyEmail: true, notifyAssignedEmail: false, notifyDueEmail: false, notifyCommentEmail: false, dailyDigest: false });
    const nothing = await mk({ notifyEmail: false, notifyAssignedEmail: false, notifyDueEmail: false, notifyCommentEmail: false, dailyDigest: false });
    const digestOnly = await mk({ notifyEmail: false, notifyAssignedEmail: false, notifyDueEmail: false, notifyCommentEmail: false, dailyDigest: true });
    const dueOnly = await mk({ notifyEmail: false, notifyAssignedEmail: false, notifyDueEmail: true, notifyCommentEmail: false, dailyDigest: false });
    const ids = [mentionsOnly, nothing, digestOnly, dueOnly];
    // Las mismas sentencias de la migración, acotadas a estas cuatro cuentas (en una transacción que se deshace).
    const sentinel = new Error("rollback");
    const rows = await db
      .$transaction(async (tx) => {
        for (const stmt of updates) {
          const body = stmt.replace(/;$/, "");
          const bounded = body.includes(" WHERE ") ? `${body} AND "id" = ANY($1::text[])` : `${body} WHERE "id" = ANY($1::text[])`;
          await tx.$executeRawUnsafe(bounded, ids);
        }
        const out = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, emailNotices: true, notifyAdminEmail: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, dailyDigest: true } });
        throw Object.assign(sentinel, { out });
      })
      .catch((e) => {
        if (e !== sentinel) throw e;
        return (e as unknown as { out: Record<string, unknown>[] }).out;
      });
    const by = (id: string) => rows.find((r) => r.id === id) as Record<string, unknown>;
    // Solo menciones: casilla principal marcada y administración como estaba (con las menciones).
    assert.deepEqual([by(mentionsOnly).emailNotices, by(mentionsOnly).notifyAdminEmail, by(mentionsOnly).dailyDigest], [true, true, false]);
    // Sin ningún email: casilla principal desmarcada y sin administración (no empieza a recibir nada).
    assert.deepEqual([by(nothing).emailNotices, by(nothing).notifyAdminEmail], [false, false]);
    // Solo el resumen: lo sigue recibiendo, con lo que ya traía (asignaciones, fechas y comentarios), y sigue en «Resumen diario».
    assert.deepEqual([by(digestOnly).emailNotices, by(digestOnly).dailyDigest, by(digestOnly).notifyAssignedEmail, by(digestOnly).notifyDueEmail, by(digestOnly).notifyCommentEmail], [true, true, true, true, true]);
    // Solo fechas (sin resumen): sigue al momento y no se marca nada más.
    assert.deepEqual([by(dueOnly).emailNotices, by(dueOnly).notifyAdminEmail, by(dueOnly).notifyAssignedEmail, by(dueOnly).notifyCommentEmail], [true, false, false, false]);
  });
});

describe("envío al momento y en el resumen", () => {
  async function setup(prefs: Record<string, unknown>) {
    const author = await makeUser({ name: "Autora Aviso" });
    const reader = await makeUser({ name: "Lector Aviso" });
    await db.user.update({ where: { id: reader.id }, data: { emailNotices: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, dailyDigest: false, ...prefs } });
    const f = await makeProject({ members: [author, reader] });
    const task = await makeTask(f);
    return { author, reader, f, task };
  }
  const mention = async (author: { id: string; name: string }, reader: { id: string; name: string }, taskId: string) => {
    await asUser(author, async () => expectOk(await addComment(taskId, `Hola ${at(reader)}`)));
    await afterDone();
  };

  test("«Al momento»: salen las menciones marcadas; con la casilla principal apagada, nada", async () => {
    const on = await setup({});
    await mention(on.author, on.reader, on.task.id);
    assert.equal((await mails()).filter((m) => m.to === on.reader.email).length, 1);
    await clearOutbox();
    const off = await setup({ emailNotices: false });
    await mention(off.author, off.reader, off.task.id);
    assert.equal((await mails()).filter((m) => m.to === off.reader.email).length, 0);
    // En la campana, siempre.
    assert.equal(await db.notification.count({ where: { userId: off.reader.id, type: "MENTION" } }), 1);
  });

  test("«Resumen diario»: nada al momento y el resumen trae lo marcado", async () => {
    const { author, reader, f, task } = await setup({ dailyDigest: true, digestHour: 0, lastDigestAt: null, notifyAssignedEmail: false, notifyDueEmail: false, notifyCommentEmail: true });
    await mention(author, reader, task.id);
    assert.equal((await mails()).filter((m) => m.to === reader.email).length, 0, "con resumen diario no sale al momento");
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const prefs = await db.user.findUniqueOrThrow({ where: { id: reader.id }, select: { id: true, role: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true } });
    const d = await gatherDigest(prefs, now, today);
    assert.deepEqual(d.mentions?.map((i) => i.taskId), [task.id]);
    assert.ok(d.comments.some((i) => i.taskId === task.id), "el comentario con la mención cuenta en los comentarios marcados");
    // Sin las menciones marcadas, el resumen no las trae; sin asignaciones ni fechas marcadas, tampoco.
    const without = await gatherDigest({ ...prefs, notifyEmail: false }, now, today);
    assert.deepEqual([without.mentions, without.notes], [[], []]);
    const mine = await makeTask(f, { createdById: author.id });
    await db.task.update({ where: { id: mine.id }, data: { assigneeId: reader.id } });
    const none = await gatherDigest(prefs, now, today);
    assert.deepEqual([none.assigned, none.dueToday, none.overdue], [[], [], []]);
    const all = await gatherDigest({ ...prefs, notifyAssignedEmail: true }, now, today);
    assert.equal(all.assigned.length, 1);
  });

  test("el resumen solo se envía con la casilla principal y alguna de proyectos marcadas", async () => {
    const { reader, f } = await setup({ dailyDigest: true, digestHour: 0, lastDigestAt: null });
    await makeTask(f, { createdById: null });
    await db.user.updateMany({ where: { id: { not: reader.id }, dailyDigest: true }, data: { dailyDigest: false } });
    const mine = async () => (await mails()).filter((m) => m.to === reader.email && m.subject.includes("resumen diario")).length;
    await db.user.update({ where: { id: reader.id }, data: { emailNotices: false } });
    await sendDueDigests(new Date());
    assert.equal(await mine(), 0);
    await db.user.update({ where: { id: reader.id }, data: { emailNotices: true, notifyEmail: false, notifyAssignedEmail: false, notifyDueEmail: false, notifyCommentEmail: false } });
    await sendDueDigests(new Date());
    assert.equal(await mine(), 0);
    await db.user.update({ where: { id: reader.id }, data: { notifyDueEmail: true } });
    await sendDueDigests(new Date());
    assert.equal(await mine(), 1);
  });

  test("emails de administración: siempre al momento (también con resumen diario), con su casilla y la principal", async () => {
    const mkAdmin = async (prefs: Record<string, unknown>) => {
      const u = await makeUser({ role: "ADMIN" });
      await db.user.update({ where: { id: u.id }, data: { emailNotices: true, notifyAdminEmail: true, ...prefs } });
      return u;
    };
    const immediate = await mkAdmin({ notifyEmail: false });
    const inDigest = await mkAdmin({ dailyDigest: true });
    const noAdmin = await mkAdmin({ notifyAdminEmail: false });
    const noMaster = await mkAdmin({ emailNotices: false });
    const f = await makeProject({ members: [immediate, inDigest, noAdmin, noMaster] });
    const rows = await db.notification.createManyAndReturn({
      data: [immediate, inDigest, noAdmin, noMaster].map((u) => ({ userId: u.id, actorId: null, projectId: f.project.id, type: "PROJECT_TO_TEAM" as const, excerpt: "Lucía Baja" })),
      select: { id: true },
    });
    await deliver(rows.map((r) => r.id));
    assert.deepEqual((await mails()).map((m) => m.to).sort(), [immediate, inDigest].map((u) => u.email).sort());
  });

  test("baja desde el email de administración: apaga solo esa casilla", async () => {
    const u = await makeUser({ role: "ADMIN" });
    const { email } = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { email: true } });
    const res = await applyUnsubscribe(unsubscribeToken("admin", u.id, email), "page", "127.0.0.1");
    assert.equal(res?.changed, true);
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { notifyAdminEmail: true, notifyEmail: true, emailNotices: true } });
    assert.deepEqual(row, { notifyAdminEmail: false, notifyEmail: true, emailNotices: true });
  });
});
