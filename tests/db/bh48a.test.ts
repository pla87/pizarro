// Caza de bugs 48a contra PostgreSQL real: los nombres se guardan con un solo espacio normal (proyectos, columnas,
// etiquetas) y un proyecto cuyo nombre guardado tiene dos espacios o uno duro se borra escribiendo lo que se ve.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeUser } from "./helpers";

const { createLabel, deleteProject, updateProject } = await import("../../src/actions/projects");
const { renameColumn } = await import("../../src/actions/columns");

describe("nombres con espacios dobles o duros", () => {
  test("proyecto, columna y etiqueta se guardan con un solo espacio normal", async () => {
    const owner = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner });
    await loginAs(owner);
    expectOk(await updateProject(f.project.id, { name: "  Mi  proyecto   web ", description: "" }));
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: f.project.id } })).name, "Mi proyecto web");
    expectOk(await renameColumn(f.columns.todo, "Por  hacer"));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).name, "Por hacer");
    const label = expectOk(await createLabel(f.project.id, { name: "Muy  urgente", color: "#ef4444" }));
    assert.equal(label.name, "Muy urgente");
  });

  test("borrar: basta con escribir el nombre tal como se ve", async () => {
    const owner = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner });
    await loginAs(owner);
    // Guardado antes del arreglo (o importado) con dos espacios y uno duro.
    await db.project.update({ where: { id: f.project.id }, data: { name: "Borrar  doble espacio" } });
    expectFail(await deleteProject(f.project.id, "Borrar doble"), "El nombre no coincide.");
    expectOk(await deleteProject(f.project.id, "Borrar doble espacio"));
    assert.equal(await db.project.count({ where: { id: f.project.id } }), 0);
  });
});
