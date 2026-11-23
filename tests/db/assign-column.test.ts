// Columna «Asignación a persona»: la regla al entrar (mover, mover varias, crear, recuperar), deshacer, cambiar de persona,
// persona sin acceso, permisos, roles exclusivos, exportar/importar y plantillas.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ADMIN_EXPORT, db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { archiveTask, createTask, createTasks, moveTask, moveTasks, restoreTask } from "../../src/actions/tasks";
import { setColumnAssignee, setColumnRole, setColumnWaitingDays } from "../../src/actions/columns";
import { removeProjectMember } from "../../src/actions/projects";
import { templateFromProject } from "../../src/actions/templates";
import { applyTemplateChange, undoTemplateChange } from "../../src/actions/template-apply";
import { undoLast } from "../../src/actions/undo";
import { addDaysIso, dateToIso, isoToDate, todayIso } from "../../src/lib/dates";
import { appTimeZone } from "../../src/lib/format";
import { buildProjectExport } from "../../src/lib/project-export/export";
import { importProjectFile } from "../../src/lib/project-export/import";
import { streamZip } from "../../src/lib/zip-stream";
import { generateAssignPlanPdf } from "../../src/lib/report-build";
import { stopPdfWorker } from "../../src/lib/report-render";

process.env.UPLOAD_DIR ??= await mkdtemp(path.join(tmpdir(), "pz-assign-"));
const work = await mkdtemp(path.join(tmpdir(), "pz-assign-zip-"));
after(async () => {
  stopPdfWorker();
  await rm(work, { recursive: true, force: true });
});

const inDays = (n: number) => addDaysIso(todayIso(appTimeZone()), n);
const taskRow = (id: string) => db.task.findUniqueOrThrow({ where: { id }, select: { assigneeId: true, dueDate: true, columnId: true } });
const assignedNotices = (userId: string) => db.notification.findMany({ where: { userId, type: "ASSIGNED" }, select: { taskId: true, excerpt: true } });

/** Proyecto con una persona que gestiona el tablero (`me`) y la persona de la columna «Por hacer» (`ana`). */
async function setup(opts: { dueDays?: number | null } = {}) {
  const me = await makeUser();
  const ana = await makeUser();
  const f = await makeProject({ members: [me, ana] });
  await loginAs(me);
  expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: ana.id, dueDays: opts.dueDays === undefined ? 3 : opts.dueDays }));
  return { me, ana, f };
}

