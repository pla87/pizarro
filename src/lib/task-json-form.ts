// La tarea en JSON (lib/task-json.ts) y los formularios del navegador: copiar lo que hay en «Nueva tarea» como JSON,
// rellenar ese formulario con una tarea importada y la vista previa de «Importar» del tablero (a qué columna irá cada
// tarea y qué no se va a poder aplicar). Puro y sin zod: lo usa el cliente. Lo que se guarda lo vuelve a comprobar el
// servidor (lib/task-json-resolve.ts) con las mismas reglas de nombres.
import { normalizeSearch } from "./search-accents";
import { buildTaskJson, TASK_JSON_FIELD_LABEL as FIELD_LABEL, type TaskJsonField, type TaskJsonInput } from "./task-json";
import type { FieldsForm } from "./fields-form";
import type { RecurrenceRule } from "./recurrence-date";
import type { TaskFieldKey, TaskPriorityValue } from "./task-fields";
import type { T } from "@/i18n/shared";

/** Comparación de nombres sin mayúsculas, tildes ni espacios repetidos (la misma que el servidor). */
export const foldName = (s: string) => normalizeSearch(s).replace(/\s+/g, " ").trim();

const findByName = <T extends { name: string }>(list: readonly T[], name: string): T | undefined => {
  const want = foldName(name);
  return list.find((x) => foldName(x.name) === want);
};

/** Un nombre del JSON dentro de un aviso: corto y sin saltos de línea. */
const quote = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s).replace(/\s+/g, " ");

/** Lo del proyecto que hace falta para pasar de nombres a ids en el formulario. */
export interface FormProject {
  kinds: readonly { id: string; name: string }[];
  columns: readonly { id: string; name: string }[];
  users: readonly { id: string; name: string }[];
  deliverables: readonly { id: string; name: string }[];
  enabledFields: readonly TaskFieldKey[];
}

/** Lo que hay escrito en «Nueva tarea» (ids, como en el formulario). */
interface NewTaskForm {
  title: string;
  kindId: string;
  description: string;
  columnId: string;
  assigneeId: string;
  dueDate: string;
  deliverableId: string;
  recurrence: RecurrenceRule;
  recurrenceDay: number | null;
  subtasks: string[];
  fields: FieldsForm;
}

