// Resumen diario por email, contra PostgreSQL real: lo que entra en cada apartado.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser, waitForLockWaiter } from "./helpers";
import { updateEmailPrefs } from "../../src/actions/collab-prefs";
import { gatherDigest, sendDueDigests } from "../../src/lib/periodic-mail";
import { resetShutdownForTests, runShutdown } from "../../src/lib/shutdown";
import { digestDue } from "../../src/lib/schedule";

describe("resumen diario", () => {
  test("«Tareas nuevas» no incluye las que creó la propia persona", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const f = await makeProject({ members: [user, other] });
    await makeTask(f, { title: "Mía", createdById: user.id });
    await makeTask(f, { title: "De otra persona", createdById: other.id });
    await makeTask(f, { title: "Sin autor", createdById: null });
    const now = new Date();
    const d = await gatherDigest({ id: user.id, role: "MEMBER" }, now, now.toISOString().slice(0, 10));
    assert.deepEqual(d.created.filter((x) => x.projectId === f.project.id).map((x) => x.title).sort(), ["De otra persona", "Sin autor"]);
  });

  // Antes, una tarea terminada y archivada antes del envío desaparecía de «Terminadas» (se filtraba por archivedAt).
  test("«Terminadas» incluye las que se terminaron y luego se archivaron, pero no las de proyectos ajenos", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const f = await makeProject({ members: [user, other] });
    const foreign = await makeProject({ visibility: "PRIVATE", owner: other, members: [other] });
    const done = async (fx: typeof f, title: string, archived: boolean) => {
      const task = await makeTask(fx, { title, columnId: fx.columns.done });
      await db.taskEvent.create({ data: { taskId: task.id, projectId: fx.project.id, userId: other.id, userName: "Otra", code: "done", label: "Terminó la tarea" } });
      if (archived) await db.task.update({ where: { id: task.id }, data: { archivedAt: new Date(), archivedFromColumnId: fx.columns.done } });
    };
    await done(f, "Terminada", false);
    await done(f, "Terminada y archivada", true);
    await done(foreign, "De un proyecto ajeno", true);
    const now = new Date();
    const d = await gatherDigest({ id: user.id, role: "MEMBER" }, now, now.toISOString().slice(0, 10));
    assert.deepEqual(d.done.filter((x) => [f.project.id, foreign.project.id].includes(x.projectId)).map((x) => x.title).sort(), ["Terminada", "Terminada y archivada"]);
  });
});

describe("preferencias del resumen diario", () => {
  const prefs = { notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true };
  test("ni cambiar la hora tras recibirlo ni desactivarlo y volver a activarlo reinician el «ya enviado hoy»", async () => {
    const user = await makeUser();
    await loginAs(user);
    const sent = new Date();
    await db.user.update({ where: { id: user.id }, data: { dailyDigest: true, digestHour: 7, lastDigestAt: sent } });
    expectOk(await updateEmailPrefs({ ...prefs, dailyDigest: true, digestHour: 20 }));
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { digestHour: true, lastDigestAt: true } });
    assert.equal(after.digestHour, 20);
    assert.equal(after.lastDigestAt?.getTime(), sent.getTime(), "no llega otro resumen con lo mismo el mismo día");
    expectOk(await updateEmailPrefs({ ...prefs, dailyDigest: false, digestHour: 20 }));
    expectOk(await updateEmailPrefs({ ...prefs, dailyDigest: true, digestHour: 20 }));
    // Desactivarlo y volver a activarlo el mismo día no lo reinicia (antes llegaba otro resumen igual).
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).lastDigestAt?.getTime(), sent.getTime());
  });

  test("activarlo por primera vez, o con un envío de otro día, lo deja pendiente", async () => {
    const now = new Date();
    for (const last of [null, new Date(now.getTime() - 3 * 86_400_000)]) {
      const user = await makeUser();
      await loginAs(user);
      await db.user.update({ where: { id: user.id }, data: { dailyDigest: false, lastDigestAt: last } });
      expectOk(await updateEmailPrefs({ ...prefs, dailyDigest: true, digestHour: 0 }));
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { dailyDigest: true, digestHour: true, lastDigestAt: true } });
      assert.equal(row.dailyDigest, true);
      assert.equal(digestDue(now, "UTC", { hour: row.digestHour, lastSentAt: row.lastDigestAt }), true, String(last));
    }
  });
});

