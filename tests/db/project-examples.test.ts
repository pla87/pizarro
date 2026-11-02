// Crear un proyecto desde cada ejemplo, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeUser } from "./helpers";
import { createProject, listProjectExamples } from "../../src/actions/projects";
import { dateToIso, todayIso } from "../../src/lib/dates";
import { appTimeZone } from "../../src/lib/format";
import { EXAMPLE_KEYS, EXAMPLE_LABEL, resolveExample, type ExampleLocale } from "../../src/lib/project-examples";

async function check(projectId: string, key: string, locale: ExampleLocale) {
  const ex = resolveExample(key, locale)!;
  const columns = await db.column.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  assert.deepEqual(columns.map((c) => [c.name, c.role, c.isDone]), ex.template.columns.map((c) => [c.name, c.role, c.isDone]), `${key}: columnas`);
  const tasks = await db.task.findMany({ where: { projectId }, include: { labels: { include: { label: true } }, subtasks: true, kind: true } });
  assert.equal(tasks.length, ex.content.tasks.length, `${key}: tarjetas`);
  for (const t of tasks) {
    assert.ok(t.labels.some((l) => l.label.name === EXAMPLE_LABEL[locale].name), `${key}: «${t.title}» sin etiqueta de ejemplo`);
    assert.ok(t.kind, `${key}: «${t.title}» sin tipo`);
  }
  const deliverables = await db.deliverable.findMany({ where: { projectId } });
  assert.equal(deliverables.length, (ex.content.deliverables ?? []).length);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  assert.equal(project.description, ex.content.description);
  assert.deepEqual([...project.taskFields].sort(), [...ex.template.taskFields].sort());
  assert.equal(await db.projectReleaseTemplate.count({ where: { projectId } }), ex.template.releaseTemplates.length);
  return { tasks, columns, deliverables };
}

describe("proyectos desde un ejemplo", () => {
  test("cada ejemplo se crea en español con columnas, tarjetas, etiqueta de ejemplo y configuración", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const list = expectOk(await listProjectExamples());
    assert.deepEqual(list.map((e) => e.key).sort(), [...EXAMPLE_KEYS].sort());
    for (const key of EXAMPLE_KEYS) {
      const p = expectOk(await createProject(`Prueba ${key}`, { exampleKey: key }));
      await check(p.id, key, "es");
    }
  });

  test("software: tipos general y propio; familia: repeticiones en rutinas; eventos: entregables con fecha y coste", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const sw = expectOk(await createProject("Software", { exampleKey: "equipo-software" }));
    const swTasks = await db.task.findMany({ where: { projectId: sw.id }, include: { kind: true } });
    assert.ok(swTasks.some((t) => t.kind.id === "kind_funcionalidad") && swTasks.some((t) => t.kind.id === "kind_correccion") && swTasks.some((t) => t.kind.name === "Mejora"));
    assert.equal(await db.projectHiddenKind.count({ where: { projectId: sw.id } }), 1);
    const home = expectOk(await createProject("Casa", { exampleKey: "familia-casa" }));
    const rec = await db.task.findMany({ where: { projectId: home.id, recurrence: "WEEKLY" } });
    assert.equal(rec.length, 2);
    assert.deepEqual(rec.map((t) => t.recurrenceDay).sort(), [2, 6]);
    assert.ok(rec.every((t) => t.routineColumnId));
    const ev = expectOk(await createProject("Evento", { exampleKey: "eventos" }));
    const { tasks, deliverables } = await check(ev.id, "eventos", "es");
    assert.ok(deliverables.every((d) => d.dueDate && dateToIso(d.dueDate)! > todayIso(appTimeZone())));
    assert.ok(tasks.some((t) => t.deliverableId) && tasks.some((t) => t.cost !== null));
  });

  test("una persona en inglés recibe el ejemplo en inglés", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await db.user.update({ where: { id: admin.id }, data: { locale: "EN" } });
    await loginAs(admin);
    assert.ok(expectOk(await listProjectExamples()).some((e) => e.name === "Software team"));
    for (const key of EXAMPLE_KEYS) {
      const p = expectOk(await createProject(`Example ${key}`, { exampleKey: key }));
      await check(p.id, key, "en");
    }
  });

  test("un miembro sin permisos de administrador puede usar ejemplos (en privado); plantilla y ejemplo a la vez, no; clave inventada, no", async () => {
    const member = await makeUser();
    await loginAs(member);
    const p = expectOk(await createProject("Mi casa", { exampleKey: "familia-casa", isPrivate: true }));
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: p.id } })).isPrivate, true);
    assert.equal(await db.task.count({ where: { projectId: p.id } }), resolveExample("familia-casa", "es")!.content.tasks.length);
    assert.equal((await createProject("X", { exampleKey: "familia-casa", isPrivate: false })).ok, false);
    assert.equal((await createProject("X", { exampleKey: "no-existe", isPrivate: true })).ok, false);
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    assert.equal((await createProject("X", { exampleKey: "eventos", templateId: "cualquiera" })).ok, false);
  });

  test("en blanco sigue igual: columnas por defecto y ninguna tarjeta", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const p = expectOk(await createProject("Vacío"));
    assert.equal(await db.task.count({ where: { projectId: p.id } }), 0);
    assert.equal(await db.column.count({ where: { projectId: p.id } }), 5);
  });
});
