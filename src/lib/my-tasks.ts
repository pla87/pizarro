// «Mis tareas» como bandeja diaria: reparto por vencimiento y filtros. Funciones puras.
import { daysBetween } from "./dates";

export type TaskBucket = "overdue" | "today" | "week" | "later" | "none";
export type TaskFilter = "all" | "overdue" | "week";

export const BUCKET_ORDER: TaskBucket[] = ["overdue", "today", "week", "later", "none"];

/** Días que abarca «esta semana» desde hoy (hoy no incluido: tiene su propio grupo). */
const WEEK_DAYS = 7;

/** Grupo de una tarea según su fecha límite (YYYY-MM-DD) respecto a hoy. */
export function bucketOf(dueDate: string | null, today: string): TaskBucket {
  if (!dueDate) return "none";
  const d = daysBetween(today, dueDate);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= WEEK_DAYS) return "week";
  return "later";
}

export function parseFilter(value: string | string[] | undefined): TaskFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "overdue" || v === "week" ? v : "all";
}

/** ¿Entra la tarea en el filtro? «Vencidas» solo las atrasadas; «Esta semana», vencidas, de hoy y de los próximos 7 días. */
export function matchesFilter(bucket: TaskBucket, filter: TaskFilter): boolean {
  if (filter === "all") return true;
  if (filter === "overdue") return bucket === "overdue";
  return bucket === "overdue" || bucket === "today" || bucket === "week";
}

/**
 * Reparte las tareas en grupos (vencidas, hoy, esta semana, más adelante, sin fecha), cada grupo
 * ordenado por fecha y, a igual fecha, por el orden recibido. Los grupos vacíos no salen.
 */
export function groupByDue<T extends { dueDate: string | null }>(tasks: T[], today: string, filter: TaskFilter = "all"): { bucket: TaskBucket; tasks: T[] }[] {
  const groups = new Map<TaskBucket, T[]>(BUCKET_ORDER.map((b) => [b, []]));
  for (const task of tasks) {
    const bucket = bucketOf(task.dueDate, today);
    if (matchesFilter(bucket, filter)) groups.get(bucket)!.push(task);
  }
  return BUCKET_ORDER.map((bucket) => ({
    bucket,
    // sort es estable: el orden recibido se conserva dentro de la misma fecha.
    tasks: groups.get(bucket)!.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
  })).filter((g) => g.tasks.length > 0);
}
