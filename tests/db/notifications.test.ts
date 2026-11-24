// Avisos (menciones, asignaciones) y quién los recibe según la visibilidad del proyecto, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { addComment, createTask, createTasks, updateTask } from "../../src/actions/tasks";
import { mentionToken } from "../../src/lib/mentions";
import { deliver, mentionEmail } from "../../src/lib/notify";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notificationBody } from "../../src/lib/notification-text";
import { unreadCount } from "../../src/lib/notification-access";
import { markAllNotificationsRead, markNotificationRead } from "../../src/actions/notifications";
import { updateEmailPrefs } from "../../src/actions/collab-prefs";
import { UNREAD_COUNT_CAP } from "../../src/lib/unread-core";
import { makeT } from "../../src/i18n/core";
import { flushLogs } from "../../src/lib/log";

const mention = (u: { id: string; name: string }) => mentionToken(u.name, u.id);
const recipients = async (taskId: string) => (await db.notification.findMany({ where: { taskId }, select: { userId: true, type: true } })).sort((a, b) => a.userId.localeCompare(b.userId));

describe("menciones según la visibilidad", () => {
  test("proyecto privado: la mención en un comentario solo avisa a los miembros", async () => {
    const author = await makeUser();
    const member = await makeUser();
    const outsider = await makeUser();
    const adminOutsider = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ visibility: "PRIVATE", owner: author, members: [member] });
    const task = await makeTask(f);
    await loginAs(author);
    expectOk(await addComment(task.id, `hola ${mention(member)} ${mention(outsider)} ${mention(adminOutsider)}`));
    const got = (await recipients(task.id)).filter((n) => n.type === "MENTION").map((n) => n.userId);
    assert.deepEqual(got, [member.id]);
    assert.equal(await db.notification.count({ where: { userId: { in: [outsider.id, adminOutsider.id] } } }), 0);
  });

  test("proyecto privado: mencionar en la descripción al crear y editar tampoco avisa a ajenos", async () => {
    const author = await makeUser();
    const member = await makeUser();
    const outsider = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ visibility: "PRIVATE", owner: author, members: [member] });
    await loginAs(author);
    const created = expectOk(
      await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "T", kindId: f.kindId, description: `a ${mention(member)} y ${mention(outsider)}` }),
    );
    assert.deepEqual((await recipients(created.id)).map((n) => n.userId), [member.id]);

    const task = await makeTask(f);
    expectOk(await updateTask(task.id, { description: `b ${mention(outsider)}` }));
    assert.equal(await db.notification.count({ where: { taskId: task.id } }), 0);
  });

  test("proyecto de equipo: avisa a admins y asignados, no a otros usuarios", async () => {
    const author = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const admin = await makeUser({ role: "ADMIN" });
    const outsider = await makeUser();
    const f = await makeProject({ visibility: "TEAM", members: [member] });
    const task = await makeTask(f);
    await loginAs(author);
    expectOk(await addComment(task.id, `${mention(member)} ${mention(admin)} ${mention(outsider)}`));
    const got = (await recipients(task.id)).filter((n) => n.type === "MENTION").map((n) => n.userId).sort();
    assert.deepEqual(got, [member.id, admin.id].sort());
  });

  test("proyecto de equipo: avisa a los asignados activos, pero no a los desactivados ni a uno mismo", async () => {
    const author = await makeUser();
    const other = await makeUser();
    const inactive = await makeUser({ active: false });
    const f = await makeProject({ members: [author, other, inactive] });
    const task = await makeTask(f);
    await loginAs(author);
    expectOk(await addComment(task.id, `${mention(other)} ${mention(inactive)} ${mention(author)}`));
    const got = (await recipients(task.id)).filter((n) => n.type === "MENTION").map((n) => n.userId);
    assert.deepEqual(got, [other.id]);
  });

  test("asignar a alguien que no es miembro de un privado se rechaza y no genera aviso", async () => {
    const author = await makeUser();
    const outsider = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner: author });
    const task = await makeTask(f);
    await loginAs(author);
    expectFail(await updateTask(task.id, { assigneeId: outsider.id }), NOT_FOUND);
    assert.equal(await db.notification.count({ where: { userId: outsider.id } }), 0);
  });

  test("un comentario avisa a quien sigue la tarea y un miembro nuevo sí; el excluido del proyecto no", async () => {
    const author = await makeUser();
    const creator = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner: author, members: [creator] });
    const task = await makeTask(f, { createdById: creator.id });
    await loginAs(author);
    expectOk(await addComment(task.id, "sin menciones"));
    assert.deepEqual((await recipients(task.id)).map((n) => [n.userId, n.type]), [[creator.id, "COMMENT"]]);
  });
});

