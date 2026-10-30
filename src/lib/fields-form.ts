// Formulario de los campos opcionales de una tarea: valores en texto y conversión a parche del servidor (sin React).
import { startAfterDue, TASK_PRIORITIES, type TaskFieldKey, type TaskFieldValues } from "./task-fields";

/** Valores de los campos opcionales en un formulario: todo texto ("" = sin valor). */
export interface FieldsForm {
  cost: string;
  costPaid: boolean;
  estimatedHours: string;
  actualHours: string;
  priority: string;
  client: string;
  startDate: string;
}

export const EMPTY_FIELDS_FORM: FieldsForm = { cost: "", costPaid: false, estimatedHours: "", actualHours: "", priority: "", client: "", startDate: "" };

/** De una tarea al formulario. */
export function fieldsFormOf(task: Partial<TaskFieldValues>): FieldsForm {
  return {
    cost: task.cost ?? "",
    costPaid: task.costPaid ?? false,
    estimatedHours: task.estimatedHours ?? "",
    actualHours: task.actualHours ?? "",
    priority: task.priority ?? "",
    client: task.client ?? "",
    startDate: task.startDate ?? "",
  };
}

const KEY_OF: Record<keyof FieldsForm, TaskFieldKey> = {
  cost: "cost", costPaid: "cost", estimatedHours: "hours", actualHours: "hours", priority: "priority", client: "client", startDate: "startDate",
};

/** Parche para el servidor: solo los campos activados que difieren de `base` ("" se envía como null). */
export function fieldsPatch(form: FieldsForm, base: FieldsForm, enabled: readonly TaskFieldKey[]): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  for (const k of Object.keys(form) as (keyof FieldsForm)[]) {
    if (!enabled.includes(KEY_OF[k]) || form[k] === base[k]) continue;
    out[k] = typeof form[k] === "boolean" ? form[k] : (form[k] as string).trim() === "" ? null : (form[k] as string);
  }
  return out;
}

/** Valores para el borrador local: solo los campos activados (el resto queda vacío). */
export function fieldsForDraft(form: FieldsForm, enabled: readonly TaskFieldKey[]): FieldsForm {
  const out: FieldsForm = { ...EMPTY_FIELDS_FORM };
  for (const k of Object.keys(out) as (keyof FieldsForm)[]) if (enabled.includes(KEY_OF[k])) (out as unknown as Record<string, string | boolean>)[k] = form[k];
  return out;
}

/** Del borrador local (JSON no fiable) al formulario: ignora lo que no tenga el tipo esperado. */
export function fieldsFromDraft(raw: unknown): FieldsForm {
  const out: FieldsForm = { ...EMPTY_FIELDS_FORM };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(out) as (keyof FieldsForm)[]) {
    const v = r[k];
    if (typeof EMPTY_FIELDS_FORM[k] === "boolean" ? typeof v === "boolean" : typeof v === "string" && v.length <= 2000) (out as unknown as Record<string, string | boolean>)[k] = v as string | boolean;
  }
  if (out.priority && !(TASK_PRIORITIES as readonly string[]).includes(out.priority)) out.priority = "";
  return out;
}

/** Parche al crear una tarea: los campos activados con valor. */
export const fieldsForCreate = (form: FieldsForm, enabled: readonly TaskFieldKey[]) => fieldsPatch(form, EMPTY_FIELDS_FORM, enabled);

/** Mensaje de error de los campos (null si todo bien); lo muestra el grupo y bloquea el guardado. */
export function fieldsError(form: FieldsForm, enabled: readonly TaskFieldKey[], dueDate: string | null | undefined, t: (s: string) => string): string | null {
  if (enabled.includes("startDate") && startAfterDue(form.startDate, dueDate)) return t("La fecha de inicio no puede ser posterior a la fecha límite.");
  return null;
}