/** «Nueva tarea» como JSON de tarea (sin `info` ni lo que el formulario no tiene: etiquetas, color, enlace…). */
export function newTaskFormJson(f: NewTaskForm, p: FormProject): Record<string, unknown> {
  const name = (list: readonly { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? null;
  const user = p.users.find((u) => u.id === f.assigneeId);
  const text = (v: string) => (v.trim() === "" ? null : v.trim());
  return buildTaskJson({
    title: f.title.trim(),
    description: f.description,
    type: name(p.kinds, f.kindId),
    column: name(p.columns, f.columnId),
    assignee: user ? { id: user.id, name: user.name } : null,
    dueDate: f.dueDate || null,
    recurrence: f.recurrence,
    recurrenceDay: f.recurrenceDay,
    deliverable: name(p.deliverables, f.deliverableId),
    subtasks: f.subtasks.map((s) => ({ text: s, done: false })),
    enabledFields: p.enabledFields,
    startDate: f.fields.startDate || null,
    priority: (f.fields.priority || null) as TaskPriorityValue | null,
    client: text(f.fields.client),
    cost: text(f.fields.cost)?.replace(",", ".") ?? null,
    costPaid: f.fields.costPaid,
    estimatedHours: text(f.fields.estimatedHours)?.replace(",", ".") ?? null,
    actualHours: text(f.fields.actualHours)?.replace(",", ".") ?? null,
  });
}

/** Campos del JSON que «Nueva tarea» no tiene (se pueden poner después, en el detalle). */
const NOT_IN_NEW_TASK: readonly TaskJsonField[] = ["labels", "color", "link", "dependsOn", "googleDocs"];
/** Campos opcionales del formulario y su interruptor. */
const OPTIONAL: readonly [keyof FieldsForm & TaskJsonField, TaskFieldKey][] = [
  ["startDate", "startDate"], ["priority", "priority"], ["client", "client"], ["cost", "cost"], ["costPaid", "cost"], ["estimatedHours", "hours"], ["actualHours", "hours"],
];

/**
 * Lo que una tarea importada pone en «Nueva tarea»: solo los campos que trae (los demás no se tocan), ya con ids. Lo
 * que no encaja (nombres que no existen, campos que el formulario no tiene o el proyecto no tiene activados) va en
 * `notices`. `maxSubtasks`: las que admite el formulario al crear.
 */
export function fillNewTaskForm(task: TaskJsonInput, problems: readonly TaskJsonField[], p: FormProject, maxSubtasks: number, t: T): { form: Partial<NewTaskForm>; notices: string[] } {
  const form: Partial<NewTaskForm> = {};
  const notices: string[] = problems.map((f) => t(FIELD_LABEL[f]));
  if (task.title !== undefined) form.title = task.title;
  if (task.description !== undefined) form.description = task.description;
  if (task.type !== undefined) {
    const kind = findByName(p.kinds, task.type);
    if (kind) form.kindId = kind.id;
    else notices.push(t("tipo «{name}» (no existe)", { name: quote(task.type) }));
  }
  if (task.column !== undefined) {
    const column = findByName(p.columns, task.column);
    if (column) form.columnId = column.id;
    else notices.push(t("columna «{name}» (no existe)", { name: quote(task.column) }));
  }
  if (task.assignee !== undefined) {
    if (task.assignee === null) form.assigneeId = "";
    else {
      // Por id o por nombre (si solo hay una persona con ese nombre). El navegador no conoce los emails de los demás.
      const a = task.assignee;
      const byName = a.name ? p.users.filter((u) => foldName(u.name) === foldName(a.name!)) : [];
      const who = p.users.find((u) => u.id === a.id) ?? (byName.length === 1 ? byName[0] : undefined);
      if (who) form.assigneeId = who.id;
      else notices.push(t("responsable «{name}» (sin acceso al proyecto)", { name: quote(a.name ?? a.email ?? a.id ?? "") }));
    }
  }
  if (task.deliverable !== undefined) {
    if (task.deliverable === null) form.deliverableId = "";
    else {
      const d = findByName(p.deliverables, task.deliverable);
      if (d) form.deliverableId = d.id;
      else notices.push(t("entregable «{name}» (no existe)", { name: quote(task.deliverable) }));
    }
  }
  if (task.dueDate !== undefined) form.dueDate = task.dueDate ?? "";
  if (task.recurrence !== undefined) {
    form.recurrence = task.recurrence.rule;
    form.recurrenceDay = task.recurrence.day ?? null;
  }
  if (task.subtasks !== undefined) {
    const list = task.subtasks.map((s) => s.text);
    if (list.length > maxSubtasks) notices.push(t("subtareas (máximo {max} al crear)", { max: maxSubtasks }));
    if (task.subtasks.some((s) => s.done)) notices.push(t("subtareas hechas (se crean sin marcar)"));
    form.subtasks = list.slice(0, maxSubtasks);
  }
  const fields: Partial<FieldsForm> = {};
  for (const [key, toggle] of OPTIONAL) {
    const value = task[key];
    if (value === undefined) continue;
    if (!p.enabledFields.includes(toggle)) {
      notices.push(t("{field} (campo no activado)", { field: t(FIELD_LABEL[key]) }));
      continue;
    }
    if (key === "costPaid") fields.costPaid = value === true;
    else (fields as Record<string, string>)[key] = value === null ? "" : String(value);
  }
  if (Object.keys(fields).length) form.fields = fields as FieldsForm;
  const missing = NOT_IN_NEW_TASK.filter((k) => task[k] !== undefined && !(Array.isArray(task[k]) && (task[k] as unknown[]).length === 0) && task[k] !== null);
  if (missing.length) notices.push(t("{list} (no se pueden poner al crear: añádelos en el detalle)", { list: missing.map((k) => t(FIELD_LABEL[k])).join(", ") }));
  return { form, notices };
}

/** Vista previa de «Importar»: a qué columna va cada tarea y qué se sabe ya que no se va a poder aplicar. */
export function importPreview(task: TaskJsonInput, p: Pick<FormProject, "columns" | "kinds">, forcedColumnId: string | null, t: T): { columnId: string | null; notices: string[] } {
  const notices: string[] = [];
  let columnId = forcedColumnId;
  if (!columnId && task.column !== undefined) {
    columnId = findByName(p.columns, task.column)?.id ?? null;
    if (!columnId) notices.push(t("columna «{name}» (no existe)", { name: quote(task.column) }));
  }
  if (task.type !== undefined && !findByName(p.kinds, task.type)) notices.push(t("tipo «{name}» (no existe)", { name: quote(task.type) }));
  return { columnId: columnId ?? p.columns[0]?.id ?? null, notices };
}
