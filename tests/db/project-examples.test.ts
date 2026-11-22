// Crear un proyecto desde cada plantilla de serie con «Con tarjetas de ejemplo», contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeUser } from "./helpers";
import { createProject, listProjectStarts } from "../../src/actions/projects";
import { BUILTIN_KEYS, canonicalTemplate } from "../../src/lib/builtin-templates";
import { canonicalTemplateEn } from "../../src/lib/builtin-templates-en";
import { dateToIso, todayIso } from "../../src/lib/dates";
import { appTimeZone } from "../../src/lib/format";
import { EXAMPLE_LABEL, PROJECT_EXAMPLES, type ExampleLocale } from "../../src/lib/project-examples";
import { resetRateLimit } from "../../src/lib/rate-limit";
import { seedBuiltinTemplates } from "../../src/lib/template-store";

/** Las seis de serie sembradas de nuevo y sin tocar; devuelve su id por clave. */
async function freshBuiltins(): Promise<Record<string, string>> {
  await db.projectTemplate.deleteMany({ where: { builtinKey: { not: null } } });
  await db.builtinTemplateSeeded.deleteMany();
  await seedBuiltinTemplates(db);
  const rows = await db.projectTemplate.findMany({ where: { builtinKey: { not: null } }, select: { id: true, builtinKey: true } });
  return Object.fromEntries(rows.map((r) => [r.builtinKey!, r.id]));
}

async function check(projectId: string, key: string, locale: ExampleLocale) {
  const canon = locale === "en" ? canonicalTemplateEn(key)! : canonicalTemplate(key)!;
  const content = PROJECT_EXAMPLES.find((e) => e.key === key)![locale];
  const columns = await db.column.findMany({ where: { projectId }, orderBy: { position: "asc" } });
  assert.deepEqual(columns.map((c) => [c.name, c.role, c.isDone]), canon.columns.map((c) => [c.name, c.role, c.isDone]), `${key}: columnas`);
  const tasks = await db.task.findMany({ where: { projectId }, include: { labels: { include: { label: true } }, subtasks: true, kind: true, column: true } });
  assert.equal(tasks.length, content.tasks.length, `${key}: tarjetas`);
  for (const t of tasks) {
    assert.ok(t.labels.some((l) => l.label.name === EXAMPLE_LABEL[locale].name), `${key}: «${t.title}» sin etiqueta de ejemplo`);
    const want = content.tasks.find((x) => x.title === t.title)!;
    assert.equal(t.column.name, canon.columns[want.column]!.name, `${key}: «${t.title}» en su columna`);
    if (want.kind) assert.equal(t.kind.name, want.kind, `${key}: «${t.title}» con su tipo`);
  }
  assert.equal((await db.deliverable.findMany({ where: { projectId } })).length, (content.deliverables ?? []).length);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  assert.equal(project.description, canon.description);
  assert.deepEqual([...project.taskFields].sort(), [...canon.taskFields].sort());
  return tasks;
}

