// Fechas límite: se guardan como día (YYYY-MM-DD, columna DATE) y se comparan por día.

export type DueStatus = "none" | "done" | "overdue" | "today" | "soon" | "ok";

export const SOON_DAYS = 3;

/** "Hoy" en la zona horaria indicada, como YYYY-MM-DD. */
export function todayIso(timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Date (UTC medianoche, como la devuelve Prisma para @db.Date) → YYYY-MM-DD. */
export function dateToIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

export function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
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
export function formatDay(iso: string, today?: string): string {
  const d = isoToDate(iso);
  const sameYear = today ? today.slice(0, 4) === iso.slice(0, 4) : false;
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: sameYear ? undefined : "numeric", timeZone: "UTC" });
}
