// Columna «Asignación a persona»: reglas puras (plazo, agrupación del plan) y el PDF «Plan de <persona>».
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pdfRuns } from "./pdf-runs";
import { calendarWeekStart } from "../src/lib/calendar";
import {
  assignedDueDate, assignPlanBounds, buildAssignPlan, firstDescriptionLine, isAssignColumn, isValidAssignDays, parseAssignDays,
  type AssignPlanTask,
} from "../src/lib/column-assign-core";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
const { renderInWorker, stopPdfWorker } = await import("../src/lib/report-render");
after(() => stopPdfWorker());

test("qué columna es «Asignación a persona»: con persona o, venida de una plantilla, solo con el plazo", () => {
  assert.equal(isAssignColumn({ assigneeId: "u1", assignDueDays: null }), true);
  assert.equal(isAssignColumn({ assigneeId: null, assignDueDays: 7 }), true);
  assert.equal(isAssignColumn({ assigneeId: null, assignDueDays: null }), false);
  assert.equal(isAssignColumn({}), false);
});

test("plazo: entero de 1 a 365; vacío = sin plazo", () => {
  assert.equal(parseAssignDays(""), null);
  assert.equal(parseAssignDays("  "), null);
  assert.equal(parseAssignDays("7"), 7);
  assert.equal(parseAssignDays(" 365 "), 365);
  for (const bad of ["0", "366", "-1", "2.5", "1e2", "siete"]) assert.equal(parseAssignDays(bad), undefined, bad);
  assert.equal(isValidAssignDays(1), true);
  assert.equal(isValidAssignDays(1.5), false);
  assert.equal(isValidAssignDays("3"), false);
});

test("fecha límite al entrar: la que ya tenía se respeta; sin fecha, hoy + N días; sin plazo, ninguna", () => {
  assert.equal(assignedDueDate("2026-12-01", 3, "2026-11-23"), "2026-12-01");
  assert.equal(assignedDueDate(null, 3, "2026-11-23"), "2026-11-26");
  // Cambia de mes y de año.
  assert.equal(assignedDueDate(null, 10, "2026-12-28"), "2027-01-07");
  assert.equal(assignedDueDate(null, null, "2026-11-23"), null);
});

// 2026-11-25 es miércoles. En español la semana va de lunes 23 a domingo 29; en inglés, de domingo 22 a sábado 28.
const today = "2026-11-25";
const task = (title: string, dueDate: string | null): AssignPlanTask => ({ title, kind: "Tarea", priority: null, dueDate, firstLine: "", pendingSubtasks: [] });
const tasks = [
  task("Sin fecha", null),
  task("Domingo 29", "2026-11-29"),
  task("Vencida", "2026-11-20"),
  task("Hoy B", today),
  task("Mañana", "2026-11-26"),
  task("Hoy A", today),
  task("Fin de mes", "2026-11-30"),
  task("Diciembre", "2026-12-02"),
];

test("límites de «Esta semana» y «Este mes» según el primer día de la semana de cada idioma", () => {
  assert.deepEqual(assignPlanBounds(today, calendarWeekStart("es")), { weekEnd: "2026-11-29", monthEnd: "2026-11-30" });
  assert.deepEqual(assignPlanBounds(today, calendarWeekStart("en")), { weekEnd: "2026-11-28", monthEnd: "2026-11-30" });
  // Domingo: en español es el último día de la semana; en inglés, el primero.
  assert.equal(assignPlanBounds("2026-11-29", 1).weekEnd, "2026-11-29");
  assert.equal(assignPlanBounds("2026-11-29", 7).weekEnd, "2026-12-05");
  // Febrero de un año bisiesto.
  assert.equal(assignPlanBounds("2028-02-10", 1).monthEnd, "2028-02-29");
});

