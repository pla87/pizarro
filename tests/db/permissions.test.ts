// Visibilidad de proyectos y permisos de las acciones, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { asUser, db, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, restoreSession, saveSession, makeTask, makeUser, NOT_FOUND, SESSION_EXPIRED } from "./helpers";
import { assertProjectAccess, assertTaskAccess, listVisibleProjects, visibleProjectsWhere } from "../../src/lib/access";
import { addComment, createTask, deleteTask, getTaskDetail, moveTask, updateTask } from "../../src/actions/tasks";
import { deleteRelease, deployRelease, getReleaseTaskDetails } from "../../src/actions/releases";
import { createProject, setProjectVisibility } from "../../src/actions/projects";

/** Tres proyectos (público, restringido, privado) con un administrador, dos miembros y un ajeno. */
async function world() {
  const admin = await makeUser({ role: "ADMIN" });
  const otherAdmin = await makeUser({ role: "ADMIN" });
  const member = await makeUser();
  const outsider = await makeUser();
  const pub = await makeProject();
  const restricted = await makeProject({ visibility: "RESTRICTED", members: [member] });
  const priv = await makeProject({ visibility: "PRIVATE", owner: admin, members: [member] });
  return { admin, otherAdmin, member, outsider, pub, restricted, priv };
}

describe("visibleProjectsWhere / assertProjectAccess / assertTaskAccess", () => {
  test("público: lo ve todo el mundo; restringido: admins y miembros; privado: solo sus miembros (ni otros admins)", async () => {
    const w = await world();
    const ids = [w.pub.project.id, w.restricted.project.id, w.priv.project.id];
    const visibleTo = async (u: { id: string; role: "ADMIN" | "MEMBER" }) => {
      const user = { ...(await db.user.findUniqueOrThrow({ where: { id: u.id } })), theme: "SYSTEM", accent: "BLUE", locale: "ES" } as never;
      const rows = await db.project.findMany({ where: { id: { in: ids }, ...visibleProjectsWhere(user) }, select: { id: true } });
      return new Set(rows.map((r) => r.id));
    };
    assert.deepEqual(await visibleTo(w.admin), new Set([w.pub.project.id, w.restricted.project.id, w.priv.project.id]));
    // Otro administrador ve el restringido pero nunca el privado ajeno.
    assert.deepEqual(await visibleTo(w.otherAdmin), new Set([w.pub.project.id, w.restricted.project.id]));
    assert.deepEqual(await visibleTo(w.member), new Set([w.pub.project.id, w.restricted.project.id, w.priv.project.id]));
    assert.deepEqual(await visibleTo(w.outsider), new Set([w.pub.project.id]));
  });

  test("listVisibleProjects, assertProjectAccess y assertTaskAccess respetan la visibilidad", async () => {
    const w = await world();
    const task = await makeTask(w.priv);
    const asCurrent = (u: typeof w.admin) => ({ ...u, theme: "SYSTEM", accent: "BLUE", locale: "ES" }) as never;
    await assert.rejects(assertProjectAccess(asCurrent(w.otherAdmin), w.priv.project.id), (e: Error) => /No encontrado/.test(e.message));
    await assert.rejects(assertTaskAccess(asCurrent(w.outsider), task.id), (e: Error) => /No encontrado/.test(e.message));
    await assertProjectAccess(asCurrent(w.member), w.priv.project.id);
    assert.deepEqual(await assertTaskAccess(asCurrent(w.admin), task.id), { projectId: w.priv.project.id, columnId: w.priv.columns.todo });
    const listed = (await listVisibleProjects(asCurrent(w.otherAdmin))).map((p) => p.id);
    assert.ok(listed.includes(w.pub.project.id) && !listed.includes(w.priv.project.id));
  });
});

