// Apariciones futuras previstas de las tareas que se repiten (calendario) y su serie en el .ics (RRULE).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDaysIso, isoToDate, isoWeekday } from "../src/lib/dates";
import { buildIcs } from "../src/lib/ics";
import { nextOccurrenceDue, type RecurrenceRule } from "../src/lib/recurrence-date";
import { assertFast } from "./timing";
import { firstOccurrence, MAX_EXPANDED_PER_SERIES, projectOccurrences, recurrenceRRule, repeatIcsEvents } from "../src/lib/recurrence-series";

const TODAY = "2026-11-13"; // viernes

/** Lo que haría la app terminando cada aparición a tiempo: nextOccurrenceDue encadenado, sin atajos. */
function naive(rule: Exclude<RecurrenceRule, "NONE">, day: number | null, due: string, today: string, from: string, to: string): string[] {
  const out: string[] = [];
  for (let cur = nextOccurrenceDue(rule, day, due, today); cur <= to; cur = nextOccurrenceDue(rule, day, cur, today)) if (cur >= from) out.push(cur);
  return out;
}

/** Evaluador mínimo de las RRULE que generamos (DAILY; WEEKLY;BYDAY; MONTHLY;BYMONTHDAY=n|-1) desde DTSTART. */
function expandRRule(rrule: string, start: string, to: string): string[] {
  const parts = Object.fromEntries(rrule.split(";").map((p) => p.split("=") as [string, string]));
  const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  const out: string[] = [];
  for (let d = start; d <= to; d = addDaysIso(d, 1)) {
    const date = isoToDate(d);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    if (parts.FREQ === "DAILY") out.push(d);
    else if (parts.FREQ === "WEEKLY" && BYDAY[isoWeekday(d) - 1] === parts.BYDAY) out.push(d);
    else if (parts.FREQ === "MONTHLY") {
      const n = Number(parts.BYMONTHDAY);
      if (date.getUTCDate() === (n === -1 ? last : n)) out.push(d);
    }
  }
  return out;
}

