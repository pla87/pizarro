// Calendario: cálculos puros (sin BD ni React) para la cuadrícula mensual, las bandas de entregables
// y la agrupación por semanas de la vista móvil.
import { addDaysIso, daysBetween, isoWeekday } from "./dates";

/** Mes en formato YYYY-MM. */
export type MonthKey = string;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Valida el parámetro `month`; si no es válido, devuelve el mes de `fallbackIso` (un día YYYY-MM-DD). */
export function parseMonth(raw: string | undefined | null, fallbackIso: string): MonthKey {
  const m = raw ? MONTH_RE.exec(raw) : null;
  const year = Number(m?.[1]);
  if (m && year >= 2000 && year <= 2100) return raw!;
  return fallbackIso.slice(0, 7);
}

/** Mes anterior (-1) o siguiente (+1), cruzando años. */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [y = 0, m = 1] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export interface CalendarDay {
  iso: string;
  /** Pertenece al mes mostrado (false = día de relleno del mes vecino). */
  inMonth: boolean;
}

export interface MonthGrid {
  weeks: CalendarDay[][];
  start: string;
  end: string;
}

/** Cuadrícula del mes: semanas completas de 7 días empezando en `weekStart` (1 = lunes … 7 = domingo). */
export function monthGrid(month: MonthKey, weekStart: number = 1): MonthGrid {
  const first = `${month}-01`;
  const last = addDaysIso(`${shiftMonth(month, 1)}-01`, -1);
  const lead = (isoWeekday(first) - weekStart + 7) % 7;
  const trail = 6 - ((isoWeekday(last) - weekStart + 7) % 7);
  const start = addDaysIso(first, -lead);
  const end = addDaysIso(last, trail);
  const weeks: CalendarDay[][] = [];
  for (let d = start; d <= end; d = addDaysIso(d, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const iso = addDaysIso(d, i);
        return { iso, inMonth: iso.startsWith(month) };
      }),
    );
  }
  return { weeks, start, end };
}

/** Agrupa por día (clave YYYY-MM-DD) conservando el orden de entrada. */
export function groupByDay<T>(items: T[], dayOf: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const day = dayOf(item);
    if (!day) continue;
    const list = map.get(day);
    if (list) list.push(item);
    else map.set(day, [item]);
  }
  return map;
}

/** Días que dura la banda de un entregable: la semana previa a su fecha objetivo (incluida). */
export const BAND_DAYS = 7;

export interface Band {
  id: string;
  /** Columnas (1-7) que ocupa dentro de la semana. */
  colStart: number;
  colEnd: number;
  /** La banda empieza antes de esta semana / termina (fecha objetivo) en ella. */
  continuesLeft: boolean;
  endsHere: boolean;
}

/** Bandas de entregable que cruzan una semana (7 días consecutivos), ordenadas por fecha objetivo. */
export function bandsForWeek(weekDays: string[], deliverables: { id: string; dueDate: string }[]): Band[] {
  const first = weekDays[0]!;
  const last = weekDays[weekDays.length - 1]!;
  const bands: Band[] = [];
  for (const d of [...deliverables].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))) {
    const bandStart = addDaysIso(d.dueDate, -(BAND_DAYS - 1));
    if (bandStart > last || d.dueDate < first) continue;
    const from = bandStart < first ? first : bandStart;
    const to = d.dueDate > last ? last : d.dueDate;
    bands.push({ id: d.id, colStart: daysBetween(first, from) + 1, colEnd: daysBetween(first, to) + 1, continuesLeft: bandStart < first, endsHere: d.dueDate <= last });
  }
  return bands;
}

/**
 * Semanas con contenido para la vista móvil: solo los días del mes que tienen algo (`hasItems`);
 * las semanas vacías se omiten. `start`/`end` son los límites de la semana completa.
 */
export function groupWeeks(weeks: CalendarDay[][], hasItems: (iso: string) => boolean): { start: string; end: string; days: string[] }[] {
  return weeks
    .map((w) => ({ start: w[0]!.iso, end: w[w.length - 1]!.iso, days: w.filter((d) => d.inMonth && hasItems(d.iso)).map((d) => d.iso) }))
    .filter((w) => w.days.length > 0);
}
