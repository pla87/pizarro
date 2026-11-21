// Cuándo toca enviar los envíos periódicos (resumen diario, informe semanal). Funciones puras.
//
// La pasada del correo va a cada hora en punto (+1 min) de la zona de la app (maintenance.ts): un envío «a las 8» sale
// en la primera pasada a partir de las 8 (hora local de la app) de ese día, y solo una vez al día.

interface LocalParts {
  /** YYYY-MM-DD en la zona horaria indicada. */
  date: string;
  /** 0-23 */
  hour: number;
  /** ISO: 1 = lunes … 7 = domingo. */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Fecha, hora y día de la semana de un instante en una zona horaria. */
export function localParts(now: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, weekday: WEEKDAYS[parts.weekday!] ?? 1 };
}

function sentToday(lastSentAt: Date | null, now: Date, timeZone: string): boolean {
  return !!lastSentAt && localParts(lastSentAt, timeZone).date === localParts(now, timeZone).date;
}

/** Margen del informe semanal: no se repite si el último salió hace menos de esto (3 días). */
const REPORT_MIN_GAP_MS = 3 * 24 * 60 * 60 * 1000;

function sentRecently(lastSentAt: Date | null, now: Date): boolean {
  return !!lastSentAt && now.getTime() - lastSentAt.getTime() < REPORT_MIN_GAP_MS;
}

/** Resumen diario: ya es la hora elegida (o pasó) y hoy todavía no se ha enviado. */
export function digestDue(now: Date, timeZone: string, s: { hour: number; lastSentAt: Date | null }): boolean {
  return localParts(now, timeZone).hour >= s.hour && !sentToday(s.lastSentAt, now, timeZone);
}

/**
 * Informe semanal: hoy es el día elegido, ya es la hora (o pasó) y el último salió hace al menos 3 días. Así, si se
 * envía el lunes y se cambia al viernes, el viernes llega; si se cambia al martes, no se repite al día siguiente.
 */
export function reportDue(now: Date, timeZone: string, s: { weekday: number; hour: number; lastSentAt: Date | null }): boolean {
  const local = localParts(now, timeZone);
  return local.weekday === s.weekday && local.hour >= s.hour && !sentRecently(s.lastSentAt, now);
}
