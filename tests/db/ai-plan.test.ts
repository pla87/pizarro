// Columna «Plan de trabajo para IA» (rol AI_PLAN) contra PostgreSQL real: rol repetible, tareas fijas («Siempre en el
// plan») como las de la release, plantillas del plan (persona y proyecto, aparte de las de release), datos para generar
// el plan y «Guardar en Documentación» con su número de versión y sus límites.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { getAiPlanSetup, getAiPlanTaskDetails, saveAiPlan } from "../../src/actions/ai-plan";
import { setColumnRole } from "../../src/actions/columns";
import { createReleaseTemplate } from "../../src/actions/profile";
import { createProjectReleaseTemplate } from "../../src/actions/project-release-templates";
import { createTask, makeEvergreen, moveTask, updateTask } from "../../src/actions/tasks";
import { undoLast } from "../../src/actions/undo";
import { userTemplates } from "../../src/lib/board";
import { todayIso } from "../../src/lib/dates";
import { appTimeZone } from "../../src/lib/format";
import { documentPath } from "../../src/lib/uploads";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-ai-plan-"));

const evergreen = async (id: string) => (await db.task.findUniqueOrThrow({ where: { id } })).evergreen;

describe("rol «Plan de trabajo para IA» y sus tareas fijas", () => {
  test("se repite en varias columnas; cada una conserva sus fijas aunque otra pase a ser la de la release", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectOk(await setColumnRole(f.columns.todo, "AI_PLAN"));
    expectOk(await setColumnRole(f.columns.doing, "AI_PLAN"));
    assert.equal(await db.column.count({ where: { projectId: f.project.id, role: "AI_PLAN" } }), 2);

    // Fija al crearla, al editarla y al soltarla en el panel de la columna.
    const a = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "Fija A", kindId: f.kindId, evergreen: true }));
    assert.equal(await evergreen(a.id), true);
    const b = await makeTask(f, { columnId: f.columns.doing, title: "B" });
    expectOk(await updateTask(b.id, { evergreen: true }));
    assert.equal(await evergreen(b.id), true);
    const c = await makeTask(f, { columnId: f.columns.done, title: "C" });
    const moved = expectOk(await makeEvergreen(c.id, f.columns.doing));
    assert.equal(moved.columnId, f.columns.doing);
    assert.equal(await evergreen(c.id), true);
    // En una columna sin ese rol, no.
    expectFail(await makeEvergreen(c.id, f.columns.done), /Solo pueden ser fijas/);

    // Otra columna pasa a ser la de la release: las fijas de los planes siguen siéndolo.
    expectOk(await setColumnRole(f.columns.done, "NEXT_RELEASE"));
    assert.deepEqual([await evergreen(a.id), await evergreen(b.id), await evergreen(c.id)], [true, true, true]);

    // Una columna de plan que deja de serlo: sus fijas pasan a normales (y el deshacer las devuelve).
    expectOk(await setColumnRole(f.columns.doing, "NONE"));
    assert.deepEqual([await evergreen(a.id), await evergreen(b.id), await evergreen(c.id)], [true, false, false]);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.doing } })).role, "AI_PLAN");
    assert.deepEqual([await evergreen(b.id), await evergreen(c.id)], [true, true]);

    // Moverla a otra columna le quita la marca, como en la release.
    expectOk(await moveTask(a.id, f.columns.done, null, null));
    assert.equal(await evergreen(a.id), false);
  });

  test("pasar de release a plan conserva las fijas; de plan a otro rol, no", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectOk(await setColumnRole(f.columns.todo, "NEXT_RELEASE"));
    const t = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "Siempre", kindId: f.kindId, evergreen: true }));
    expectOk(await setColumnRole(f.columns.todo, "AI_PLAN"));
    assert.equal(await evergreen(t.id), true);
    expectOk(await setColumnRole(f.columns.todo, "PROGRAM"));
    assert.equal(await evergreen(t.id), false);
  });
});