describe("projectOccurrences", () => {
  test("diaria: desde mañana si la tarea está vencida; nunca la propia fecha límite ni días pasados", () => {
    assert.deepEqual(projectOccurrences("DAILY", null, "2026-11-10", TODAY, "2026-11-01", "2026-11-16", 50), ["2026-11-14", "2026-11-15", "2026-11-16"]);
    // Con la fecha límite en el futuro, la primera es el día siguiente a ella.
    assert.deepEqual(projectOccurrences("DAILY", null, "2026-11-20", TODAY, "2026-11-01", "2026-11-23", 50), ["2026-11-21", "2026-11-22", "2026-11-23"]);
  });

  test("semanal: el día de la semana elegido", () => {
    // Lunes (1), con fecha límite el lunes 16.
    assert.deepEqual(projectOccurrences("WEEKLY", 1, "2026-11-16", TODAY, "2026-11-01", "2026-12-13", 50), ["2026-11-23", "2026-11-30", "2026-12-07"]);
    // Fecha límite un miércoles y regla de los lunes: la primera es el lunes siguiente.
    assert.deepEqual(projectOccurrences("WEEKLY", 1, "2026-11-18", TODAY, "2026-11-01", "2026-11-30", 50), ["2026-11-23", "2026-11-30"]);
  });

  test("mensual: el día 31 cae en el último día de los meses cortos y el 30 en el 29 de febrero bisiesto", () => {
    assert.deepEqual(projectOccurrences("MONTHLY", 31, "2026-12-31", TODAY, "2027-01-01", "2027-05-31", 50), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
    assert.deepEqual(projectOccurrences("MONTHLY", 30, "2028-01-30", TODAY, "2028-02-01", "2028-03-31", 50), ["2028-02-29", "2028-03-30"]);
  });

  test("sin repetición, sin fecha límite, rango vacío o tope 0: nada", () => {
    assert.deepEqual(projectOccurrences("NONE", null, "2026-11-20", TODAY, "2026-11-01", "2026-12-31", 50), []);
    assert.deepEqual(projectOccurrences("DAILY", null, null, TODAY, "2026-11-01", "2026-12-31", 50), []);
    assert.deepEqual(projectOccurrences("DAILY", null, "2026-11-20", TODAY, "2026-12-31", "2026-11-01", 50), []);
    assert.deepEqual(projectOccurrences("DAILY", null, "2026-11-20", TODAY, "2026-11-01", "2026-12-31", 0), []);
    assert.equal(firstOccurrence("WEEKLY", 2, null, TODAY), null);
  });

  test("tope de apariciones por rango y salto directo a un rango lejano (sin recorrer los años de en medio)", () => {
    assert.equal(projectOccurrences("DAILY", null, "2026-11-20", TODAY, "2026-11-01", "2027-12-31", 42).length, 42);
    // Un rango 80 años después: solo las del rango, desde su primer día.
    const far = projectOccurrences("DAILY", null, "2026-11-20", TODAY, "2106-03-01", "2106-03-05", 100);
    assert.deepEqual(far, ["2106-03-01", "2106-03-02", "2106-03-03", "2106-03-04", "2106-03-05"]);
    // 2000 tareas a un mes de 2090: con el salto son unas pocas vueltas cada una (sin él, miles por tarea).
    assertFast(1500, () => {
      for (let i = 0; i < 2000; i++) projectOccurrences("WEEKLY", 3, "2026-11-20", TODAY, "2090-01-01", "2090-02-11", 42);
    }, "2000 series en 2090");
  });

  test("igual que encadenar nextOccurrenceDue (todas las reglas y días, rangos antes, durante y después)", () => {
    const dues = ["2026-01-31", "2026-11-13", "2026-11-20", "2027-02-28", "2028-02-29"];
    const ranges: [string, string][] = [["2026-10-26", "2026-12-06"], ["2027-01-25", "2027-03-07"], ["2028-01-31", "2028-03-12"], ["2030-12-30", "2031-02-09"]];
    const rules: [Exclude<RecurrenceRule, "NONE">, number | null][] = [["DAILY", null]];
    for (let d = 1; d <= 7; d++) rules.push(["WEEKLY", d]);
    for (let d = 1; d <= 31; d++) rules.push(["MONTHLY", d]);
    for (const due of dues) for (const [rule, day] of rules) for (const [from, to] of ranges) {
      assert.deepEqual(projectOccurrences(rule, day, due, TODAY, from, to, 1000), naive(rule, day, due, TODAY, from, to), `${rule} ${day} ${due} ${from}`);
    }
  });
});

describe("RRULE de la serie", () => {
  test("reglas que tienen RRULE fiel y las que no", () => {
    assert.equal(recurrenceRRule("DAILY", null), "FREQ=DAILY");
    assert.equal(recurrenceRRule("WEEKLY", 1), "FREQ=WEEKLY;BYDAY=MO");
    assert.equal(recurrenceRRule("WEEKLY", 7), "FREQ=WEEKLY;BYDAY=SU");
    assert.equal(recurrenceRRule("MONTHLY", 15), "FREQ=MONTHLY;BYMONTHDAY=15");
    assert.equal(recurrenceRRule("MONTHLY", 28), "FREQ=MONTHLY;BYMONTHDAY=28");
    assert.equal(recurrenceRRule("MONTHLY", 31), "FREQ=MONTHLY;BYMONTHDAY=-1");
    // El 29 y el 30 pasan al último día en febrero: BYMONTHDAY=30 se saltaría el mes.
    assert.equal(recurrenceRRule("MONTHLY", 29), null);
    assert.equal(recurrenceRRule("MONTHLY", 30), null);
    assert.equal(recurrenceRRule("NONE", null), null);
    assert.equal(recurrenceRRule("WEEKLY", null), null);
  });

  test("la RRULE desde la primera aparición da las mismas fechas que la app durante tres años", () => {
    const to = "2029-12-31";
    const cases: [Exclude<RecurrenceRule, "NONE">, number | null][] = [["DAILY", null]];
    for (let d = 1; d <= 7; d++) cases.push(["WEEKLY", d]);
    for (const d of [1, 15, 28, 31]) cases.push(["MONTHLY", d]);
    for (const due of ["2026-11-02", "2026-11-30", "2027-01-31"]) for (const [rule, day] of cases) {
      const [ev] = repeatIcsEvents({ id: "t1", recurrence: rule, recurrenceDay: day, due }, { summary: "x" }, TODAY, to);
      assert.ok(ev?.rrule, `${rule} ${day}`);
      assert.deepEqual(expandRRule(ev.rrule!, ev.date, to), projectOccurrences(rule, day, due, TODAY, TODAY, to, 5000), `${rule} ${day} ${due}`);
    }
  });

  test("serie: un evento con RRULE y UID propio; sin RRULE fiel, eventos sueltos hasta el horizonte (con tope)", () => {
    const weekly = repeatIcsEvents({ id: "abc", recurrence: "WEEKLY", recurrenceDay: 1, due: "2026-11-16" }, { summary: "Reunión", url: "https://example.com/p/1?task=abc" }, TODAY, "2027-11-13");
    assert.equal(weekly.length, 1);
    assert.deepEqual({ uid: weekly[0]!.uid, date: weekly[0]!.date, rrule: weekly[0]!.rrule, summary: weekly[0]!.summary }, { uid: "abc-repeat@pizarro", date: "2026-11-23", rrule: "FREQ=WEEKLY;BYDAY=MO", summary: "Reunión" });

    const m30 = repeatIcsEvents({ id: "m", recurrence: "MONTHLY", recurrenceDay: 30, due: "2026-11-30" }, { summary: "Cierre" }, TODAY, "2027-11-13");
    assert.deepEqual(m30.map((e) => e.date).slice(0, 4), ["2026-12-30", "2027-01-30", "2027-02-28", "2027-03-30"]);
    assert.equal(m30.at(-1)!.date, "2027-10-30");
    assert.ok(m30.every((e) => !e.rrule && e.uid === `m-repeat-${e.date}@pizarro`));
    assert.ok(repeatIcsEvents({ id: "m", recurrence: "MONTHLY", recurrenceDay: 29, due: "2026-11-29" }, { summary: "x" }, TODAY, "2040-01-01").length <= MAX_EXPANDED_PER_SERIES);

    assert.deepEqual(repeatIcsEvents({ id: "n", recurrence: "DAILY", recurrenceDay: null, due: null }, { summary: "x" }, TODAY, "2027-11-13"), []);
    assert.deepEqual(repeatIcsEvents({ id: "n", recurrence: "NONE", recurrenceDay: null, due: "2026-11-20" }, { summary: "x" }, TODAY, "2027-11-13"), []);
  });

  test("buildIcs escribe la RRULE tras el resumen y descarta una con otra forma (sin inyectar propiedades)", () => {
    const ics = buildIcs({ name: "Cal", now: new Date("2026-11-13T10:00:00Z"), events: [
      { uid: "a-repeat@pizarro", date: "2026-11-23", summary: "A", rrule: "FREQ=WEEKLY;BYDAY=MO" },
      { uid: "b@pizarro", date: "2026-11-24", summary: "B", rrule: "FREQ=DAILY\r\nATTENDEE:mailto:x@example.com" },
      { uid: "c@pizarro", date: "2026-11-25", summary: "C", rrule: "FREQ=daily" },
      { uid: "d@pizarro", date: "2026-11-26", summary: "D", rrule: "A=A;".repeat(5000) },
    ] });
    const lines = ics.split("\r\n");
    const a = lines.indexOf("UID:a-repeat@pizarro");
    assert.equal(lines[a + 3], "DTEND;VALUE=DATE:20261124");
    assert.equal(lines[a + 4], "SUMMARY:A");
    assert.equal(lines[a + 5], "RRULE:FREQ=WEEKLY;BYDAY=MO");
    assert.equal(lines.filter((l) => l.startsWith("RRULE:")).length, 1);
    assert.ok(!ics.includes("ATTENDEE"));
  });

  test("la forma de la RRULE se comprueba en tiempo lineal (textos enormes y casi válidos)", () => {
    const evil = ["FREQ=" + "A".repeat(100_000) + ";", "A=" + "A,".repeat(50_000) + "=", ("A=1;").repeat(30_000) + "x"];
    const ics = assertFast(500, () => evil.map((rrule) => buildIcs({ name: "x", events: [{ uid: "u", date: "2026-11-23", summary: "s", rrule }] })).join(""), "RRULE enormes");
    assert.ok(!ics.includes("RRULE:"));
  });
});