describe("envío externo de avisos", () => {
  // Logs decía «2 aviso(s) MENTION creados (2 con envío externo)» sin email ni Telegram/WhatsApp: contaba la casilla del
  // email de menciones (activada por defecto) aunque la instalación no pudiera enviar nada.
  test("«con envío externo» solo cuenta lo que puede salir: sin email configurado, 0", async () => {
    const author = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    await db.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { notifyEmail: true } });
    const f = await makeProject({ members: [author, a, b] });
    await loginAs(author);
    const logOf = async (taskId: string) => {
      await flushLogs();
      const row = await db.appLog.findFirstOrThrow({ where: { action: "notify.mention", details: { path: ["taskId"], equals: taskId } } });
      return { external: (row.details as { externalRecipients: string[] }).externalRecipients.length, message: row.message };
    };
    const t1 = await makeTask(f);
    expectOk(await addComment(t1.id, `${mention(a)} ${mention(b)}`));
    const off = await logOf(t1.id);
    assert.equal(off.external, 0);
    assert.match(off.message, /2 aviso\(s\) MENTION creados \(0 con envío externo\)/);

    const dir = await mkdtemp(join(tmpdir(), "pz-outbox-count-"));
    const prev = process.env.MAIL_OUTBOX_DIR;
    process.env.MAIL_OUTBOX_DIR = dir;
    try {
      const t2 = await makeTask(f);
      expectOk(await addComment(t2.id, `${mention(a)} ${mention(b)}`));
      assert.equal((await logOf(t2.id)).external, 2);
    } finally {
      process.env.MAIL_OUTBOX_DIR = prev ?? "";
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no sale el email si la persona perdió el acceso al proyecto privado antes del envío", async () => {
    const author = await makeUser();
    const stays = await makeUser();
    const removed = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner: author, members: [stays, removed] });
    const task = await makeTask(f);
    const created = await db.notification.createManyAndReturn({
      data: [stays, removed].map((u) => ({ userId: u.id, actorId: author.id, taskId: task.id, type: "MENTION" as const, excerpt: "x" })),
      select: { id: true, userId: true },
    });
    await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: removed.id } });
    const dir = await mkdtemp(join(tmpdir(), "pz-outbox-"));
    const prev = process.env.MAIL_OUTBOX_DIR;
    process.env.MAIL_OUTBOX_DIR = dir;
    try {
      await deliver(created.map((c) => c.id));
    } finally {
      process.env.MAIL_OUTBOX_DIR = prev ?? "";
    }
    const sent = await db.notification.findMany({ where: { id: { in: created.map((c) => c.id) } }, select: { userId: true, emailSentAt: true } });
    assert.ok(sent.find((n) => n.userId === stays.id)?.emailSentAt, "quien sigue en el proyecto recibe el email");
    assert.equal(sent.find((n) => n.userId === removed.id)?.emailSentAt, null);
    assert.equal((await readdir(dir)).filter((n) => n.endsWith(".json")).length, 1);
    await rm(dir, { recursive: true, force: true });
  });

  // Antes los recordatorios de «Esperando» salían por email con «Avisos de menciones» (y por Telegram/WhatsApp con las
  // fechas límite): ahora, en todos los canales, con «fechas límite y recordatorios de “Esperando”».
  test("recordatorio de «Esperando»: el email lo decide la casilla de las fechas límite, no la de menciones", async () => {
    const mentionsOnly = await makeUser();
    const dueOnly = await makeUser();
    await db.user.update({ where: { id: mentionsOnly.id }, data: { notifyEmail: true, notifyDueEmail: false } });
    await db.user.update({ where: { id: dueOnly.id }, data: { notifyEmail: false, notifyDueEmail: true } });
    const f = await makeProject({ members: [mentionsOnly, dueOnly] });
    const task = await makeTask(f);
    const created = await db.notification.createManyAndReturn({
      data: [mentionsOnly, dueOnly].map((u) => ({ userId: u.id, actorId: null, taskId: task.id, type: "WAITING" as const, excerpt: "4" })),
      select: { id: true, userId: true },
    });
    const dir = await mkdtemp(join(tmpdir(), "pz-outbox-waiting-"));
    const prev = process.env.MAIL_OUTBOX_DIR;
    process.env.MAIL_OUTBOX_DIR = dir;
    try {
      await deliver(created.map((c) => c.id));
      const sent = await db.notification.findMany({ where: { id: { in: created.map((c) => c.id) } }, select: { userId: true, emailSentAt: true } });
      assert.equal(sent.find((n) => n.userId === mentionsOnly.id)?.emailSentAt, null);
      assert.ok(sent.find((n) => n.userId === dueOnly.id)?.emailSentAt);
      const [file] = (await readdir(dir)).filter((x) => x.endsWith(".json"));
      const mail = JSON.parse(await readFile(join(dir, file!), "utf8")) as { subject: string; text: string };
      assert.match(mail.subject, /sigue esperando respuesta/);
      // Su baja apaga esa misma casilla (la «d» de las fechas límite).
      assert.match(mail.text, /\/unsubscribe\/d/);
    } finally {
      process.env.MAIL_OUTBOX_DIR = prev ?? "";
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("avisos de asignación en lote", () => {
  test("createTasks avisa una sola vez al responsable", async () => {
    const actor = await makeUser();
    const assignee = await makeUser();
    const f = await makeProject({ members: [actor, assignee] });
    await loginAs(actor);
    const made = expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, assigneeId: assignee.id, tasks: [{ title: "Uno", kindId: f.kindId }, { title: "Dos", kindId: f.kindId }] }));
    const notes = await db.notification.findMany({ where: { userId: assignee.id, type: "ASSIGNED" } });
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.taskId, made[0]!.id);
    // Se guarda solo el número; «2 tareas» se pone al mostrarlo, en el idioma de quien lo lee.
    assert.equal(notificationBody("ASSIGNED", notes[0]!.excerpt, makeT("es"), "es-ES"), "2 tareas");
  });

  test("el aviso de asignación de un lote se muestra y se envía en el idioma de quien lo recibe", async () => {
    const actor = await makeUser();
    const assignee = await makeUser();
    await db.user.update({ where: { id: assignee.id }, data: { locale: "EN" } });
    const f = await makeProject({ members: [actor, assignee] });
    await loginAs(actor);
    expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, assigneeId: assignee.id, tasks: ["a", "b", "c"].map((title) => ({ title, kindId: f.kindId })) }));
    const n = await db.notification.findFirstOrThrow({ where: { userId: assignee.id, type: "ASSIGNED" } });
    const en = makeT("en");
    assert.equal(notificationBody("ASSIGNED", n.excerpt, en, "en-US"), "3 tasks");
    assert.equal(notificationBody("ASSIGNED", n.excerpt, makeT("es"), "es-ES"), "3 tareas");
    const mail = mentionEmail({ type: "ASSIGNED", actorName: "X", taskTitle: "a", projectName: "P", excerpt: n.excerpt, url: "https://example.com" }, en);
    assert.match(mail.text, /3 tasks/);
    assert.doesNotMatch(mail.text + mail.html, /tareas/);
    // Por email, la cabecera dice cuántas son (antes el asunto nombraba una tarea y el cuerpo decía «3 tareas»).
    const dir = await mkdtemp(join(tmpdir(), "pz-outbox-batch-"));
    const prev = process.env.MAIL_OUTBOX_DIR;
    process.env.MAIL_OUTBOX_DIR = dir;
    try {
      await db.user.update({ where: { id: assignee.id }, data: { notifyAssignedEmail: true } });
      await deliver([n.id]);
      const [file] = (await readdir(dir)).filter((x) => x.endsWith(".json"));
      const sent = JSON.parse(await readFile(join(dir, file!), "utf8")) as { subject: string; text: string };
      const first = await db.task.findUniqueOrThrow({ where: { id: n.taskId! }, select: { title: true } });
      const actorName = (await db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true } })).name;
      assert.equal(sent.subject, `${actorName} assigned you 3 tasks (including “${first.title}”)`);
      assert.match(sent.text, /assigned you 3 tasks \(including “a”\)/);
      assert.doesNotMatch(sent.text, /\n\n3 tasks\n/);
      assert.ok(sent.text.includes("Don't reply to this email: reply in Pizarro."));
    } finally {
      process.env.MAIL_OUTBOX_DIR = prev ?? "";
      await rm(dir, { recursive: true, force: true });
    }
    // Una sola tarea: el extracto sigue siendo su título.
    expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, assigneeId: assignee.id, tasks: [{ title: "Sola", kindId: f.kindId }] }));
    const one = await db.notification.findFirstOrThrow({ where: { userId: assignee.id, type: "ASSIGNED", excerpt: { not: n.excerpt } } });
    assert.equal(notificationBody("ASSIGNED", one.excerpt, en, "en-US"), "Sola");
  });
});