describe("plantillas de serie con tarjetas de ejemplo", () => {
  test("cada una se crea en español con sus columnas, sus tarjetas en su sitio y la etiqueta «Ejemplo»; sin la casilla, sin tarjetas", async () => {
    const ids = await freshBuiltins();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const list = expectOk(await listProjectStarts());
    assert.deepEqual(list.filter((t) => t.builtin).map((t) => t.id).sort(), Object.values(ids).sort());
    assert.ok(list.every((t) => t.examples === t.builtin));
    for (const key of BUILTIN_KEYS) {
      resetRateLimit(`project-create:${admin.id}`);
      const p = expectOk(await createProject(`Prueba ${key}`, { templateId: ids[key], withExamples: true }));
      await check(p.id, key, "es");
    }
    const plain = expectOk(await createProject("Sin ejemplos", { templateId: ids["casa-familia"] }));
    assert.equal(await db.task.count({ where: { projectId: plain.id } }), 0);
    assert.equal(await db.label.count({ where: { projectId: plain.id, name: "Ejemplo" } }), 0);
  });

  test("vibecoding: tipos general y propio; casa: repeticiones en rutinas; eventos: entregables con fecha y coste; curso: sesiones en «Programa»", async () => {
    const ids = await freshBuiltins();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const sw = expectOk(await createProject("Software", { templateId: ids.vibecoding, withExamples: true }));
    const swTasks = await db.task.findMany({ where: { projectId: sw.id }, include: { kind: true } });
    assert.ok(swTasks.some((t) => t.kind.id === "kind_funcionalidad") && swTasks.some((t) => t.kind.id === "kind_correccion") && swTasks.some((t) => t.kind.name === "Mejora"));
    const home = expectOk(await createProject("Casa", { templateId: ids["casa-familia"], withExamples: true }));
    const rec = await db.task.findMany({ where: { projectId: home.id, recurrence: "WEEKLY" } });
    assert.deepEqual(rec.map((t) => t.recurrenceDay).sort(), [2, 6]);
    assert.ok(rec.every((t) => t.routineColumnId));
    const ev = expectOk(await createProject("Evento", { templateId: ids["eventos-viajes"], withExamples: true }));
    const evTasks = await check(ev.id, "eventos-viajes", "es");
    const deliverables = await db.deliverable.findMany({ where: { projectId: ev.id } });
    assert.ok(deliverables.length >= 3 && deliverables.every((d) => d.dueDate && dateToIso(d.dueDate)! > todayIso(appTimeZone())));
    assert.ok(evTasks.some((t) => t.deliverableId) && evTasks.some((t) => t.cost !== null && t.column.role === "BUDGET"));
    const course = expectOk(await createProject("Curso", { templateId: ids["curso-master"], withExamples: true }));
    const program = await db.column.findFirstOrThrow({ where: { projectId: course.id, role: "PROGRAM" } });
    const sessions = await db.task.findMany({ where: { columnId: program.id }, orderBy: { position: "asc" } });
    assert.equal(sessions.length, 3);
    assert.ok(sessions.every((t) => t.dueDate));
    assert.ok(sessions.some((t) => t.startDate && t.dueDate && t.startDate < t.dueDate));
    // …encargos para el agente en «Plan de trabajo para IA», uno de ellos fijo («Siempre en el plan»), y uno en «Publicado».
    const plan = await db.column.findFirstOrThrow({ where: { projectId: course.id, role: "AI_PLAN" } });
    const planTasks = await db.task.findMany({ where: { columnId: plan.id }, orderBy: { position: "asc" } });
    assert.deepEqual(planTasks.map((t) => t.evergreen), [false, true]);
    assert.equal(await db.task.count({ where: { projectId: course.id, evergreen: true, columnId: { not: plan.id } } }), 0);
    assert.equal(await db.task.count({ where: { projectId: course.id, column: { isDone: true } } }), 1);
  });

  test("una persona en inglés recibe la plantilla y las tarjetas en inglés", async () => {
    const ids = await freshBuiltins();
    const admin = await makeUser({ role: "ADMIN" });
    await db.user.update({ where: { id: admin.id }, data: { locale: "EN" } });
    await loginAs(admin);
    assert.ok(expectOk(await listProjectStarts()).some((e) => e.name === "Home and family"));
    for (const key of BUILTIN_KEYS) {
      resetRateLimit(`project-create:${admin.id}`);
      const p = expectOk(await createProject(`Example ${key}`, { templateId: ids[key], withExamples: true }));
      await check(p.id, key, "en");
    }
  });

  test("plantilla modificada: las tarjetas van a la columna del mismo nombre o del mismo rol, y si no, a la primera", async () => {
    const ids = await freshBuiltins();
    const canon = canonicalTemplate("casa-familia")!;
    // El administrador renombró «Citas» (rol Agenda) y quitó «Rutinas»; la persona usa el inglés, pero la plantilla está en español.
    const columns = canon.columns.filter((c) => c.role !== "ROUTINES").map((c) => (c.role === "AGENDA" ? { ...c, name: "Médicos" } : c));
    await db.projectTemplate.update({ where: { id: ids["casa-familia"] }, data: { columns } });
    const admin = await makeUser({ role: "ADMIN" });
    await db.user.update({ where: { id: admin.id }, data: { locale: "EN" } });
    await loginAs(admin);
    const p = expectOk(await createProject("Casa modificada", { templateId: ids["casa-familia"], withExamples: true }));
    const tasks = await db.task.findMany({ where: { projectId: p.id }, include: { column: true, labels: { include: { label: true } } } });
    assert.equal(tasks.length, PROJECT_EXAMPLES.find((e) => e.key === "casa-familia")!.es.tasks.length);
    assert.ok(tasks.every((t) => t.labels.some((l) => l.label.name === "Ejemplo")), "tarjetas en el idioma de la plantilla");
    const at = (title: string) => tasks.find((t) => t.title === title)!.column.name;
    assert.equal(at("Revisión del dentista"), "Médicos");
    assert.equal(at("Sacar la basura"), "Por hacer");
    assert.equal(at("Lista de la compra"), "Lista de la compra");
  });

  test("quien no es administrador usa las de serie (en privado), con o sin ejemplos; las propias, no", async () => {
    const ids = await freshBuiltins();
    const own = await db.projectTemplate.create({ data: { name: "Propia de prueba", columns: [{ name: "Por hacer", role: "NONE", isDone: false }], position: 99_000 } });
    const member = await makeUser();
    await loginAs(member);
    const list = expectOk(await listProjectStarts());
    assert.ok(list.length === BUILTIN_KEYS.length && list.every((t) => t.builtin));
    const p = expectOk(await createProject("Mi casa", { templateId: ids["casa-familia"], withExamples: true, isPrivate: true }));
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: p.id } })).isPrivate, true);
    assert.equal(await db.task.count({ where: { projectId: p.id } }), PROJECT_EXAMPLES.find((e) => e.key === "casa-familia")!.es.tasks.length);
    expectFail(await createProject("X", { templateId: ids["casa-familia"], isPrivate: false }), FORBIDDEN);
    expectFail(await createProject("X", { templateId: own.id, isPrivate: true }), FORBIDDEN);
    // La casilla con una plantilla propia no añade nada.
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const q = expectOk(await createProject("Propia", { templateId: own.id, withExamples: true }));
    assert.equal(await db.task.count({ where: { projectId: q.id } }), 0);
    await db.projectTemplate.delete({ where: { id: own.id } });
  });

  test("en blanco sigue igual: columnas por defecto y ninguna tarjeta", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const p = expectOk(await createProject("Vacío", { withExamples: true }));
    assert.equal(await db.task.count({ where: { projectId: p.id } }), 0);
    assert.equal(await db.column.count({ where: { projectId: p.id } }), 5);
  });
});
