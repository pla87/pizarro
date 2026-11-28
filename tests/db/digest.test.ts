// Resumen diario por email, contra PostgreSQL real: lo que entra en cada apartado.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { afterDone, db, expectOk, loginAs, makeProject, makeTask, makeUser, waitForLockWaiter, withSmtpDown } from "./helpers";
import { flushLogs } from "../../src/lib/log";
import { updateEmailPrefs } from "../../src/actions/collab-prefs";
import { gatherDigest, sendDueDigests } from "../../src/lib/periodic-mail";
import { createTasks } from "../../src/actions/tasks";
import { notifyAssigned } from "../../src/lib/column-assign";
import { buildDigest, digestEmail, emptyDigestInput } from "../../src/lib/digest";
import { makeT } from "../../src/i18n/core";
import pg from "pg";
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

/** Cuenta las consultas SQL mientras corre `fn` (como en calendar-feed.test.ts). */
async function countQueries<T>(fn: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const orig = proto.query;
  const sql: string[] = [];
  proto.query = function (this: unknown, ...args: unknown[]) {
    const q = args[0];
    sql.push(typeof q === "string" ? q : String((q as { text?: string } | undefined)?.text ?? ""));
    return orig.apply(this, args);
  };
  try {
    return { result: await fn(), sql };
  } finally {
    proto.query = orig;
  }
}

describe("resumen diario: «Asignadas a ti»", () => {
  const today = () => new Date().toISOString().slice(0, 10);
  const assignedOf = async (user: { id: string }, projectId: string) =>
    (await gatherDigest({ id: user.id, role: "MEMBER" }, new Date(), today())).assigned.filter((x) => x.projectId === projectId);

  // Antes salía la tarea aunque al rato se la hubieran pasado a otra persona (solo se miraban los avisos).
  test("solo las que siguen siendo de la persona", async () => {
    const [user, other, third] = [await makeUser(), await makeUser(), await makeUser()];
    const f = await makeProject({ members: [user, other, third] });
    const kept = await makeTask(f, { title: "Sigue siendo mía", createdById: other.id });
    const moved = await makeTask(f, { title: "Ya es de otra", createdById: other.id });
    for (const t of [kept, moved]) {
      await db.task.update({ where: { id: t.id }, data: { assigneeId: user.id } });
      await db.notification.create({ data: { userId: user.id, actorId: other.id, taskId: t.id, type: "ASSIGNED", excerpt: t.title } });
    }
    await db.task.update({ where: { id: moved.id }, data: { assigneeId: third.id } });
    assert.deepEqual((await assignedOf(user, f.project.id)).map((x) => x.title), ["Sigue siendo mía"]);
  });

  // Antes un lote de «Varias tareas» (un solo aviso, enlazado a la primera) salía como «Asignadas a ti: 1».
  test("«Varias tareas» asignadas a la persona salen todas, sin «y N más»", async () => {
    const [user, other] = [await makeUser(), await makeUser()];
    const f = await makeProject({ members: [user, other] });
    await loginAs(other);
    const titles = Array.from({ length: 30 }, (_, i) => `Lote ${String(i).padStart(2, "0")}`);
    expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, assigneeId: user.id, tasks: titles.map((title) => ({ title, kindId: f.kindId })) }));
    await afterDone();
    assert.equal(await db.notification.count({ where: { userId: user.id, type: "ASSIGNED" } }), 1, "un solo aviso para el lote");
    const items = await assignedOf(user, f.project.id);
    assert.deepEqual(items.map((x) => x.title).sort(), titles);
    assert.ok(items.every((x) => !x.more), "sin «y N más»: ya salen todas");
    // Las que crea la propia persona para sí misma no salen (ya las conoce).
    await loginAs(user);
    expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, assigneeId: user.id, tasks: [{ title: "Para mí", kindId: f.kindId }] }));
    assert.ok(!(await assignedOf(user, f.project.id)).some((x) => x.title === "Para mí"));
  });

  // El lote de la columna con «Asignación a persona» no tiene fecha de asignación por tarea: sale la primera y «y N más».
  test("el lote de una columna con «Asignación a persona» dice «y N más»", async () => {
    const [user, other] = [await makeUser(), await makeUser()];
    const f = await makeProject({ members: [user, other] });
    const old = new Date(Date.now() - 5 * 86_400_000);
    const rows = [];
    for (const title of ["Primera del lote", "Segunda", "Tercera"]) {
      const t = await makeTask(f, { title, createdById: other.id });
      rows.push(await db.task.update({ where: { id: t.id }, data: { assigneeId: user.id, createdAt: old } }));
    }
    await loginAs(other);
    await notifyAssigned({ projectId: f.project.id, assigneeId: user.id }, rows.map((r) => r.id), other.id, rows);
    await afterDone();
    const items = await assignedOf(user, f.project.id);
    assert.deepEqual(items.map((x) => [x.title, x.more]), [["Primera del lote", 2]]);
    const digest = buildDigest({ ...emptyDigestInput(), assigned: items });
    assert.equal(digest.sections[0]!.total, 3);
    assert.equal(digest.taskCount, 3);
    const es = digestEmail(digest, { name: "Luz", baseUrl: "https://app.example.com" }, makeT("es"));
    assert.ok(es.text.includes("Asignadas a ti (3)"), es.text);
    assert.ok(es.text.includes("«Primera del lote» y 2 más"), es.text);
    assert.ok(es.html.includes("«Primera del lote» y 2 más"), es.html);
    assert.ok(digestEmail(digest, { name: "Luz", baseUrl: "https://app.example.com" }, makeT("en")).text.includes("and 2 more"));
  });

  test("el número de consultas no crece con las tareas asignadas", async () => {
    const counts: number[] = [];
    for (const n of [2, 25]) {
      const [user, other] = [await makeUser(), await makeUser()];
      const f = await makeProject({ members: [user, other] });
      await loginAs(other);
      expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, assigneeId: user.id, tasks: Array.from({ length: n }, (_, i) => ({ title: `T${i}`, kindId: f.kindId })) }));
      await afterDone();
      const { result, sql } = await countQueries(() => gatherDigest({ id: user.id, role: "MEMBER" }, new Date(), today()));
      assert.equal(result.assigned.filter((x) => x.projectId === f.project.id).length, n);
      counts.push(sql.filter((s) => /^\s*SELECT/i.test(s)).length);
    }
    assert.equal(counts[0], counts[1], String(counts));
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