describe("recuento de avisos sin leer (cabecera y página de Avisos)", () => {
  test("cuenta solo los visibles y sin leer, con tope de 100, y no ve los de proyectos a los que ya no tiene acceso", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const other = await makeUser();
    const mine = await makeProject({ visibility: "PRIVATE", owner, members: [u] });
    const lost = await makeProject({ visibility: "PRIVATE", owner, members: [u] });
    const a = await makeTask(mine);
    const b = await makeTask(lost);
    const at = (i: number) => new Date(Date.now() - i * 60_000);
    await db.notification.createMany({
      data: [
        ...Array.from({ length: 3 }, (_, i) => ({ userId: u.id, taskId: a.id, createdAt: at(i) })),
        // Uno leído y uno de otra persona no cuentan; el de proyecto (sin tarea) y el de `lost`, sí.
        { userId: u.id, taskId: a.id, readAt: new Date() },
        { userId: other.id, taskId: a.id },
        { userId: u.id, projectId: mine.project.id, type: "PROJECT_TO_TEAM" as const },
        { userId: u.id, taskId: b.id },
      ],
    });
    assert.equal(await unreadCount(u.id, "MEMBER"), 5);
    // Pierde el acceso a `lost`: su aviso deja de contar.
    await db.projectMember.deleteMany({ where: { projectId: lost.project.id, userId: u.id } });
    assert.equal(await unreadCount(u.id, "MEMBER"), 4);
    // Con más de 100 sin leer se para en 100 (la interfaz dice «99+»).
    await db.notification.createMany({ data: Array.from({ length: 120 }, (_, i) => ({ userId: u.id, taskId: a.id, createdAt: at(10 + i) })) });
    assert.equal(UNREAD_COUNT_CAP, 100);
    assert.equal(await unreadCount(u.id, "MEMBER"), UNREAD_COUNT_CAP);
  });

  test("leer uno o todos devuelve el recuento real de después (con tope), aunque otra pestaña haya leído otros", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner, members: [u] });
    const a = await makeTask(f);
    const at = (i: number) => new Date(Date.now() - i * 60_000);
    const mine = await db.notification.createManyAndReturn({ data: Array.from({ length: 4 }, (_, i) => ({ userId: u.id, taskId: a.id, createdAt: at(i) })), select: { id: true } });
    const theirs = await db.notification.create({ data: { userId: owner.id, taskId: a.id }, select: { id: true } });
    await loginAs(u);
    assert.equal(expectOk(await markNotificationRead(mine[0]!.id)).unreadCount, 3);
    // Otra pestaña lee uno: el número siguiente ya lo descuenta (bajarlo aquí daba 2 y luego 1 de más o de menos).
    await db.notification.update({ where: { id: mine[1]!.id }, data: { readAt: new Date() } });
    assert.equal(expectOk(await markNotificationRead(mine[0]!.id)).unreadCount, 2, "releer el mismo no baja de más");
    // El de otra persona no se marca ni cuenta.
    assert.equal(expectOk(await markNotificationRead(theirs.id)).unreadCount, 2);
    assert.equal((await db.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt, null);
    // Con más de 100 sin leer, leer uno sigue en el tope («99+»): no se inventa un 99.
    await db.notification.createMany({ data: Array.from({ length: 150 }, (_, i) => ({ userId: u.id, taskId: a.id, createdAt: at(10 + i) })) });
    assert.equal(expectOk(await markNotificationRead(mine[2]!.id)).unreadCount, UNREAD_COUNT_CAP);
    assert.equal(expectOk(await markAllNotificationsRead()).unreadCount, 0);
    assert.equal(await db.notification.count({ where: { userId: u.id, readAt: null } }), 0);
  });
});

describe("«Avisos por email» de Mi perfil", () => {
  test("una sola acción guarda todas las casillas y la hora del resumen a la vez", async () => {
    const u = await makeUser();
    await loginAs(u);
    const all = { notifyEmail: false, notifyAssignedEmail: true, notifyDueEmail: false, notifyCommentEmail: true, dailyDigest: true, digestHour: 19 };
    expectOk(await updateEmailPrefs(all));
    const select = { notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, dailyDigest: true, digestHour: true } as const;
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: u.id }, select }), all);
    // Faltar una casilla (un navegador con la página de antes) o traer otra cosa no guarda nada a medias.
    const { notifyEmail: _omit, ...partial } = all;
    expectFail(await updateEmailPrefs(partial as typeof all));
    expectFail(await updateEmailPrefs({ ...all, notifyEmail: true, role: "ADMIN" } as typeof all));
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { ...select, role: true } }), { ...all, role: "MEMBER" });
  });
});