describe("asignación a persona: regla al entrar", () => {
  test("mover a la columna asigna y pone la fecha del plazo; deshacer devuelve responsable, fecha y columna", async () => {
    const { me, ana, f } = await setup();
    const t = await makeTask(f, { columnId: f.columns.doing });
    await db.task.update({ where: { id: t.id }, data: { assigneeId: me.id } });
    const res = expectOk(await moveTask(t.id, f.columns.todo, null, null));
    assert.deepEqual(res.assigned, [{ id: t.id, assigneeId: ana.id, dueDate: inDays(3) }]);
    const moved = await taskRow(t.id);
    assert.equal(moved.assigneeId, ana.id);
    assert.equal(dateToIso(moved.dueDate), inDays(3));
    assert.equal((await assignedNotices(ana.id)).filter((n) => n.taskId === t.id).length, 1);
    expectOk(await undoLast(f.project.id));
    const back = await taskRow(t.id);
    assert.equal(back.columnId, f.columns.doing);
    assert.equal(back.assigneeId, me.id);
    assert.equal(back.dueDate, null);
  });

  test("una fecha límite que ya tenía se respeta; reordenar dentro de la columna no cambia nada", async () => {
    const { me, ana, f } = await setup();
    const t = await makeTask(f, { columnId: f.columns.doing, dueDate: isoToDate("2030-01-15") });
    expectOk(await moveTask(t.id, f.columns.todo, null, null));
    const row = await taskRow(t.id);
    assert.equal(row.assigneeId, ana.id);
    assert.equal(dateToIso(row.dueDate), "2030-01-15");
    // Cambiada a mano dentro de la columna: reordenar no la vuelve a asignar.
    await db.task.update({ where: { id: t.id }, data: { assigneeId: me.id } });
    const res = expectOk(await moveTask(t.id, f.columns.todo, null, null));
    assert.deepEqual(res.assigned, []);
    assert.equal((await taskRow(t.id)).assigneeId, me.id);
  });

  test("sin plazo solo asigna; mover varias: todas a la persona, un solo aviso y un solo deshacer", async () => {
    const { ana, f } = await setup({ dueDays: null });
    const before = (await assignedNotices(ana.id)).length;
    const ids = (await Promise.all([1, 2, 3].map((i) => makeTask(f, { title: `T${i}`, columnId: f.columns.doing, position: i })))).map((t) => t.id);
    const res = expectOk(await moveTasks(ids, f.columns.todo));
    assert.equal(res.assigned.length, 3);
    for (const id of ids) {
      const row = await taskRow(id);
      assert.equal(row.assigneeId, ana.id);
      assert.equal(row.dueDate, null);
    }
    const notices = await assignedNotices(ana.id);
    assert.equal(notices.length - before, 1, "un aviso por lote");
    expectOk(await undoLast(f.project.id));
    for (const id of ids) assert.deepEqual(await taskRow(id), { assigneeId: null, dueDate: null, columnId: f.columns.doing });
  });

  test("crear (una o varias) en la columna: nace de la persona y, sin fecha, con la del plazo", async () => {
    const { me, ana, f } = await setup({ dueDays: 5 });
    const one = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "Nueva", kindId: f.kindId, assigneeId: me.id }));
    assert.equal(one.assigneeId, ana.id);
    assert.equal(one.dueDate, inDays(5));
    const many = expectOk(await createTasks({ projectId: f.project.id, columnId: f.columns.todo, tasks: [{ title: "A", kindId: f.kindId }, { title: "B", kindId: f.kindId }], dueDate: "2031-03-01" }));
    assert.deepEqual(many.map((x) => [x.assigneeId, x.dueDate]), [[ana.id, "2031-03-01"], [ana.id, "2031-03-01"]]);
    // En otra columna, nada cambia.
    const other = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.doing, title: "Otra", kindId: f.kindId }));
    assert.equal(other.assigneeId, null);
  });

  test("recuperar una archivada en la columna la asigna; deshacer la vuelve a archivar como estaba", async () => {
    const { ana, f } = await setup();
    const t = await makeTask(f, { columnId: f.columns.todo });
    expectOk(await archiveTask(t.id));
    await db.task.update({ where: { id: t.id }, data: { assigneeId: null, dueDate: null } });
    expectOk(await restoreTask(t.id));
    assert.equal((await taskRow(t.id)).assigneeId, ana.id);
    expectOk(await undoLast(f.project.id));
    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    assert.ok(row.archivedAt);
    assert.equal(row.assigneeId, null);
  });
});

