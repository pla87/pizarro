// Columna «Asignación a persona»: la regla al entrar (mover, mover varias, crear, recuperar), deshacer, cambiar de persona,
// persona sin acceso, permisos, roles exclusivos, exportar/importar y plantillas.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import pg from "pg";
import { ADMIN_EXPORT, db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, NOT_FOUND, waitForLockWaiter } from "./helpers";
import { archiveTask, createTask, createTasks, moveTask, moveTasks, restoreTask } from "../../src/actions/tasks";
import { createPersonColumns, setColumnAssignee, setColumnRole, setColumnWaitingDays } from "../../src/actions/columns";
import { removeProjectMember } from "../../src/actions/projects";
import { projectPeople, projectUsers } from "../../src/lib/board";
import { templateFromProject } from "../../src/actions/templates";
import { applyTemplateChange, undoTemplateChange } from "../../src/actions/template-apply";
import { undoEntry, undoLast } from "../../src/actions/undo";
import { addDaysIso, dateToIso, isoToDate, todayIso } from "../../src/lib/dates";
import { appTimeZone } from "../../src/lib/format";
import { buildProjectExport } from "../../src/lib/project-export/export";
import { importProjectFile } from "../../src/lib/project-export/import";
import { streamZip } from "../../src/lib/zip-stream";
import { generateAssignPlanPdf, pendingSubtaskHeads } from "../../src/lib/report-build";
import { PLAN_SUBTASKS_SHOWN } from "../../src/lib/column-assign-core";
import { flushLogs } from "../../src/lib/log";
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
    expectOk(await setColumnRole(f.columns.todo, "CHECKLIST"));
    col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.role, col.assigneeId, col.assignDueDays], ["CHECKLIST", null, null]);
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

  test("PDF del plan: de las subtareas se leen solo las primeras pendientes (con tope en SQL) y cuántas son", async () => {
    const { f } = await setup();
    const many = await makeTask(f, { columnId: f.columns.doing, title: "Muchas subtareas" });
    const none = await makeTask(f, { columnId: f.columns.doing, title: "Sin pendientes" });
    // 300 subtareas en orden inverso de creación, una de cada tres marcada; dos con la misma posición (desempata el id).
    await db.subtask.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ taskId: many.id, title: `S${String(299 - i).padStart(3, "0")}`, position: 299 - i, done: (299 - i) % 3 === 0 })) });
    await db.subtask.createMany({ data: [{ taskId: many.id, title: "S001b", position: 1, done: false }, { taskId: none.id, title: "Hecha", position: 1, done: true }] });
    expectOk(await moveTasks([many.id, none.id], f.columns.todo, null));
    // Lo mismo que leía la consulta anterior (Prisma, con todas en memoria).
    const expected = await db.subtask.findMany({ where: { taskId: many.id, done: false }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { title: true } });
    const heads = await pendingSubtaskHeads([many.id, none.id], PLAN_SUBTASKS_SHOWN);
    assert.deepEqual(heads.get(many.id), { titles: expected.slice(0, PLAN_SUBTASKS_SHOWN).map((s) => s.title), count: 201 });
    assert.equal(expected.length, 201);
    assert.ok(heads.get(many.id)!.titles.slice(0, 3).every((x) => /^S00[12]/.test(x)));
    assert.equal(heads.has(none.id), false);
    assert.equal((await pendingSubtaskHeads([], PLAN_SUBTASKS_SHOWN)).size, 0);
    const pdf = await generateAssignPlanPdf(f.project.id, f.columns.todo, { locale: "es" });
    assert.equal(pdf?.taskCount, 2);
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
    const owner = await makeUser();
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

// Lecturas de la tabla Column que traen el plazo de «Asignación a persona» (las de la regla), mientras `fn` se ejecuta.
let watching = false;
let ruleReads = 0;
const origQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
  const q = args[0];
  const text = typeof q === "string" ? q : (q as { text?: string } | undefined)?.text ?? "";
  if (watching && /FROM "public"\."Column"/.test(text) && /"assignDueDays"/.test(text)) ruleReads++;
  return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
} as typeof pg.Client.prototype.query;
async function ruleReadsOf<T>(fn: () => Promise<T>): Promise<{ value: T; reads: number }> {
  ruleReads = 0;
  watching = true;
  try {
    return { value: await fn(), reads: ruleReads };
  } finally {
    watching = false;
  }
}

