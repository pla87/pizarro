import assert from "node:assert/strict";
import { test } from "node:test";
import { bandsForWeek, groupByDay, groupWeeks, monthGrid, parseMonth, shiftMonth } from "../src/lib/calendar";
import { deliverableStatus } from "../src/lib/report";

test("parseMonth valida y cae al mes de hoy", () => {
  assert.equal(parseMonth("2026-03", "2026-10-23"), "2026-03");
  assert.equal(parseMonth("2026-13", "2026-10-23"), "2026-10");
  assert.equal(parseMonth("abc", "2026-10-23"), "2026-10");
  assert.equal(parseMonth(undefined, "2026-10-23"), "2026-10");
  assert.equal(parseMonth("1999-01", "2026-10-23"), "2026-10");
});

test("shiftMonth cruza años", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-10", 0), "2026-10");
});

test("monthGrid con semana en lunes: octubre 2026 (empieza en jueves)", () => {
  const g = monthGrid("2026-10");
  assert.equal(g.start, "2026-09-28");
  assert.equal(g.end, "2026-11-01");
  assert.equal(g.weeks.length, 5);
  assert.ok(g.weeks.every((w) => w.length === 7));
  assert.equal(g.weeks[0]![0]!.inMonth, false);
  assert.equal(g.weeks[0]![3]!.iso, "2026-10-01");
  assert.equal(g.weeks[0]![3]!.inMonth, true);
  assert.equal(g.weeks[4]![6]!.iso, "2026-11-01");
  assert.equal(g.weeks[4]![6]!.inMonth, false);
});

test("monthGrid con semana en domingo y mes que empieza en domingo", () => {
  const g = monthGrid("2026-02", 1); // 1 feb 2026 es domingo; 28 feb es sábado
  assert.equal(g.start, "2026-01-26");
  assert.equal(g.end, "2026-03-01");
  const s = monthGrid("2026-02", 7);
  assert.equal(s.start, "2026-02-01");
  assert.equal(s.end, "2026-02-28");
  assert.equal(s.weeks.length, 4);
  assert.ok(s.weeks.flat().every((d) => d.inMonth));
});

test("monthGrid: año bisiesto y diciembre", () => {
  assert.ok(monthGrid("2028-02").weeks.flat().some((d) => d.iso === "2028-02-29"));
  assert.equal(monthGrid("2026-12").end, "2027-01-03");
});

test("groupByDay agrupa y omite sin fecha", () => {
  const m = groupByDay([{ d: "a", n: 1 }, { d: null, n: 2 }, { d: "a", n: 3 }], (x) => x.d);
  assert.deepEqual(m.get("a")?.map((x) => x.n), [1, 3]);
  assert.equal(m.size, 1);
});

test("bandsForWeek: banda de 7 días que acaba en la fecha objetivo", () => {
  const week = monthGrid("2026-10").weeks[2]!.map((d) => d.iso); // 12-18 oct
  const bands = bandsForWeek(week, [
    { id: "x", dueDate: "2026-10-15" }, // 9-15: empieza antes
    { id: "y", dueDate: "2026-10-30" }, // fuera
    { id: "z", dueDate: "2026-10-20" }, // 14-20: sigue en la semana siguiente
  ]);
  assert.deepEqual(bands, [
    { id: "x", colStart: 1, colEnd: 4, continuesLeft: true, endsHere: true },
    { id: "z", colStart: 3, colEnd: 7, continuesLeft: false, endsHere: false },
  ]);
});

test("estado de entregable: reutiliza las reglas del informe", () => {
  assert.equal(deliverableStatus(0, 0, 3), "Sin tareas");
  assert.equal(deliverableStatus(4, 4, -2), "Completado");
  assert.equal(deliverableStatus(4, 1, -1), "Retrasado");
  assert.equal(deliverableStatus(4, 2, 7), "En riesgo");
  assert.equal(deliverableStatus(4, 3, 7), "En plazo");
  assert.equal(deliverableStatus(4, 1, 8), "En plazo");
});

test("groupWeeks: solo días del mes con contenido y semanas no vacías", () => {
  const weeks = monthGrid("2026-10").weeks;
  const has = new Set(["2026-09-30", "2026-10-02", "2026-10-03", "2026-10-21"]);
  const g = groupWeeks(weeks, (iso) => has.has(iso));
  assert.deepEqual(g, [
    { start: "2026-09-28", end: "2026-10-04", days: ["2026-10-02", "2026-10-03"] },
    { start: "2026-10-19", end: "2026-10-25", days: ["2026-10-21"] },
  ]);
});
