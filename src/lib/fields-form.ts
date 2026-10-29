// Formulario de los campos opcionales de una tarea: valores en texto y conversión a parche del servidor (sin React).
import { startAfterDue, type TaskFieldKey, type TaskFieldValues } from "./task-fields";

/** Valores de los campos opcionales en un formulario: todo texto ("" = sin valor). */
export interface FieldsForm {
  cost: string;
  costPaid: boolean;
  estimatedHours: string;
  actualHours: string;
  priority: string;
  client: string;
  startDate: string;
  externalUrl: string;
}

export const EMPTY_FIELDS_FORM: FieldsForm = { cost: "", costPaid: false, estimatedHours: "", actualHours: "", priority: "", client: "", startDate: "", externalUrl: "" };

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
    externalUrl: task.externalUrl ?? "",
  };
}

const KEY_OF: Record<keyof FieldsForm, TaskFieldKey> = {
  cost: "cost", costPaid: "cost", estimatedHours: "hours", actualHours: "hours", priority: "priority", client: "client", startDate: "startDate", externalUrl: "externalUrl",
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

/** Parche al crear una tarea: los campos activados con valor. */
export const fieldsForCreate = (form: FieldsForm, enabled: readonly TaskFieldKey[]) => fieldsPatch(form, EMPTY_FIELDS_FORM, enabled);

/** Mensaje de error de los campos (null si todo bien); lo muestra el grupo y bloquea el guardado. */
export function fieldsError(form: FieldsForm, enabled: readonly TaskFieldKey[], dueDate: string | null | undefined, t: (s: string) => string): string | null {
  if (enabled.includes("startDate") && startAfterDue(form.startDate, dueDate)) return t("La fecha de inicio no puede ser posterior a la fecha límite.");
  if (enabled.includes("externalUrl") && form.externalUrl.trim() !== "" && !/^https?:\/\/[^\s]+$/i.test(form.externalUrl.trim())) return t("El enlace debe empezar por http:// o https://");
  return null;
}
