// «Notificaciones por email» simplificadas (v1.79), contra PostgreSQL real: la conversión de las cuentas existentes, lo que
// llega al momento y en el resumen, la casilla principal apagada, los emails de administración y la baja desde el email.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { updateEmailPrefs } from "../../src/actions/collab-prefs";
import { addComment } from "../../src/actions/tasks";
import { sendProjectAddedMail } from "../../src/lib/auth-mail";
import { afterDone, asUser, db, expectOk, makeProject, makeTask, makeUser } from "./helpers";
import { mentionToken } from "../../src/lib/mentions";
import { deliver, emailWanted, notifyReportUnsubscribed, notifyShareRevoked } from "../../src/lib/notify";
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
    // Todas las sentencias UPDATE de la migración (sean las que sean), de «UPDATE» a su «;».
    const updates = [...sql.matchAll(/^UPDATE[^;]*;/gm)].map((m) => m[0]);
    assert.ok(updates.length > 0);
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
    // Con resumen y menciones marcadas (recibía los emails al momento además del resumen): ahora solo en el resumen.
    const digestAndMentions = await mk({ notifyEmail: true, notifyAssignedEmail: false, notifyDueEmail: false, notifyCommentEmail: false, dailyDigest: true });
    // noteMentionEmail (v1.77) no se convierte: las menciones quedan como estaban en notifyEmail, sea cual sea la opción de notas.
    const noteOffMentions = await mk({ notifyEmail: true, noteMentionEmail: "OFF", notifyAssignedEmail: false, notifyDueEmail: false, notifyCommentEmail: false, dailyDigest: false });
    const noteNowNoMentions = await mk({ notifyEmail: false, noteMentionEmail: "NOW", notifyAssignedEmail: false, notifyDueEmail: false, notifyCommentEmail: false, dailyDigest: false });
    // Administrador y no administrador se convierten igual (la casilla de administración es de todos).
    const adminRole = await makeUser({ role: "ADMIN" });
    await db.user.update({ where: { id: adminRole.id }, data: { emailNotices: true, notifyAdminEmail: true, notifyEmail: false, notifyAssignedEmail: false, notifyDueEmail: false, notifyCommentEmail: false, dailyDigest: false } });
    const ids = [mentionsOnly, nothing, digestOnly, dueOnly, digestAndMentions, noteOffMentions, noteNowNoMentions, adminRole.id];
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
    // Resumen con menciones: sigue en resumen, con las menciones y la administración como estaban.
    assert.deepEqual([by(digestAndMentions).emailNotices, by(digestAndMentions).dailyDigest, by(digestAndMentions).notifyEmail, by(digestAndMentions).notifyAdminEmail], [true, true, true, true]);
    // noteMentionEmail se ignora: «No» en notas con menciones marcadas deja las menciones; «Al momento» en notas sin menciones, nada.
    assert.deepEqual([by(noteOffMentions).emailNotices, by(noteOffMentions).notifyEmail], [true, true]);
    assert.deepEqual([by(noteNowNoMentions).emailNotices, by(noteNowNoMentions).notifyEmail, by(noteNowNoMentions).notifyAdminEmail], [false, false, false]);
    // Una administradora con las menciones apagadas: la administración (que viajaba con notifyEmail) se copia, apagada.
    assert.deepEqual([by(adminRole.id).notifyAdminEmail, by(adminRole.id).notifyEmail], [false, false]);
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
    assert.ok(!d.comments.some((i) => i.taskId === task.id), "el comentario con la mención no se repite en «Comentarios»");
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

