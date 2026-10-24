// Visibilidad de proyectos y permisos de las acciones, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { asUser, db, expectFail, expectOk, FORBIDDEN, assign, loginAs, makeKind, makeProject, restoreSession, saveSession, makeTask, makeUser, NOT_FOUND, SESSION_EXPIRED } from "./helpers";
import { assertAssignable, assertProjectAccess, assertTaskAccess, listVisibleProjects, visibleProjectsWhere } from "../../src/lib/access";
import { addComment, createTask, deleteTask, getTaskDetail, moveTask, updateTask } from "../../src/actions/tasks";
import { deleteRelease, deployRelease, getReleaseTaskDetails } from "../../src/actions/releases";
import { addProjectMember, createProject, removeProjectMember, setMyProjectPicks, setAttachmentLimits, setProjectVisibility } from "../../src/actions/projects";

/** Tres proyectos (equipo con asignado, equipo sin asignados, privado) con dos administradores, un miembro y un ajeno. */
async function world() {
  const admin = await makeUser({ role: "ADMIN" });
  const otherAdmin = await makeUser({ role: "ADMIN" });
  const member = await makeUser();
  const outsider = await makeUser();
  const pub = await makeProject({ members: [member] });
  const unassigned = await makeProject({ members: [] });
  const priv = await makeProject({ visibility: "PRIVATE", owner: admin, members: [member] });
  // El administrador trabaja en el de equipo asignado; el otro administrador no ha elegido ninguno.
  await db.adminProjectPick.create({ data: { projectId: pub.project.id, userId: admin.id } });
  return { admin, otherAdmin, member, outsider, pub, unassigned, priv };
}

