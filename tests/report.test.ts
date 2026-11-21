import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, deliverableStatus, type ReportInput } from "../src/lib/report";
import { deliverableProgress } from "../src/lib/deliverable-progress";

const base: ReportInput = {
  project: { name: "P", description: "" },
  generatedBy: "Test",
  today: "2026-10-18",
  columns: [
    { id: "todo", name: "Backlog", isDone: false },
    { id: "done", name: "Cerrado", isDone: true },
  ],
  kinds: ["Funcionalidad", "Corrección"],
  tasks: [
    { id: "a", title: "Vencida", kind: "Corrección", columnId: "todo", assigneeName: "Ana", dueDate: "2026-10-15", deliverableId: "d1", subtaskTotal: 2, subtaskDone: 1 },
    { id: "b", title: "Próxima", kind: "Funcionalidad", columnId: "todo", assigneeName: null, dueDate: "2026-10-20", deliverableId: "d1", subtaskTotal: 0, subtaskDone: 0 },
    { id: "c", title: "Hecha vencida", kind: "Funcionalidad", columnId: "done", assigneeName: "Ana", dueDate: "2026-10-01", deliverableId: "d1", subtaskTotal: 0, subtaskDone: 0 },
    { id: "d", title: "Sin plazo", kind: "Funcionalidad", columnId: "todo", assigneeName: "Ana", dueDate: null, deliverableId: null, subtaskTotal: 0, subtaskDone: 0 },
  ],
  deliverables: [{ id: "d1", name: "Beta", description: "", dueDate: "2026-10-22" }],
  releases: [],
  archivedCount: 3,
};

test("KPIs: terminadas por columna, vencidas solo si siguen pendientes", () => {
  const r = buildReport(base);
  assert.deepEqual(
    { total: r.kpis.total, done: r.kpis.done, open: r.kpis.open, pct: r.kpis.progressPct, overdue: r.kpis.overdue, soon: r.kpis.dueSoon },
    { total: 4, done: 1, open: 3, pct: 25, overdue: 1, soon: 1 },
  );
  assert.equal(r.kpis.unassignedOpen, 1);
  assert.equal(r.kpis.withoutDueOpen, 1);
  assert.equal(r.kpis.archived, 3);
  assert.deepEqual(r.overdue.map((t) => t.title), ["Vencida"]);
  assert.deepEqual(r.upcoming.map((t) => t.title), ["Próxima"]);
});

test("entregables: avance y estado", () => {
  const [beta] = buildReport(base).deliverables;
  assert.equal(beta!.total, 3);
  assert.equal(beta!.done, 1);
  assert.equal(beta!.pct, 33);
  assert.equal(beta!.daysLeft, 4);
  assert.equal(beta!.status, "En riesgo");
});

test("avance de un entregable: criterio único (archivadas = hechas; las fijas no cuentan)", () => {
  assert.deepEqual(deliverableProgress([]), { total: 0, done: 0 });
  assert.deepEqual(
    deliverableProgress([
      { evergreen: false, archived: false, inDoneColumn: false, count: 3 }, // pendientes
      { evergreen: false, archived: false, inDoneColumn: true }, // en una columna terminada
      { evergreen: false, archived: true, inDoneColumn: false, count: 2 }, // archivadas (desde cualquier columna)
      { evergreen: true, archived: false, inDoneColumn: false, count: 4 }, // fijas: fuera
      { evergreen: true, archived: false, inDoneColumn: true },
      { evergreen: true, archived: true, inDoneColumn: false },
    ]),
    { total: 6, done: 3 },
  );
});

test("entregables del informe: sin las fijas y, con `progress` (de la BD), con las archivadas", () => {
  const withFixed: ReportInput = {
    ...base,
    tasks: [...base.tasks, { id: "e", title: "Fija", kind: "Funcionalidad", columnId: "todo", assigneeName: null, dueDate: null, deliverableId: "d1", subtaskTotal: 0, subtaskDone: 0, evergreen: true }],
  };
  const [beta] = buildReport(withFixed).deliverables;
  assert.equal(beta!.total, 3);
  assert.equal(beta!.done, 1);
  const [counted] = buildReport({ ...withFixed, deliverables: [{ ...withFixed.deliverables[0]!, progress: { total: 5, done: 3 } }] }).deliverables;
  assert.equal(counted!.total, 5);
  assert.equal(counted!.done, 3);
  assert.equal(counted!.pct, 60);
});

test("estado de entregable", () => {
  assert.equal(deliverableStatus(0, 0, 3), "Sin tareas");
  assert.equal(deliverableStatus(2, 2, -5), "Completado");
  assert.equal(deliverableStatus(2, 1, -1), "Retrasado");
  assert.equal(deliverableStatus(4, 3, 2), "En plazo");
  assert.equal(deliverableStatus(4, 1, 30), "En plazo");
  assert.equal(deliverableStatus(4, 1, null), "Sin fecha");
});

test("columnas y personas", () => {
  const r = buildReport(base);
  assert.deepEqual(r.columns.map((c) => [c.name, c.count, c.overdue]), [["Backlog", 3, 1], ["Cerrado", 1, 0]]);
  const ana = r.people.find((p) => p.name === "Ana")!;
  assert.deepEqual([ana.open, ana.done, ana.overdue], [2, 1, 1]);
  assert.ok(r.people.some((p) => p.name === "Sin asignar"));
});

test("desglose por tipo usa los nombres configurados", () => {
  const r = buildReport(base);
  assert.deepEqual(r.types.map((t) => [t.label, t.open, t.done]), [["Funcionalidad", 2, 1], ["Corrección", 1, 0]]);
});

