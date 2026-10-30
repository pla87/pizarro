import assert from "node:assert/strict";
import { test } from "node:test";
import { taskClient, taskCost, taskHours, taskPriority, linkUrl } from "../src/lib/validation";
import { budgetSummary, centsToAmount, formatEuro, normalizeTaskFields, startAfterDue, sumCents } from "../src/lib/task-fields";
import { templateTaskFields } from "../src/lib/project-templates";
import { buildReport, type ReportInput } from "../src/lib/report";
import { EMPTY_FILTERS, taskMatchesFilters } from "../src/components/board/filters";
import { fieldsError, fieldsPatch, EMPTY_FIELDS_FORM } from "../src/lib/fields-form";
import type { BoardTask } from "../src/lib/types";

test("coste y horas: coma o punto, dos decimales, sin negativos ni exponentes", () => {
  assert.equal(taskCost.parse("12,5"), "12.50");
  assert.equal(taskCost.parse(7), "7.00");
  assert.equal(taskCost.parse("  "), null);
  assert.equal(taskCost.parse(null), null);
  assert.equal(taskCost.parse("9999999999.99"), "9999999999.99");
  for (const bad of ["-1", "1.234", "1e3", "abc", "10000000000"]) assert.equal(taskCost.safeParse(bad).success, false, bad);
  assert.equal(taskHours.parse("0,25"), "0.25");
  assert.equal(taskHours.safeParse("100000").success, false);
});