test("plan en español: vencidas, hoy, esta semana (hasta el domingo), este mes, más adelante y sin fecha", () => {
  const plan = buildAssignPlan(tasks, today, calendarWeekStart("es"));
  assert.deepEqual(plan.map((g) => g.bucket), ["overdue", "today", "week", "month", "later", "none"]);
  // A igual fecha, en el orden de la columna.
  assert.deepEqual(plan.find((g) => g.bucket === "today")!.tasks.map((x) => x.title), ["Hoy B", "Hoy A"]);
  assert.deepEqual(plan.find((g) => g.bucket === "week")!.tasks.map((x) => x.title), ["Mañana", "Domingo 29"]);
  assert.deepEqual(plan.find((g) => g.bucket === "month")!.tasks.map((x) => x.title), ["Fin de mes"]);
  assert.deepEqual(plan.find((g) => g.bucket === "later")!.tasks.map((x) => x.title), ["Diciembre"]);
});

test("plan en inglés: la semana acaba el sábado y el domingo 29 pasa a «Este mes»", () => {
  const plan = buildAssignPlan(tasks, today, calendarWeekStart("en"));
  assert.deepEqual(plan.find((g) => g.bucket === "week")!.tasks.map((x) => x.title), ["Mañana"]);
  assert.deepEqual(plan.find((g) => g.bucket === "month")!.tasks.map((x) => x.title), ["Domingo 29", "Fin de mes"]);
});

test("plan: los grupos vacíos no salen y, si la semana ya llega al mes siguiente, «Este mes» no añade nada", () => {
  assert.deepEqual(buildAssignPlan([task("Sola", null)], today, 1).map((g) => g.bucket), ["none"]);
  // Lunes 28 de diciembre: la semana llega al 3 de enero; el 2 de enero es «Esta semana» y el 10, «Más adelante».
  const plan = buildAssignPlan([task("2 ene", "2027-01-02"), task("10 ene", "2027-01-10")], "2026-12-28", 1);
  assert.deepEqual(plan.map((g) => [g.bucket, g.tasks.map((x) => x.title)]), [["week", ["2 ene"]], ["later", ["10 ene"]]]);
});

test("primera línea de la descripción, sin marcas de Markdown y recortada", () => {
  assert.equal(firstDescriptionLine(""), "");
  assert.equal(firstDescriptionLine("\n\n## Objetivo **claro**\nResto"), "Objetivo claro");
  assert.equal(firstDescriptionLine("![foto](/api/attachments/x)\n- [ ] Ver [el plano](https://example.com/p)"), "Ver el plano");
  assert.equal(firstDescriptionLine("```\ncódigo\n```"), "código");
  assert.equal(firstDescriptionLine("---\n> cita"), "cita");
  const long = firstDescriptionLine("a".repeat(300), 20);
  assert.equal(long.length, 20);
  assert.ok(long.endsWith("…"));
});

test("PDF: título con la persona, columna y proyecto, grupos traducidos y fechas en cada idioma", async () => {
  const groups = buildAssignPlan(
    [
      { title: "Revisar el contrato", kind: "Tarea", priority: "ALTA", dueDate: "2026-11-20", firstLine: "Con el cliente", pendingSubtasks: ["Leer", "Firmar"] },
      { title: "Llamar", kind: "Tarea", priority: null, dueDate: "2026-11-26", firstLine: "", pendingSubtasks: [] },
      { title: "Algún día", kind: "Idea", priority: null, dueDate: null, firstLine: "", pendingSubtasks: Array.from({ length: 17 }, (_, i) => `Paso ${i + 1}`) },
    ],
    today, 1,
  );
  const text = async (locale: "es" | "en") => {
    const pdf = await renderInWorker({ kind: "assignPlan", locale, input: { project: "Obra", column: "De Ana", person: "Ana", today, groups, others: 2 } });
    return pdfRuns(pdf).join("").replace(/\s+/g, " ");
  };
  const es = await text("es");
  for (const s of ["Plan de Ana", "De Ana · Obra", "Vencidas", "Esta semana", "Sin fecha", "Prioridad: Alta", "Vence el 20 nov", "Con el cliente", "[ ]", "Firmar", "y 2 subtareas más", "2 tarjetas de la columna son de otras personas"]) {
    assert.ok(es.includes(s), `${s} en: ${es}`);
  }
  assert.ok(!es.includes("Hoy"), "sin tareas de hoy, no sale el grupo");
  const en = await text("en");
  for (const s of ["Ana's plan", "Overdue", "This week", "No date", "Priority: High", "Due Nov 20", "and 2 more subtasks"]) assert.ok(en.includes(s), `${s} en: ${en}`);
});
