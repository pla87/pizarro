// Intervalo de fechas de la descarga CSV de logs (Administración → Logs). Sin dependencias del servidor para poder probarlo.

const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const utcOf = (day: string): number => {
  const m = DAY_RE.exec(day)!;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
};

/** Día (YYYY-MM-DD) de un instante en la zona horaria dada. */
export function dayInZone(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Suma días a un YYYY-MM-DD (aritmética de calendario, sin husos). */
export function addDays(day: string, n: number): string {
  return new Date(utcOf(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** ¿Es una fecha de calendario real? (rechaza 2026-02-31) */
function validDay(s: string): boolean {
  return DAY_RE.test(s) && new Date(utcOf(s)).toISOString().slice(0, 10) === s;
}

/** Instante en el que empieza ese día en la zona horaria dada. */
export function startOfDayInZone(day: string, tz: string): Date {
  const asUtc = utcOf(day);
  // Dos pasadas bastan para resolver el desfase (también en los cambios de hora).
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(guess)).map((x) => [x.type, x.value]),
    );
    const shown = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
    guess -= shown - asUtc;
  }
  return new Date(guess);
}

export type ExportRange =
  | { ok: true; from: string; to: string; gte: Date; lt: Date }
  | { ok: false; error: "invalid" | "order" | "too_long" };

/**
 * Valida el intervalo pedido (desde/hasta, YYYY-MM-DD). Sin parámetros: el último día (de ayer a hoy).
 * Condiciones: fechas reales, desde ≤ hasta y no más de `retentionDays` días de diferencia (los logs más viejos ya no existen).
 * El intervalo incluye los dos días enteros, en la zona horaria de la aplicación.
 */
export function parseExportRange(
  from: string | null | undefined,
  to: string | null | undefined,
  opts: { now?: Date; tz: string; retentionDays: number },
): ExportRange {
  const today = dayInZone(opts.now ?? new Date(), opts.tz);
  const f = from?.trim() || addDays(today, -1);
  const t = to?.trim() || today;
  if (!validDay(f) || !validDay(t)) return { ok: false, error: "invalid" };
  if (f > t) return { ok: false, error: "order" };
  if (Math.round((utcOf(t) - utcOf(f)) / DAY_MS) > opts.retentionDays) return { ok: false, error: "too_long" };
  return { ok: true, from: f, to: t, gte: startOfDayInZone(f, opts.tz), lt: startOfDayInZone(addDays(t, 1), opts.tz) };
}