describe("asignación a persona: carreras, versión anterior, plazo y consultas", () => {
  for (const many of [false, true]) {
    test(`carrera: una tarjeta que entra (${many ? "moveTasks" : "moveTask"}) mientras la columna se convierte también pasa a la persona`, async () => {
      const me = await makeUser();
      const ana = await makeUser();
      const f = await makeProject({ members: [me, ana] });
      await loginAs(me);
      const t = await makeTask(f, { columnId: f.columns.doing });
      // Como setColumnAssignee: escribe la persona y toma el candado de posiciones de la columna, sin confirmar aún.
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query(`UPDATE "Column" SET "assigneeId" = $1 WHERE "id" = $2`, [ana.id, f.columns.todo]);
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`task-position:${f.columns.todo}`]);
        // El movimiento lee la columna (todavía sin persona) y espera el candado.
        const moving = many ? moveTasks([t.id], f.columns.todo) : moveTask(t.id, f.columns.todo, null, null);
        await waitForLockWaiter();
        await client.query("COMMIT");
        const { assigned } = expectOk<{ assigned: { id: string; assigneeId: string }[] }>(await moving);
        assert.deepEqual(assigned.map((a) => [a.id, a.assigneeId]), [[t.id, ana.id]]);
        assert.equal((await taskRow(t.id)).assigneeId, ana.id);
      } finally {
        await client.end();
      }
    });
  }

  test("rol cambiado en la versión anterior con la persona aún guardada: se comporta como la de su rol", async () => {
    const { me, f } = await setup({ dueDays: 2 });
    // Lo que hace setColumnRole en la v1.66: solo cambia el rol (no conoce la persona ni el plazo).
    await db.column.update({ where: { id: f.columns.todo }, data: { role: "WAITING", waitingDays: 3 } });
    const t = await makeTask(f, { columnId: f.columns.doing });
    const res = expectOk(await moveTask(t.id, f.columns.todo, null, null));
    assert.deepEqual(res.assigned, []);
    assert.deepEqual(await taskRow(t.id), { assigneeId: null, dueDate: null, columnId: f.columns.todo });
    const u = await makeTask(f, { columnId: f.columns.doing });
    assert.deepEqual(expectOk(await moveTasks([u.id], f.columns.todo)).assigned, []);
    const created = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "Nueva", kindId: f.kindId, assigneeId: me.id }));
    assert.equal(created.assigneeId, me.id);
    assert.equal(created.dueDate, null);
    assert.equal(await generateAssignPlanPdf(f.project.id, f.columns.todo, { locale: "es" }), null, "sin plan");
    // Elegir «Sin rol» la deja como una columna normal (sin persona ni plazo).
    expectOk(await setColumnRole(f.columns.todo, "NONE"));
    const col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.role, col.assigneeId, col.assignDueDays], ["NONE", null, null]);
  });

  test("con la misma persona, cambiar solo el plazo no toca las tarjetas que ya están; deshacer lo devuelve", async () => {
    const { me, ana, f } = await setup({ dueDays: 3 });
    const t = await makeTask(f, { columnId: f.columns.todo });
    // Pasada a mano a otra persona dentro de la columna.
    await db.task.update({ where: { id: t.id }, data: { assigneeId: me.id } });
    const notices = (await assignedNotices(ana.id)).length;
    const since = new Date();
    assert.deepEqual(expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: ana.id, dueDays: 10 })), { reassigned: 0 });
    assert.deepEqual(await taskRow(t.id), { assigneeId: me.id, dueDate: null, columnId: f.columns.todo });
    assert.equal((await assignedNotices(ana.id)).length, notices);
    let col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.assigneeId, col.assignDueDays], [ana.id, 10]);
    expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: ana.id, dueDays: 1 }));
    expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: ana.id, dueDays: null }));
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { action: "columns.setColumnAssignee", projectId: f.project.id, createdAt: { gte: since } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { message: true } });
    assert.deepEqual(logs.map((l) => l.message), [
      "Cambió el plazo de la columna «Por hacer» a 10 días",
      "Cambió el plazo de la columna «Por hacer» a 1 día",
      "Quitó el plazo de la columna «Por hacer»",
    ]);
    expectOk(await undoLast(f.project.id));
    col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.assigneeId, col.assignDueDays], [ana.id, 1]);
    // Una tarjeta que entra después recibe el plazo nuevo.
    const u = await makeTask(f, { columnId: f.columns.doing });
    expectOk(await moveTask(u.id, f.columns.todo, null, null));
    assert.equal(dateToIso((await taskRow(u.id)).dueDate), inDays(1));
    // Cambiar la persona sigue reasignando todas.
    assert.equal(expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: me.id, dueDays: 1 })).reassigned, 1);
    assert.equal((await taskRow(u.id)).assigneeId, me.id);
  });

  test("la siguiente aparición de una repetición que nace en la columna pasa a su persona", async () => {
    const { ana, f } = await setup({ dueDays: null });
    const a = await makeTask(f, { title: "Diaria", columnId: f.columns.doing, recurrence: "DAILY", dueDate: new Date("2026-01-10T00:00:00Z") });
    const res = expectOk(await moveTask(a.id, f.columns.done, null, null));
    assert.equal(res.spawned.length, 1);
    const next = await db.task.findFirstOrThrow({ where: { recurrenceFromId: a.id } });
    assert.deepEqual([next.columnId, next.assigneeId], [f.columns.todo, ana.id]);
  });

  test("en columnas normales la regla no gasta consultas: se decide con la lectura de la columna que ya se hace", async () => {
    const { f } = await setup();
    const normal = f.columns.doing;
    const create = await ruleReadsOf(() => createTask({ projectId: f.project.id, columnId: normal, title: "Una", kindId: f.kindId }));
    expectOk(create.value);
    assert.equal(create.reads, 1, "crear");
    const many = await ruleReadsOf(() => createTasks({ projectId: f.project.id, columnId: normal, tasks: [{ title: "A", kindId: f.kindId }, { title: "B", kindId: f.kindId }] }));
    expectOk(many.value);
    assert.equal(many.reads, 1, "crear varias");
    const t = await makeTask(f, { columnId: f.columns.done });
    const move = await ruleReadsOf(() => moveTask(t.id, normal, null, null));
    expectOk(move.value);
    assert.equal(move.reads, 1, "mover");
    expectOk(await archiveTask(t.id));
    const restore = await ruleReadsOf(() => restoreTask(t.id));
    expectOk(restore.value);
    assert.equal(restore.reads, 1, "recuperar");
    // Repetición que nace en una columna normal: una sola lectura de las columnas de destino.
    const r = await makeTask(f, { columnId: normal, recurrence: "DAILY", dueDate: new Date("2026-01-10T00:00:00Z") });
    const spawn = await ruleReadsOf(() => moveTask(r.id, f.columns.done, null, null));
    assert.equal(expectOk(spawn.value).spawned.length, 1);
    assert.equal(spawn.reads, 2, "mover a terminada (la columna destino) + repetición (sus columnas de destino)");
  });
});

