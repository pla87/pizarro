// Avisos (menciones, asignaciones) y quién los recibe según la visibilidad del proyecto, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { addComment, createTask, updateTask } from "../../src/actions/tasks";
import { mentionToken } from "../../src/lib/mentions";

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

  test("proyecto restringido: avisa a admins y miembros, no a otros usuarios", async () => {
    const author = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const admin = await makeUser({ role: "ADMIN" });
    const outsider = await makeUser();
    const f = await makeProject({ visibility: "RESTRICTED", members: [member] });
    const task = await makeTask(f);
    await loginAs(author);
    expectOk(await addComment(task.id, `${mention(member)} ${mention(admin)} ${mention(outsider)}`));
    const got = (await recipients(task.id)).filter((n) => n.type === "MENTION").map((n) => n.userId).sort();
    assert.deepEqual(got, [member.id, admin.id].sort());
  });

  test("proyecto público: avisa a cualquier usuario activo, pero no a los desactivados ni a uno mismo", async () => {
    const author = await makeUser();
    const other = await makeUser();
    const inactive = await makeUser({ active: false });
    const f = await makeProject();
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
