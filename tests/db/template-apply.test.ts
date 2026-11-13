// «Aplicar plantilla» a un proyecto existente (Ajustes del proyecto → Tablero): añadir lo que falte, cambiar de plantilla
// con emparejamiento, nada se borra si tiene tareas, todo o nada (transacción), deshacer, permisos y aviso en vivo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { applyTemplateChange, listApplicableTemplates, previewTemplateChange, undoTemplateChange } from "../../src/actions/template-apply";
import { subscribeProject } from "../../src/lib/realtime";
import { undoTemplateChange as undoInLib } from "../../src/lib/template-apply";
import type { TemplateInput } from "../../src/lib/project-templates";

const TEMPLATE: TemplateInput = {
  name: "Plantilla de prueba",
  description: "",
  columns: [
    { name: "Por hacer", role: "NONE", isDone: false },
    { name: "Haciendo", role: "NONE", isDone: false, wipLimit: 4 },
    { name: "Revisión", role: "REVIEW", isDone: false },
    { name: "Listo", role: "NONE", isDone: true },
  ],
  kinds: [
    { name: "Mejora", color: "#0ea5e9", titleTemplate: "", descriptionTemplate: "", subtaskTemplate: ["Probar"] },
    { name: "Trámite", color: "#64748b", titleTemplate: "", descriptionTemplate: "", subtaskTemplate: [] },
  ],
  hiddenGeneralKinds: [],
  hideAllGeneralKinds: true,
  labels: [{ name: "Urgente", color: "#ef4444" }, { name: "Frontend", color: "#0ea5e9" }],
  taskFields: ["priority"],
  releaseTemplates: [{ kind: "FOOTER", name: "Checklist", content: "- [ ] ok" }],
};

async function makeTemplate(data: TemplateInput = TEMPLATE) {
  return db.projectTemplate.create({
    data: {
      name: `${data.name} ${Math.random().toString(36).slice(2, 7)}`, description: data.description ?? "", columns: data.columns, kinds: data.kinds ?? [], hiddenGeneralKinds: data.hiddenGeneralKinds ?? [],
      hideAllGeneralKinds: data.hideAllGeneralKinds ?? false, labels: data.labels ?? [], taskFields: data.taskFields ?? [], releaseTemplates: data.releaseTemplates ?? [], position: 1,
    },
  });
}

/** Proyecto privado de `owner` (lo gestiona sin ser administrador) con tareas en sus tres columnas. */
async function setup() {
  const owner = await makeUser();
  const f = await makeProject({ visibility: "PRIVATE", owner });
  const [a, b] = [await makeTask(f, { title: "A", columnId: f.columns.todo, position: 1000 }), await makeTask(f, { title: "B", columnId: f.columns.todo, position: 2000 })];
  const c = await makeTask(f, { title: "C", columnId: f.columns.doing, position: 1000 });
  const d = await makeTask(f, { title: "D (archivada)", columnId: f.columns.doing, position: 2000 });
  await db.task.update({ where: { id: d.id }, data: { archivedAt: new Date(), archivedFromColumnId: f.columns.doing } });
  const e = await makeTask(f, { title: "E", columnId: f.columns.done });
  return { owner, f, tasks: { a, b, c, d, e } };
}

async function state(projectId: string) {
  const columns = await db.column.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, role: true, isDone: true, wipLimit: true } });
  const tasks = await db.task.findMany({ where: { projectId }, orderBy: { title: "asc" }, select: { title: true, columnId: true, position: true, kindId: true, evergreen: true } });
  const kinds = await db.taskKind.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true } });
  const hidden = (await db.projectHiddenKind.findMany({ where: { projectId }, select: { kindId: true } })).map((h) => h.kindId).sort();
  const labels = (await db.label.findMany({ where: { projectId }, orderBy: { name: "asc" }, select: { name: true } })).map((l) => l.name);
  const releaseTemplates = (await db.projectReleaseTemplate.findMany({ where: { projectId }, select: { name: true } })).map((r) => r.name);
  const { taskFields } = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { taskFields: true } });
  return { columns, tasks, kinds, hidden, labels, releaseTemplates, taskFields };
}