describe("acciones de tareas según visibilidad", () => {
  test("proyecto privado: un administrador ajeno y un usuario sin acceso reciben «no encontrado» en todas las acciones", async () => {
    const w = await world();
    const task = await makeTask(w.priv, { title: "Secreta" });
    for (const intruder of [w.otherAdmin, w.outsider]) {
      await loginAs(intruder);
      expectFail(await getTaskDetail(task.id), NOT_FOUND);
      expectFail(await updateTask(task.id, { title: "Hackeada" }), NOT_FOUND);
      expectFail(await moveTask(task.id, w.priv.columns.doing, null, null), NOT_FOUND);
      expectFail(await addComment(task.id, "hola"), NOT_FOUND);
      expectFail(await deleteTask(task.id), NOT_FOUND);
      expectFail(
        await createTask({ projectId: w.priv.project.id, columnId: w.priv.columns.todo, title: "Intrusa", kindId: w.priv.kindId }),
        NOT_FOUND,
      );
    }
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(after.title, "Secreta");
    assert.equal(after.columnId, w.priv.columns.todo);
    assert.equal(await db.taskComment.count({ where: { taskId: task.id } }), 0);
    assert.equal(await db.task.count({ where: { projectId: w.priv.project.id } }), 1);
  });

  test("proyecto privado: sus miembros sí pueden operar", async () => {
    const w = await world();
    const task = await makeTask(w.priv, { title: "Visible" });
    await loginAs(w.member);
    expectOk(await getTaskDetail(task.id));
    expectOk(await updateTask(task.id, { title: "Editada" }));
    expectOk(await moveTask(task.id, w.priv.columns.doing, null, null));
    expectOk(await addComment(task.id, "hola"));
    const created = expectOk(await createTask({ projectId: w.priv.project.id, columnId: w.priv.columns.todo, title: "Nueva", kindId: w.priv.kindId }));
    expectOk(await deleteTask(created.id));
    // El dueño (admin) también.
    await loginAs(w.admin);
    expectOk(await getTaskDetail(task.id));
  });

  test("proyecto restringido: el miembro y los admins operan; el ajeno no", async () => {
    const w = await world();
    const task = await makeTask(w.restricted);
    await loginAs(w.outsider);
    expectFail(await getTaskDetail(task.id), NOT_FOUND);
    expectFail(await addComment(task.id, "hola"), NOT_FOUND);
    await loginAs(w.otherAdmin);
    expectOk(await getTaskDetail(task.id));
    await loginAs(w.member);
    expectOk(await addComment(task.id, "hola"));
  });

  test("proyecto público: cualquier usuario activo opera", async () => {
    const w = await world();
    const task = await makeTask(w.pub);
    await loginAs(w.outsider);
    expectOk(await getTaskDetail(task.id));
    expectOk(await updateTask(task.id, { title: "Cambiada por cualquiera" }));
  });

  test("el borrado y la edición de comentarios ajenos: solo autor o admin", async () => {
    const w = await world();
    const task = await makeTask(w.pub);
    await loginAs(w.member);
    const comment = expectOk(await addComment(task.id, "mío"));
    const { deleteComment } = await import("../../src/actions/tasks");
    await loginAs(w.outsider);
    expectFail(await deleteComment(comment.id), /Solo puedes borrar tus comentarios/);
    await loginAs(w.otherAdmin);
    expectOk(await deleteComment(comment.id));
  });

  test("no se puede asignar una tarea de un proyecto privado a quien no es miembro", async () => {
    const w = await world();
    const task = await makeTask(w.priv);
    await loginAs(w.member);
    expectFail(await updateTask(task.id, { assigneeId: w.outsider.id }), NOT_FOUND);
    expectOk(await updateTask(task.id, { assigneeId: w.admin.id }));
  });
});

describe("releases", () => {
  async function releaseOf(f: Awaited<ReturnType<typeof makeProject>>, by: { id: string }) {
    const inProd = await db.column.create({ data: { projectId: f.project.id, name: "En producción", position: 4000, role: "IN_PRODUCTION" } });
    const task = await makeTask(f, { columnId: f.columns.done });
    await loginAs(by);
    const res = await deployRelease({ projectId: f.project.id, title: "R1", content: "Cambios", taskIds: [task.id], destination: "IN_PRODUCTION" });
    return { task, inProd, res };
  }

  test("deployRelease / getReleaseTaskDetails / deleteRelease: rechazadas en un proyecto privado ajeno y permitidas a los miembros", async () => {
    const w = await world();
    const task = await makeTask(w.priv, { columnId: w.priv.columns.done });
    await db.column.create({ data: { projectId: w.priv.project.id, name: "En producción", position: 4000, role: "IN_PRODUCTION" } });
    const input = { projectId: w.priv.project.id, title: "R1", content: "Cambios", taskIds: [task.id], destination: "IN_PRODUCTION" as const };

    for (const intruder of [w.otherAdmin, w.outsider]) {
      await loginAs(intruder);
      expectFail(await deployRelease(input), NOT_FOUND);
      expectFail(await getReleaseTaskDetails({ projectId: w.priv.project.id, taskIds: [task.id] }), NOT_FOUND);
    }
    assert.equal(await db.release.count({ where: { projectId: w.priv.project.id } }), 0);

    await loginAs(w.member);
    expectOk(await getReleaseTaskDetails({ projectId: w.priv.project.id, taskIds: [task.id] }));
    expectOk(await deployRelease(input));
    const release = await db.release.findFirstOrThrow({ where: { projectId: w.priv.project.id } });

    await loginAs(w.otherAdmin);
    expectFail(await deleteRelease(release.id), NOT_FOUND);
    assert.equal(await db.release.count({ where: { id: release.id } }), 1);
    await loginAs(w.admin);
    expectOk(await deleteRelease(release.id));
  });

  test("deployRelease en un proyecto público mueve la tarea a «En producción»", async () => {
    const w = await world();
    const { task, inProd, res } = await releaseOf(w.pub, w.outsider);
    expectOk(res);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).columnId, inProd.id);
  });
});

