import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pdfRuns } from "./pdf-runs";
import { intlLocale, makeT } from "../src/i18n/core";
import { weekBoundsIso } from "../src/lib/dates";
import { buildWeekPlan, type WeekPlanTask } from "../src/lib/week-plan";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
const { renderInWorker, stopPdfWorker } = await import("../src/lib/report-render");
after(() => stopPdfWorker());

// 2026-10-27 es martes: la semana va del 26 al 1 de noviembre.
const t = makeT("es");
const task = (title: string, dueDate: string | null, assigneeName: string | null = null): WeekPlanTask => ({ title, kind: "Tarea", assigneeName, dueDate });
const tasks = [
  task("Sin fecha", null, "Ana"),
  task("Domingo", "2026-11-01", "Berta"),
  task("Lunes B", "2026-10-26"),
  task("Lunes A", "2026-10-26", "Ana"),
  task("Vencida", "2026-10-20", "Berta"),
  task("Próxima", "2026-11-03"),
];

test("por día: lunes a domingo, luego otras fechas y sin fecha", () => {
  const s = buildWeekPlan(tasks, "2026-10-27", "day", t, "es-ES");
  assert.deepEqual(s.map((x) => x.key), ["2026-10-26", "2026-11-01", "other", "none"]);
  assert.deepEqual(s[0]!.tasks.map((x) => x.title), ["Lunes A", "Lunes B"]);
  assert.match(s[0]!.label, /lunes/i);
  assert.deepEqual(s[2]!.tasks.map((x) => x.title), ["Vencida", "Próxima"]);
});

test("por persona: por nombre, con «Sin responsable» al final y ordenadas por fecha", () => {
  const s = buildWeekPlan(tasks, "2026-10-27", "person", t, "es-ES");
  assert.deepEqual(s.map((x) => x.label), ["Ana", "Berta", "Sin responsable"]);
  assert.deepEqual(s[0]!.tasks.map((x) => x.title), ["Lunes A", "Sin fecha"]);
  assert.deepEqual(s[1]!.tasks.map((x) => x.title), ["Vencida", "Domingo"]);
});

test("por día, en inglés: fechas de EE. UU. («Monday, Oct 26»), con la semana aún de lunes a domingo", () => {
  const s = buildWeekPlan(tasks, "2026-10-27", "day", makeT("en"), intlLocale("en"));
  assert.deepEqual(s.map((x) => x.label), ["Monday, Oct 26", "Sunday, Nov 1", "Other dates", "No date"]);
});

test("PDF: la cabecera dice la semana de lunes a domingo, no el día en que se descarga", async () => {
  const today = "2026-10-31"; // sábado
  const week = weekBoundsIso(today);
  const text = async (locale: "es" | "en") => {
    const sections = buildWeekPlan(tasks, today, "day", makeT(locale), intlLocale(locale));
    const pdf = await renderInWorker({ kind: "weekPlan", locale, input: { project: "Proyecto", column: "Semana", today, weekStart: week.start, weekEnd: week.end, generatedBy: "Ana", groupBy: "day", sections } });
    return pdfRuns(pdf).join("").replace(/\s+/g, " ");
  };
  const es = await text("es");
  assert.ok(es.includes("Semana del 26 oct al 1 nov"), es);
  assert.ok(!es.includes("31 oct"));
  assert.ok((await text("en")).includes("Week of Oct 26 to Nov 1"));
});
