// «Mis tareas» como bandeja diaria: reparto por vencimiento. Funciones puras.
import { daysBetween } from "./dates";

export type TaskBucket = "overdue" | "today" | "week" | "later" | "none";

const BUCKET_ORDER: TaskBucket[] = ["overdue", "today", "week", "later", "none"];

/** Días que abarca el grupo «Próximos 7 días» desde hoy (hoy no incluido: tiene su propio grupo). */
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

/** Ancla del grupo en la página (la línea de resumen enlaza a cada grupo). */
export function bucketAnchor(bucket: TaskBucket): string {
  return `tareas-${bucket}`;
}

/**
 * Reparte las tareas en grupos (vencidas, hoy, próximos 7 días, más adelante, sin fecha), cada grupo
 * ordenado por fecha y, a igual fecha, por el orden recibido. Los grupos vacíos no salen.
 */
export function groupByDue<T extends { dueDate: string | null }>(tasks: T[], today: string): { bucket: TaskBucket; tasks: T[] }[] {
  const groups = new Map<TaskBucket, T[]>(BUCKET_ORDER.map((b) => [b, []]));
  for (const task of tasks) {
    groups.get(bucketOf(task.dueDate, today))!.push(task);
  }
  return BUCKET_ORDER.map((bucket) => ({
    bucket,
    // sort es estable: el orden recibido se conserva dentro de la misma fecha.
    tasks: groups.get(bucket)!.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
  })).filter((g) => g.tasks.length > 0);
}
