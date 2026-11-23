// Calendario: cálculos puros (sin BD ni React) para la cuadrícula mensual, las bandas de entregables
// y la agrupación por semanas de la vista móvil.
import { addDaysIso, daysBetween, isoWeekday } from "./dates";
import { isRowId } from "./row-id";
import type { Locale } from "../i18n/shared";

/** Mes en formato YYYY-MM. */
type MonthKey = string;

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

interface MonthGrid {
  weeks: CalendarDay[][];
  start: string;
  end: string;
}

/**
 * Primer día de la semana en la cuadrícula del calendario según el idioma de la interfaz: domingo en inglés (el
 * americano, como en-US) y lunes en español. Solo la cuadrícula: «Esta semana» (filtro del tablero) y el plan semanal
 * siguen de lunes a domingo en los dos idiomas.
 */
export function calendarWeekStart(locale: Locale): 1 | 7 {
  return locale === "en" ? 7 : 1;
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

/** ¿La tarea se dibuja como rango? Necesita fecha de inicio anterior a la límite (con inicio == límite es un solo día). */
export const isRange = (start: string | null | undefined, due: string | null | undefined): boolean => Boolean(start && due && start < due);

/** Bandas de tareas con rango (inicio → límite, ambos incluidos) que cruzan una semana, por inicio y luego por fin. */
export function rangeBandsForWeek(weekDays: string[], ranges: { id: string; start: string; due: string }[]): Band[] {
  const first = weekDays[0]!;
  const last = weekDays[weekDays.length - 1]!;
  const bands: Band[] = [];
  for (const r of [...ranges].sort((a, b) => a.start.localeCompare(b.start) || a.due.localeCompare(b.due) || a.id.localeCompare(b.id))) {
    if (!isRange(r.start, r.due) || r.start > last || r.due < first) continue;
    const from = r.start < first ? first : r.start;
    const to = r.due > last ? last : r.due;
    bands.push({ id: r.id, colStart: daysBetween(first, from) + 1, colEnd: daysBetween(first, to) + 1, continuesLeft: r.start < first, endsHere: r.due <= last });
  }
  return bands;
}

/**
 * Bandas que se dibujan en una semana con un tope de `max`: las primeras, salvo que alguna de `keep` (la que se arrastra
 * o la que se acaba de mover con el teclado) quede fuera; entonces ocupa el sitio de las últimas. `hidden` son las que
 * van a «+N más» (las mismas que faltan en `shown`, para no repetir ni perder ninguna).
 */
export function visibleBands(bands: Band[], max: number, keep: (string | null | undefined)[]): { shown: Band[]; hidden: Band[] } {
  const shown = bands.slice(0, max);
  const kept = new Set(keep.filter((id): id is string => Boolean(id)));
  let slot = shown.length - 1;
  for (const id of kept) {
    const band = bands.find((b) => b.id === id);
    if (!band || shown.includes(band)) continue;
    while (slot >= 0 && kept.has(shown[slot]!.id)) slot--;
    if (slot < 0) break;
    shown[slot--] = band;
  }
  return { shown, hidden: bands.filter((b) => !shown.includes(b)) };
}

/** ¿Un rango (o un día, con start = due) queda antes («prev») o después («next») de la cuadrícula que va de `first` a `last`? */
export function outsideGrid(range: { start: string; due: string }, first: string, last: string): "prev" | "next" | null {
  if (range.due < first) return "prev";
  if (range.start > last) return "next";
  return null;
}

/** Qué se arrastra de una banda: toda ella, su borde izquierdo (inicio) o el derecho (fin). */
export type RangeDragMode = "move" | "start" | "end";

/**
 * Fechas de un rango tras arrastrarlo: `grabbed` es el día bajo el puntero al empezar y `hover` el de ahora.
 * Mover conserva la duración (ambas fechas se desplazan lo mismo); los bordes cambian solo su fecha,
 * y nunca cruzan al otro (inicio <= fin): al llegar al otro borde se queda en un solo día.
 */
export function dragRange(origin: { start: string; due: string }, mode: RangeDragMode, grabbed: string, hover: string): { start: string; due: string } {
  if (mode === "move") {
    const delta = daysBetween(grabbed, hover);
    return delta ? { start: addDaysIso(origin.start, delta), due: addDaysIso(origin.due, delta) } : { ...origin };
  }
  if (mode === "start") return { start: hover > origin.due ? origin.due : hover, due: origin.due };
  return { start: origin.start, due: hover < origin.start ? origin.start : hover };
}

/** Con el dedo o un lápiz, una banda solo se arrastra tras mantenerla pulsada este tiempo sin moverla. */
export const TOUCH_DRAG_DELAY_MS = 350;
/** Distancia (px) que hay que mover el puntero para que cuente como movimiento y no como pulsación. */
const DRAG_SLOP_PX = 5;

/**
 * Qué hacer con un movimiento del puntero sobre una banda antes de que empiece el arrastre: con el ratón, arrastrar en
 * cuanto se mueve; con el dedo, solo si ya se ha mantenido pulsada (`held`); si se mueve antes, se suelta la banda para
 * que el navegador desplace la página (deslizar para bajar por el mes no debe cambiar ninguna fecha).
 */
export function pendingBandDrag(pointerType: string, held: boolean, distance: number): "wait" | "drag" | "abort" {
  if (distance < DRAG_SLOP_PX) return "wait";
  return pointerType === "mouse" || held ? "drag" : "abort";
}

/** Columna (0..cols-1) que corresponde a la coordenada x dentro de una fila de `width` px que empieza en `left`; se ajusta a los extremos. */
export function columnAt(x: number, left: number, width: number, cols: number = 7): number {
  if (!(width > 0)) return 0;
  return Math.min(cols - 1, Math.max(0, Math.floor(((x - left) / width) * cols)));
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

/**
 * Extremos del texto «Semana del {from} al {to}» de la vista móvil: el mes se escribe una sola vez si los dos días son
 * del mismo mes, junto al día donde lo pone el idioma: detrás en español («del 2 al 8 nov»), delante en inglés de EE. UU.
 * («of Nov 2 to 8»). Si la semana cruza de mes, los dos lo llevan.
 */
export function weekRangeEnds(start: string, end: string, locale: string): { from: string; to: string } {
  const day = (iso: string, withMonth: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, withMonth ? { day: "numeric", month: "short", timeZone: "UTC" } : { day: "numeric", timeZone: "UTC" });
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const types = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).formatToParts(new Date(0)).map((p) => p.type);
  const monthFirst = types.indexOf("month") < types.indexOf("day");
  return { from: day(start, !sameMonth || monthFirst), to: day(end, !sameMonth || !monthFirst) };
}

/** Marca de «sin asignar» en `?person=`. */
export const PERSON_UNASSIGNED = "unassigned";
/** Personas que se aceptan en `?person=`. */
export const MAX_PERSON_FILTER = 50;

/**
 * Valor de `?person=`: lista separada por comas de ids de usuario y/o «unassigned». Acepta los valores antiguos:
 * `me` (el usuario actual) y `none` (sin asignar). Sin duplicados y con tope; lo vacío y lo que no tiene forma de id
 * (`isRowId`: el carácter nulo rompía la consulta) se descartan. Que existan y se vean lo comprueba el servidor.
 */
export function parsePersonParam(raw: string | undefined | null, meId: string, max: number = MAX_PERSON_FILTER): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const x = part.trim();
    if (!x) continue;
    const v = x === "me" ? meId : x === "none" ? PERSON_UNASSIGNED : x;
    if (!isRowId(v)) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Valor de `?project=`: ids de proyecto separados por comas (o uno solo, como antes). Sin duplicados y con tope; lo
 * vacío y lo que no tiene forma de id se descartan. Que existan y se vean lo comprueba el servidor.
 */
export function parseProjectParam(raw: string | undefined | null, max: number): string[] {
  return [...new Set((raw ?? "").split(",").map((x) => x.trim()).filter(isRowId))].slice(0, max);
}