describe("resumen diario y apagado ordenado", () => {
  // Antes se reservaba el día (lastDigestAt) y se reunían los datos fuera del trabajo en curso: un reinicio a mitad salía
  // sin esperar y ese día no llegaba resumen.
  test("el apagado espera al resumen que se está preparando y no reserva ninguno más", async () => {
    const outbox = await mkdtemp(path.join(tmpdir(), "pz-digest-outbox-"));
    const prevOutbox = process.env.MAIL_OUTBOX_DIR;
    process.env.MAIL_OUTBOX_DIR = outbox;
    let release!: () => void;
    let lockTx: Promise<unknown> | null = null;
    try {
      const a = await makeUser();
      const b = await makeUser();
      const other = await makeUser();
      const f = await makeProject({ members: [a, b, other] });
      await makeTask(f, { title: "Novedad", createdById: other.id });
      // Solo estas dos personas tienen el resumen pendiente (las de otras pruebas, no).
      await db.user.updateMany({ where: { id: { notIn: [a.id, b.id] } }, data: { dailyDigest: false } });
      await db.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { dailyDigest: true, digestHour: 0, lastDigestAt: null } });
      // Con «Task» bloqueada, el primer resumen se queda reuniendo los datos (ya reservado).
      const locked = new Promise<void>((resolve) => (release = resolve));
      let lockedReady!: () => void;
      const ready = new Promise<void>((r) => (lockedReady = r));
      lockTx = db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`LOCK TABLE "Task" IN ACCESS EXCLUSIVE MODE`);
        lockedReady();
        await locked;
      }, { timeout: 30_000 });
      await ready;
      const now = new Date();
      const pass = sendDueDigests(now);
      await waitForLockWaiter();
      const exits: number[] = [];
      const shutdown = runShutdown("SIGTERM", {
        flushLogs: async () => {},
        logEvent: () => {},
        closeStreams: () => 0,
        stopListening: async () => ({ closed: 1, drained: async () => 0 }),
        exit: (code) => void exits.push(code),
        graceMs: 15_000,
        flushMs: 100,
      });
      await new Promise((r) => setTimeout(r, 300));
      assert.deepEqual(exits, [], "el apagado espera al resumen en curso");
      release();
      await lockTx;
      assert.equal(await pass, 1);
      await shutdown;
      assert.deepEqual(exits, [143]);
      const rows = await db.user.findMany({ where: { id: { in: [a.id, b.id] } }, select: { email: true, lastDigestAt: true } });
      const sent = rows.filter((r) => r.lastDigestAt?.getTime() === now.getTime());
      assert.equal(sent.length, 1, "uno enviado");
      assert.equal(rows.filter((r) => r.lastDigestAt === null).length, 1, "el otro, sin reservar: sale en el proceso nuevo");
      const mails = (await readdir(outbox)).filter((n) => n.endsWith(".json"));
      assert.equal(mails.length, 1);
      assert.equal(JSON.parse(await readFile(path.join(outbox, mails[0]!), "utf8")).to, sent[0]!.email);
    } finally {
      release?.();
      await lockTx?.catch(() => {});
      resetShutdownForTests();
      if (prevOutbox === undefined) delete process.env.MAIL_OUTBOX_DIR;
      else process.env.MAIL_OUTBOX_DIR = prevOutbox;
      await rm(outbox, { recursive: true, force: true });
    }
  });
});

describe("email del resumen diario", () => {
  test("asunto con tareas distintas, «desde el último resumen» y pie en el idioma de la persona", async () => {
    const outbox = await mkdtemp(path.join(tmpdir(), "pz-digest-mail-"));
    const prevOutbox = process.env.MAIL_OUTBOX_DIR;
    process.env.MAIL_OUTBOX_DIR = outbox;
    try {
      const user = await makeUser();
      const other = await makeUser();
      const f = await makeProject({ members: [user, other] });
      // Una tarea suya, asignada hoy y ya vencida: sale en dos secciones, pero es una sola.
      const task = await makeTask(f, { title: "Vencida y asignada", createdById: user.id, dueDate: new Date(Date.now() - 3 * 86_400_000) });
      await db.task.update({ where: { id: task.id }, data: { assigneeId: user.id } });
      await db.notification.create({ data: { userId: user.id, actorId: other.id, taskId: task.id, type: "ASSIGNED", excerpt: "Vencida y asignada" } });
      const now = new Date();
      await db.user.updateMany({ where: { id: { not: user.id } }, data: { dailyDigest: false } });
      // Hace 26 h: siempre otro día en la zona de la app (con 20 h, de 20:00 a medianoche era «hoy» y no tocaba).
      await db.user.update({ where: { id: user.id }, data: { locale: "EN", dailyDigest: true, digestHour: 0, lastDigestAt: new Date(now.getTime() - 26 * 3_600_000) } });
      assert.equal(await sendDueDigests(now), 1);
      const files = (await readdir(outbox)).filter((n) => n.endsWith(".json"));
      assert.equal(files.length, 1);
      const mail = JSON.parse(await readFile(path.join(outbox, files[0]!), "utf8")) as { subject: string; text: string; html: string; headers: Record<string, string> };
      assert.match(mail.subject, /\(1\)$/, "antes salía (2): la tarea contaba en «Asignadas» y en «Vencidas»");
      assert.match(mail.text, /since the last summary\./);
      assert.ok(mail.text.includes("Don't reply to this email: reply in Pizarro."), mail.text);
      assert.match(mail.html, /Don(&#39;|&#x27;|')t reply to this email: reply in Pizarro\./);
      assert.equal(mail.headers["Auto-Submitted"], "auto-generated");
    } finally {
      if (prevOutbox === undefined) delete process.env.MAIL_OUTBOX_DIR;
      else process.env.MAIL_OUTBOX_DIR = prevOutbox;
      await rm(outbox, { recursive: true, force: true });
    }
  });
});