describe("revisión de «Avisos por email» (vuelta 2)", () => {
  const prep = async (prefs: Record<string, unknown>) => {
    const u = await makeUser();
    await db.user.update({ where: { id: u.id }, data: { emailNotices: true, notifyAdminEmail: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, dailyDigest: false, ...prefs } });
    return db.user.findUniqueOrThrow({ where: { id: u.id } });
  };

  test("«te han añadido al proyecto»: su enlace de baja es el de administración, no el de menciones", async () => {
    const u = await prep({});
    await sendProjectAddedMail(u, "Ana", "Proyecto X", "https://pizarro.test/p/x");
    const m = (await mails()).find((x) => x.to === u.email);
    assert.ok(m, "se envía");
    const token = /\/unsubscribe\/([A-Za-z0-9_.-]+)/.exec(m.text)?.[1];
    assert.ok(token?.startsWith("x"), `baja de administración (x), no ${token?.slice(0, 1)}`);
    assert.equal((await applyUnsubscribe(token!, "page", "127.0.0.1"))?.changed, true);
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { notifyAdminEmail: true, notifyEmail: true } });
    assert.deepEqual(row, { notifyAdminEmail: false, notifyEmail: true });
  });

  test("quien no es administrador recibe los avisos importantes y los apaga con su casilla, sin tocar las menciones", async () => {
    const setter = await prep({});
    const generator = await prep({});
    const quiet = await prep({ notifyAdminEmail: false });
    const f = await makeProject({ members: [setter, generator, quiet] });
    const a = await notifyReportUnsubscribed(f.project.id, setter.id, "Ex Destinatario");
    const b = await notifyShareRevoked(f.project.id, generator.id, "Otra Persona", "Columna");
    const c = await notifyReportUnsubscribed(f.project.id, quiet.id, "Ex Destinatario");
    await afterDone();
    assert.ok(a && b && c);
    const to = (await mails()).map((m) => m.to);
    assert.ok(to.includes(setter.email) && to.includes(generator.email));
    assert.ok(!to.includes(quiet.email), "con su casilla apagada no sale (sigue en la campana)");
    assert.equal(await db.notification.count({ where: { userId: quiet.id, type: "REPORT_UNSUBSCRIBED" } }), 1);
  });

  test("collab-prefs: un miembro guarda «Avisos importantes» y se acepta (e ignora) noteMentionEmail", async () => {
    const u = await prep({});
    const base = { notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, dailyDigest: false, digestHour: 8 };
    await asUser(u, async () => expectOk(await updateEmailPrefs({ ...base, emailNotices: true, notifyAdminEmail: false, noteMentionEmail: "OFF" })));
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { notifyAdminEmail: true, noteMentionEmail: true } });
    assert.deepEqual(row, { notifyAdminEmail: false, noteMentionEmail: null });
  });

  test("resumen: cambios de fecha y recordatorios de «Esperando» llegan en su sección, solo con la casilla de fechas", async () => {
    const author = await makeUser();
    const reader = await prep({ dailyDigest: true });
    const f = await makeProject({ members: [author, reader] });
    const task = await makeTask(f, { createdById: author.id });
    await db.notification.createMany({ data: [
      { userId: reader.id, actorId: author.id, taskId: task.id, type: "DUE_CHANGED", excerpt: "x" },
      { userId: reader.id, actorId: null, taskId: task.id, type: "WAITING", excerpt: "y" },
    ] });
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const d = await gatherDigest(reader, now, today);
    assert.deepEqual(d.changes?.map((i) => [i.taskId, i.count]), [[task.id, 2]]);
    const without = await gatherDigest({ ...reader, notifyDueEmail: false }, now, today);
    assert.deepEqual(without.changes, []);
    // Y no sale al momento con resumen diario.
    assert.equal(emailWanted("DUE_CHANGED", reader), false);
    assert.equal(emailWanted("WAITING", reader), false);
  });

  test("resumen: los comentarios son solo de tareas que sigue y no repiten los que ya salen en menciones", async () => {
    const author = await makeUser();
    const reader = await prep({ dailyDigest: true });
    const f = await makeProject({ members: [author, reader] });
    const followed = await makeTask(f, { createdById: reader.id });
    const notFollowed = await makeTask(f, { createdById: author.id });
    const muted = await makeTask(f, { createdById: reader.id });
    await db.taskFollower.create({ data: { taskId: muted.id, userId: reader.id, muted: true } });
    const explicit = await makeTask(f, { createdById: author.id });
    await db.taskFollower.create({ data: { taskId: explicit.id, userId: reader.id, muted: false } });
    const mentioned = await makeTask(f, { createdById: reader.id });
    for (const t of [followed, notFollowed, muted, explicit, mentioned]) {
      await db.taskComment.create({ data: { taskId: t.id, authorId: author.id, body: "hola" } });
    }
    // En «mentioned», un comentario con mención (ya sale en menciones) y otro sin ella.
    const withMention = await db.taskComment.create({ data: { taskId: mentioned.id, authorId: author.id, body: "con mención" } });
    await db.notification.create({ data: { userId: reader.id, actorId: author.id, taskId: mentioned.id, commentId: withMention.id, type: "MENTION", excerpt: "m" } });
    const now = new Date();
    const d = await gatherDigest(reader, now, now.toISOString().slice(0, 10));
    assert.deepEqual(new Set(d.comments.map((i) => i.taskId)), new Set([followed.id, explicit.id, mentioned.id]));
    assert.equal(d.comments.find((i) => i.taskId === mentioned.id)?.count, 1, "el comentario con mención no se cuenta otra vez");
    assert.deepEqual(d.mentions?.map((i) => i.taskId), [mentioned.id]);
  });
});