test("añadir lo que falte: crea solo lo que no hay y no toca nada; se puede deshacer", async () => {
  const admin = await makeUser({ role: "ADMIN" });
  const { f } = await setup();
  await db.column.update({ where: { id: f.columns.done }, data: { name: "listo" } });
  await db.label.create({ data: { projectId: f.project.id, name: "urgente", color: "#64748b" } });
  await db.projectMember.create({ data: { projectId: f.project.id, userId: admin.id } });
  const tpl = await makeTemplate();
  const before = await state(f.project.id);
  await loginAs(admin);
  const preview = expectOk(await previewTemplateChange(f.project.id, { source: "template", id: tpl.id }));
  assert.equal(preview.project.columns.length, 3);
  const res = expectOk(await applyTemplateChange(f.project.id, { source: "template", id: tpl.id }, "ADD"));
  assert.equal(res.addedColumns, 2);
  const after = await state(f.project.id);
  // Las de antes siguen igual y en su sitio; las nuevas van al final («Por hacer» ya está y «listo» cuenta como «Listo»).
  assert.deepEqual(after.columns.slice(0, 3), before.columns);
  assert.deepEqual(after.columns.slice(3).map((c) => [c.name, c.role, c.wipLimit]), [["Haciendo", "NONE", 4], ["Revisión", "REVIEW", null]]);
  assert.deepEqual(after.tasks, before.tasks);
  assert.deepEqual(after.kinds.map((k) => k.name), [...before.kinds.map((k) => k.name), "Mejora", "Trámite"]);
  assert.deepEqual(after.hidden, before.hidden, "añadir no oculta tipos generales");
  assert.deepEqual(after.labels, ["Frontend", "urgente"]);
  assert.deepEqual(after.releaseTemplates, ["Checklist"]);
  assert.deepEqual(after.taskFields, ["priority"]);

  // Deshacer quita lo creado y deja el proyecto como estaba.
  expectOk(await undoTemplateChange(f.project.id));
  assert.deepEqual(await state(f.project.id), before);
  expectFail(await undoTemplateChange(f.project.id), /No hay ningún cambio de plantilla/);
});