test("prioridad, cliente y enlace", () => {
  assert.equal(taskPriority.parse("URGENTE"), "URGENTE");
  assert.equal(taskPriority.parse(null), null);
  assert.equal(taskPriority.safeParse("urgente").success, false);
  assert.equal(taskClient.parse("  Acme  "), "Acme");
  assert.equal(taskClient.parse(""), null);
  assert.equal(taskClient.safeParse("x".repeat(121)).success, false);
  assert.equal(linkUrl.parse("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(linkUrl.parse(""), null);
  for (const bad of ["javascript:alert(1)", "ftp://example.com", "example.com", "https://a b"]) assert.equal(linkUrl.safeParse(bad).success, false, bad);
});

test("fecha de inicio frente a fecha límite", () => {
  assert.equal(startAfterDue("2026-10-02", "2026-10-01"), true);
  assert.equal(startAfterDue("2026-10-01", "2026-10-01"), false);
  assert.equal(startAfterDue("2026-10-01", null), false);
  assert.equal(startAfterDue(null, "2026-10-01"), false);
});

test("normalizeTaskFields deja claves válidas, sin repetir y en orden", () => {
  assert.deepEqual(normalizeTaskFields(["client", "x", "cost", "client"]), ["cost", "client"]);
});

test("sumas en céntimos sin errores de coma flotante y resumen de presupuesto", () => {
  assert.equal(centsToAmount(sumCents(["0.10", "0.20", null, ""])), "0.30");
  const s = budgetSummary([
    { cost: "100.10", costPaid: true },
    { cost: "50.20", costPaid: false },
    { cost: null, costPaid: true },
  ]);
  assert.deepEqual(s, { paid: 10010, pending: 5020, total: 15030, count: 2 });
  assert.deepEqual(budgetSummary([]), { paid: 0, pending: 0, total: 0, count: 0 });
});

test("importe con el símbolo del euro", () => {
  assert.match(formatEuro("1234.5", "es-ES"), /1234,50\s€|1\.234,50\s€/);
  assert.match(formatEuro(5, "en-GB"), /€5\.00/);
  assert.equal(formatEuro(null), "");
});

test("plantillas: una columna de presupuesto fuerza el coste", () => {
  assert.deepEqual(templateTaskFields({ taskFields: ["client"], columns: [{ role: "NONE" }] }), ["client"]);
  assert.deepEqual(templateTaskFields({ taskFields: ["client"], columns: [{ role: "BUDGET" }] }), ["cost", "client"]);
  assert.deepEqual(templateTaskFields({ columns: [{ role: "BUDGET" }] }), ["cost"]);
});

test("formulario de campos: solo cambios en campos activados; vacío = null", () => {
  const form = { ...EMPTY_FIELDS_FORM, cost: "5", priority: "ALTA", client: "  " };
  assert.deepEqual(fieldsPatch(form, EMPTY_FIELDS_FORM, ["cost", "priority"]), { cost: "5", priority: "ALTA" });
  assert.deepEqual(fieldsPatch({ ...EMPTY_FIELDS_FORM }, { ...EMPTY_FIELDS_FORM, cost: "5" }, ["cost"]), { cost: null });
  assert.deepEqual(fieldsPatch({ ...EMPTY_FIELDS_FORM, costPaid: true }, EMPTY_FIELDS_FORM, ["cost"]), { costPaid: true });
  const t = (s: string) => s;
  assert.ok(fieldsError({ ...EMPTY_FIELDS_FORM, startDate: "2026-02-01" }, ["startDate"], "2026-01-01", t));
  assert.equal(fieldsError({ ...EMPTY_FIELDS_FORM, startDate: "2026-02-01" }, [], "2026-01-01", t), null);
});

const task = (over: Partial<BoardTask>): BoardTask => ({
  id: "t", columnId: "todo", title: "x", kindId: "k1", color: null, linkUrl: null, position: 1, assigneeId: null, labelIds: [],
  subtaskTotal: 0, subtaskDone: 0, imageCount: 0, fileCount: 0, attachBytes: 0, hasDescription: false, dueDate: null, deliverableId: null, commentCount: 0,
  linkCount: 0, evergreen: false, evergreenEvery: 1, recurrence: "NONE", recurrenceDay: null, textVersion: null, columnEnteredAt: "2026-10-01T00:00:00.000Z",
  cost: null, costPaid: false, estimatedHours: null, actualHours: null, priority: null, client: null, startDate: null, ...over,
});

test("filtros por prioridad y cliente", () => {
  const ctx = { currentUserId: "me", today: "2026-10-22", doneColumnIds: new Set<string>() };
  const f = { ...EMPTY_FILTERS, priorities: ["ALTA", "URGENTE"], clients: ["Acme"] };
  assert.equal(taskMatchesFilters(task({ priority: "ALTA", client: "Acme" }), f, ctx), true);
  assert.equal(taskMatchesFilters(task({ priority: "BAJA", client: "Acme" }), f, ctx), false);
  assert.equal(taskMatchesFilters(task({ priority: "ALTA", client: "Otro" }), f, ctx), false);
  assert.equal(taskMatchesFilters(task({ priority: null, client: null }), f, ctx), false);
  assert.equal(taskMatchesFilters(task({}), EMPTY_FILTERS, ctx), true);
});

const reportBase = (over: Partial<ReportInput>): ReportInput => ({
  project: { name: "P", description: "" }, generatedBy: "Yo", today: "2026-10-22",
  columns: [{ id: "c1", name: "Presupuesto", isDone: false }], kinds: ["Tarea"],
  tasks: [], deliverables: [], releases: [], archivedCount: 0, ...over,
});
const rt = (id: string, fields: Partial<NonNullable<ReportInput["tasks"][number]["fields"]>>) => ({
  id, title: id, kind: "Tarea", columnId: "c1", assigneeName: null, dueDate: null, deliverableId: null, subtaskTotal: 0, subtaskDone: 0,
  fields: { cost: null, costPaid: false, estimatedHours: null, actualHours: null, priority: null, client: null, startDate: null, ...fields },
});

test("informe: sin campos activados no hay sección; con ellos, totales y filas solo de lo activado", () => {
  const tasks = [rt("a", { cost: "100.00", costPaid: true, priority: "ALTA", estimatedHours: "2.00" }), rt("b", { cost: "50.50", client: "Acme" }), rt("c", {})];
  assert.equal(buildReport(reportBase({ tasks })).fields, null);
  const r = buildReport(reportBase({ tasks, taskFields: ["cost", "hours"] })).fields!;
  assert.deepEqual(r.totals, { cost: "150.50", paid: "100.00", pending: "50.50", estimatedHours: "2.00", actualHours: "0.00" });
  assert.deepEqual(r.rows.map((x) => x.title), ["a", "b"]);
  // Prioridad y cliente están guardados pero desactivados: no salen.
  assert.equal(r.rows[0]!.priority, null);
  assert.equal(r.rows[1]!.client, null);
});