test("terminadas recientes y hora", () => {
  const r = buildReport({
    ...base,
    time: "09:30",
    tasks: base.tasks.map((t) => (t.id === "c" ? { ...t, updatedAt: "2026-10-10T08:00:00.000Z" } : { ...t, updatedAt: "2026-01-01T00:00:00.000Z" })),
  });
  assert.equal(r.time, "09:30");
  assert.deepEqual(r.recentDone.map((t) => t.title), ["Hecha vencida"]);
});

test("terminadas recientes: cuenta la fecha de cierre, no la última edición", () => {
  const r = buildReport({
    ...base,
    // Editada hace poco pero cerrada hace meses: no es reciente. Sin fecha de cierre, vale la última edición.
    tasks: base.tasks.map((t) => (t.id === "c" ? { ...t, updatedAt: "2026-10-10T08:00:00.000Z", doneAt: "2026-03-01T08:00:00.000Z" } : t)),
  });
  assert.deepEqual(r.recentDone, []);
  const r2 = buildReport({ ...base, tasks: base.tasks.map((t) => (t.id === "c" ? { ...t, updatedAt: "2026-01-01T00:00:00.000Z", doneAt: "2026-10-10T08:00:00.000Z" } : t)) });
  assert.deepEqual(r2.recentDone.map((t) => t.title), ["Hecha vencida"]);
});

test("terminadas recientes: el día de cierre se cuenta en la zona horaria de la app", () => {
  const withDoneAt = (timeZone?: string) => buildReport({ ...base, timeZone, tasks: base.tasks.map((t) => (t.id === "c" ? { ...t, doneAt: "2026-10-03T23:30:00.000Z" } : t)) });
  // 23:30 UTC ya es el 4 de octubre en Madrid (14 días antes de «hoy»: dentro); en UTC es el 3 (15 días: fuera).
  assert.deepEqual(withDoneAt("Europe/Madrid").recentDone.map((t) => t.title), ["Hecha vencida"]);
  assert.deepEqual(withDoneAt("UTC").recentDone, []);
});

test("tareas fijas: fuera del avance y de las pendientes, contadas aparte", () => {
  const fixed = (id: string, extra: Partial<ReportInput["tasks"][number]> = {}) => ({
    id, title: `Fija ${id}`, kind: "Funcionalidad", columnId: "todo", assigneeName: "Ana", dueDate: "2026-10-01", deliverableId: "d1", subtaskTotal: 0, subtaskDone: 0, evergreen: true, ...extra,
  });
  const r = buildReport({ ...base, tasks: [...base.tasks, fixed("f1"), fixed("f2", { assigneeName: null, dueDate: null })] });
  const plain = buildReport(base);
  // Mismo avance, pendientes, plazos, columnas, entregables, personas y tipos que sin las fijas.
  assert.deepEqual({ ...r.kpis, fixed: 0 }, plain.kpis);
  assert.equal(r.kpis.fixed, 2);
  assert.equal(r.kpis.progressPct, 25);
  assert.deepEqual(r.overdue.map((t) => t.title), ["Vencida"]);
  assert.deepEqual(r.columns, plain.columns);
  assert.deepEqual(r.deliverables, plain.deliverables);
  assert.deepEqual(r.people, plain.people);
  assert.deepEqual(r.types, plain.types);
  assert.equal(plain.kpis.fixed, 0);
});

// Antes el informe leía las primeras 2.000 tareas y calculaba con ellas el avance, las vencidas y la carga por persona,
// sin avisar. Ahora los recuentos llegan de la BD sobre todas (`counts`) y el PDF dice cuántas salen en los listados.
test("recuentos de todas las tareas: avance, vencidas, columnas, tipos y personas no dependen de las listadas", () => {
  const counts: NonNullable<ReportInput["counts"]> = {
    rows: [
      { columnId: "todo", assigneeName: "Ana", kind: "Corrección", count: 1500, overdue: 300, dueSoon: 100, withoutDue: 200 },
      { columnId: "todo", assigneeName: null, kind: "Funcionalidad", count: 1000, overdue: 50, dueSoon: 0, withoutDue: 900 },
      { columnId: "done", assigneeName: "Ana", kind: "Funcionalidad", count: 500, overdue: 500, dueSoon: 0, withoutDue: 0 },
    ],
    fixed: 2,
  };
  const r = buildReport({ ...base, counts });
  assert.deepEqual(
    { total: r.kpis.total, done: r.kpis.done, open: r.kpis.open, pct: r.kpis.progressPct, overdue: r.kpis.overdue, soon: r.kpis.dueSoon, unassigned: r.kpis.unassignedOpen, noDue: r.kpis.withoutDueOpen, fixed: r.kpis.fixed },
    { total: 3000, done: 500, open: 2500, pct: 17, overdue: 350, soon: 100, unassigned: 1000, noDue: 1100, fixed: 2 },
  );
  assert.deepEqual(r.columns.map((c) => [c.name, c.count, c.overdue]), [["Backlog", 2500, 350], ["Cerrado", 500, 0]]);
  assert.deepEqual(r.people, [{ name: "Ana", open: 1500, done: 500, overdue: 300 }, { name: "Sin asignar", open: 1000, done: 0, overdue: 50 }]);
  assert.deepEqual(r.types, [{ label: "Funcionalidad", open: 1000, done: 500 }, { label: "Corrección", open: 1500, done: 0 }]);
  // Se listan 4 de 3.002 (con las fijas).
  assert.equal(r.omittedTasks, 2998);
  // Las listas siguen siendo las de las tareas leídas.
  assert.deepEqual(r.overdue.map((t) => t.title), ["Vencida"]);
  // Sin recuentos de la BD (todas leídas), los mismos números salen de las tareas y no se omite ninguna.
  assert.equal(buildReport(base).omittedTasks, 0);
});
