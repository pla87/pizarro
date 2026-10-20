// Fechas con la misma zona horaria en el servidor y en el navegador: si no, el HTML del
// servidor y el del navegador no coinciden (error de hidratación de React #418).

export const APP_TIME_ZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Europe/Madrid";

type Style = "date" | "dateShort" | "dateLong" | "dateTime" | "dateTimeShort" | "time";

const OPTIONS: Record<Style, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: "medium" },
  dateShort: { dateStyle: "short" },
  dateLong: { dateStyle: "long" },
  dateTime: { dateStyle: "medium", timeStyle: "short" },
  dateTimeShort: { dateStyle: "short", timeStyle: "short" },
  time: { timeStyle: "short" },
};

/** Formatea una fecha (Date o ISO) en la zona horaria de la app. */
export function formatDate(value: Date | string, style: Style = "date", locale = "es-ES"): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString(locale, { ...OPTIONS[style], timeZone: APP_TIME_ZONE });
}
