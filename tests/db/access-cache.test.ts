// Caché de acceso a proyectos (presencia, quién mira una tarea) y aviso de cambios propios, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { addSubtask, addSubtasks, deleteSubtask, deleteTaskLink, moveTask, reorderSubtask, updateSubtask } from "../../src/actions/tasks";
import { canAccessProject, projectOfTask } from "../../src/lib/access-cache";
import { revokeProject, revokeUser } from "../../src/lib/revoke";
import { subscribeProject } from "../../src/lib/realtime";

describe("canAccessProject", () => {
  test("guarda el sí hasta que revoke lo vacía; el no no se guarda", async () => {
    const member = await makeUser();
    const outsider = await makeUser();
    const f = await makeProject({ members: [member] });
    assert.equal(await canAccessProject(member, f.project.id), true);
    assert.equal(await canAccessProject(outsider, f.project.id), false);
    // Se le quita el acceso: la caché lo sigue dando hasta que se avisa.
    await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: member.id } });
    assert.equal(await canAccessProject(member, f.project.id), true);
    revokeProject(f.project.id);
    assert.equal(await canAccessProject(member, f.project.id), false);
    // El no no se guardó: al darle acceso se ve enseguida.
    await db.projectMember.create({ data: { projectId: f.project.id, userId: outsider.id } });
    assert.equal(await canAccessProject(outsider, f.project.id), true);
  });

  test("revokeUser vacía lo del usuario", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    assert.equal(await canAccessProject(user, f.project.id), true);
    await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: user.id } });
    revokeUser(user.id);
    assert.equal(await canAccessProject(user, f.project.id), false);
  });

  test("projectOfTask devuelve el proyecto y null si no existe", async () => {
    const f = await makeProject({ members: [] });
    const task = await makeTask(f);
    assert.equal(await projectOfTask(task.id), f.project.id);
    assert.equal(await projectOfTask("c000000000000000000000000"), null);
  });
});

describe("id de cambio (cid)", () => {
  test("la acción devuelve el mismo cid que recibe el canal; si renumera la columna no lo devuelve", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const a = await makeTask(f, { position: 1024 });
    const b = await makeTask(f, { position: 1024 });
    const c = await makeTask(f, { position: 2048 });
    await loginAs(user);
    const seen: string[] = [];
    const off = subscribeProject(f.project.id, (ch) => seen.push(ch.cid));
    try {
      const res = await moveTask(c.id, f.columns.doing, null, null);
      expectOk(res);
      assert.ok(res.ok && res.cid, "debe devolver cid");
      assert.deepEqual(seen, [res.cid]);
      // Entre dos tarjetas empatadas: se renumera la columna (cambian otras posiciones) y no hay cid.
      const res2 = await moveTask(c.id, f.columns.todo, a.id, b.id);
      expectOk(res2);
      assert.equal(res2.ok && res2.cid, undefined);
      assert.equal(seen.length, 2);
    } finally {
      off();
    }
  });

  test("subtareas y quitar un enlace devuelven el cid (la pestaña que las lanza no se refresca con su propio aviso)", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f);
    await loginAs(user);
    const seen: string[] = [];
    const off = subscribeProject(f.project.id, (ch) => seen.push(ch.cid));
    try {
      const cids: (string | undefined)[] = [];
      const one = await addSubtask(task.id, "Uno");
      expectOk(one);
      cids.push(one.ok ? one.cid : undefined);
      const many = await addSubtasks(task.id, ["Dos", "Tres"]);
      expectOk(many);
      cids.push(many.ok ? many.cid : undefined);
      const [two] = many.ok ? many.data.created : [];
      const done = await updateSubtask(one.ok ? one.data.id : "", { done: true });
      expectOk(done);
      cids.push(done.ok ? done.cid : undefined);
      const moved = await reorderSubtask(two!.id, null, one.ok ? one.data.id : null);
      expectOk(moved);
      cids.push(moved.ok ? moved.cid : undefined);
      const gone = await deleteSubtask(two!.id);
      expectOk(gone);
      cids.push(gone.ok ? gone.cid : undefined);
      const link = await db.taskLink.create({ data: { taskId: task.id, kind: "GOOGLE_DOC", title: "Doc", url: "https://docs.google.com/document/d/x" } });
      const unlinked = await deleteTaskLink(link.id);
      expectOk(unlinked);
      cids.push(unlinked.ok ? unlinked.cid : undefined);
      assert.ok(cids.every((c) => typeof c === "string"), JSON.stringify(cids));
      assert.deepEqual(seen, cids);
    } finally {
      off();
    }
  });
});
