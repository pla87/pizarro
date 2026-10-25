// Miembros de proyectos privados, contraseñas y cambio forzado, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, makeTask, makeUser, NOT_FOUND, saveSession, restoreSession } from "./helpers";
import { addProjectMember, deleteProject, removeProjectMember, updateProject } from "../../src/actions/projects";
import { getTaskDetail, updateTask } from "../../src/actions/tasks";
import { setNewPassword } from "../../src/actions/auth";
import * as usersActions from "../../src/actions/users";
import { forcePasswordChange, updateUser } from "../../src/actions/users";
import { getCurrentUser, getPendingUser } from "../../src/lib/session";
import { hashPassword } from "../../src/lib/password";

describe("miembros de proyectos privados", () => {
  test("un miembro añade y quita miembros; quien no lo es recibe «no encontrado»", async () => {
    const owner = await makeUser();
    const friend = await makeUser();
    const stranger = await makeUser();
    const p = await makeProject({ visibility: "PRIVATE", owner });

    await loginAs(stranger);
    expectFail(await addProjectMember(p.project.id, friend.id), NOT_FOUND);

    await loginAs(owner);
    expectOk(await addProjectMember(p.project.id, friend.id));
    // Idempotente.
    expectOk(await addProjectMember(p.project.id, friend.id));
    assert.equal(await db.projectMember.count({ where: { projectId: p.project.id } }), 2);

    // El nuevo miembro ya ve el proyecto; el ajeno sigue sin verlo.
    const task = await makeTask(p);
    await loginAs(friend);
    expectOk(await getTaskDetail(task.id));
    await loginAs(stranger);
    expectFail(await getTaskDetail(task.id), NOT_FOUND);

    // Quitar a un miembro lo deja fuera y desasigna sus tarjetas.
    await db.task.update({ where: { id: task.id }, data: { assigneeId: friend.id } });
    await loginAs(owner);
    expectOk(await removeProjectMember(p.project.id, friend.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId, null);
    await loginAs(friend);
    expectFail(await getTaskDetail(task.id), NOT_FOUND);
  });

  test("no se puede añadir a un usuario desactivado ni a un administrador en un proyecto de equipo", async () => {
    const owner = await makeUser();
    const inactive = await makeUser({ active: false });
    const p = await makeProject({ visibility: "PRIVATE", owner });
    await loginAs(owner);
    expectFail(await addProjectMember(p.project.id, inactive.id), /Usuario no válido/);

    const admin = await makeUser({ role: "ADMIN" });
    const pub = await makeProject();
    await loginAs(admin);
    // En un proyecto de equipo los administradores no se asignan (ven todos).
    expectFail(await addProjectMember(pub.project.id, admin.id), /administradores ven todos/);
  });

  test("el último miembro no puede salir; con otro miembro sí", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const p = await makeProject({ visibility: "PRIVATE", owner });
    await loginAs(owner);
    expectFail(await removeProjectMember(p.project.id, owner.id), /último miembro/);
    assert.equal(await db.projectMember.count({ where: { projectId: p.project.id } }), 1);

    expectOk(await addProjectMember(p.project.id, other.id));
    expectOk(await removeProjectMember(p.project.id, owner.id));
    assert.deepEqual((await db.projectMember.findMany({ where: { projectId: p.project.id } })).map((m) => m.userId), [other.id]);
    // Ya no es miembro: no puede volver a tocar el proyecto.
    expectFail(await removeProjectMember(p.project.id, other.id), NOT_FOUND);
  });

  test("un miembro desactivado no cuenta como «otro miembro» para dejar salir al último activo", async () => {
    const owner = await makeUser();
    const gone = await makeUser({ active: false });
    const p = await makeProject({ visibility: "PRIVATE", owner, members: [gone] });
    await loginAs(owner);
    expectFail(await removeProjectMember(p.project.id, owner.id), /último miembro/);
  });

  test("un no administrador no puede renombrar ni borrar proyectos no privados; en privados sí, solo con el nombre exacto", async () => {
    const member = await makeUser();
    const pub = await makeProject();
    await loginAs(member);
    expectFail(await updateProject(pub.project.id, { name: "Nuevo", description: "" }), FORBIDDEN);
    expectFail(await deleteProject(pub.project.id, pub.project.name), FORBIDDEN);

    const priv = await makeProject({ visibility: "PRIVATE", owner: member });
    expectOk(await updateProject(priv.project.id, { name: "Renombrado", description: "" }));
    expectFail(await deleteProject(priv.project.id, "otro nombre"), /nombre no coincide/);
    expectOk(await deleteProject(priv.project.id, "Renombrado"));
    assert.equal(await db.project.count({ where: { id: priv.project.id } }), 0);
  });

  test("un administrador ajeno no puede gestionar el privado de otro", async () => {
    const owner = await makeUser();
    const admin = await makeUser({ role: "ADMIN" });
    const p = await makeProject({ visibility: "PRIVATE", owner });
    await loginAs(admin);
    expectFail(await addProjectMember(p.project.id, admin.id), NOT_FOUND);
    expectFail(await deleteProject(p.project.id, p.project.name), NOT_FOUND);
    assert.equal(await db.project.count({ where: { id: p.project.id } }), 1);
  });
});

