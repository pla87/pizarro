// Apariciones futuras previstas de una tarea recurrente (para el calendario y el .ics). Funciones puras; días YYYY-MM-DD.
//
// La siguiente aparición nace al terminar o archivar la tarea (lib/recurrence.ts) con la fecha que da nextOccurrenceDue
// partiendo de su fecha límite o de hoy, lo que sea posterior. Las que se prevén aquí son las que saldrían si cada una se
// terminara a tiempo: la primera es nextOccurrenceDue(fecha límite, hoy) y cada una de las siguientes sale de la anterior.
// Una tarea sin fecha límite no tiene previsión (su siguiente fecha depende del día en que se termine).
import { addDaysIso, isoToDate, isoWeekday } from "./dates";
import type { IcsEvent } from "./ics";
import { nextOccurrenceDue, type RecurrenceRule } from "./recurrence-date";

type Rule = Exclude<RecurrenceRule, "NONE">;

/**
 * Día de la regla que usará toda la serie: el guardado si es válido o, si falta (datos antiguos), el de la fecha de partida,
 * como hace nextOccurrenceDue. Con el día fijo, las apariciones son todos los días que cumplen la regla tras la primera.
 */
function seriesDay(rule: Rule, day: number | null, due: string, today: string): number | null {
  if (rule === "DAILY") return null;
  const max = rule === "WEEKLY" ? 7 : 31;
  if (day != null && Number.isInteger(day) && day >= 1 && day <= max) return day;
  const base = due > today ? due : today;
  return rule === "WEEKLY" ? isoWeekday(base) : isoToDate(base).getUTCDate();
}

/** Primera aparición prevista (la que nacería al terminar la tarea a tiempo); null sin repetición o sin fecha límite. */
export function firstOccurrence(rule: RecurrenceRule, day: number | null, due: string | null, today: string): string | null {
  if (rule === "NONE" || !due) return null;
  return nextOccurrenceDue(rule, seriesDay(rule, day, due, today), due, today);
}

/**
 * Apariciones previstas entre `from` y `to` (incluidos), como mucho `max`. Nunca da la propia tarea (su fecha límite) ni días
 * pasados: todas son posteriores a hoy y a la fecha límite. Sin bucles largos: salta directamente al principio del rango
 * y cada paso avanza al menos un día, así que da como mucho `max` vueltas aunque el rango quede años después.
 */
export function projectOccurrences(rule: RecurrenceRule, day: number | null, due: string | null, today: string, from: string, to: string, max: number): string[] {
  if (rule === "NONE" || !due || from > to || max <= 0) return [];
  const d = seriesDay(rule, day, due, today);
  let cur = nextOccurrenceDue(rule, d, due, today);
  // La primera queda antes del rango: la primera del rango es el primer día que cumple la regla desde `from`.
  if (cur < from) cur = nextOccurrenceDue(rule, d, addDaysIso(from, -1), today);
  const out: string[] = [];
  while (cur <= to && out.length < max) {
    out.push(cur);
    cur = nextOccurrenceDue(rule, d, cur, today);
  }
  return out;
}

const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/**
 * RRULE (RFC 5545) equivalente a la regla, o null si no hay una fiel y que entiendan todos los clientes: el día 29 y el 30 de
 * cada mes pasan al último día en los meses más cortos (BYMONTHDAY=30 se saltaría febrero). El 31 es «el último día del mes».
 */
export function recurrenceRRule(rule: RecurrenceRule, day: number | null): string | null {
  if (rule === "DAILY") return "FREQ=DAILY";
  if (rule === "WEEKLY") return day != null && day >= 1 && day <= 7 ? `FREQ=WEEKLY;BYDAY=${BYDAY[day - 1]}` : null;
  if (rule === "MONTHLY") {
    if (day === 31) return "FREQ=MONTHLY;BYMONTHDAY=-1";
    return day != null && Number.isInteger(day) && day >= 1 && day <= 28 ? `FREQ=MONTHLY;BYMONTHDAY=${day}` : null;
  }
  return null;
}

/** Tope de eventos sueltos por serie cuando no hay RRULE fiel (mensual los días 29 o 30: uno al mes). */
export const MAX_EXPANDED_PER_SERIES = 24;

/**
 * Eventos del .ics para las apariciones futuras de una tarea recurrente: uno con RRULE que empieza en la primera aparición
 * prevista (la tarea en sí ya tiene su propio evento) o, si la regla no tiene RRULE fiel, uno por aparición hasta `until`.
 * `event` lleva lo común (resumen, descripción, URL…); el UID se deriva del de la tarea para no chocar con él.
 */
export function repeatIcsEvents(
  task: { id: string; recurrence: RecurrenceRule; recurrenceDay: number | null; due: string | null },
  event: Omit<IcsEvent, "uid" | "date" | "endDate" | "rrule">,
  today: string,
  until: string,
): IcsEvent[] {
  const first = firstOccurrence(task.recurrence, task.recurrenceDay, task.due, today);
  if (!first || task.recurrence === "NONE" || !task.due) return [];
  const rrule = recurrenceRRule(task.recurrence, seriesDay(task.recurrence, task.recurrenceDay, task.due, today));
  if (rrule) return [{ ...event, uid: `${task.id}-repeat@pizarro`, date: first, rrule }];
  return projectOccurrences(task.recurrence, task.recurrenceDay, task.due, today, first, until, MAX_EXPANDED_PER_SERIES).map((date) => ({ ...event, uid: `${task.id}-repeat-${date}@pizarro`, date }));
}
