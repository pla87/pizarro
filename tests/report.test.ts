import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, deliverableStatus, type ReportInput } from "../src/lib/report";

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