describe("contraseñas y cambio forzado", () => {
  test("ninguna acción de administración permite fijar la contraseña de otra persona", async () => {
    // La API de usuarios solo ofrece alta (clave inicial obligada a cambiar), edición, forzar cambio, 2FA y borrado.
    assert.deepEqual(Object.keys(usersActions).sort(), ["createUser", "deleteUser", "forcePasswordChange", "resetUserTwoFactor", "unlinkGoogle", "updateUser"]);

    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    const hash = await hashPassword("clave-original-123");
    await db.user.update({ where: { id: target.id }, data: { passwordHash: hash } });
    await loginAs(admin);
    // Un campo de contraseña colado en updateUser se descarta (esquema estricto de campos conocidos).
    expectOk(await updateUser(target.id, { name: "Otro nombre", email: target.email, role: "MEMBER", active: true, password: "hackeada-12345" } as never));
    const row = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(row.passwordHash, hash);
    assert.equal(row.name, "Otro nombre");
  });

  test("forcePasswordChange: marca el cambio, cierra sus sesiones y no toca la contraseña; solo admins y nunca a uno mismo", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    const hash = await hashPassword("clave-original-123");
    await db.user.update({ where: { id: target.id }, data: { passwordHash: hash } });
    await loginAs(target);
    const targetCookie = saveSession();

    await loginAs(target);
    expectFail(await forcePasswordChange(admin.id), FORBIDDEN);

    await loginAs(admin);
    expectFail(await forcePasswordChange(admin.id), /Mi perfil/);
    expectOk(await forcePasswordChange(target.id));
    const row = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(row.mustChangePassword, true);
    assert.equal(row.passwordHash, hash);
    assert.equal(await db.session.count({ where: { userId: target.id } }), 0);

    // La sesión vieja ya no vale.
    restoreSession(targetCookie);
    assert.equal(await getCurrentUser(), null);
  });

  test("con el cambio pendiente (sesión viva) las acciones quedan bloqueadas y solo se puede elegir la contraseña nueva", async () => {
    const target = await makeUser({ mustChangePassword: true });
    const old = await hashPassword("clave-original-123");
    await db.user.update({ where: { id: target.id }, data: { passwordHash: old } });
    const p = await makeProject();
    const task = await makeTask(p);
    await loginAs(target);

    assert.equal(await getCurrentUser(), null);
    assert.equal((await getPendingUser())?.id, target.id);
    expectFail(await getTaskDetail(task.id), /elegir una contraseña nueva/);
    expectFail(await updateTask(task.id, { title: "x" }), /elegir una contraseña nueva/);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, task.title);

    // La nueva contraseña debe ser distinta; al elegirla, la marca desaparece y las acciones vuelven a funcionar.
    expectFail(await setNewPassword("clave-original-123"), /distinta de la actual/);
    expectOk(await setNewPassword("clave-nueva-segura-456"));
    const row = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(row.mustChangePassword, false);
    assert.notEqual(row.passwordHash, old);
    expectOk(await getTaskDetail(task.id));
  });

  test("un usuario normal no puede forzar cambios ni editar usuarios", async () => {
    const member = await makeUser();
    const other = await makeUser();
    await loginAs(member);
    expectFail(await forcePasswordChange(other.id), FORBIDDEN);
    expectFail(await updateUser(other.id, { name: "x", email: other.email, role: "ADMIN", active: true }), FORBIDDEN);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: other.id } })).role, "MEMBER");
  });
});
