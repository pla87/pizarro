// Campos opcionales de las tareas: cada proyecto activa los que necesita (Project.taskFields).
// Sin dependencias de Node: lo usan el servidor y el cliente.

export const TASK_FIELDS = ["cost", "hours", "priority", "client", "startDate"] as const;
export type TaskFieldKey = (typeof TASK_FIELDS)[number];

export const isTaskFieldKey = (k: string): k is TaskFieldKey => (TASK_FIELDS as readonly string[]).includes(k);

/** Deja solo claves válidas, sin repetir y en el orden canónico. */
export function normalizeTaskFields(keys: readonly string[]): TaskFieldKey[] {
  return TASK_FIELDS.filter((f) => keys.includes(f));
}

export const TASK_FIELD_LABEL: Record<TaskFieldKey, string> = {
  cost: "Coste",
  hours: "Horas estimadas y reales",
  priority: "Prioridad",
  client: "Cliente",
  startDate: "Fecha de inicio",
};

export const TASK_PRIORITIES = ["BAJA", "MEDIA", "ALTA", "URGENTE"] as const;
export type TaskPriorityValue = (typeof TASK_PRIORITIES)[number];

export const PRIORITY_LABEL: Record<TaskPriorityValue, string> = { BAJA: "Baja", MEDIA: "Media", ALTA: "Alta", URGENTE: "Urgente" };
/** Colores de la insignia (texto sobre fondo suave); URGENTE y ALTA llaman más la atención. */
export const PRIORITY_COLOR: Record<TaskPriorityValue, string> = { BAJA: "#64748b", MEDIA: "#2563eb", ALTA: "#d97706", URGENTE: "#dc2626" };

export const MAX_CLIENT = 120;
export const MAX_COST = 9_999_999_999.99;
export const MAX_HOURS = 99_999.99;
/** Paso de los campos de horas (cuartos de hora). */
export const HOURS_STEP = 0.25;

/** Valores opcionales de una tarea (decimales como texto «12.50» para no perder precisión). */
export interface TaskFieldValues {
  cost: string | null;
  costPaid: boolean;
  estimatedHours: string | null;
  actualHours: string | null;
  priority: TaskPriorityValue | null;
  client: string | null;
  startDate: string | null;
}

/** ¿La fecha de inicio es posterior a la fecha límite? (solo si hay las dos). */
export function startAfterDue(start: string | null | undefined, due: string | null | undefined): boolean {
  return Boolean(start && due && start > due);
}

/** Campos de tarea que gobierna cada interruptor. */
export const FIELD_COLUMNS: Record<TaskFieldKey, (keyof TaskFieldValues)[]> = {
  cost: ["cost", "costPaid"],
  hours: ["estimatedHours", "actualHours"],
  priority: ["priority"],
  client: ["client"],
  startDate: ["startDate"],
};

/** Importe con símbolo del euro y formato del idioma: 1.234,50 €. */
export function formatEuro(value: string | number | null | undefined, locale = "es-ES"): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
}

/** Suma de importes decimales en céntimos enteros (sin errores de coma flotante). */
export function sumCents(values: readonly (string | number | null | undefined)[]): number {
  let cents = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    cents += Math.round(Number(v) * 100);
  }
  return cents;
}

export const centsToAmount = (cents: number): string => (cents / 100).toFixed(2);

/** Horas en texto corto: 1,5 / 2. */
export function formatHours(value: string | number | null | undefined, locale = "es-ES"): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n) : "";
}

/** Pagado / pendiente / total (céntimos) del coste de unas tareas; las que no tienen coste no cuentan. */
export function budgetSummary(tasks: readonly { cost: string | null; costPaid: boolean }[]): { paid: number; pending: number; total: number; count: number } {
  const priced = tasks.filter((t) => t.cost !== null);
  const total = sumCents(priced.map((t) => t.cost));
  const paid = sumCents(priced.filter((t) => t.costPaid).map((t) => t.cost));
  return { paid, pending: total - paid, total, count: priced.length };
}
