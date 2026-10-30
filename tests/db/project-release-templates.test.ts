// Cabeceras y pies de release del proyecto: permisos, orden, topes y datos del diálogo «Generar release».
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, makeUser, NOT_FOUND } from "./helpers";
import {
  createProjectReleaseTemplate, deleteProjectReleaseTemplate, moveProjectReleaseTemplate, updateProjectReleaseTemplate,
} from "../../src/actions/project-release-templates";
import { createReleaseTemplate } from "../../src/actions/profile";
import { purgeProject } from "../../src/lib/project-delete";
import { projectReleaseTemplates, userTemplates } from "../../src/lib/board";
import { MAX_RELEASE_TEMPLATES_PER_KIND, MAX_TEMPLATE } from "../../src/lib/constants";

const names = (list: { name: string }[]) => list.map((x) => x.name);

describe("plantillas de release del proyecto", () => {
  test("permisos: admin en equipo; miembros solo en privados; ajenos no ven ni el proyecto", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const outsider = await makeUser();
    const team = await makeProject({ members: [member] });
    const priv = await makeProject({ visibility: "PRIVATE", owner: member, members: [member] });

    // Equipo: un miembro no administrador no gestiona los ajustes del proyecto.
    await loginAs(member);
    expectFail(await createProjectReleaseTemplate(team.project.id, "HEADER", { name: "A", content: "x" }), FORBIDDEN);
    await loginAs(admin);
    const tpl = expectOk(await createProjectReleaseTemplate(team.project.id, "HEADER", { name: "A", content: "x" }));
    await loginAs(member);
    expectFail(await updateProjectReleaseTemplate(tpl.id, { name: "B", content: "y" }), FORBIDDEN);
    expectFail(await moveProjectReleaseTemplate(tpl.id, 1), FORBIDDEN);
    expectFail(await deleteProjectReleaseTemplate(tpl.id), FORBIDDEN);
    assert.equal((await db.projectReleaseTemplate.findUniqueOrThrow({ where: { id: tpl.id } })).name, "A");

    // Privado: gestiona cualquier miembro; un administrador ajeno ni siquiera lo ve.
    const own = expectOk(await createProjectReleaseTemplate(priv.project.id, "FOOTER", { name: "Pie", content: "- [ ] ok" }));
    expectOk(await updateProjectReleaseTemplate(own.id, { name: "Pie 2", content: "z" }));
    await loginAs(admin);
    expectFail(await createProjectReleaseTemplate(priv.project.id, "FOOTER", { name: "N", content: "" }), NOT_FOUND);
    expectFail(await deleteProjectReleaseTemplate(own.id), NOT_FOUND);
    await loginAs(outsider);
    expectFail(await createProjectReleaseTemplate(team.project.id, "HEADER", { name: "N", content: "" }), NOT_FOUND);
    expectFail(await updateProjectReleaseTemplate(tpl.id, { name: "N", content: "" }), NOT_FOUND);
    await loginAs(member);
    expectOk(await deleteProjectReleaseTemplate(own.id));
    assert.equal(await db.projectReleaseTemplate.count({ where: { projectId: priv.project.id } }), 0);
  });

  test("orden: altas al final de su tipo, subir/bajar y el diálogo recibe el orden del proyecto", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const id = f.project.id;
    await loginAs(admin);
    const [h1, h2, h3] = [
      expectOk(await createProjectReleaseTemplate(id, "HEADER", { name: "H1", content: "uno" })),
      expectOk(await createProjectReleaseTemplate(id, "HEADER", { name: "H2", content: "dos" })),
      expectOk(await createProjectReleaseTemplate(id, "HEADER", { name: "H3", content: "tres" })),
    ];
    expectOk(await createProjectReleaseTemplate(id, "FOOTER", { name: "F1", content: "pie" }));
    let data = await projectReleaseTemplates(id);
    assert.deepEqual(names(data.headers), ["H1", "H2", "H3"]);
    assert.deepEqual(names(data.footers), ["F1"]);

    expectOk(await moveProjectReleaseTemplate(h3.id, -1));
    expectOk(await moveProjectReleaseTemplate(h1.id, 1));
    data = await projectReleaseTemplates(id);
    // H3 subió sobre H2 (H1,H3,H2) y luego H1 bajó una (H3,H1,H2).
    assert.deepEqual(names(data.headers), ["H3", "H1", "H2"]);
    // En los extremos no hace nada ni falla; el pie queda aparte.
    expectOk(await moveProjectReleaseTemplate(h3.id, -1));
    expectOk(await moveProjectReleaseTemplate(h2.id, 1));
    assert.deepEqual(names((await projectReleaseTemplates(id)).headers), ["H3", "H1", "H2"]);
    assert.deepEqual(names((await projectReleaseTemplates(id)).footers), ["F1"]);
    expectFail(await moveProjectReleaseTemplate(h1.id, 2), /./);

    // Datos del diálogo: las del usuario y las del proyecto van en listas separadas (el diálogo pone las suyas primero).
    await createReleaseTemplate("HEADER", { name: "Mía", content: "m" });
    const own = await userTemplates(admin.id);
    assert.deepEqual(names(own.headers), ["Mía"]);
    assert.deepEqual(names((await projectReleaseTemplates(id)).headers), ["H3", "H1", "H2"]);
    // Otro proyecto no mezcla plantillas.
    const other = await makeProject({ members: [] });
    assert.deepEqual(await projectReleaseTemplates(other.project.id), { headers: [], footers: [] });
    void h2;
  });

  test("topes (20 por tipo y proyecto), longitud y nombre", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const id = f.project.id;
    await loginAs(admin);
    await db.projectReleaseTemplate.createMany({
      data: Array.from({ length: MAX_RELEASE_TEMPLATES_PER_KIND }, (_, i) => ({ projectId: id, kind: "HEADER" as const, name: `H${i}`, content: "", position: i + 1 })),
    });
    expectFail(await createProjectReleaseTemplate(id, "HEADER", { name: "Extra", content: "" }), /Máximo 20/);
    // Los pies tienen su propio cupo.
    const footer = expectOk(await createProjectReleaseTemplate(id, "FOOTER", { name: "F", content: "" }));
    expectFail(await createProjectReleaseTemplate(id, "FOOTER", { name: "G", content: "x".repeat(MAX_TEMPLATE + 1) }), /demasiado larga/);
    expectOk(await createProjectReleaseTemplate(id, "FOOTER", { name: "G", content: "x".repeat(MAX_TEMPLATE) }));
    expectFail(await createProjectReleaseTemplate(id, "FOOTER", { name: "N".repeat(61), content: "" }), /60/);
    expectFail(await updateProjectReleaseTemplate(footer.id, { name: "  ", content: "" }), /./);
  });

  test("borrar el proyecto borra sus plantillas", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    expectOk(await createProjectReleaseTemplate(f.project.id, "HEADER", { name: "H", content: "" }));
    assert.equal(await db.projectReleaseTemplate.count({ where: { projectId: f.project.id } }), 1);
    await purgeProject(f.project.id);
    assert.equal(await db.projectReleaseTemplate.count({ where: { projectId: f.project.id } }), 0);
  });
});
