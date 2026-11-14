// Administrador que abre un proyecto de equipo que no está en «Proyectos en los que trabajo»: el selector lo muestra
// marcado y con «Añadir a mis proyectos», sin añadirlo solo; quien no es administrador nunca tiene uno así.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeUser, NOT_FOUND } from "./helpers";
import { addProjectToMine, projectOutsideList } from "../../src/actions/project-visit";
import { outsideListProject } from "../../src/lib/project-visit";

describe("proyecto de equipo fuera de la lista del administrador", () => {
  test("de equipo, sin elegir y sin ser miembro: se muestra; elegido, miembro, privado o inexistente: no", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const other = await makeUser();
    const team = await makeProject({ members: [] });
    const picked = await makeProject({ members: [] });
    const memberOf = await makeProject({ members: [admin] });
    const foreignPrivate = await makeProject({ visibility: "PRIVATE", owner: other });
    await db.adminProjectPick.create({ data: { projectId: picked.project.id, userId: admin.id } });
    const me = { id: admin.id, role: "ADMIN" as const };
    assert.deepEqual(await outsideListProject(me, team.project.id), { id: team.project.id, name: team.project.name });
    assert.equal(await outsideListProject(me, picked.project.id), null);
    assert.equal(await outsideListProject(me, memberOf.project.id), null);
    assert.equal(await outsideListProject(me, foreignPrivate.project.id), null, "un privado ajeno no existe para él");
    assert.equal(await outsideListProject(me, "no-existe"), null);
    assert.equal(await outsideListProject(me, "x".repeat(41)), null);

    // La acción (navegación de la app) devuelve lo mismo y no añade nada a su lista.
    await loginAs(admin);
    assert.deepEqual(expectOk(await projectOutsideList(team.project.id)), { id: team.project.id, name: team.project.name });
    assert.equal(await db.adminProjectPick.count({ where: { userId: admin.id, projectId: team.project.id } }), 0, "abrirlo no lo añade");
    // «Añadir a mis proyectos»: queda en su lista y deja de estar fuera.
    expectOk(await addProjectToMine(team.project.id));
    assert.equal(await db.adminProjectPick.count({ where: { userId: admin.id, projectId: team.project.id } }), 1);
    assert.equal(expectOk(await projectOutsideList(team.project.id)), null);
    expectFail(await addProjectToMine(foreignPrivate.project.id), NOT_FOUND);
  });

  test("quien no es administrador: nunca hay proyecto fuera de su lista ni puede añadirse uno de equipo", async () => {
    const m = await makeUser();
    const team = await makeProject({ members: [] });
    assert.equal(await outsideListProject({ id: m.id, role: "MEMBER" }, team.project.id), null);
    await loginAs(m);
    assert.equal(expectOk(await projectOutsideList(team.project.id)), null);
    expectFail(await addProjectToMine(team.project.id), /No tienes permiso/);
    assert.equal(await db.adminProjectPick.count({ where: { projectId: team.project.id } }), 0);
  });
});