describe("asignación a persona: configurar la columna", () => {
  test("cambiar de persona reasigna todas las tarjetas no archivadas (un solo deshacer); el plazo es solo para las que entran", async () => {
    const { me, ana, f } = await setup({ dueDays: null });
    const bea = await makeUser();
    await db.projectMember.create({ data: { projectId: f.project.id, userId: bea.id } });
    const a = await makeTask(f, { columnId: f.columns.todo });
    const b = await makeTask(f, { columnId: f.columns.todo });
    await db.task.update({ where: { id: a.id }, data: { assigneeId: ana.id } });
    await db.task.update({ where: { id: b.id }, data: { assigneeId: me.id } });
    const archived = await makeTask(f, { columnId: f.columns.todo });
    await db.task.update({ where: { id: archived.id }, data: { archivedAt: new Date(), archivedFromColumnId: f.columns.todo } });
    const res = expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: bea.id, dueDays: 7 }));
    assert.equal(res.reassigned, 2);
    assert.equal((await taskRow(a.id)).assigneeId, bea.id);
    assert.equal((await taskRow(b.id)).assigneeId, bea.id);
    assert.equal((await taskRow(a.id)).dueDate, null, "las que ya estaban no reciben fecha");
    assert.equal((await taskRow(archived.id)).assigneeId, null, "las archivadas no cambian");
    assert.equal((await assignedNotices(bea.id)).length, 1, "un solo aviso para el lote");
    expectOk(await undoLast(f.project.id));
    assert.equal((await taskRow(a.id)).assigneeId, ana.id);
    assert.equal((await taskRow(b.id)).assigneeId, me.id);
    const col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.equal(col.assigneeId, ana.id);
    assert.equal(col.assignDueDays, null);
  });

  test("es exclusivo con los demás roles: elegirlo quita el rol (y sus ajustes); elegir otro rol o «Sin rol» quita persona y plazo", async () => {
    const me = await makeUser();
    const ana = await makeUser();
    const f = await makeProject({ members: [me, ana] });
    await loginAs(me);
    expectOk(await setColumnRole(f.columns.todo, "WAITING"));
    expectOk(await setColumnWaitingDays(f.columns.todo, 9));
    expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: ana.id, dueDays: 2 }));
    let col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.role, col.waitingDays, col.assigneeId, col.assignDueDays], ["NONE", null, ana.id, 2]);
    expectOk(await undoLast(f.project.id));
    col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.role, col.waitingDays, col.assigneeId, col.assignDueDays], ["WAITING", 9, null, null]);

    expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: ana.id, dueDays: 2 }));
    expectOk(await setColumnRole(f.columns.todo, "AGENDA"));
    col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.role, col.assigneeId, col.assignDueDays], ["AGENDA", null, null]);
    expectOk(await undoLast(f.project.id));
    col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.role, col.assigneeId, col.assignDueDays], ["NONE", ana.id, 2]);
    // «Sin rol» en una columna de asignación (que ya tiene rol NONE) sí cambia: deja de asignar.
    expectOk(await setColumnRole(f.columns.todo, "NONE"));
    col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.assigneeId, col.assignDueDays], [null, null]);
  });

  test("permisos: sin acceso al proyecto no se configura; la persona debe poder tener tareas del proyecto; el plazo, 1-365", async () => {
    const me = await makeUser();
    const outsider = await makeUser();
    const f = await makeProject({ members: [me] });
    await loginAs(outsider);
    expectFail(await setColumnAssignee(f.columns.todo, { assigneeId: outsider.id, dueDays: null }), NOT_FOUND);
    await loginAs(me);
    expectFail(await setColumnAssignee(f.columns.todo, { assigneeId: outsider.id, dueDays: null }), NOT_FOUND);
    expectFail(await setColumnAssignee(f.columns.todo, { assigneeId: me.id, dueDays: 0 }));
    expectFail(await setColumnAssignee(f.columns.todo, { assigneeId: me.id, dueDays: 366 }));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).assigneeId, null);
  });

  test("si la persona deja el proyecto o se desactiva, la columna se queda sin persona efectiva: no asigna", async () => {
    const { me, ana, f } = await setup();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    expectOk(await removeProjectMember(f.project.id, ana.id));
    await loginAs(me);
    const t = await makeTask(f, { columnId: f.columns.doing });
    const res = expectOk(await moveTask(t.id, f.columns.todo, null, null));
    assert.deepEqual(res.assigned, []);
    assert.equal((await taskRow(t.id)).assigneeId, null);
    // La columna conserva la persona (el tablero avisa en su cabecera) y el PDF del plan sigue saliendo.
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } })).assigneeId, ana.id);

    const bea = await makeUser();
    await db.projectMember.create({ data: { projectId: f.project.id, userId: bea.id } });
    await loginAs(me);
    expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: bea.id, dueDays: null }));
    await db.user.update({ where: { id: bea.id }, data: { active: false } });
    const u = await makeTask(f, { columnId: f.columns.doing });
    expectOk(await moveTask(u.id, f.columns.todo, null, null));
    assert.equal((await taskRow(u.id)).assigneeId, null);
    // Borrada la persona, la columna se queda sin ella (la clave foránea la pone a null) y conserva el plazo.
    await db.user.delete({ where: { id: bea.id } });
    const col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.equal(col.assigneeId, null);
  });

  test("PDF del plan: sale con las tareas de la persona; sin persona, no hay plan", async () => {
    const { ana, f } = await setup();
    const t = await makeTask(f, { columnId: f.columns.doing, title: "Plan uno" });
    expectOk(await moveTask(t.id, f.columns.todo, null, null));
    const pdf = await generateAssignPlanPdf(f.project.id, f.columns.todo, { locale: "es" });
    assert.ok(pdf);
    assert.equal(pdf.taskCount, 1);
    assert.match(pdf.filename, /^plan-usuario-[0-9a-f]+-\d{4}-\d{2}-\d{2}\.pdf$/);
    assert.equal(await generateAssignPlanPdf(f.project.id, f.columns.doing, { locale: "es" }), null);
    void ana;
  });
});

