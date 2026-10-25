// Avisos (menciones, asignaciones) y quién los recibe según la visibilidad del proyecto, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { addComment, createTask, updateTask } from "../../src/actions/tasks";
import { mentionToken } from "../../src/lib/mentions";
import { deliver } from "../../src/lib/notify";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
});