describe("usuario desactivado y sin sesión", () => {
  test("un usuario desactivado ya no puede ejecutar acciones, aunque conserve la cookie", async () => {
    const u = await makeUser();
    const p = await makeProject();
    const task = await makeTask(p);
    await loginAs(u);
    expectOk(await getTaskDetail(task.id));
    // Se desactiva sin borrar su sesión (p. ej. una petición que ya iba en vuelo).
    await db.user.update({ where: { id: u.id }, data: { active: false } });
    expectFail(await getTaskDetail(task.id), SESSION_EXPIRED);
    expectFail(await updateTask(task.id, { title: "x" }), SESSION_EXPIRED);
    expectFail(await addComment(task.id, "x"), SESSION_EXPIRED);
    expectFail(await createProject("Nuevo", { isPrivate: true }), SESSION_EXPIRED);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, task.title);
  });

  test("desactivar desde la acción updateUser cierra sus sesiones", async () => {
    const { updateUser } = await import("../../src/actions/users");
    const admin = await makeUser({ role: "ADMIN" });
    const u = await makeUser();
    const p = await makeProject();
    const task = await makeTask(p);
    await loginAs(u);
    expectOk(await getTaskDetail(task.id));
    assert.equal(await db.session.count({ where: { userId: u.id } }), 1);
    const userCookie = saveSession();
    await loginAs(admin);
    expectOk(await updateUser(u.id, { name: u.name, email: u.email, role: "MEMBER", active: false }));
    assert.equal(await db.session.count({ where: { userId: u.id } }), 0);
    restoreSession(userCookie);
    expectFail(await getTaskDetail(task.id), SESSION_EXPIRED);
  });

  test("sin sesión todas las acciones fallan", async () => {
    const { logout } = await import("./helpers");
    const p = await makeProject();
    const task = await makeTask(p);
    logout();
    expectFail(await getTaskDetail(task.id), SESSION_EXPIRED);
    expectFail(await createTask({ projectId: p.project.id, columnId: p.columns.todo, title: "x", kindId: p.kindId }), SESSION_EXPIRED);
  });
});

describe("crear y cambiar la visibilidad de proyectos", () => {
  test("un miembro no admin solo crea proyectos privados (y sin plantilla)", async () => {
    const u = await makeUser();
    await loginAs(u);
    expectFail(await createProject("Público"), FORBIDDEN);
    expectFail(await createProject("Público 2", { isPrivate: false }), FORBIDDEN);
    expectFail(await createProject("Con plantilla", { isPrivate: true, templateId: "x" }), FORBIDDEN);
    const created = expectOk(await createProject("Mi privado", { isPrivate: true }));
    const row = await db.project.findUniqueOrThrow({ where: { id: created.id }, include: { members: true } });
    assert.equal(row.isPrivate, true);
    assert.equal(row.privateOwnerId, u.id);
    assert.deepEqual(row.members.map((m) => m.userId), [u.id]);
  });

  test("un administrador puede crear públicos; setProjectVisibility es solo de administradores", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    await loginAs(admin);
    const created = expectOk(await createProject("Público admin"));
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: created.id } })).isPrivate, false);
    expectOk(await setProjectVisibility(created.id, "RESTRICTED", [member.id]));
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: created.id } })).restricted, true);
    await loginAs(member);
    expectFail(await setProjectVisibility(created.id, "PUBLIC", []), FORBIDDEN);
    // Tras hacerlo privado, otro administrador deja de verlo.
    await loginAs(admin);
    expectOk(await setProjectVisibility(created.id, "PRIVATE", []));
    const other = await makeUser({ role: "ADMIN" });
    await asUser(other, async () => expectFail(await setProjectVisibility(created.id, "PUBLIC", []), NOT_FOUND));
  });
});
