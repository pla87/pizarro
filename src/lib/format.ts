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

// Un solo formato legible por idioma para fecha y hora en la interfaz: «22 nov 2026, 21:41» / «Nov 22, 2026, 9:41 PM»
// (`dateTime`), y «22 nov 2026» / «Nov 22, 2026» para la fecha sola (`date`). Los cortos de Intl («22/11/26, 21:41»;
// «11/22/26, 9:41 PM») se quitaron: mezclaban dos formatos en la misma pantalla y en inglés el día y el mes se confunden.
type Style = "date" | "dateLong" | "dateTime" | "dateTimeSeconds" | "time" | "timeHm";

const OPTIONS: Record<Style, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: "medium" },
  dateLong: { dateStyle: "long" },
  dateTime: { dateStyle: "medium", timeStyle: "short" },
  /** Con segundos (13 nov 2026, 14:05:09; Nov 13, 2026, 2:05:09 PM): para distinguir copias hechas en el mismo minuto. */
  dateTimeSeconds: { dateStyle: "medium", timeStyle: "medium" },
  time: { timeStyle: "short" },
  /** Hora y minutos con la costumbre del idioma: «08:14» (24 horas, con ceros) o «8:14 AM» (en-US). Ver hourMinute. */
  timeHm: {},
};

// Idiomas que escriben la hora en 12 horas (en-US): se miran una vez.
const twelveHour = new Map<string, boolean>();

/**
 * Opciones de Intl para la hora y los minutos: en 24 horas y con ceros («08:14») donde es la costumbre (es-ES), y en
 * 12 horas sin cero delante («8:14 AM») donde se usa el reloj de 12 horas (en-US).
 */
function hourMinute(locale: string): Intl.DateTimeFormatOptions {
  let h12 = twelveHour.get(locale);
  if (h12 === undefined) {
    const cycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
    h12 = cycle === "h12" || cycle === "h11";
    if (twelveHour.size >= 16) twelveHour.clear();
    twelveHour.set(locale, h12);
  }
  return h12 ? { hour: "numeric", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
}

/**
 * Espacios «finos» o duros de Intl (U+202F antes de «AM»/«PM», U+00A0) como espacios normales. Según la versión de ICU
 * (Node, Chrome, Firefox, Safari) salen unos u otros: sin igualarlos, la misma fecha difiere entre el HTML del servidor y
 * el del navegador (error de hidratación #418) y las búsquedas de texto fallan.
 */
const plainSpaces = (text: string): string => text.replace(/[\u00a0\u2009\u202f]/g, " ");

/** Formatea una fecha (Date o ISO) en la zona horaria de la app. */
export function formatDate(value: Date | string, style: Style = "date", locale = "es-ES"): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const options = style === "timeHm" ? hourMinute(locale) : OPTIONS[style];
  return plainSpaces(d.toLocaleString(locale, { ...options, timeZone: appTimeZone() }));
}

/**
 * Hora de una línea de Administración → Logs, compacta y con segundos (dos eventos del mismo minuto se distinguen):
 * «22 nov 21:49:12» en español (24 horas) y «Nov 22 9:49:12 PM» en inglés americano (12 horas), en la zona de la app.
 * Devuelve una función que reutiliza los formateadores (una página de logs pinta cien filas).
 */
export function logTimeFormatter(locale = "es-ES"): (d: Date) => string {
  const timeZone = appTimeZone();
  const day = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat(locale, { timeZone, ...hourMinute(locale), second: "2-digit" });
  // «22 nov.» en algunas versiones de ICU: sin el punto, como en formatDate («22 nov 2026»).
  return (d) => plainSpaces(`${day.format(d).replace(/\.$/, "")} ${time.format(d)}`);
}

/**
 * Fecha y hora con la zona horaria al final («14 nov 2026, 14:05 (CET)»), para lo que se lee fuera de Pizarro (emails):
 * quien lo recibe puede estar en otra zona que la de la app. Intl no admite la zona junto a `dateStyle`, así que se
 * añade su nombre corto aparte.
 */
export function formatDateTimeZone(value: Date | string, locale = "es-ES", style: "dateTime" | "dateTimeSeconds" = "dateTime"): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const timeZone = appTimeZone();
  // En en-US, las zonas que no son de EE. UU. salen como «GMT+1» (en es-ES, «CET»): sin ambigüedad para quien lo lee.
  const zone = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  return `${formatDate(d, style, locale)} (${zone})`;
}

/** Hora y minutos con la zona horaria de la app al final («14:05 CET»; en en-US, «2:05 PM GMT+1»): pie de los PDF que se envían por email. */
export function formatTimeZone(value: Date | string, locale = "es-ES"): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return plainSpaces(new Intl.DateTimeFormat(locale, { ...hourMinute(locale), timeZone: appTimeZone(), timeZoneName: "short" }).format(d));
}

/**
 * Cuánto hace de `value` («hace 2 h», «hace 3 días»; en inglés, «2 hr. ago»), en el idioma de Intl dado. null si es de
 * hace menos de una hora (o posterior a `now`): el texto de ese caso lo elige quien lo muestra. Desde 30 días, la fecha
 * (en la zona de la app).
 */
export function formatAgo(value: Date | string, now: Date, locale = "es-ES"): string | null {
  const d = typeof value === "string" ? new Date(value) : value;
  const hours = Math.floor((now.getTime() - d.getTime()) / 3_600_000);
  if (!(hours >= 1)) return null;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "short" });
  if (hours < 48) return rtf.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  return days < 30 ? rtf.format(-days, "day") : formatDate(d, "date", locale);
}
