// La tarea en JSON (lib/task-json.ts) y los formularios del navegador: copiar lo que hay en «Nueva tarea» como JSON,
// rellenar ese formulario con una tarea importada y la vista previa de «Importar» del tablero (a qué columna irá cada
// tarea y qué no se va a poder aplicar). Puro y sin zod: lo usa el cliente. Lo que se guarda lo vuelve a comprobar el
// servidor (lib/task-json-resolve.ts) con las mismas reglas de nombres.
import { MAX_TASK_LABELS, PALETTE } from "./constants";
import { ellipsize } from "./graphemes";
import { isHttpUrl, normalizeLinkUrl } from "./link-url";
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
/**
 * Tipo por nombre: el que se ve (en inglés, los generales de serie van traducidos) o, si no, el guardado (`codeName`), como
 * hace el servidor. Así una tarea copiada en español («Respuesta») se importa con la interfaz en inglés («Reply»).
 */
const findKind = <T extends { name: string; codeName?: string }>(list: readonly T[], name: string): T | undefined => {
  const want = foldName(name);
  return findByName(list, name) ?? list.find((x) => x.codeName !== undefined && foldName(x.codeName) === want);
};

/** Un nombre del JSON dentro de un aviso: corto y sin saltos de línea. */
const quote = (s: string) => ellipsize(s.replace(/\s+/g, " "), 40);

/** Lo del proyecto que hace falta para pasar de nombres a ids en el formulario. */
export interface FormProject {
  kinds: readonly { id: string; name: string; codeName?: string }[];
  columns: readonly { id: string; name: string }[];
  users: readonly { id: string; name: string }[];
  deliverables: readonly { id: string; name: string }[];
  /** Etiquetas que ya existen en el proyecto («Nueva tarea» no crea etiquetas). */
  labels: readonly { id: string; name: string }[];
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
  /** Etiquetas elegidas (ids de etiquetas del proyecto), color de la tarjeta (de la paleta) y enlace externo (tal como se escribe). */
  labelIds: string[];
  color: string | null;
  linkUrl: string;
}

/** «Nueva tarea» como JSON de tarea (sin `info` ni lo que el formulario no tiene: dependencia y documentos de Google). */
export function newTaskFormJson(f: NewTaskForm, p: FormProject): Record<string, unknown> {
  const name = (list: readonly { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? null;
  const user = p.users.find((u) => u.id === f.assigneeId);
  const text = (v: string) => (v.trim() === "" ? null : v.trim());
  return buildTaskJson({
    title: f.title.trim(),
    description: f.description,
    type: name(p.kinds, f.kindId),
    column: name(p.columns, f.columnId),
    labels: p.labels.filter((l) => f.labelIds.includes(l.id)).map((l) => l.name),
    assignee: user ? { id: user.id, name: user.name } : null,
    dueDate: f.dueDate || null,
    recurrence: f.recurrence,
    recurrenceDay: f.recurrenceDay,
    color: f.color,
    deliverable: name(p.deliverables, f.deliverableId),
    link: text(normalizeLinkUrl(f.linkUrl)),
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
const NOT_IN_NEW_TASK: readonly TaskJsonField[] = ["dependsOn", "googleDocs"];
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
    const kind = findKind(p.kinds, task.type);
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
  if (task.labels !== undefined) {
    // Solo las que ya existen en el proyecto (sin repetir), como mucho MAX_TASK_LABELS; de las demás se avisa.
    const ids: string[] = [];
    const missing: string[] = [];
    for (const name of task.labels) {
      const label = findByName(p.labels, name);
      if (!label) missing.push(name);
      else if (!ids.includes(label.id)) ids.push(label.id);
    }
    // De como mucho 3 por su nombre y del resto en un solo aviso (como al importar desde el tablero).
    const named = missing.length > 4 ? 3 : missing.length;
    for (const name of missing.slice(0, named)) notices.push(t("etiqueta «{name}» (no existe en el proyecto)", { name: quote(name) }));
    if (missing.length > named) notices.push(t("{n} etiquetas más (no existen en el proyecto)", { n: missing.length - named }));
    if (ids.length > MAX_TASK_LABELS) notices.push(t("etiquetas (máximo {max} por tarea)", { max: MAX_TASK_LABELS }));
    form.labelIds = ids.slice(0, MAX_TASK_LABELS);
  }
  if (task.color !== undefined) {
    // Como el servidor (v.color): solo un color de la paleta.
    if (task.color === null) form.color = null;
    else if ((PALETTE as readonly string[]).includes(task.color)) form.color = task.color;
    else notices.push(t("color"));
  }
  if (task.link !== undefined) {
    // Como el servidor (v.linkUrl): http(s), o un dominio sin esquema, que se completa con https://.
    const link = task.link === null ? "" : normalizeLinkUrl(task.link);
    if (link === "" || (link.length <= 2000 && isHttpUrl(link))) form.linkUrl = link;
    else notices.push(t("enlace"));
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
  if (task.type !== undefined && !findKind(p.kinds, task.type)) notices.push(t("tipo «{name}» (no existe)", { name: quote(task.type) }));
  return { columnId: columnId ?? p.columns[0]?.id ?? null, notices };
}
