// Fechas con la misma zona horaria en el servidor y en el navegador: si no, el HTML del
// servidor y el del navegador no coinciden (error de hidratación de React #418).

export const DEFAULT_TIME_ZONE = "Europe/Madrid";

/**
 * Zona horaria de la app. En el servidor se lee APP_TIMEZONE en tiempo de ejecución; en el navegador, el
 * atributo data-tz que el layout raíz pone en <html> con ese mismo valor. Nada queda fijado al compilar:
 * cambiar APP_TIMEZONE solo exige reiniciar.
 */
export function appTimeZone(): string {
  if (typeof document !== "undefined") return document.documentElement.dataset.tz || DEFAULT_TIME_ZONE;
  return process.env.APP_TIMEZONE || DEFAULT_TIME_ZONE;
}

type Style = "date" | "dateShort" | "dateLong" | "dateTime" | "dateTimeShort" | "time" | "timeHm" | "dateNumeric";

const OPTIONS: Record<Style, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: "medium" },
  dateShort: { dateStyle: "short" },
  /** 24/10/2026: día, mes y año completo, numéricos. */
  dateNumeric: { day: "2-digit", month: "2-digit", year: "numeric" },
  dateLong: { dateStyle: "long" },
  dateTime: { dateStyle: "medium", timeStyle: "short" },
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
