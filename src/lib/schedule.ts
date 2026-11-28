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

/** Si el último informe salió hace esto o más (8 días), se envió uno menos de la cuenta y toca ya, sea cual sea el día. */
const REPORT_CATCH_UP_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * Informe semanal: hoy es el día elegido, ya es la hora (o pasó) y el último salió hace al menos 3 días. Así, si se
 * envía el lunes y se cambia al viernes, el viernes llega; si se cambia al martes, no se repite al día siguiente.
 *
 * Recuperación: si el servidor estuvo parado todo el día elegido (un despliegue, una caída), el informe no se pierde
 * hasta la semana siguiente: toca también en cualquier otro día cuando el último salió hace 8 días o más (un envío a
 * tiempo se repite cada 7; con 8 es que falló uno). Sin ningún envío anterior (`lastSentAt` nulo) no se recupera nada,
 * para que activar el informe a mitad de semana no mande uno al momento. Tras recuperarlo, `lastSentAt` es de ahora, así
 * que no salen dos en la misma semana, y la regla de los 3 días sigue valiendo.
 */
export function reportDue(now: Date, timeZone: string, s: { weekday: number; hour: number; lastSentAt: Date | null }): boolean {
  if (sentRecently(s.lastSentAt, now)) return false;
  const local = localParts(now, timeZone);
  if (local.weekday === s.weekday && local.hour >= s.hour) return true;
  return !!s.lastSentAt && now.getTime() - s.lastSentAt.getTime() >= REPORT_CATCH_UP_MS;
}