describe("asignación a persona: exportar, importar y plantillas", () => {
  const zip = async (entries: Awaited<ReturnType<typeof buildProjectExport>>["entries"]) => {
    const parts: Buffer[] = [];
    for await (const c of streamZip(entries)) parts.push(c);
    const file = path.join(work, `exp-${Math.random().toString(36).slice(2)}.zip`);
    await writeFile(file, Buffer.concat(parts));
    return file;
  };

  test("exportar e importar conserva el plazo y la persona si existe en el destino", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const { ana, f } = await setup({ dueDays: 4 });
    const file = await zip((await buildProjectExport(f.project.id, { attachments: false, scope: "board" }, ADMIN_EXPORT)).entries);
    const importer = { id: admin.id, name: admin.name, email: admin.email, role: "ADMIN" as const };
    const team = await importProjectFile(file, importer, { isPrivate: false });
    const col = await db.column.findFirstOrThrow({ where: { projectId: team.projectId, name: "Por hacer" } });
    assert.deepEqual([col.assigneeId, col.assignDueDays], [ana.id, 4]);
    // En un proyecto privado solo vale quien importa: la columna llega sin persona, con su plazo.
    const priv = await importProjectFile(file, importer, { isPrivate: true });
    const col2 = await db.column.findFirstOrThrow({ where: { projectId: priv.projectId, name: "Por hacer" } });
    assert.deepEqual([col2.assigneeId, col2.assignDueDays], [null, 4]);
  });

  test("plantilla desde un proyecto: el plazo viaja, la persona no", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const { f } = await setup({ dueDays: 6 });
    await loginAs(admin);
    const tpl = expectOk(await templateFromProject(f.project.id));
    const col = tpl.columns.find((c) => c.name === "Por hacer")!;
    assert.equal(col.role, "NONE");
    assert.equal(col.assignDueDays, 6);
    assert.ok(!("assigneeId" in col));
  });
});

describe("asignación a persona: aplicar plantilla", () => {
  test("las tareas que se unen a la columna pasan a su persona; con otro rol deja de asignar; deshacer lo devuelve todo", async () => {
    // Las plantillas propias solo las usan los administradores.
    const owner = await makeUser({ role: "ADMIN" });
    const ana = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner, members: [ana] });
    await loginAs(owner);
    expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: ana.id, dueDays: 2 }));
    const t = await makeTask(f, { title: "Se une", columnId: f.columns.doing });
    await db.task.update({ where: { id: t.id }, data: { assigneeId: owner.id } });
    const tpl = await db.projectTemplate.create({
      data: {
        name: `Plantilla ${Math.random().toString(36).slice(2, 7)}`, description: "", position: 1, kinds: [], hiddenGeneralKinds: [], labels: [], taskFields: [], releaseTemplates: [],
        columns: [{ name: "Por hacer", role: "NONE", isDone: false }, { name: "Revisión", role: "REVIEW", isDone: false }, { name: "Hecho", role: "NONE", isDone: true }],
      },
    });
    const ref = { source: "template", id: tpl.id } as const;
    // «En curso» se une a «Por hacer» (la columna de Ana).
    expectOk(await applyTemplateChange(f.project.id, ref, "REPLACE", { columns: { [f.columns.todo]: "t:0", [f.columns.doing]: "t:0", [f.columns.done]: "t:2" } }));
    let row = await taskRow(t.id);
    assert.equal(row.columnId, f.columns.todo);
    assert.equal(row.assigneeId, ana.id);
    assert.equal(dateToIso(row.dueDate), inDays(2));
    let col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.role, col.assigneeId, col.assignDueDays], ["NONE", ana.id, 2], "aplicar plantilla no rompe la columna");
    expectOk(await undoTemplateChange(f.project.id));
    row = await taskRow(t.id);
    assert.deepEqual([row.columnId, row.assigneeId, row.dueDate], [f.columns.doing, owner.id, null]);

    // Si la plantilla le da otro rol, deja de ser «Asignación a persona»; deshacer se lo devuelve.
    expectOk(await applyTemplateChange(f.project.id, ref, "REPLACE", { columns: { [f.columns.todo]: "t:1", [f.columns.doing]: "t:0", [f.columns.done]: "t:2" } }));
    col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.role, col.assigneeId, col.assignDueDays], ["REVIEW", null, null]);
    expectOk(await undoTemplateChange(f.project.id));
    col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.role, col.assigneeId, col.assignDueDays], ["NONE", ana.id, 2]);
    // Otras pruebas cuentan las plantillas de la instalación.
    await db.projectTemplate.delete({ where: { id: tpl.id } });
  });
});
