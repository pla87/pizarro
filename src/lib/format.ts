// Fechas con la misma zona horaria en el servidor y en el navegador: si no, el HTML del
// servidor y el del navegador no coinciden (error de hidratación de React #418).

export const DEFAULT_TIME_ZONE = "Europe/Madrid";

/**
 * Zona horaria de la app. En el servidor se lee APP_TIMEZONE en tiempo de ejecución; en el navegador, el
 * atributo data-tz que el layout raíz pone en <html> con ese mismo valor. Nada queda fijado al compilar:
 * cambiar APP_TIMEZONE solo exige reiniciar. Sin variable, vale la zona elegida en el asistente de primer arranque.
 * Una zona mal escrita (en la variable, en lo guardado o en data-tz) no se usa: Intl lanzaría RangeError en cada fecha.
 */
export function appTimeZone(): string {
  if (typeof document !== "undefined") return resolveTimeZone(document.documentElement.dataset.tz, undefined);
  return resolveTimeZone(process.env.APP_TIMEZONE, (globalThis as unknown as Record<string, string | undefined>)[INSTANCE_TZ_GLOBAL], warnInvalidEnvTz);
}

/** Variable global donde lib/instance.ts deja la zona horaria elegida en el asistente (AppState). */
export const INSTANCE_TZ_GLOBAL = "__pzInstanceTz";

// appTimeZone() se llama en cada fecha formateada: la validez de cada zona se comprueba una vez (son muy pocas).
const tzValidity = new Map<string, boolean>();

/** Zona horaria IANA válida para Intl. */
export function validTimeZone(tz: string): boolean {
  const known = tzValidity.get(tz);
  if (known !== undefined) return known;
  let ok: boolean;
  try {
    new Intl.DateTimeFormat("es", { timeZone: tz });
    ok = true;
  } catch {
    ok = false;
  }
  if (tzValidity.size >= 64) tzValidity.clear();
  tzValidity.set(tz, ok);
  return ok;
}

/** APP_TIMEZONE si está definida y es válida; si no, null (la zona se elige entonces en el asistente o en Ajustes). */
export function envTimeZone(env: Record<string, string | undefined> = process.env): string | null {
  const tz = env.APP_TIMEZONE?.trim();
  return tz && validTimeZone(tz) ? tz : null;
}

let warnedEnvTz = false;
function warnInvalidEnvTz(tz: string): void {
  if (warnedEnvTz) return;
  warnedEnvTz = true;
  console.warn(`[config] APP_TIMEZONE no es una zona horaria válida (${JSON.stringify(tz.slice(0, 64))}): se ignora y vale la de Administración → Ajustes → Instalación o, si no hay, ${DEFAULT_TIME_ZONE}.`);
}

/**
 * Orden de preferencia: variable APP_TIMEZONE, valor guardado por el asistente, Europe/Madrid. Cada uno solo cuenta si
 * es una zona válida; `onInvalidEnv` avisa cuando la variable está definida pero no lo es.
 */
export function resolveTimeZone(envTz: string | undefined, stored: string | undefined, onInvalidEnv?: (envTz: string) => void): string {
  const env = envTz?.trim();
  if (env && validTimeZone(env)) return env;
  if (env) onInvalidEnv?.(env);
  return stored && validTimeZone(stored) ? stored : DEFAULT_TIME_ZONE;
}

type Style = "date" | "dateShort" | "dateLong" | "dateTime" | "dateTimeSeconds" | "dateTimeShort" | "time" | "timeHm" | "dateNumeric";

const OPTIONS: Record<Style, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: "medium" },
  dateShort: { dateStyle: "short" },
  /** 24/10/2026: día, mes y año completo, numéricos. */
  dateNumeric: { day: "2-digit", month: "2-digit", year: "numeric" },
  dateLong: { dateStyle: "long" },
  dateTime: { dateStyle: "medium", timeStyle: "short" },
  /** Con segundos (13 nov 2026, 14:05:09): para distinguir copias de seguridad hechas en el mismo minuto. */
  dateTimeSeconds: { dateStyle: "medium", timeStyle: "medium" },
  dateTimeShort: { dateStyle: "short", timeStyle: "short" },
  time: { timeStyle: "short" },
  /** Hora con ceros (08:14), en 24 horas. */
  timeHm: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
};

/** Formatea una fecha (Date o ISO) en la zona horaria de la app. */
export function formatDate(value: Date | string, style: Style = "date", locale = "es-ES"): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString(locale, { ...OPTIONS[style], timeZone: appTimeZone() });
}