describe("plantillas del plan", () => {
  test("las de la persona y las del proyecto son de su tipo y no salen entre las de release", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectOk(await setColumnRole(f.columns.todo, "AI_PLAN"));
    expectOk(await createReleaseTemplate("HEADER", { name: "Release", content: "r" }));
    expectOk(await createReleaseTemplate("PLAN_HEADER", { name: "Mi cabecera", content: "Usa pnpm." }));
    expectOk(await createReleaseTemplate("PLAN_FOOTER", { name: "Mi pie", content: "Resume." }));
    expectOk(await createProjectReleaseTemplate(f.project.id, "PLAN_HEADER", { name: "Repo", content: "El repositorio es example/web." }));
    const own = await userTemplates(user.id);
    assert.deepEqual([own.headers.map((x) => x.name), own.footers.map((x) => x.name)], [["Release"], []]);

    const setup = expectOk(await getAiPlanSetup({ projectId: f.project.id, columnId: f.columns.todo }));
    assert.deepEqual(setup.templates.headers.map((x) => x.name), ["Mi cabecera"]);
    assert.deepEqual(setup.templates.footers.map((x) => x.name), ["Mi pie"]);
    assert.deepEqual(setup.projectTemplates.headers.map((x) => x.name), ["Repo"]);
    assert.equal(setup.nextVersion, 1);
    assert.equal(setup.today, todayIso(appTimeZone()));
    // Una columna que no es de plan, o un proyecto ajeno: no.
    expectFail(await getAiPlanSetup({ projectId: f.project.id, columnId: f.columns.doing }), /ya no es un plan/);
    const other = await makeProject({ members: [] });
    expectFail(await getAiPlanSetup({ projectId: other.project.id, columnId: other.columns.todo }), NOT_FOUND);
  });
});

describe("generar y guardar el plan", () => {
  test("datos de cada tarea: descripción, subtareas en orden, adjuntos y documentos; solo del proyecto", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const t = await makeTask(f, { title: "Con todo", subtasks: ["Primera", "Segunda"] });
    await db.task.update({ where: { id: t.id }, data: { description: "Hazlo bien." } });
    await db.subtask.updateMany({ where: { taskId: t.id, title: "Primera" }, data: { done: true } });
    await db.taskAttachment.create({ data: { taskId: t.id, originalName: "captura.png", size: 10 } });
    await db.taskLink.create({ data: { taskId: t.id, kind: "GOOGLE_DOC", title: "Diseño", url: "https://docs.google.com/document/d/x" } });
    const other = await makeProject({ members: [user] });
    const foreign = await makeTask(other);
    const [d, ...rest] = expectOk(await getAiPlanTaskDetails({ projectId: f.project.id, taskIds: [t.id, foreign.id] }));
    assert.equal(rest.length, 0);
    assert.equal(d!.description, "Hazlo bien.");
    assert.deepEqual(d!.subtasks, [{ title: "Primera", done: true }, { title: "Segunda", done: false }]);
    assert.deepEqual(d!.attachments.map((a) => a.originalName), ["captura.png"]);
    assert.deepEqual(d!.links, [{ title: "Diseño", url: "https://docs.google.com/document/d/x" }]);
  });

  test("«Plan de trabajo – fecha_vN.md» en Documentación: N sube en cada guardado, no baja de lo ya guardado y no se gasta si falla", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectOk(await setColumnRole(f.columns.todo, "AI_PLAN"));
    const day = todayIso(appTimeZone());
    const first = expectOk(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.todo, content: "# Plan de trabajo – P\n\nUno" }));
    assert.equal(first.name, `Plan de trabajo – ${day}_v1.md`);
    assert.equal(first.version, 1);
    const doc = await db.projectDocument.findUniqueOrThrow({ where: { id: first.id } });
    assert.deepEqual([doc.kind, doc.mimeType, doc.createdById], ["MARKDOWN", "text/markdown", user.id]);
    assert.equal(await readFile(documentPath(doc.id), "utf8"), "# Plan de trabajo – P\n\nUno\n");
    assert.equal(expectOk(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.todo, content: "Dos" })).version, 2);

    // Un documento importado (o subido) con una versión más alta: la siguiente va detrás, también si está en la papelera.
    await db.projectDocument.create({ data: { projectId: f.project.id, name: "Work plan – 2026-01-01_v7.md", mimeType: "text/markdown", size: 1, kind: "MARKDOWN", deletedAt: new Date() } });
    assert.equal(expectOk(await getAiPlanSetup({ projectId: f.project.id, columnId: f.columns.todo })).nextVersion, 8);
    assert.equal(expectOk(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.todo, content: "Tres" })).version, 8);

    // Documentación llena: no se guarda ni se gasta la versión.
    const fill = await db.projectDocument.count({ where: { projectId: f.project.id, deletedAt: null } });
    const { DOCUMENTS_MAX_PER_PROJECT } = await import("../../src/lib/document-kind");
    await db.projectDocument.createMany({
      data: Array.from({ length: DOCUMENTS_MAX_PER_PROJECT - fill }, (_, i) => ({ projectId: f.project.id, name: `d${i}.txt`, mimeType: "text/plain", size: 1, kind: "TEXT" as const })),
    });
    expectFail(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.todo, content: "Cuatro" }), /máximo de/);
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: f.project.id } })).aiPlanCount, 8);

    // Vacío, columna que no es de plan, proyecto ajeno: no.
    expectFail(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.todo, content: "   " }), /vacío/);
    expectFail(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.doing, content: "x" }), /ya no es un plan/);
    const outsider = await makeUser();
    await loginAs(outsider);
    expectFail(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.todo, content: "x" }), NOT_FOUND);
  });

  test("en inglés, «Work plan – fecha_vN.md», con la numeración común", async () => {
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { locale: "EN" } });
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectOk(await setColumnRole(f.columns.todo, "AI_PLAN"));
    await db.projectDocument.create({ data: { projectId: f.project.id, name: "Plan de trabajo – 2026-01-01_v2.md", mimeType: "text/markdown", size: 1, kind: "MARKDOWN" } });
    const saved = expectOk(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.todo, content: "Plan" }));
    assert.equal(saved.name, `Work plan – ${todayIso(appTimeZone())}_v3.md`);
  });
});

