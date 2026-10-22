import type { T } from "@/i18n/core";
import type { BoardTask } from "@/lib/types";

/** Nombre del día de la semana (1 = lunes … 7 = domingo) en el idioma de la interfaz. */
export function weekdayName(day: number, locale: string): string {
  // El 1 de enero de 2024 fue lunes.
  return new Date(Date.UTC(2024, 0, day)).toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" });
}

/** Texto corto de la repetición de una tarea («Cada semana (lunes)»); null si no se repite. */
export function recurrenceLabel(task: Pick<BoardTask, "recurrence" | "recurrenceDay">, t: T, locale: string): string | null {
  if (task.recurrence === "DAILY") return t("Cada día");
  if (task.recurrence === "WEEKLY") return t("Cada semana ({day})", { day: weekdayName(task.recurrenceDay ?? 1, locale) });
  if (task.recurrence === "MONTHLY") return t("Cada mes (día {n})", { n: task.recurrenceDay ?? 1 });
  return null;
}