describe("visibleProjectsWhere / assertProjectAccess / assertTaskAccess", () => {
  test("equipo: usuarios asignados y todos los admins; privado: solo sus miembros (ni otros admins)", async () => {
    const w = await world();
    const ids = [w.pub.project.id, w.unassigned.project.id, w.priv.project.id];
    const visibleTo = async (u: { id: string; role: "ADMIN" | "MEMBER" }) => {
      const user = { ...(await db.user.findUniqueOrThrow({ where: { id: u.id } })), theme: "SYSTEM", accent: "BLUE", locale: "ES" } as never;
      const rows = await db.project.findMany({ where: { id: { in: ids }, ...visibleProjectsWhere(user) }, select: { id: true } });
      return new Set(rows.map((r) => r.id));
    };
    assert.deepEqual(await visibleTo(w.admin), new Set(ids));
    // Otro administrador ve los de equipo (elegidos o no) pero nunca el privado ajeno.
    assert.deepEqual(await visibleTo(w.otherAdmin), new Set([w.pub.project.id, w.unassigned.project.id]));
    assert.deepEqual(await visibleTo(w.member), new Set([w.pub.project.id, w.priv.project.id]));
    assert.deepEqual(await visibleTo(w.outsider), new Set());
  });

  test("listVisibleProjects, assertProjectAccess y assertTaskAccess respetan la visibilidad", async () => {
    const w = await world();
    const task = await makeTask(w.priv);
    const asCurrent = (u: typeof w.admin) => ({ ...u, theme: "SYSTEM", accent: "BLUE", locale: "ES" }) as never;
    await assert.rejects(assertProjectAccess(asCurrent(w.otherAdmin), w.priv.project.id), (e: Error) => /No encontrado/.test(e.message));
    await assert.rejects(assertTaskAccess(asCurrent(w.outsider), task.id), (e: Error) => /No encontrado/.test(e.message));
    await assert.rejects(assertProjectAccess(asCurrent(w.outsider), w.pub.project.id), (e: Error) => /No encontrado/.test(e.message));
    await assertProjectAccess(asCurrent(w.member), w.priv.project.id);
    assert.deepEqual(await assertTaskAccess(asCurrent(w.admin), task.id), { projectId: w.priv.project.id, columnId: w.priv.columns.todo });
    // Un administrador abre cualquier proyecto de equipo aunque no lo tenga elegido.
    await assertProjectAccess(asCurrent(w.otherAdmin), w.unassigned.project.id);
  });

  test("listVisibleProjects: el admin solo lista los de equipo que ha elegido y sus privados", async () => {
    const w = await world();
    const asCurrent = (u: typeof w.admin) => ({ ...u, theme: "SYSTEM", accent: "BLUE", locale: "ES" }) as never;
    const ids = async (u: typeof w.admin, opts?: { all?: boolean }) => new Set((await listVisibleProjects(asCurrent(u), opts)).map((p) => p.id));
    const mine = new Set([w.pub.project.id, w.priv.project.id]);
    const own = await ids(w.admin);
    assert.ok([...mine].every((id) => own.has(id)) && !own.has(w.unassigned.project.id));
    assert.ok((await ids(w.admin, { all: true })).has(w.unassigned.project.id));
    const other = await ids(w.otherAdmin);
    assert.ok(!other.has(w.pub.project.id) && !other.has(w.priv.project.id));
    assert.ok((await ids(w.otherAdmin, { all: true })).has(w.pub.project.id));
    assert.deepEqual(await ids(w.member), mine);
    assert.deepEqual(await ids(w.outsider), new Set());
  });

  test("asignación de tarjetas: privado solo miembros; equipo, asignados y admins", async () => {
    const w = await world();
    await assertAssignable(w.pub.project.id, w.member.id);
    await assertAssignable(w.pub.project.id, w.otherAdmin.id);
    await assert.rejects(assertAssignable(w.pub.project.id, w.outsider.id), (e: Error) => /No encontrado/.test(e.message));
    await assertAssignable(w.priv.project.id, w.member.id);
    await assert.rejects(assertAssignable(w.priv.project.id, w.otherAdmin.id), (e: Error) => /No encontrado/.test(e.message));
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

  test("proyecto de equipo: el asignado y los admins operan; el no asignado no", async () => {
    const w = await world();
    const task = await makeTask(w.pub);
    await loginAs(w.outsider);
    expectFail(await getTaskDetail(task.id), NOT_FOUND);
    expectFail(await addComment(task.id, "hola"), NOT_FOUND);
    expectFail(await updateTask(task.id, { title: "Cambiada" }), NOT_FOUND);
    await loginAs(w.otherAdmin);
    expectOk(await getTaskDetail(task.id));
    await loginAs(w.member);
    expectOk(await addComment(task.id, "hola"));
    expectOk(await updateTask(task.id, { title: "Cambiada por la asignada" }));
  });

  test("el borrado y la edición de comentarios ajenos: solo autor o admin", async () => {
    const w = await world();
    const task = await makeTask(w.pub);
    await loginAs(w.member);
    const comment = expectOk(await addComment(task.id, "mío"));
    const { deleteComment } = await import("../../src/actions/tasks");
    await assign(w.pub, w.outsider);
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

  test("deployRelease en un proyecto de equipo mueve la tarea a «En producción»", async () => {
    const w = await world();
    await assign(w.pub, w.outsider);
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
    expectFail(await createProject("Equipo"), FORBIDDEN);
    expectFail(await createProject("Equipo 2", { isPrivate: false }), FORBIDDEN);
    expectFail(await createProject("Con plantilla", { isPrivate: true, templateId: "x" }), FORBIDDEN);
    const created = expectOk(await createProject("Mi privado", { isPrivate: true }));
    const row = await db.project.findUniqueOrThrow({ where: { id: created.id }, include: { members: true } });
    assert.equal(row.isPrivate, true);
    assert.equal(row.privateOwnerId, u.id);
    assert.deepEqual(row.members.map((m) => m.userId), [u.id]);
  });

  test("un administrador crea proyectos de equipo (los marca como suyos); setProjectVisibility es solo de administradores", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    await loginAs(admin);
    const created = expectOk(await createProject("Equipo admin"));
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: created.id } })).isPrivate, false);
    assert.equal(await db.adminProjectPick.count({ where: { projectId: created.id, userId: admin.id } }), 1);
    expectOk(await addProjectMember(created.id, member.id));
    await loginAs(member);
    expectFail(await setProjectVisibility(created.id, "PRIVATE"), FORBIDDEN);
    // Tras hacerlo privado solo queda quien lo hizo: el asignado y otros administradores dejan de verlo.
    const column = await db.column.findFirstOrThrow({ where: { projectId: created.id } });
    const task = await db.task.create({ data: { projectId: created.id, columnId: column.id, title: "T", kindId: (await makeKind()).id, position: 1000, assigneeId: member.id } });
    await loginAs(admin);
    expectOk(await setProjectVisibility(created.id, "PRIVATE"));
    assert.deepEqual((await db.projectMember.findMany({ where: { projectId: created.id } })).map((m) => m.userId), [admin.id]);
    assert.equal(await db.adminProjectPick.count({ where: { projectId: created.id } }), 0);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId, null);
    const other = await makeUser({ role: "ADMIN" });
    await asUser(other, async () => expectFail(await setProjectVisibility(created.id, "TEAM"), NOT_FOUND));
    await loginAs(admin);
    // De vuelta a equipo: se conserva el miembro administrador como proyecto elegido.
    expectOk(await setProjectVisibility(created.id, "TEAM"));
    assert.equal(await db.projectMember.count({ where: { projectId: created.id } }), 0);
    assert.equal(await db.adminProjectPick.count({ where: { projectId: created.id, userId: admin.id } }), 1);
  });
});

