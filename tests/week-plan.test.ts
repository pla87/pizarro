import assert from "node:assert/strict";
import { test } from "node:test";
import { makeT } from "../src/i18n/core";
import { buildWeekPlan, type WeekPlanTask } from "../src/lib/week-plan";

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
