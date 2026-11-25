// Columna «Asignación a persona»: reglas puras (plazo, agrupación del plan) y el PDF «Plan de <persona>».
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pdfRuns } from "./pdf-runs";
import { calendarWeekStart } from "../src/lib/calendar";
import {
  assignedDueDate, assignedNoticeText, assignPlanBounds, buildAssignPlan, descriptionSummary, isAssignColumn, isValidAssignDays, parseAssignDays,
  type AssignPlanTask,
} from "../src/lib/column-assign-core";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
const { renderInWorker, stopPdfWorker } = await import("../src/lib/report-render");
after(() => stopPdfWorker());

test("qué columna es «Asignación a persona»: con persona o, venida de una plantilla, solo con el plazo; solo con rol NONE", () => {
  assert.equal(isAssignColumn({ role: "NONE", assigneeId: "u1", assignDueDays: null }), true);
  assert.equal(isAssignColumn({ role: "NONE", assigneeId: null, assignDueDays: 7 }), true);
  assert.equal(isAssignColumn({ role: "NONE", assigneeId: null, assignDueDays: null }), false);
  assert.equal(isAssignColumn({ role: "NONE" }), false);
  // Rol cambiado en la versión anterior (que no conoce la persona ni el plazo): se comporta como la de su rol.
  assert.equal(isAssignColumn({ role: "WAITING", assigneeId: "u1", assignDueDays: 3 }), false);
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
const task = (title: string, dueDate: string | null): AssignPlanTask => ({ title, kind: "Tarea", priority: null, dueDate, summary: [], labels: [], pendingSubtasks: [], pendingCount: 0 });
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

test("resumen de la descripción: líneas sin marcas de Markdown, sin bloques de código y recortadas", () => {
  const first = (md: string, max = 140) => descriptionSummary(md, 1, max)[0] ?? "";
  assert.deepEqual(descriptionSummary(""), []);
  assert.equal(first("\n\n## Objetivo **claro**\nResto"), "Objetivo claro…");
  assert.equal(first("![foto](/api/attachments/x)\n- [ ] Ver [el plano](https://example.com/p)"), "Ver el plano");
  // Los bloques de código se saltan enteros (ni la etiqueta del lenguaje ni el código).
  assert.deepEqual(descriptionSummary("```\ncódigo\n```"), []);
  assert.equal(first("```js\nconst x = 1;\n```\nTexto"), "Texto");
  assert.equal(first("```\nconst x = 1;\n\n```\n\nTexto"), "Texto");
  assert.equal(first("~~~\ncode\n~~~\nTexto"), "Texto");
  // Solo cierra una valla del mismo carácter y al menos igual de larga.
  assert.equal(first("````md\n```\nno\n````\nTexto"), "Texto");
  assert.equal(first("```\n~~~\nno\n```\nTexto"), "Texto");
  // Código en línea (en la misma línea) no abre un bloque.
  assert.equal(first("```x``` y más"), "x y más");
  assert.equal(first("---\n> cita"), "cita");
  const long = first("a".repeat(300), 20);
  assert.equal(long.length, 20);
  assert.ok(long.endsWith("…"));
});

test("resumen de la descripción: sin los apartados vacíos de la plantilla del tipo, cada etiqueta con su respuesta", () => {
  // La plantilla del tipo «Cita» con solo un apartado relleno: antes salía «Quién:» (la primera línea) y nada más.
  const cita = "**Quién:**\n\n**Dónde y cuándo:**\nCentro de salud, a las 10\n\n**Qué preguntar o llevar:**\n- \n";
  assert.deepEqual(descriptionSummary(cita), ["Dónde y cuándo: Centro de salud, a las 10"]);
  // Respuesta en la misma línea, varias líneas de respuesta y una lista.
  const md = "**Riesgo:** ninguno\n\n**Pasos:**\n- Abrir ajustes\n- [ ] Guardar\n\n**Notas:**\n\nTexto libre.";
  assert.deepEqual(descriptionSummary(md), ["Riesgo: ninguno", "Pasos: Abrir ajustes", "Guardar", "Notas: Texto libre."]);
  // Como mucho 6 líneas y 400 caracteres: lo que queda fuera se nota con «…».
  const many = Array.from({ length: 10 }, (_, i) => `Línea ${i + 1}`).join("\n");
  const six = descriptionSummary(many);
  assert.equal(six.length, 6);
  assert.equal(six.at(-1), "Línea 6…");
  const big = descriptionSummary(Array.from({ length: 5 }, () => "x".repeat(150)).join("\n"));
  assert.ok(big.join("").length <= 401, `caracteres: ${big.join("").length}`);
  assert.ok(big.at(-1)!.endsWith("…"));
  assert.equal(big.length, 3);
  // Dentro de un bloque de código no se toca nada (y el bloque no sale en el resumen).
  assert.deepEqual(descriptionSummary("```\n**Vacía:**\n```\n**Hecho:** sí"), ["Hecho: sí"]);
});

test("PDF: título con la persona, columna y proyecto, grupos traducidos y fechas en cada idioma", async () => {
  const groups = buildAssignPlan(
    [
      { title: "Revisar el contrato", kind: "Tarea", priority: "ALTA", dueDate: "2026-11-20", summary: ["Con el cliente", "Quién: Ana y Luis"], labels: ["Urgente"], pendingSubtasks: ["Leer", "Firmar"], pendingCount: 2 },
      { title: "Llamar", kind: "Tarea", priority: null, dueDate: "2026-11-26", summary: [], labels: [], pendingSubtasks: [], pendingCount: 0 },
      // Solo se leen las 15 que salen y cuántas son.
      { title: "Algún día", kind: "Idea", priority: null, dueDate: null, summary: [], labels: [], pendingSubtasks: Array.from({ length: 15 }, (_, i) => `Paso ${i + 1}`), pendingCount: 17 },
    ],
    today, 1,
  );
  const text = async (locale: "es" | "en") => {
    const pdf = await renderInWorker({ kind: "assignPlan", locale, input: { project: "Obra", column: "De Ana", person: "Ana", today, groups, others: 2 } });
    return pdfRuns(pdf).join("").replace(/\s+/g, " ");
  };
  const es = await text("es");
  for (const s of ["Plan de Ana", "De Ana · Obra", "Vencidas", "Esta semana", "Sin fecha", "Prioridad: Alta", "Vence el 20 nov", "Con el cliente", "Quién: Ana y Luis", "Urgente", "[ ]", "Firmar", "y 2 subtareas más", "2 tarjetas de la columna son de otras personas"]) {
    assert.ok(es.includes(s), `${s} en: ${es}`);
  }
  assert.ok(!es.includes("Hoy"), "sin tareas de hoy, no sale el grupo");
  const en = await text("en");
  for (const s of ["Ana's plan", "Overdue", "This week", "No date", "Priority: High", "Due Nov 20", "and 2 more subtasks"]) assert.ok(en.includes(s), `${s} en: ${en}`);
});

test("aviso al mover a una columna «Asignación a persona»: dice cuántas se movieron si no todas cambian", async () => {
  const { makeT } = await import("../src/i18n/core");
  const ctx = (locale: "es" | "en") => ({ users: [{ id: "ana", name: "Ana" }], today: "2026-11-25", locale, t: makeT(locale) });
  const a = (id: string, dueDate: string | null = null) => ({ id, assigneeId: "ana", dueDate });
  const es = ctx("es");
  assert.equal(assignedNoticeText([], 3, es), null);
  // Todas las movidas cambian: como hasta ahora.
  assert.equal(assignedNoticeText([a("1")], 1, es), "Asignada a Ana");
  assert.equal(assignedNoticeText([a("1", "2026-11-27")], 1, es), "Asignada a Ana · vence el 27 nov");
  assert.equal(assignedNoticeText([a("1"), a("2")], 2, es), "2 tarjetas asignadas a Ana");
  // Algunas ya eran suyas (y tenían fecha): un solo aviso con las dos cifras.
  assert.equal(assignedNoticeText([a("1"), a("2")], 5, es), "5 tarjetas movidas · 2 asignadas a Ana");
  assert.equal(assignedNoticeText([a("1", "2026-11-27")], 4, es), "4 tarjetas movidas · 1 asignada a Ana");
  const en = ctx("en");
  assert.equal(assignedNoticeText([a("1"), a("2")], 5, en), "5 cards moved · 2 assigned to Ana");
  assert.equal(assignedNoticeText([a("1")], 4, en), "4 cards moved · 1 assigned to Ana");
});