describe("ritmo de las tareas fijas del plan: por columna", () => {
  test("guardar un plan en una columna no adelanta a las demás; el _vN sigue siendo del proyecto", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectOk(await setColumnRole(f.columns.todo, "AI_PLAN"));
    expectOk(await setColumnRole(f.columns.doing, "AI_PLAN"));
    const setup = async (columnId: string) => expectOk(await getAiPlanSetup({ projectId: f.project.id, columnId }));
    assert.deepEqual([(await setup(f.columns.todo)).nextColumnPlan, (await setup(f.columns.doing)).nextColumnPlan], [1, 1]);

    expectOk(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.todo, content: "Uno" }));
    expectOk(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.todo, content: "Dos" }));
    // La otra columna sigue en su primer plan, pero el documento va por la versión 3 del proyecto.
    const other = await setup(f.columns.doing);
    assert.equal(other.nextColumnPlan, 1);
    assert.equal(other.nextVersion, 3);
    assert.equal((await setup(f.columns.todo)).nextColumnPlan, 3);
    const saved = expectOk(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.doing, content: "Tres" }));
    assert.equal(saved.version, 3);
    assert.deepEqual((await db.column.findMany({ where: { projectId: f.project.id, role: "AI_PLAN" }, orderBy: { position: "asc" }, select: { planCount: true } })).map((c) => c.planCount), [2, 1]);

    // Un guardado que falla (Documentación llena) no gasta ni la versión ni el turno de la columna.
    const fill = await db.projectDocument.count({ where: { projectId: f.project.id, deletedAt: null } });
    const { DOCUMENTS_MAX_PER_PROJECT } = await import("../../src/lib/document-kind");
    await db.projectDocument.createMany({
      data: Array.from({ length: DOCUMENTS_MAX_PER_PROJECT - fill }, (_, i) => ({ projectId: f.project.id, name: `r${i}.txt`, mimeType: "text/plain", size: 1, kind: "TEXT" as const })),
    });
    expectFail(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.doing, content: "Cuatro" }), /máximo de/);
    assert.equal((await setup(f.columns.doing)).nextColumnPlan, 2);
  });

  test("borrar una columna de plan y deshacerlo devuelve su contador", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectOk(await setColumnRole(f.columns.doing, "AI_PLAN"));
    expectOk(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.doing, content: "Uno" }));
    expectOk(await saveAiPlan({ projectId: f.project.id, columnId: f.columns.doing, content: "Dos" }));
    const { deleteColumn } = await import("../../src/actions/columns");
    expectOk(await deleteColumn(f.columns.doing));
    assert.equal(await db.column.count({ where: { id: f.columns.doing } }), 0);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.doing } })).planCount, 2);
  });
});

