// Planificación semanal: reparte las tareas de una columna WEEKLY_PLAN por día de la semana actual o por persona.
// Funciones puras (sin BD) para poder testearlas.
import type { T } from "../i18n/core";
import { addDaysIso, isoToDate, weekBoundsIso } from "./dates";

export type WeekPlanGroupBy = "day" | "person";

export interface WeekPlanTask {
  title: string;
  kind: string;
  assigneeName: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
}

export interface WeekPlanSection {
  key: string;
  label: string;
  tasks: WeekPlanTask[];
}

const byDueThenTitle = (a: WeekPlanTask, b: WeekPlanTask) =>
  (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99") || a.title.localeCompare(b.title);

/** «lunes, 26 oct» en el idioma de quien lee. */
export function weekDayLabel(iso: string, locale: string): string {
  return isoToDate(iso).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Lunes a domingo de la semana de `today` (solo los días con tareas), después «Otras fechas» (fuera de esta
 * semana) y «Sin fecha»; o, por persona, una sección por responsable (y «Sin responsable» al final).
 */
export function buildWeekPlan(tasks: WeekPlanTask[], today: string, groupBy: WeekPlanGroupBy, t: T, locale: string): WeekPlanSection[] {
  const sections: WeekPlanSection[] = [];
  if (groupBy === "person") {
    const names = [...new Set(tasks.map((x) => x.assigneeName).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b, locale));
    for (const name of names) sections.push({ key: `p:${name}`, label: name, tasks: tasks.filter((x) => x.assigneeName === name).sort(byDueThenTitle) });
    const free = tasks.filter((x) => !x.assigneeName).sort(byDueThenTitle);
    if (free.length) sections.push({ key: "p:none", label: t("Sin responsable"), tasks: free });
    return sections;
  }
  const { start, end } = weekBoundsIso(today);
  for (let i = 0; i < 7; i++) {
    const day = addDaysIso(start, i);
    const list = tasks.filter((x) => x.dueDate === day).sort(byDueThenTitle);
    if (list.length) sections.push({ key: day, label: weekDayLabel(day, locale), tasks: list });
  }
  const other = tasks.filter((x) => x.dueDate && (x.dueDate < start || x.dueDate > end)).sort(byDueThenTitle);
  if (other.length) sections.push({ key: "other", label: t("Otras fechas"), tasks: other });
  const none = tasks.filter((x) => !x.dueDate).sort(byDueThenTitle);
  if (none.length) sections.push({ key: "none", label: t("Sin fecha"), tasks: none });
  return sections;
}
