// Aritmética de fechas de las tareas recurrentes (pura, sin base de datos). Los días son YYYY-MM-DD.
import { addDaysIso, isoToDate, isoWeekday, nextWeekdayIso } from "./dates";

export const RECURRENCES = ["NONE", "DAILY", "WEEKLY", "MONTHLY"] as const;
export type RecurrenceRule = (typeof RECURRENCES)[number];

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Día `day` del mes (1-12) de ese año; en un mes más corto, su último día (el 31 en abril da el 30). */
function dayOfMonth(year: number, month: number, day: number): string {
  const d = Math.min(day, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Primer día posterior a `from` que es el día `day` del mes (ajustado a meses cortos). */
export function nextMonthDayIso(from: string, day: number): string {
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7));
  const thisMonth = dayOfMonth(y, m, day);
  if (thisMonth > from) return thisMonth;
  return m === 12 ? dayOfMonth(y + 1, 1, day) : dayOfMonth(y, m + 1, day);
}

/**
 * Fecha límite de la siguiente aparición. Se parte de la fecha límite de la tarea terminada o de hoy,
 * lo que sea posterior (una tarea vencida hace meses no genera otra ya vencida), y se avanza al primer día
 * posterior que cumple la regla: cada día, el día de la semana `day` (1 = lunes … 7 = domingo) o el día
 * del mes `day`. Sin `day`, se usa el de la propia fecha de partida.
 */
export function nextOccurrenceDue(rule: Exclude<RecurrenceRule, "NONE">, day: number | null, due: string | null, today: string): string {
  const base = due && due > today ? due : today;
  if (rule === "DAILY") return addDaysIso(base, 1);
  if (rule === "WEEKLY") return nextWeekdayIso(base, day && day >= 1 && day <= 7 ? day : isoWeekday(base));
  return nextMonthDayIso(base, day && day >= 1 && day <= 31 ? day : Number(base.slice(8, 10)));
}

/** Día por defecto de la regla al activarla: el de la fecha límite o, sin ella, el de hoy. */
export function defaultRecurrenceDay(rule: RecurrenceRule, due: string | null, today: string): number | null {
  const ref = due ?? today;
  if (rule === "WEEKLY") return isoWeekday(ref);
  if (rule === "MONTHLY") return isoToDate(ref).getUTCDate();
  return null;
}

/** Deja la regla coherente: sin repetición ni diaria no hay día; semanal 1-7; mensual 1-31. */
export function normalizeRecurrence(
  rule: RecurrenceRule,
  day: number | null | undefined,
  due: string | null,
  today: string,
): { recurrence: RecurrenceRule; recurrenceDay: number | null } {
  if (rule === "NONE" || rule === "DAILY") return { recurrence: rule, recurrenceDay: null };
  const max = rule === "WEEKLY" ? 7 : 31;
  const valid = day != null && Number.isInteger(day) && day >= 1 && day <= max;
  return { recurrence: rule, recurrenceDay: valid ? day : defaultRecurrenceDay(rule, due, today) };
}
