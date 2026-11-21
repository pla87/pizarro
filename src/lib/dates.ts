// Fechas límite: se guardan como día (YYYY-MM-DD, columna DATE) y se comparan por día.

type DueStatus = "none" | "done" | "overdue" | "today" | "soon" | "ok";

const SOON_DAYS = 3;

/** "Hoy" en la zona horaria indicada, como YYYY-MM-DD. */
export function todayIso(timeZone?: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Milisegundos que faltan, según la hora de pared de esa zona, para que empiece el día siguiente. Un día con cambio de
 * hora puede durar una hora más o menos de lo que dice la hora de pared antes del cambio: quien lo use vuelve a comprobar
 * el día al vencer (y conviene no esperar de una vez más de una hora).
 */
export function msUntilNextDay(timeZone?: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = ((part("hour") * 60 + part("minute")) * 60 + part("second")) * 1000 + (((now.getTime() % 1000) + 1000) % 1000);
  return Math.max(0, 86_400_000 - elapsed);
}

/** Margen tras la medianoche por si el reloj del servidor va algo detrás del navegador. */
const MIDNIGHT_MARGIN_MS = 5_000;
/** Espera máxima de cada vez: los cambios de hora alargan o acortan el día, así que se vuelve a mirar. */
const MAX_WAIT_MS = 3_600_000;
/** Si tras refrescar el servidor aún dice el día anterior: cada cuánto y cuántas veces se reintenta. */
const RETRY_MS = 60_000;
const MAX_RETRIES = 3;

type MidnightStep = { refresh: boolean; waitMs: number } | null;

/**
 * Qué hacer en cada comprobación de useMidnightRefresh: mientras el día del navegador en la zona de la app sea el del
 * servidor (`today`), esperar hasta la medianoche siguiente (con margen, como mucho una hora); si ya es otro, refrescar y
 * volver a mirar al minuto, como mucho MAX_RETRIES veces (después, null: se deja de mirar).
 */
export function midnightStep(browserDay: string, today: string, retries: number, msToMidnight: number): MidnightStep {
  if (browserDay === today) return { refresh: false, waitMs: Math.min(msToMidnight + MIDNIGHT_MARGIN_MS, MAX_WAIT_MS) };
  return retries < MAX_RETRIES ? { refresh: true, waitMs: RETRY_MS } : null;
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
