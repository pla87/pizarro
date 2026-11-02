// «Crear desde un proyecto»: el nombre propuesto para la plantilla sale en el idioma de quien la crea.
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { templateFromProject } from "../../src/actions/templates";

test("el nombre propuesto se traduce al idioma del administrador", async () => {
  const admin = await makeUser({ role: "ADMIN" });
  const f = await makeProject({ members: [] });
  await loginAs(admin);
  assert.equal(expectOk(await templateFromProject(f.project.id)).name, `Plantilla de ${f.project.name}`);
  await db.user.update({ where: { id: admin.id }, data: { locale: "EN" } });
  await loginAs(admin);
  assert.equal(expectOk(await templateFromProject(f.project.id)).name, `${f.project.name} template`);
});
