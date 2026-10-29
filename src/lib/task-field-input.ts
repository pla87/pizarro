import "server-only";
import { z } from "zod";
import { db } from "./db";
import { AppError } from "./errors";
import { isoToDate } from "./dates";
import { FIELD_COLUMNS, normalizeTaskFields, startAfterDue, TASK_FIELDS, type TaskFieldKey, type TaskFieldValues } from "./task-fields";
import * as v from "./validation";

// Validación y aplicación de los campos opcionales de las tareas (coste, horas, prioridad, cliente,
// fecha de inicio, enlace externo). Solo se pueden escribir los que el proyecto tiene activados.

/** Forma común de los campos opcionales en createTask / updateTask. */
export const taskFieldShape = {
  cost: v.taskCost.optional(),
  costPaid: z.boolean().optional(),
  estimatedHours: v.taskHours.optional(),
  actualHours: v.taskHours.optional(),
  priority: v.taskPriority.optional(),
  client: v.taskClient.optional(),
  startDate: v.dayIso.optional(),
  externalUrl: v.externalUrl.optional(),
};
export const taskFieldSchema = z.object(taskFieldShape);
export type TaskFieldPatch = z.infer<typeof taskFieldSchema>;

/** Nombre (en español, clave de traducción) de cada interruptor para los errores. */
const FIELD_NAME: Record<TaskFieldKey, string> = {
  cost: "coste", hours: "horas", priority: "prioridad", client: "cliente", startDate: "fecha de inicio", externalUrl: "enlace de referencia",
};

/** Interruptor al que pertenece cada campo de tarea. */
export function fieldKeyOf(column: keyof TaskFieldValues): TaskFieldKey {
  return TASK_FIELDS.find((f) => FIELD_COLUMNS[f].includes(column))!;
}

export async function enabledTaskFields(projectId: string): Promise<TaskFieldKey[]> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { taskFields: true } });
  return normalizeTaskFields(p?.taskFields ?? []);
}

/** Los campos con valor en `patch` deben estar activados en el proyecto. */
export function assertFieldsEnabled(enabled: readonly TaskFieldKey[], patch: Partial<Record<keyof TaskFieldValues, unknown>>): void {
  for (const col of Object.keys(patch) as (keyof TaskFieldValues)[]) {
    if (patch[col] === undefined) continue;
    const key = fieldKeyOf(col);
    if (!enabled.includes(key)) throw new AppError(`El campo «${FIELD_NAME[key]}» no está activado en este proyecto.`);
  }
}

/** La fecha de inicio no puede ser posterior a la fecha límite (solo si el campo está activado). */
export function assertStartBeforeDue(enabled: readonly TaskFieldKey[], start: string | null | undefined, due: string | null | undefined): void {
  if (enabled.includes("startDate") && startAfterDue(start, due)) throw new AppError("La fecha de inicio no puede ser posterior a la fecha límite.");
}

/** Datos listos para Prisma (la fecha de inicio pasa a Date; el resto, tal cual). */
export function fieldData(patch: TaskFieldPatch) {
  const { startDate, ...rest } = patch;
  return { ...rest, ...(startDate !== undefined ? { startDate: startDate ? isoToDate(startDate) : null } : {}) };
}

/** Campos de `patch` que no están sin definir (los que de verdad se escriben). */
export const patchedFieldKeys = (patch: TaskFieldPatch): (keyof TaskFieldValues)[] => (Object.keys(patch) as (keyof TaskFieldValues)[]).filter((k) => patch[k] !== undefined);

const FIELD_KEYS = Object.keys(taskFieldShape) as (keyof TaskFieldValues)[];

/** Solo los campos opcionales de un objeto más grande (p. ej. el resultado de parsear createSchema). */
export function pickTaskFields(d: TaskFieldPatch): TaskFieldPatch {
  const out: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) if (d[k] !== undefined) out[k] = d[k];
  return out as TaskFieldPatch;
}

type StoredFields = { [K in keyof TaskFieldValues]?: unknown };

/** Valor guardado en forma comparable (decimales con dos cifras, fechas YYYY-MM-DD). */
function comparable(x: unknown): unknown {
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (x !== null && typeof x === "object" && "toFixed" in x) return (x as { toFixed(n: number): string }).toFixed(2);
  return x ?? null;
}

/** De lo que se quiere escribir, solo lo que de verdad difiere de lo guardado en la tarea. */
export function onlyChangedFields(stored: StoredFields, patch: TaskFieldPatch): TaskFieldPatch {
  const out: Record<string, unknown> = {};
  for (const k of patchedFieldKeys(patch)) if (comparable(stored[k]) !== (patch[k] ?? null)) out[k] = patch[k];
  return out as TaskFieldPatch;
}