describe("resumen diario con el SMTP caído", () => {
  // Antes cada pasada horaria recorría a todas las personas: reunía su resumen, esperaba a la conexión y anotaba un fallo
  // por persona, todo el día. Ahora se corta al primer error de conexión y lo pendiente sale en la pasada siguiente.
  test("corta la pasada al primer error de conexión y devuelve la reserva", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const other = await makeUser();
    const f = await makeProject({ members: [a, b, other] });
    await makeTask(f, { title: "Novedad", createdById: other.id });
    await db.user.updateMany({ where: { id: { notIn: [a.id, b.id] } }, data: { dailyDigest: false } });
    await db.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { dailyDigest: true, digestHour: 0, lastDigestAt: null } });
    const now = new Date();
    assert.equal(await withSmtpDown(() => sendDueDigests(now)), 0);
    await flushLogs();
    assert.equal(await db.appLog.count({ where: { action: "digest.failed", userId: { in: [a.id, b.id] } } }), 1, "solo se intenta la primera persona");
    assert.equal(await db.appLog.count({ where: { action: "mail.smtpDown", createdAt: { gte: now } } }), 1, "un solo aviso de que el SMTP no responde");
    const rows = await db.user.findMany({ where: { id: { in: [a.id, b.id] } }, select: { lastDigestAt: true } });
    assert.deepEqual(rows.map((r) => r.lastDigestAt), [null, null], "las dos siguen pendientes para la pasada siguiente");
  });

  // Si el correo de una persona falla siempre (p. ej. un ETIMEDOUT tras DATA con su resumen), antes cada pasada se cortaba
  // en ella y las de detrás no lo recibían nunca. Ahora quien falló espera una hora y la pasada siguiente sigue con las demás.
  test("quien falló espera una hora: la pasada siguiente intenta a la de detrás", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const other = await makeUser();
    const f = await makeProject({ members: [a, b, other] });
    await makeTask(f, { title: "Novedad", createdById: other.id });
    await db.user.updateMany({ where: { id: { notIn: [a.id, b.id] } }, data: { dailyDigest: false } });
    await db.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { dailyDigest: true, digestHour: 0, lastDigestAt: null } });
    const now = new Date();
    const failed = async () => {
      await flushLogs();
      return (await db.appLog.findMany({ where: { action: "digest.failed", userId: { in: [a.id, b.id] } }, select: { userId: true } })).map((r) => r.userId);
    };
    assert.equal(await withSmtpDown(() => sendDueDigests(now)), 0);
    const [first] = await failed();
    assert.ok(first);
    assert.equal(await withSmtpDown(() => sendDueDigests(new Date(now.getTime() + 60_000))), 0);
    assert.deepEqual((await failed()).sort(), [a.id, b.id].sort(), "la segunda pasada salta a quien falló e intenta a la otra");
    // Con el SMTP de vuelta, sale la que no falló hace menos de una hora; la primera, en la pasada de después.
    const outbox = await mkdtemp(path.join(tmpdir(), "pz-digest-retry-"));
    const prevOutbox = process.env.MAIL_OUTBOX_DIR;
    process.env.MAIL_OUTBOX_DIR = outbox;
    try {
      assert.equal(await sendDueDigests(new Date(now.getTime() + 60 * 60_000)), 1, "la primera ya puede; la segunda aún espera");
      assert.equal(await sendDueDigests(new Date(now.getTime() + 61 * 60_000 + 1)), 1);
      const rows = await db.user.findMany({ where: { id: { in: [a.id, b.id] } }, select: { lastDigestAt: true } });
      assert.ok(rows.every((r) => r.lastDigestAt), "las dos lo han recibido");
    } finally {
      if (prevOutbox === undefined) delete process.env.MAIL_OUTBOX_DIR;
      else process.env.MAIL_OUTBOX_DIR = prevOutbox;
      await rm(outbox, { recursive: true, force: true });
    }
  });

  test("un ETIMEDOUT de la base al reunir el resumen no corta la pasada ni se anota como SMTP caído", async () => {
    const outbox = await mkdtemp(path.join(tmpdir(), "pz-digest-dberr-"));
    const prevOutbox = process.env.MAIL_OUTBOX_DIR;
    process.env.MAIL_OUTBOX_DIR = outbox;
    const delegate = db.taskComment as unknown as { findMany: (...args: unknown[]) => Promise<unknown> };
    const findMany = delegate.findMany;
    try {
      const a = await makeUser();
      const b = await makeUser();
      const other = await makeUser();
      const f = await makeProject({ members: [a, b, other] });
      await makeTask(f, { title: "Novedad", createdById: other.id });
      await db.user.updateMany({ where: { id: { notIn: [a.id, b.id] } }, data: { dailyDigest: false } });
      await db.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { dailyDigest: true, digestHour: 0, lastDigestAt: null, notifyCommentEmail: true } });
      // La primera consulta de comentarios (solo la hace quien tiene marcados los comentarios) falla como un socket de PostgreSQL agotado; las demás van bien.
      let calls = 0;
      delegate.findMany = (...args) => (++calls === 1 ? Promise.reject(Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT" })) : findMany.apply(delegate, args));
      const now = new Date();
      assert.equal(await sendDueDigests(now), 1, "la otra persona sí lo recibe");
      await flushLogs();
      assert.equal(await db.appLog.count({ where: { action: "digest.failed", userId: { in: [a.id, b.id] } } }), 1);
      assert.equal(await db.appLog.count({ where: { action: "mail.smtpDown", createdAt: { gte: now } } }), 0);
    } finally {
      delegate.findMany = findMany;
      if (prevOutbox === undefined) delete process.env.MAIL_OUTBOX_DIR;
      else process.env.MAIL_OUTBOX_DIR = prevOutbox;
      await rm(outbox, { recursive: true, force: true });
    }
  });
});