describe("topes de adjuntos del proyecto (setAttachmentLimits)", () => {
  test("valida rangos y que el ZIP no sea menor que el de la tarea, exige gestionar el proyecto y guarda ambos", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const id = f.project.id;
    const read = () => db.project.findUniqueOrThrow({ where: { id } });
    assert.equal((await read()).releaseZipMaxMb, 80);
    assert.equal((await read()).taskAttachMaxMb, 80);
    await loginAs(admin);
    expectFail(await setAttachmentLimits(id, 9, 80), /mínimo/);
    expectFail(await setAttachmentLimits(id, 80, 501), /máximo/);
    expectFail(await setAttachmentLimits(id, 501, 500), /máximo/);
    expectFail(await setAttachmentLimits(id, 80.5, 100), /no válido/);
    expectFail(await setAttachmentLimits(id, 80, Number.NaN), /no válido/);
    // El paquete no puede ser menor que el tope de la tarea.
    expectFail(await setAttachmentLimits(id, 100, 99), /no puede ser menor/);
    assert.equal((await read()).releaseZipMaxMb, 80);
    assert.equal((await read()).taskAttachMaxMb, 80);
    expectOk(await setAttachmentLimits(id, 50, 200));
    assert.deepEqual([(await read()).taskAttachMaxMb, (await read()).releaseZipMaxMb], [50, 200]);
    expectOk(await setAttachmentLimits(id, 10, 10));
    expectOk(await setAttachmentLimits(id, 500, 500));
    // Un miembro de un proyecto de equipo no puede cambiarlo; un ajeno ni lo ve.
    await loginAs(member);
    expectFail(await setAttachmentLimits(id, 100, 100), FORBIDDEN);
    await loginAs(await makeUser());
    expectFail(await setAttachmentLimits(id, 100, 100), NOT_FOUND);
    assert.equal((await read()).taskAttachMaxMb, 500);
  });
});

describe("asignación de usuarios a proyectos", () => {
  test("solo administradores gestionan los de equipo; los admins no se asignan; quitar desasigna tarjetas", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const other = await makeUser({ role: "ADMIN" });
    const user = await makeUser();
    const f = await makeProject({ members: [] });
    const task = await makeTask(f);
    await loginAs(user);
    expectFail(await addProjectMember(f.project.id, user.id), NOT_FOUND);
    await loginAs(admin);
    expectFail(await addProjectMember(f.project.id, other.id), "Los administradores ven todos");
    expectOk(await addProjectMember(f.project.id, user.id));
    await db.task.update({ where: { id: task.id }, data: { assigneeId: user.id } });
    await loginAs(user);
    expectOk(await getTaskDetail(task.id));
    await loginAs(admin);
    expectOk(await removeProjectMember(f.project.id, user.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId, null);
    await loginAs(user);
    expectFail(await getTaskDetail(task.id), NOT_FOUND);
  });

  test("setMyProjectPicks: solo admins, solo proyectos de equipo", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const user = await makeUser();
    const a = await makeProject();
    const b = await makeProject();
    const priv = await makeProject({ visibility: "PRIVATE", owner: admin });
    await loginAs(user);
    expectFail(await setMyProjectPicks([a.project.id]), FORBIDDEN);
    await loginAs(admin);
    expectOk(await setMyProjectPicks([a.project.id, priv.project.id]));
    assert.deepEqual((await db.adminProjectPick.findMany({ where: { userId: admin.id } })).map((p) => p.projectId), [a.project.id]);
    expectOk(await setMyProjectPicks([b.project.id]));
    assert.deepEqual((await db.adminProjectPick.findMany({ where: { userId: admin.id } })).map((p) => p.projectId), [b.project.id]);
  });
});
