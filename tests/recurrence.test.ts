import assert from "node:assert/strict";
import { test } from "node:test";
import { addDaysIso, isoWeekday, nextWeekdayIso, weekBoundsIso } from "../src/lib/dates";
import { defaultRecurrenceDay, nextMonthDayIso, nextOccurrenceDue, normalizeRecurrence } from "../src/lib/recurrence-date";

// 2026-10-22 es jueves.
const TODAY = "2026-10-22";

test("días de la semana y semanas", () => {
  assert.equal(isoWeekday("2026-10-22"), 4);
  assert.equal(isoWeekday("2026-10-25"), 7);
  assert.equal(isoWeekday("2026-10-19"), 1);
  assert.equal(addDaysIso("2026-10-31", 1), "2026-11-01");
  assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
  assert.equal(nextWeekdayIso("2026-10-22", 1), "2026-10-26");
  // El mismo día de la semana salta a la semana siguiente.
  assert.equal(nextWeekdayIso("2026-10-22", 4), "2026-10-29");
  assert.deepEqual(weekBoundsIso("2026-10-22"), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(weekBoundsIso("2026-10-25"), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(weekBoundsIso("2026-10-19"), { start: "2026-10-19", end: "2026-10-25" });
});

test("diaria: el día siguiente a la fecha límite o a hoy", () => {
  assert.equal(nextOccurrenceDue("DAILY", null, null, TODAY), "2026-10-23");
  assert.equal(nextOccurrenceDue("DAILY", null, "2026-10-25", TODAY), "2026-10-26");
  // Vencida hace tiempo: no nace ya vencida.
  assert.equal(nextOccurrenceDue("DAILY", null, "2026-09-01", TODAY), "2026-10-23");
  assert.equal(nextOccurrenceDue("DAILY", null, "2026-12-31", TODAY), "2027-01-01");
});

test("semanal: el siguiente día de la semana elegido", () => {
  assert.equal(nextOccurrenceDue("WEEKLY", 1, null, TODAY), "2026-10-26");
  assert.equal(nextOccurrenceDue("WEEKLY", 4, null, TODAY), "2026-10-29");
  assert.equal(nextOccurrenceDue("WEEKLY", 7, null, TODAY), "2026-10-25");
  // Con fecha límite futura se avanza desde ella (miércoles 4 nov → lunes 9 nov).
  assert.equal(nextOccurrenceDue("WEEKLY", 1, "2026-11-04", TODAY), "2026-11-09");
  assert.equal(nextOccurrenceDue("WEEKLY", 1, "2026-09-07", TODAY), "2026-10-26");
  // Sin día se conserva el de la fecha de partida.
  assert.equal(nextOccurrenceDue("WEEKLY", null, null, TODAY), "2026-10-29");
});

test("mensual: día del mes, con meses cortos y cambio de año", () => {
  assert.equal(nextOccurrenceDue("MONTHLY", 5, null, TODAY), "2026-11-05");
  // Hoy es 22: el 22 de este mes ya no es posterior, pasa al siguiente.
  assert.equal(nextOccurrenceDue("MONTHLY", 22, null, TODAY), "2026-11-22");
  assert.equal(nextOccurrenceDue("MONTHLY", 25, null, TODAY), "2026-10-25");
  assert.equal(nextOccurrenceDue("MONTHLY", 15, "2026-12-20", "2026-12-01"), "2027-01-15");
  // El 31 en meses de 30 y 28 días cae en su último día.
  assert.equal(nextOccurrenceDue("MONTHLY", 31, "2026-01-31", "2026-01-10"), "2026-02-28");
  assert.equal(nextOccurrenceDue("MONTHLY", 31, "2026-02-28", "2026-02-01"), "2026-03-31");
  assert.equal(nextOccurrenceDue("MONTHLY", 31, "2026-03-31", "2026-03-01"), "2026-04-30");
  assert.equal(nextOccurrenceDue("MONTHLY", 31, "2026-04-30", "2026-04-01"), "2026-05-31");
  assert.equal(nextOccurrenceDue("MONTHLY", 30, "2026-01-30", "2026-01-10"), "2026-02-28");
  // Año bisiesto.
  assert.equal(nextOccurrenceDue("MONTHLY", 31, "2028-01-31", "2028-01-10"), "2028-02-29");
  assert.equal(nextMonthDayIso("2026-12-31", 31), "2027-01-31");
  // Si el mes actual aún tiene el día (y es posterior), se queda en este mes.
  assert.equal(nextMonthDayIso("2026-02-10", 31), "2026-02-28");
});

test("regla coherente al guardar", () => {
  assert.equal(defaultRecurrenceDay("WEEKLY", "2026-10-22", TODAY), 4);
  assert.equal(defaultRecurrenceDay("WEEKLY", null, TODAY), 4);
  assert.equal(defaultRecurrenceDay("MONTHLY", "2026-11-09", TODAY), 9);
  assert.equal(defaultRecurrenceDay("DAILY", null, TODAY), null);
  assert.deepEqual(normalizeRecurrence("NONE", 3, null, TODAY), { recurrence: "NONE", recurrenceDay: null });
  assert.deepEqual(normalizeRecurrence("DAILY", 3, null, TODAY), { recurrence: "DAILY", recurrenceDay: null });
  assert.deepEqual(normalizeRecurrence("WEEKLY", 2, null, TODAY), { recurrence: "WEEKLY", recurrenceDay: 2 });
  assert.deepEqual(normalizeRecurrence("WEEKLY", 9, null, TODAY), { recurrence: "WEEKLY", recurrenceDay: 4 });
  assert.deepEqual(normalizeRecurrence("MONTHLY", 31, null, TODAY), { recurrence: "MONTHLY", recurrenceDay: 31 });
  assert.deepEqual(normalizeRecurrence("MONTHLY", null, "2026-11-09", TODAY), { recurrence: "MONTHLY", recurrenceDay: 9 });
  assert.deepEqual(normalizeRecurrence("MONTHLY", 0, null, TODAY), { recurrence: "MONTHLY", recurrenceDay: 22 });
});
