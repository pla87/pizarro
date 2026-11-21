import assert from "node:assert/strict";
import { test } from "node:test";
import { bandsForWeek, calendarWeekStart, columnAt, dragRange, isRange, rangeBandsForWeek, groupByDay, groupWeeks, monthGrid, parseMonth, parsePersonParam, shiftMonth, weekRangeEnds } from "../src/lib/calendar";
import { deliverableStatus } from "../src/lib/report";
import { midnightStep, msUntilNextDay } from "../src/lib/dates";
import { readFileSync } from "node:fs";

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

test("calendario: la semana empieza en domingo en inglés (EE. UU.) y en lunes en español", () => {
  assert.equal(calendarWeekStart("en"), 7);
  assert.equal(calendarWeekStart("es"), 1);
  const en = monthGrid("2026-11", calendarWeekStart("en")); // 1 nov 2026 es domingo; 30 nov, lunes
  assert.equal(en.start, "2026-11-01");
  assert.equal(en.end, "2026-12-05");
  assert.ok(en.weeks.every((w) => new Date(`${w[0]!.iso}T00:00:00Z`).getUTCDay() === 0));
  const es = monthGrid("2026-11", calendarWeekStart("es"));
  assert.equal(es.start, "2026-10-26");
  assert.ok(es.weeks.every((w) => new Date(`${w[0]!.iso}T00:00:00Z`).getUTCDay() === 1));
});

test("calendario móvil: «Semana del … al …» con el mes donde lo pone cada idioma", () => {
  assert.deepEqual(weekRangeEnds("2026-11-02", "2026-11-08", "es-ES"), { from: "2", to: "8 nov" });
  assert.deepEqual(weekRangeEnds("2026-11-01", "2026-11-07", "en-US"), { from: "Nov 1", to: "7" });
  assert.deepEqual(weekRangeEnds("2026-11-29", "2026-12-05", "en-US"), { from: "Nov 29", to: "Dec 5" });
  assert.deepEqual(weekRangeEnds("2026-11-30", "2026-12-06", "es-ES"), { from: "30 nov", to: "6 dic" });
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

test("«Hoy» a medianoche (useMidnightRefresh): espera al día siguiente, refresca y reintenta como mucho 3 veces", () => {
  // Mismo día: esperar a la medianoche (con 5 s de margen), nunca más de una hora de una vez.
  assert.deepEqual(midnightStep("2026-11-20", "2026-11-20", 0, 120_000), { refresh: false, waitMs: 125_000 });
  assert.deepEqual(midnightStep("2026-11-20", "2026-11-20", 0, 10 * 3_600_000), { refresh: false, waitMs: 3_600_000 });
  // Ya es otro día: refrescar y volver a mirar al minuto; si el servidor sigue en el anterior, tres veces y basta.
  assert.deepEqual(midnightStep("2026-11-21", "2026-11-20", 0, 0), { refresh: true, waitMs: 60_000 });
  assert.deepEqual(midnightStep("2026-11-21", "2026-11-20", 2, 0), { refresh: true, waitMs: 60_000 });
  assert.equal(midnightStep("2026-11-21", "2026-11-20", 3, 0), null);
  // Medianoche en la zona de la app, no la del equipo.
  assert.equal(msUntilNextDay("Europe/Madrid", new Date("2026-11-20T22:59:00Z")), 60_000);
  // El calendario y Mis tareas lo usan (antes solo el tablero cambiaba de día a medianoche).
  assert.match(readFileSync("src/components/calendar/CalendarView.tsx", "utf8"), /useMidnightRefresh\(today, /);
  assert.match(readFileSync("src/app/(app)/my-tasks/page.tsx", "utf8"), /<MidnightRefresh today=\{today\} \/>/);
});

test("el Calendario no cuenta tareas en cada visita para «Suscribirse» y las fechas de exportar/importar van en la zona de la app", () => {
  const page = readFileSync("src/app/(app)/calendar/page.tsx", "utf8");
  assert.ok(!page.includes("defaultFeedScope"), "la opción propuesta se pide al abrir el menú (suggestedCalendarFeedScope)");
  assert.match(readFileSync("src/components/calendar/CalendarSubscribe.tsx", "utf8"), /suggestedCalendarFeedScope\(\)/);
  const jobs = readFileSync("src/components/transfer/TransferJobs.tsx", "utf8");
  assert.ok(!/toLocale(String|DateString|TimeString)\(/.test(jobs), "TransferJobs: formatDate (con timeZone), no toLocaleString");
});
