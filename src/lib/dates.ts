// Fechas límite: se guardan como día (YYYY-MM-DD, columna DATE) y se comparan por día.

type DueStatus = "none" | "done" | "overdue" | "today" | "soon" | "ok";

const SOON_DAYS = 3;

/** "Hoy" en la zona horaria indicada, como YYYY-MM-DD. */
export function todayIso(timeZone?: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Día natural (YYYY-MM-DD) de un instante en la zona horaria indicada (no el día UTC). */
export const isoInZone = (date: Date, timeZone?: string): string => todayIso(timeZone, date);

/** Días naturales (en la zona indicada) entre un instante y otro: la regla de «lleva N días» de tarjeta y recordatorio. */
export function calendarDaysSince(from: Date, now: Date, timeZone?: string): number {
  return daysBetween(isoInZone(from, timeZone), isoInZone(now, timeZone));
}

/** Date (UTC medianoche, como la devuelve Prisma para @db.Date) → YYYY-MM-DD. */
export function dateToIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

export function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Suma (o resta) días naturales a un día YYYY-MM-DD. */
export function addDaysIso(iso: string, days: number): string {
  return dateToIso(new Date(isoToDate(iso).getTime() + days * 86_400_000))!;
}

/** Día de la semana de un día YYYY-MM-DD: 1 = lunes … 7 = domingo. */
export function isoWeekday(iso: string): number {
  return isoToDate(iso).getUTCDay() || 7;
}

/** Primer día (YYYY-MM-DD) posterior a `from` que cae en ese día de la semana (1 = lunes … 7 = domingo). */
export function nextWeekdayIso(from: string, weekday: number): string {
  return addDaysIso(from, ((weekday - isoWeekday(from) + 6) % 7) + 1);
}

/** Lunes y domingo de la semana que contiene ese día. */
export function weekBoundsIso(iso: string): { start: string; end: string } {
  const start = addDaysIso(iso, 1 - isoWeekday(iso));
  return { start, end: addDaysIso(start, 6) };
}

/** Días naturales de `from` a `to` (ambos YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((isoToDate(to).getTime() - isoToDate(from).getTime()) / 86_400_000);
}

export function dueStatus(due: string | null, done: boolean, today: string): DueStatus {
  if (!due) return "none";
  if (done) return "done";
  const d = daysBetween(today, due);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= SOON_DAYS) return "soon";
  return "ok";
}

/** 2026-10-18 → "18 oct 2026" (o sin año si es el actual). */
export function formatDay(iso: string, today?: string, locale = "es-ES"): string {
  const d = isoToDate(iso);
  const sameYear = today ? today.slice(0, 4) === iso.slice(0, 4) : false;
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric", timeZone: "UTC" });
}