test("cambiar de plantilla: empareja, mueve las tareas (archivadas incluidas), conserva y quita columnas vacías; y se deshace", async () => {
  const { owner, f, tasks } = await setup();
  const extra = await db.column.create({ data: { projectId: f.project.id, name: "Vacía", position: 4000 } });
  const next = await db.column.create({ data: { projectId: f.project.id, name: "Salto", position: 5000, role: "NEXT_RELEASE" } });
  const fixed = await makeTask(f, { title: "F (fija)", columnId: next.id });
  await db.task.update({ where: { id: fixed.id }, data: { evergreen: true, evergreenEvery: 2 } });
  const used = await db.label.create({ data: { projectId: f.project.id, name: "Cliente", color: "#64748b" } });
  await db.taskLabel.create({ data: { taskId: tasks.a.id, labelId: used.id } });
  await db.label.create({ data: { projectId: f.project.id, name: "Sin uso", color: "#64748b" } });
  const ownKind = await db.taskKind.findUniqueOrThrow({ where: { id: f.kindId } });
  const before = await state(f.project.id);
  const tpl = await makeTemplate();
  // Un proyecto privado lo gestiona su miembro; las plantillas de la instalación son solo de administradores.
  await loginAs(owner);
  expectFail(await previewTemplateChange(f.project.id, { source: "template", id: tpl.id }), /Solo los administradores/);
  const admin = await makeUser({ role: "ADMIN" });
  await db.projectMember.create({ data: { projectId: f.project.id, userId: admin.id } });
  await loginAs(admin);
  const ref = { source: "template", id: tpl.id } as const;

  const seen: string[] = [];
  const off = subscribeProject(f.project.id, (ch) => seen.push(ch.action));
  let res;
  try {
    res = expectOk(await applyTemplateChange(f.project.id, ref, "REPLACE", {
      // «Por hacer» y «En curso» pasan a «Por hacer»; «Hecho» → «Listo»; «Vacía» se quita; «Salto» se conserva.
      columns: { [f.columns.todo]: "t:0", [f.columns.doing]: "t:0", [f.columns.done]: "t:3", [extra.id]: "drop", [next.id]: "keep" },
      kinds: { [f.kindId]: "t:0" },
    }));
  } finally {
    off();
  }
  assert.deepEqual(seen, ["templateApply.applyTemplateChange"], "los demás lo ven en vivo");
  assert.equal(res.movedTasks, 1, "solo la activa de «En curso» cuenta como movida");
  assert.equal(res.retypedTasks, 6);

  const after = await state(f.project.id);
  assert.deepEqual(after.columns.map((c) => [c.name, c.role]), [["Por hacer", "NONE"], ["Haciendo", "NONE"], ["Revisión", "REVIEW"], ["Listo", "NONE"], ["Salto", "NEXT_RELEASE"]]);
  // «Por hacer» es la columna de antes (mismo id), con sus tareas y detrás las de «En curso», archivada incluida, en orden.
  assert.equal(after.columns[0]!.id, f.columns.todo);
  assert.equal(after.columns[3]!.id, f.columns.done);
  const inTodo = (await db.task.findMany({ where: { columnId: f.columns.todo }, orderBy: { position: "asc" }, select: { title: true } })).map((t) => t.title);
  assert.deepEqual(inTodo, ["A", "B", "C", "D (archivada)"]);
  assert.equal(await db.column.count({ where: { id: { in: [f.columns.doing, extra.id] } } }), 0);
  // El tipo propio pasa a «Mejora» y se quita (sin tareas); los generales se ocultan (sin tareas aquí).
  assert.deepEqual(after.kinds.map((k) => k.name), ["Mejora", "Trámite"]);
  assert.ok(after.tasks.every((t) => t.kindId === after.kinds[0]!.id));
  const generals = (await db.taskKind.findMany({ where: { projectId: null }, select: { id: true } })).map((k) => k.id).sort();
  assert.deepEqual(after.hidden, generals);
  // La tarea fija sigue en la columna de release conservada.
  assert.equal(after.tasks.find((t) => t.title === "F (fija)")!.evergreen, true);
  // Etiquetas: la usada se queda, la que no se usa se quita, las de la plantilla se añaden.
  assert.deepEqual(after.labels, ["Cliente", "Frontend", "Urgente"]);
  assert.deepEqual(after.taskFields, ["priority"]);

  // Mientras tanto alguien crea una tarea en una columna nueva: al deshacer, esa columna se conserva.
  const review = after.columns[2]!.id;
  await makeTask({ ...f, columns: { ...f.columns, todo: review }, kindId: after.kinds[1]!.id }, { title: "G (nueva)", columnId: review });

  const undone = expectOk(await undoTemplateChange(f.project.id));
  assert.equal(undone.keptColumns, 1);
  assert.equal(undone.keptKinds, 1);
  const restored = await state(f.project.id);
  assert.deepEqual(restored.columns.slice(0, before.columns.length), before.columns);
  assert.deepEqual(restored.columns.slice(before.columns.length).map((c) => c.name), ["Revisión"]);
  assert.deepEqual(restored.tasks.filter((t) => t.title !== "G (nueva)"), before.tasks);
  assert.equal(restored.kinds[0]!.id, ownKind.id);
  assert.deepEqual(restored.kinds.map((k) => k.name), [ownKind.name, "Trámite"]);
  assert.deepEqual(restored.hidden, before.hidden);
  assert.deepEqual(restored.labels, before.labels);
  assert.deepEqual(restored.releaseTemplates, before.releaseTemplates);
  assert.deepEqual(restored.taskFields, before.taskFields);
});

