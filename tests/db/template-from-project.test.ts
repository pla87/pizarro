// «Crear desde un proyecto»: el nombre propuesto para la plantilla sale en el idioma de quien la crea, y el tipo por
// defecto de cada columna viaja por nombre hasta el proyecto que se crea con ella.
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { createProject } from "../../src/actions/projects";
import { saveTemplate, templateFromProject } from "../../src/actions/templates";

test("el nombre propuesto se traduce al idioma del administrador", async () => {
  const admin = await makeUser({ role: "ADMIN" });
  const f = await makeProject({ members: [] });
  await loginAs(admin);
  assert.equal(expectOk(await templateFromProject(f.project.id)).name, `Plantilla de ${f.project.name}`);
  await db.user.update({ where: { id: admin.id }, data: { locale: "EN" } });
  await loginAs(admin);
  assert.equal(expectOk(await templateFromProject(f.project.id)).name, `${f.project.name} template`);
});

test("tipo por defecto de cada columna: la plantilla lo copia por nombre y el proyecto nuevo lo recibe (si el tipo existe)", async () => {
  const admin = await makeUser({ role: "ADMIN" });
  const f = await makeProject({ members: [] });
  await loginAs(admin);
  const general = await db.taskKind.create({ data: { name: `General ${Math.random().toString(36).slice(2, 7)}`, color: "#3b82f6", position: 99, projectId: null } });
  try {
    const own = await db.taskKind.create({ data: { name: "Cita médica", color: "#3b82f6", position: 2, projectId: f.project.id } });
    await db.column.update({ where: { id: f.columns.todo }, data: { defaultKindId: own.id } });
    await db.column.update({ where: { id: f.columns.doing }, data: { defaultKindId: general.id } });
    const input = expectOk(await templateFromProject(f.project.id));
    assert.deepEqual(input.columns.map((c) => c.defaultKind ?? null), ["Cita médica", general.name, null]);
    // Una columna con un tipo que no existe en el proyecto nuevo se queda sin él.
    input.columns[2]!.defaultKind = "No existe";
    const { id } = expectOk(await saveTemplate(input));
    const project = expectOk(await createProject("Con tipos por defecto", { templateId: id }));
    const cols = await db.column.findMany({ where: { projectId: project.id }, orderBy: { position: "asc" }, select: { defaultKind: { select: { name: true, projectId: true } } } });
    assert.deepEqual(cols.map((c) => c.defaultKind), [{ name: "Cita médica", projectId: project.id }, { name: general.name, projectId: null }, null]);
  } finally {
    await db.taskKind.delete({ where: { id: general.id } });
  }
});