describe("asignación a persona: nombre de la columna, columnas por persona y deshacer desde el aviso", () => {
  test("«Cambiar el nombre de la columna»: pone el de la persona en el mismo paso de deshacer (también con la misma persona)", async () => {
    const { ana, f } = await setup({ dueDays: null });
    const bea = await makeUser();
    await db.projectMember.create({ data: { projectId: f.project.id, userId: bea.id } });
    const name = async () => (await db.column.findUniqueOrThrow({ where: { id: f.columns.todo }, select: { name: true } })).name;
    // Misma persona, solo el nombre.
    expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: ana.id, dueDays: null, rename: true }));
    assert.equal(await name(), ana.name);
    expectOk(await undoLast(f.project.id));
    assert.equal(await name(), "Por hacer");
    // Otra persona y el nombre: un deshacer devuelve las dos cosas.
    expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: bea.id, dueDays: 2, rename: true }));
    const col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([col.name, col.assigneeId, col.assignDueDays], [bea.name, bea.id, 2]);
    expectOk(await undoLast(f.project.id));
    const back = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual([back.name, back.assigneeId, back.assignDueDays], ["Por hacer", ana.id, null]);
  });

  test("«Organizar por personas»: una columna por cada persona sin la suya, con su nombre y sin plazo; un deshacer las quita", async () => {
    // Privado: las personas son sus miembros (en uno de equipo, también los administradores que lo tienen en su lista).
    const me = await makeUser();
    const ana = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner: me, members: [me, ana] });
    await loginAs(me);
    expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: ana.id, dueDays: null }));
    const before = await db.column.count({ where: { projectId: f.project.id } });
    const order = async () => (await db.column.findMany({ where: { projectId: f.project.id }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { name: true, position: true } }));
    const positionsBefore = await order();
    const { created, moved } = expectOk(await createPersonColumns(f.project.id));
    // Ana ya tenía la suya («Por hacer»): solo la de quien gestiona.
    assert.deepEqual(created.map((c) => [c.name, c.assigneeId, c.assignDueDays, c.role]), [[me.name, me.id, null, "NONE"]]);
    assert.equal(await db.column.count({ where: { projectId: f.project.id } }), before + 1);
    // Antes de «Hecho» (la primera terminada), no detrás; el tablero recibe las posiciones nuevas de las que se corren.
    assert.deepEqual((await order()).map((c) => c.name), ["Por hacer", "En curso", me.name, "Hecho"]);
    const done = await db.column.findUniqueOrThrow({ where: { id: f.columns.done }, select: { position: true } });
    assert.ok(moved.some((m) => m.id === f.columns.done && m.position === done.position), JSON.stringify(moved));
    // Otra vez: nada que crear.
    assert.deepEqual(expectOk(await createPersonColumns(f.project.id)), { created: [], moved: [] });
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.column.count({ where: { projectId: f.project.id } }), before);
    // Un solo deshacer: también vuelven las posiciones de antes.
    assert.deepEqual(await order(), positionsBefore);
    assert.equal((await db.column.count({ where: { projectId: f.project.id, assigneeId: ana.id } })), 1);
    // Sin sitio para todas: ninguna.
    await db.column.createMany({ data: Array.from({ length: 30 - before }, (_, i) => ({ projectId: f.project.id, name: `C${i}`, position: 10_000 + i })) });
    expectFail(await createPersonColumns(f.project.id));
    assert.equal(await db.column.count({ where: { projectId: f.project.id } }), 30);
  });

  test("«Organizar por personas» en un proyecto de equipo: sus miembros y los administradores que lo tienen en su lista", async () => {
    const ana = await makeUser();
    const picked = await makeUser({ role: "ADMIN" });
    const outside = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [ana] });
    await db.adminProjectPick.create({ data: { projectId: f.project.id, userId: picked.id } });
    // El selector de responsable sigue ofreciendo a todos los administradores; las columnas, solo a quien lo tiene en su lista.
    const team = { isPrivate: false };
    assert.ok((await projectUsers(f.project.id, team)).some((u) => u.id === outside.id));
    assert.deepEqual((await projectPeople(f.project.id, team)).map((u) => u.id).sort(), [ana.id, picked.id].sort());
    await loginAs(outside);
    const { created } = expectOk(await createPersonColumns(f.project.id));
    assert.deepEqual(created.map((c) => c.assigneeId).sort(), [ana.id, picked.id].sort());
    // Un administrador asignado al proyecto cuenta como miembro aunque no lo tenga en su lista.
    await db.projectMember.create({ data: { projectId: f.project.id, userId: outside.id } });
    assert.deepEqual(expectOk(await createPersonColumns(f.project.id)).created.map((c) => c.assigneeId), [outside.id]);
  });

  test("mover a la columna devuelve la entrada de deshacer: el «Deshacer» del aviso la deshace entera", async () => {
    const { me, f } = await setup();
    const t = await makeTask(f, { columnId: f.columns.doing });
    await db.task.update({ where: { id: t.id }, data: { assigneeId: me.id } });
    const res = expectOk(await moveTask(t.id, f.columns.todo, null, null));
    assert.ok(res.undo.id);
    expectOk(await undoEntry(res.undo.id!));
    assert.deepEqual(await taskRow(t.id), { assigneeId: me.id, dueDate: null, columnId: f.columns.doing });
    const many = expectOk(await moveTasks([t.id], f.columns.todo));
    assert.ok(many.undo.id);
  });
});