test("nada que tenga tareas se borra: una columna o un tipo con tareas que se pide quitar se conserva", async () => {
  const { owner, f } = await setup();
  await loginAs(owner);
  const ref = { source: "example", key: "familia-casa" } as const;
  const preview = expectOk(await previewTemplateChange(f.project.id, ref));
  expectOk(await applyTemplateChange(f.project.id, ref, "REPLACE", {
    columns: Object.fromEntries(preview.project.columns.map((c) => [c.id, "drop"])),
    kinds: { [f.kindId]: "drop" },
  }));
  const after = await state(f.project.id);
  for (const id of Object.values(f.columns)) assert.ok(after.columns.some((c) => c.id === id), "la columna con tareas sigue");
  assert.ok(after.kinds.some((k) => k.id === f.kindId), "el tipo con tareas sigue");
  assert.equal(after.tasks.length, 5);
});

test("es todo o nada: si algo falla a mitad, el proyecto queda como estaba y no hay nada que deshacer", async () => {
  const { owner, f } = await setup();
  const before = await state(f.project.id);
  // Un fallo provocado al final (al crear la plantilla de release), cuando ya se han movido tareas y cambiado columnas.
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION pz_test_fail() RETURNS trigger AS $$ BEGIN IF NEW."name" = 'Checklist' THEN RAISE EXCEPTION 'fallo de prueba'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await db.$executeRawUnsafe(`CREATE TRIGGER pz_test_fail BEFORE INSERT ON "ProjectReleaseTemplate" FOR EACH ROW EXECUTE FUNCTION pz_test_fail()`);
  try {
    const admin = await makeUser({ role: "ADMIN" });
    await db.projectMember.create({ data: { projectId: f.project.id, userId: admin.id } });
    const tpl = await makeTemplate();
    await loginAs(admin);
    const res = await applyTemplateChange(f.project.id, { source: "template", id: tpl.id }, "REPLACE", { columns: { [f.columns.doing]: "t:0" } });
    assert.equal(res.ok, false);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER pz_test_fail ON "ProjectReleaseTemplate"`);
    await db.$executeRawUnsafe(`DROP FUNCTION pz_test_fail()`);
  }
  assert.deepEqual(await state(f.project.id), before);
  assert.equal(await db.projectTemplateChange.count({ where: { projectId: f.project.id } }), 0);
  void owner;
});

test("permisos: solo quien gestiona el proyecto; los miembros de un proyecto de equipo, no", async () => {
  const member = await makeUser();
  const f = await makeProject({ members: [member] });
  await loginAs(member);
  expectFail(await listApplicableTemplates(f.project.id), FORBIDDEN);
  expectFail(await applyTemplateChange(f.project.id, { source: "example", key: "familia-casa" }, "ADD"), FORBIDDEN);
  expectFail(await undoTemplateChange(f.project.id), FORBIDDEN);
  // Un administrador ve las generales y las de la instalación.
  const admin = await makeUser({ role: "ADMIN" });
  const tpl = await makeTemplate();
  await loginAs(admin);
  const list = expectOk(await listApplicableTemplates(f.project.id));
  assert.ok(list.some((x) => x.group === "general"));
  assert.ok(list.some((x) => x.group === "installation" && x.ref.source === "template" && x.ref.id === tpl.id));
});

test("el deshacer caduca a las 24 horas", async () => {
  const { owner, f } = await setup();
  await loginAs(owner);
  expectOk(await applyTemplateChange(f.project.id, { source: "example", key: "familia-casa" }, "ADD"));
  await assert.rejects(undoInLib(f.project.id, new Date(Date.now() + 25 * 3_600_000)), /han pasado más de 24 horas/);
  expectOk(await undoTemplateChange(f.project.id));
});

test("una columna de presupuesto de la plantilla activa el coste; al deshacer vuelven los campos de antes", async () => {
  const { owner, f } = await setup();
  await loginAs(owner);
  const ref = { source: "example", key: "empresa-clientes" } as const;
  const preview = expectOk(await previewTemplateChange(f.project.id, ref));
  assert.ok(preview.template.columns.some((c) => c.role === "BUDGET"));
  expectOk(await applyTemplateChange(f.project.id, ref, "REPLACE"));
  const after = await state(f.project.id);
  assert.ok(after.taskFields.includes("cost"));
  assert.equal(after.tasks.length, 5);
  expectOk(await undoTemplateChange(f.project.id));
  assert.deepEqual((await state(f.project.id)).taskFields, []);
});
