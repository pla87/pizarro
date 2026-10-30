import assert from "node:assert/strict";
import { test } from "node:test";
import { bandsForWeek, columnAt, dragRange, isRange, rangeBandsForWeek, groupByDay, groupWeeks, monthGrid, parseMonth, parsePersonParam, shiftMonth } from "../src/lib/calendar";
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

test("isRange: solo con inicio anterior a la fecha límite", () => {
  assert.equal(isRange("2026-10-01", "2026-10-05"), true);
  assert.equal(isRange("2026-10-05", "2026-10-05"), false);
  assert.equal(isRange("2026-10-06", "2026-10-05"), false);
  assert.equal(isRange(null, "2026-10-05"), false);
  assert.equal(isRange("2026-10-01", null), false);
});

test("rangeBandsForWeek: recorta a la semana y marca continuaciones", () => {
  const week = monthGrid("2026-10").weeks[2]!.map((d) => d.iso); // 12-18 oct
  const bands = rangeBandsForWeek(week, [
    { id: "dentro", start: "2026-10-13", due: "2026-10-15" },
    { id: "antes", start: "2026-10-08", due: "2026-10-12" }, // acaba el primer día
    { id: "cruza", start: "2026-10-16", due: "2026-10-22" }, // sigue en la semana siguiente
    { id: "larga", start: "2026-10-01", due: "2026-10-30" }, // ocupa toda la semana
    { id: "fuera", start: "2026-10-19", due: "2026-10-21" },
    { id: "pasada", start: "2026-10-01", due: "2026-10-11" },
    { id: "uno", start: "2026-10-14", due: "2026-10-14" }, // un solo día: no es rango
  ]);
  assert.deepEqual(bands, [
    { id: "larga", colStart: 1, colEnd: 7, continuesLeft: true, endsHere: false },
    { id: "antes", colStart: 1, colEnd: 1, continuesLeft: true, endsHere: true },
    { id: "dentro", colStart: 2, colEnd: 4, continuesLeft: false, endsHere: true },
    { id: "cruza", colStart: 5, colEnd: 7, continuesLeft: false, endsHere: false },
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

test("parsePersonParam: varias personas, sin asignar, duplicados y tope", () => {
  assert.deepEqual(parsePersonParam("a,b,unassigned", "me1"), ["a", "b", "unassigned"]);
  assert.deepEqual(parsePersonParam(" a , ,a,b ", "me1"), ["a", "b"]);
  assert.deepEqual(parsePersonParam("", "me1"), []);
  assert.deepEqual(parsePersonParam(undefined, "me1"), []);
  const many = Array.from({ length: 80 }, (_, i) => `u${i}`).join(",");
  assert.equal(parsePersonParam(many, "me1").length, 50);
  assert.equal(parsePersonParam(many, "me1", 3).length, 3);
});

test("parsePersonParam: enlaces antiguos (me, none, un id)", () => {
  assert.deepEqual(parsePersonParam("me", "me1"), ["me1"]);
  assert.deepEqual(parsePersonParam("none", "me1"), ["unassigned"]);
  assert.deepEqual(parsePersonParam("abc123", "me1"), ["abc123"]);
  // «me» y el id propio se funden en una sola entrada.
  assert.deepEqual(parsePersonParam("me,me1,none,unassigned", "me1"), ["me1", "unassigned"]);
});

test("dragRange: mover conserva la duración y desplaza ambas fechas", () => {
  const r = { start: "2026-10-10", due: "2026-10-14" };
  assert.deepEqual(dragRange(r, "move", "2026-10-11", "2026-10-11"), r);
  assert.deepEqual(dragRange(r, "move", "2026-10-11", "2026-10-14"), { start: "2026-10-13", due: "2026-10-17" });
  // Hacia atrás y cruzando mes y año.
  assert.deepEqual(dragRange(r, "move", "2026-10-12", "2026-10-02"), { start: "2026-09-30", due: "2026-10-04" });
  assert.deepEqual(dragRange({ start: "2026-12-30", due: "2027-01-02" }, "move", "2026-12-30", "2027-01-01"), { start: "2027-01-01", due: "2027-01-04" });
});

test("dragRange: los bordes cambian una sola fecha y nunca se cruzan", () => {
  const r = { start: "2026-10-10", due: "2026-10-14" };
  assert.deepEqual(dragRange(r, "start", "2026-10-10", "2026-10-07"), { start: "2026-10-07", due: "2026-10-14" });
  assert.deepEqual(dragRange(r, "start", "2026-10-10", "2026-10-20"), { start: "2026-10-14", due: "2026-10-14" });
  assert.deepEqual(dragRange(r, "end", "2026-10-14", "2026-10-18"), { start: "2026-10-10", due: "2026-10-18" });
  assert.deepEqual(dragRange(r, "end", "2026-10-14", "2026-10-01"), { start: "2026-10-10", due: "2026-10-10" });
});

test("columnAt reparte la fila en columnas iguales y se ajusta a los extremos", () => {
  assert.equal(columnAt(100, 100, 700), 0);
  assert.equal(columnAt(199, 100, 700), 0);
  assert.equal(columnAt(200, 100, 700), 1);
  assert.equal(columnAt(799, 100, 700), 6);
  assert.equal(columnAt(50, 100, 700), 0);
  assert.equal(columnAt(5000, 100, 700), 6);
  assert.equal(columnAt(10, 0, 0), 0);
});
