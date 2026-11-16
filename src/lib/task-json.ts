// Tareas como JSON, para copiarlas y pegarlas, exportarlas e importarlas, o para dárselas a una IA y traer lo que devuelva.
// Sin dependencias de Node ni de zod: lo usan el navegador (¿lo copiado es una tarea?, vista previa de la importación) y el
// servidor (que es quien vuelve a leer el texto, valida y aplica: pasteTaskJson en actions/tasks.ts, importTasks y
// exportTasksJson en actions/task-json.ts, resolución de nombres en lib/task-json-resolve.ts).
//
// Formato «pizarro.task», versión 1 (una tarea). Todas las claves salvo `format` son opcionales al pegar: la que no viene
// no se toca. Al importar (crear tareas nuevas) hace falta al menos el título.
//
//   {
//     "format": "pizarro.task",          marcador del formato
//     "version": 1,
//     "title": "Preparar la demo",       hasta 210 caracteres visibles (si es más largo se recorta)
//     "description": "Texto **Markdown**",
//     "type": "Funcionalidad",           nombre de un tipo del proyecto
//     "column": "En progreso",           nombre de una columna del proyecto
//     "labels": ["cliente", "urgente"],  nombres; las que no existan se crean (máx. 20 por tarea)
//     "assignee": { "id": "…", "name": "Ana" },   o null. Al copiar va el id del usuario y su nombre, NUNCA el email.
//                                        Al pegar se busca por id (activo y con acceso al proyecto) y, si no, por nombre
//                                        (si solo hay una persona con ese nombre). Un email (JSON escrito a mano o por una
//                                        IA: «"assignee": "ana@example.com"») solo vale si quien pega es administrador o
//                                        es su propio email: así nadie averigua de quién es un email probando.
//     "dueDate": "2026-12-01",           AAAA-MM-DD (o fecha ISO completa), o null
//     "recurrence": { "rule": "weekly", "day": 2 },   none | daily | weekly (day 1-7, lunes = 1) | monthly (day 1-31)
//     "color": "#ef4444",                color de la tarjeta (de la paleta) o null
//     "deliverable": "Entrega 1",        nombre de un entregable del proyecto o null
//     "link": "https://example.com/x",   enlace de la tarea o null
//     "subtasks": [{ "text": "Guion", "done": true }],   sustituyen a las que haya (máx. 100)
//     "dependsOn": { "id": "…", "title": "Contratar la sala" },   la tarea del mismo proyecto que bloquea a esta, o null
//                                        (también vale solo el título como texto). Si `info` dice que la tarea viene de
//                                        otro proyecto, la dependencia se ignora sin avisar; sin `info` se busca por título.
//     "googleDocs": [{ "kind": "doc", "title": "Acta", "url": "https://docs.google.com/…" }],   se añaden los que falten
//     -- solo si el proyecto tiene activado el campo:
//     "startDate": "2026-11-20", "priority": "high" (low | medium | high | urgent), "client": "Acme",
//     "cost": 120.5, "costPaid": false, "estimatedHours": 8, "actualHours": 2.5,
//     -- solo de referencia (no se escriben):
//     "attachments": [{ "name": "captura.png", "url": "https://…/api/attachments/ID" }],
//     "info": { "id": "…", "project": "…", "projectId": "…", "url": "https://…/p/ID?task=ID", "createdAt": "…", "updatedAt": "…", "createdBy": "…" }
//                                        `id` y `projectId` (o el proyecto de `url`) sirven para saber si la dependencia es
//                                        del mismo proyecto y, al importar varias, para enlazarlas entre sí. `createdBy` es
//                                        solo informativo: la tarea importada la crea siempre quien importa.
//   }
//
// Formato «pizarro.tasks», versión 1 (varias tareas, lo que descarga «Exportar» del tablero):
//
//   { "format": "pizarro.tasks", "version": 1, "project": "Web", "projectId": "…", "exportedAt": "2026-11-16T10:00:00.000Z",
//     "tasks": [ { objeto pizarro.task }, … ] }          como mucho TASKS_JSON_MAX tareas
//
// Al leer se es tolerante con lo que escriba una persona o una IA: claves en mayúsculas, con guiones o en español
// («título», «fecha_limite», «Etiquetas»), fechas ISO completas o DD/MM/AAAA, prioridad en español o en inglés, subtareas
// como textos sueltos («[x] Hecha»), etiquetas separadas por comas, el JSON dentro de un bloque ```json … ``` y sin el
// marcador `format` si al menos trae un título. Para importar (parseTasksText) vale además una lista de tareas, varios
// objetos seguidos (uno por línea, separados por líneas en blanco o por texto) y varios bloques ```json.
//
// Ctrl+V sobre una tarea abierta (o en el tablero) es más estricto (strictJsonFormat): solo si el portapapeles es
// exactamente un objeto JSON con su marcador `format`, sin nada alrededor.

import { GOOGLE_FILE_KINDS, type GoogleFileKind } from "./google-files";
import { RECURRENCES, type RecurrenceRule } from "./recurrence-date";
import { TASK_PRIORITIES, type TaskFieldKey, type TaskPriorityValue } from "./task-fields";

const TASK_JSON_FORMAT = "pizarro.task";
const TASKS_JSON_FORMAT = "pizarro.tasks";
const TASK_JSON_VERSION = 1;
/** Tamaño máximo del texto que se intenta leer como UNA tarea (una descripción llena y 100 subtareas caben de sobra). */
export const TASK_JSON_MAX_CHARS = 200_000;
/** Tamaño máximo del texto que se lee al importar varias tareas (también lo comprueba el servidor). */
export const TASKS_TEXT_MAX_CHARS = 5_000_000;
/** Tareas que se exportan o importan de una vez (el mismo tope que las tareas de una release). */
export const TASKS_JSON_MAX = 500;
/**
 * Largo máximo de un valor corto escrito como texto (responsable, importe, horas): con más no se intenta entender. Las
 * expresiones regulares que los leen tardan un tiempo cuadrático con textos patológicos (200 000 espacios seguidos), y el
 * servidor interpreta lo que le manda cualquier persona con sesión.
 */
const SHORT_TEXT_MAX = 500;
/** Etiquetas distintas que se leen como mucho (por tarea caben 20; el resto se ignora sin recorrerlo). */
export const TASK_JSON_MAX_LABELS = 500;

const PRIORITY_OUT: Record<TaskPriorityValue, string> = { BAJA: "low", MEDIA: "medium", ALTA: "high", URGENTE: "urgent" };
const GOOGLE_KIND_OUT: Record<GoogleFileKind, string> = { GOOGLE_DOC: "doc", GOOGLE_SHEET: "sheet", GOOGLE_SLIDES: "slides" };

/** Lo que se sabe de una tarea al copiarla (ya con nombres en vez de ids). Lo que es `undefined` no se escribe. */
export interface TaskJsonSource {
  /** Referencia de origen (`info`): solo de una tarea guardada; sin ella (formulario de «Nueva tarea»), no se escribe. */
  info?: { id: string; project: string; projectId: string; url: string; createdAt: string; updatedAt: string; createdBy: string | null };
  title: string;
  description: string;
  type: string | null;
  column: string | null;
  labels?: string[];
  /** Id y nombre del responsable: nunca el email (ver la cabecera). */
  assignee: { id: string; name: string } | null;
  dueDate: string | null;
  recurrence: RecurrenceRule;
  recurrenceDay: number | null;
  color?: string | null;
  deliverable: string | null;
  link?: string | null;
  subtasks: { text: string; done: boolean }[];
  dependsOn?: { id: string; title: string } | null;
  googleDocs?: { kind: GoogleFileKind; title: string; url: string }[];
  attachments?: { name: string; url: string }[];
  /** Campos opcionales activos en el proyecto y sus valores (decimales como texto «12.50»). */
  enabledFields: readonly TaskFieldKey[];
  startDate: string | null;
  priority: TaskPriorityValue | null;
  client: string | null;
  cost: string | null;
  costPaid: boolean;
  estimatedHours: string | null;
  actualHours: string | null;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));
/** Solo las claves con valor (las `undefined` no se escriben). */
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** El objeto que se copia: claves siempre en el mismo orden; los campos opcionales, solo los activos en el proyecto. */
export function buildTaskJson(s: TaskJsonSource): Record<string, unknown> {
  const on = (k: TaskFieldKey) => s.enabledFields.includes(k);
  return defined({
    format: TASK_JSON_FORMAT,
    version: TASK_JSON_VERSION,
    title: s.title,
    description: s.description,
    type: s.type,
    column: s.column,
    labels: s.labels,
    assignee: s.assignee ? { id: s.assignee.id, name: s.assignee.name } : null,
    dueDate: s.dueDate,
    ...(on("startDate") ? { startDate: s.startDate } : {}),
    ...(on("priority") ? { priority: s.priority ? PRIORITY_OUT[s.priority] : null } : {}),
    ...(on("client") ? { client: s.client } : {}),
    ...(on("cost") ? { cost: num(s.cost), costPaid: s.costPaid } : {}),
    ...(on("hours") ? { estimatedHours: num(s.estimatedHours), actualHours: num(s.actualHours) } : {}),
    recurrence: s.recurrence === "NONE" ? { rule: "none" } : { rule: s.recurrence.toLowerCase(), ...(s.recurrenceDay !== null ? { day: s.recurrenceDay } : {}) },
    color: s.color,
    deliverable: s.deliverable,
    link: s.link,
    subtasks: s.subtasks.map((x) => ({ text: x.text, done: x.done })),
    dependsOn: s.dependsOn === undefined ? undefined : s.dependsOn && { id: s.dependsOn.id, title: s.dependsOn.title },
    googleDocs: s.googleDocs?.map((d) => ({ kind: GOOGLE_KIND_OUT[d.kind], title: d.title, url: d.url })),
    attachments: s.attachments?.map((a) => ({ name: a.name, url: a.url })),
    info: s.info && {
      id: s.info.id, project: s.info.project, projectId: s.info.projectId, url: s.info.url, createdAt: s.info.createdAt, updatedAt: s.info.updatedAt, createdBy: s.info.createdBy,
    },
  });
}

/** Varias tareas (lo que descarga «Exportar»): el envoltorio «pizarro.tasks» con los objetos de buildTaskJson. */
export function buildTasksJson(project: { id: string; name: string }, tasks: Record<string, unknown>[], exportedAt: string): Record<string, unknown> {
  return { format: TASKS_JSON_FORMAT, version: TASK_JSON_VERSION, project: project.name, projectId: project.id, exportedAt, tasks };
}

/** Nombre del fichero que descarga «Exportar»: «tareas-mi-proyecto-2026-11-16.json» (solo letras, números y guiones). */
export function tasksExportFileName(prefix: string, project: string, day: string): string {
  const slug = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const name = slug(project.slice(0, 200)).slice(0, 60).replace(/-+$/, "") || "proyecto";
  return `${slug(prefix) || "tareas"}-${name}-${day}.json`;
}

/** El texto que va al portapapeles (sangrado de dos espacios, legible). */
export function stringifyTaskJson(json: Record<string, unknown>): string {
  return JSON.stringify(json, null, 2);
}

/** Campos que se pueden escribir al pegar (los nombres canónicos del formato). */
const TASK_JSON_FIELDS = [
  "title", "description", "type", "column", "labels", "assignee", "dueDate", "startDate", "priority", "client", "cost", "costPaid",
  "estimatedHours", "actualHours", "recurrence", "color", "deliverable", "link", "subtasks", "dependsOn", "googleDocs",
] as const;
export type TaskJsonField = (typeof TASK_JSON_FIELDS)[number];

/** Nombre (en español, clave de traducción) de cada campo, para los avisos de lo que no se pudo aplicar. */
export const TASK_JSON_FIELD_LABEL: Record<TaskJsonField, string> = {
  title: "título", description: "descripción", type: "tipo", column: "columna", labels: "etiquetas", assignee: "responsable", dueDate: "fecha límite",
  startDate: "fecha de inicio", priority: "prioridad", client: "cliente", cost: "coste", costPaid: "pago", estimatedHours: "horas estimadas",
  actualHours: "horas reales", recurrence: "repetición", color: "color", deliverable: "entregable", link: "enlace", subtasks: "subtareas",
  dependsOn: "dependencia", googleDocs: "documentos de Google",
};

/** Lo que trae un JSON de tarea, ya normalizado. Un campo ausente no se toca; `null` lo vacía. */
export interface TaskJsonInput {
  title?: string;
  description?: string;
  type?: string;
  column?: string;
  labels?: string[];
  assignee?: { id?: string; name?: string; email?: string } | null;
  dueDate?: string | null;
  startDate?: string | null;
  priority?: TaskPriorityValue | null;
  client?: string | null;
  cost?: string | null;
  costPaid?: boolean;
  estimatedHours?: string | null;
  actualHours?: string | null;
  recurrence?: { rule: RecurrenceRule; day?: number | null };
  color?: string | null;
  deliverable?: string | null;
  link?: string | null;
  subtasks?: { text: string; done: boolean }[];
  dependsOn?: { id?: string; title?: string } | null;
  googleDocs?: { kind: GoogleFileKind; title: string; url: string }[];
  /** De dónde viene (`info` del JSON, o el proyecto del envoltorio «pizarro.tasks»): solo como referencia, no se escribe. */
  info?: { id?: string; projectId?: string };
}

export type TaskJsonParse =
  /** No es un JSON de tarea (texto normal, otro JSON): el pegado sigue su curso. */
  | { kind: "none" }
  /** Quiere ser una tarea (lleva el marcador o es JSON con título) pero no se puede leer. */
  | { kind: "invalid" }
  /** `problems`: campos presentes cuyo valor no se entiende (no se aplican y se avisa). */
  | { kind: "task"; task: TaskJsonInput; problems: TaskJsonField[] };

/** Clave comparable: minúsculas, sin tildes y sin separadores («Fecha_Límite» → «fechalimite»). */
function foldKey(k: string): string {
  return k.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const KEY_ALIASES: Record<TaskJsonField, string[]> = {
  title: ["title", "titulo", "name", "nombre", "summary"],
  description: ["description", "descripcion", "body", "details", "detalle", "detalles", "content", "contenido"],
  type: ["type", "tipo", "kind", "tasktype", "tipodetarea"],
  column: ["column", "columna", "status", "estado", "list", "lista"],
  labels: ["labels", "etiquetas", "tags", "label", "etiqueta"],
  assignee: ["assignee", "responsable", "asignada", "asignadaa", "asignado", "assignedto", "assigned", "owner"],
  dueDate: ["duedate", "due", "deadline", "fechalimite", "vence", "vencimiento", "limite"],
  startDate: ["startdate", "start", "fechadeinicio", "fechainicio", "inicio"],
  priority: ["priority", "prioridad"],
  client: ["client", "cliente", "customer"],
  cost: ["cost", "coste", "costo", "price", "precio", "importe"],
  costPaid: ["costpaid", "paid", "pagado", "pagada"],
  estimatedHours: ["estimatedhours", "horasestimadas", "estimate", "estimacion", "estimated"],
  actualHours: ["actualhours", "horasreales", "actual", "spent", "hoursspent"],
  recurrence: ["recurrence", "repeticion", "repeat", "repeats", "recurring", "repite"],
  color: ["color", "colour"],
  deliverable: ["deliverable", "entregable", "milestone", "hito"],
  link: ["link", "enlace", "linkurl"],
  subtasks: ["subtasks", "subtareas", "checklist", "todos", "steps", "pasos"],
  dependsOn: ["dependson", "dependede", "blockedby", "bloqueadapor", "depende", "dependency", "dependencia"],
  googleDocs: ["googledocs", "documentosdegoogle", "documentos", "docs", "googlefiles"],
};
const FIELD_OF_KEY = new Map<string, TaskJsonField>();
for (const f of TASK_JSON_FIELDS) for (const a of KEY_ALIASES[f]) FIELD_OF_KEY.set(a, f);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined);

/** Primer valor de un objeto cuya clave (plegada) es una de `names`. */
function pick(o: Record<string, unknown>, names: string[]): unknown {
  for (const [k, v] of Object.entries(o)) if (names.includes(foldKey(k))) return v;
  return undefined;
}

/** «2026-12-01», «2026-12-01T10:00:00Z» o «01/12/2026» → «2026-12-01»; `undefined` si no se entiende. */
export function parseDayLoose(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s === "") return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(s);
  let y: string, mo: string, d: string;
  if (m) [, y, mo, d] = m as unknown as [string, string, string, string];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [, d, mo, y] = m as unknown as [string, string, string, string];
  else return undefined;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : undefined;
}

const TRUE = ["true", "si", "yes", "y", "x", "1", "done", "hecha", "hecho", "completed", "completada"];
const FALSE = ["false", "no", "n", "0", "", "pending", "pendiente", "todo"];
function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v !== "string") return undefined;
  const k = foldKey(v);
  return TRUE.includes(k) ? true : FALSE.includes(k) ? false : undefined;
}

/** Decimal como texto («12,5» → «12.5»); la validación de rango y decimales la hace el servidor. */
function decimal(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? String(Math.round(v * 100) / 100) : undefined;
  if (typeof v !== "string" || v.length > SHORT_TEXT_MAX) return undefined;
  const s = v.trim().replace(/\s*(€|eur|h|horas?|hours?)$/i, "").replace(",", ".");
  if (s === "") return null;
  return /^\d+(\.\d+)?$/.test(s) ? s : undefined;
}

const PRIORITY_IN: Record<string, TaskPriorityValue> = {
  baja: "BAJA", low: "BAJA", media: "MEDIA", medium: "MEDIA", normal: "MEDIA", alta: "ALTA", high: "ALTA", urgente: "URGENTE", urgent: "URGENTE", critical: "URGENTE", critica: "URGENTE",
};
function priority(v: unknown): TaskPriorityValue | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const k = foldKey(v);
  if (k === "" || k === "none" || k === "ninguna" || k === "sinprioridad") return null;
  return PRIORITY_IN[k] ?? (TASK_PRIORITIES as readonly string[]).find((p) => p.toLowerCase() === k) as TaskPriorityValue | undefined;
}

const RULE_IN: Record<string, RecurrenceRule> = {
  none: "NONE", no: "NONE", never: "NONE", nunca: "NONE", ninguna: "NONE", norepeat: "NONE", norepite: "NONE", false: "NONE",
  daily: "DAILY", day: "DAILY", dia: "DAILY", diaria: "DAILY", diario: "DAILY", cadadia: "DAILY", everyday: "DAILY",
  weekly: "WEEKLY", week: "WEEKLY", semana: "WEEKLY", semanal: "WEEKLY", cadasemana: "WEEKLY", everyweek: "WEEKLY",
  monthly: "MONTHLY", month: "MONTHLY", mes: "MONTHLY", mensual: "MONTHLY", cadames: "MONTHLY", everymonth: "MONTHLY",
};
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
function recurrence(v: unknown): TaskJsonInput["recurrence"] | undefined {
  if (v === null || v === false) return { rule: "NONE" };
  const ruleOf = (x: unknown): RecurrenceRule | undefined => (typeof x === "string" ? RULE_IN[foldKey(x)] ?? (RECURRENCES as readonly string[]).find((r) => r.toLowerCase() === foldKey(x)) as RecurrenceRule | undefined : undefined);
  if (typeof v === "string") {
    const rule = ruleOf(v);
    return rule ? { rule } : undefined;
  }
  if (!isObject(v)) return undefined;
  const rule = ruleOf(pick(v, ["rule", "regla", "every", "cada", "frequency", "frecuencia", "freq", "type", "tipo"]));
  if (!rule) return undefined;
  const rawDay = pick(v, ["day", "dia", "weekday", "diadelasemana", "dayofmonth", "diadelmes", "on"]);
  let day: number | null | undefined;
  if (typeof rawDay === "number" && Number.isInteger(rawDay)) day = rawDay;
  else if (typeof rawDay === "string" && /^\d{1,2}$/.test(rawDay.trim())) day = Number(rawDay.trim());
  else if (typeof rawDay === "string") {
    const k = foldKey(rawDay);
    const i = WEEKDAYS.indexOf(k) >= 0 ? WEEKDAYS.indexOf(k) : DIAS.indexOf(k);
    if (i >= 0) day = i + 1;
  } else if (rawDay === null) day = null;
  const max = rule === "WEEKLY" ? 7 : 31;
  if (typeof day === "number" && (day < 1 || day > max)) day = undefined;
  return rule === "NONE" || rule === "DAILY" ? { rule } : { rule, ...(day !== undefined ? { day } : {}) };
}

function labels(v: unknown): string[] | undefined {
  if (v === null) return [];
  const list = typeof v === "string" ? v.split(/[,;\n]/) : Array.isArray(v) ? v : undefined;
  if (!list) return undefined;
  const out: string[] = [];
  // Sin repetidas (sin mirar mayúsculas), con un conjunto: comparar cada una con todas las anteriores es cuadrático.
  const seen = new Set<string>();
  for (const item of list) {
    if (out.length >= TASK_JSON_MAX_LABELS) break;
    const name = (isObject(item) ? text(pick(item, ["name", "nombre", "label", "etiqueta", "title"])) : text(item))?.replace(/\s+/g, " ").trim().replace(/^#/, "");
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

function assignee(v: unknown): TaskJsonInput["assignee"] | undefined {
  if (v === null) return null;
  if (typeof v === "string") {
    if (v.length > SHORT_TEXT_MAX) return undefined;
    const s = v.trim();
    if (s === "") return null;
    // «Ana <ana@example.com>», un email suelto o un nombre.
    const m = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(s);
    if (m) return { ...(m[1]!.trim() ? { name: m[1]!.trim() } : {}), email: m[2]!.toLowerCase() };
    return /^\S+@\S+\.\S+$/.test(s) ? { email: s.toLowerCase() } : { name: s };
  }
  if (!isObject(v)) return undefined;
  const id = text(pick(v, ["id", "userid", "usuarioid"]))?.trim().slice(0, 100);
  const name = text(pick(v, ["name", "nombre", "fullname", "displayname"]))?.trim();
  const email = text(pick(v, ["email", "correo", "mail", "emailaddress"]))?.trim().toLowerCase();
  if (!id && !name && !email) return undefined;
  return { ...(id ? { id } : {}), ...(name ? { name } : {}), ...(email ? { email } : {}) };
}

function subtasks(v: unknown): TaskJsonInput["subtasks"] | undefined {
  if (v === null) return [];
  const list = typeof v === "string" ? v.split(/\r?\n/) : Array.isArray(v) ? v : undefined;
  if (!list) return undefined;
  const out: { text: string; done: boolean }[] = [];
  for (const item of list) {
    let raw: string | undefined;
    let done: boolean | undefined;
    if (isObject(item)) {
      raw = text(pick(item, ["text", "texto", "title", "titulo", "name", "nombre", "task", "tarea", "label"]));
      done = bool(pick(item, ["done", "hecha", "hecho", "completed", "completada", "checked", "complete", "finished"]));
    } else raw = text(item);
    if (raw === undefined) continue;
    // «- [x] Texto», «[ ] Texto», «* Texto»: la casilla marca si está hecha y la viñeta se quita.
    const m = /^\s*(?:[-*•]\s+)?(?:\[([ xX✓✔]?)\]\s*)?(.*)$/s.exec(raw)!;
    if (m[1] !== undefined && done === undefined) done = m[1].trim() !== "";
    const t = m[2]!.replace(/\s+/g, " ").trim();
    if (t) out.push({ text: t, done: done ?? false });
  }
  return out;
}

function dependsOn(v: unknown): TaskJsonInput["dependsOn"] | undefined {
  if (v === null || v === false) return null;
  // Una lista: vale su primer elemento (una lista dentro de otra no se sigue: no hay recursión que agotar).
  if (Array.isArray(v)) {
    if (!v.length) return null;
    v = v[0];
    if (v === null || v === false) return null;
  }
  if (typeof v === "string") return v.trim() ? { title: v.trim() } : null;
  if (!isObject(v)) return undefined;
  const id = text(pick(v, ["id", "taskid"]))?.trim();
  const title = text(pick(v, ["title", "titulo", "name", "nombre"]))?.trim();
  if (!id && !title) return undefined;
  return { ...(id ? { id } : {}), ...(title ? { title } : {}) };
}

const GOOGLE_KIND_IN: Record<string, GoogleFileKind> = {
  doc: "GOOGLE_DOC", docs: "GOOGLE_DOC", document: "GOOGLE_DOC", documento: "GOOGLE_DOC", googledoc: "GOOGLE_DOC",
  sheet: "GOOGLE_SHEET", sheets: "GOOGLE_SHEET", spreadsheet: "GOOGLE_SHEET", hoja: "GOOGLE_SHEET", hojadecalculo: "GOOGLE_SHEET", googlesheet: "GOOGLE_SHEET",
  slides: "GOOGLE_SLIDES", slide: "GOOGLE_SLIDES", presentation: "GOOGLE_SLIDES", presentacion: "GOOGLE_SLIDES", googleslides: "GOOGLE_SLIDES",
};
/** Solo archivos de Google Docs/Drive por https (lo mismo que acepta createGoogleFile). */
export const GOOGLE_FILE_URL_RE = /^https:\/\/(docs|drive)\.google\.com\//;
function googleKindOfUrl(url: string): GoogleFileKind {
  return /\/spreadsheets\//.test(url) ? "GOOGLE_SHEET" : /\/presentation\//.test(url) ? "GOOGLE_SLIDES" : "GOOGLE_DOC";
}
function googleDocs(v: unknown): TaskJsonInput["googleDocs"] | undefined {
  if (v === null) return [];
  if (!Array.isArray(v)) return undefined;
  const out: NonNullable<TaskJsonInput["googleDocs"]> = [];
  const seen = new Set<string>();
  for (const item of v) {
    const url = (isObject(item) ? text(pick(item, ["url", "link", "enlace", "href"])) : text(item))?.trim();
    if (!url || !GOOGLE_FILE_URL_RE.test(url) || seen.has(url)) continue;
    seen.add(url);
    const rawKind = isObject(item) ? text(pick(item, ["kind", "type", "tipo"])) : undefined;
    const kind = (rawKind && (GOOGLE_KIND_IN[foldKey(rawKind)] ?? (GOOGLE_FILE_KINDS as readonly string[]).find((k) => k === rawKind.toUpperCase()) as GoogleFileKind | undefined)) || googleKindOfUrl(url);
    const title = (isObject(item) ? text(pick(item, ["title", "titulo", "name", "nombre"])) : undefined)?.trim() || url;
    out.push({ kind, title, url });
  }
  return out;
}

/** Texto obligatorio (sin vacío): tipo, columna. */
const named = (v: unknown): string | undefined => {
  const s = (isObject(v) ? text(pick(v, ["name", "nombre", "title"])) : text(v))?.replace(/\s+/g, " ").trim();
  return s || undefined;
};
/** Texto que se puede vaciar con null o "": cliente, entregable, enlace, color. */
const clearable = (v: unknown): string | null | undefined => {
  if (v === null) return null;
  const s = (isObject(v) ? text(pick(v, ["name", "nombre", "title", "url"])) : text(v))?.trim();
  return s === undefined ? undefined : s === "" ? null : s;
};

/** Quita el bloque de código de Markdown (```json … ```) con el que una IA suele envolver el JSON. */
function stripFence(s: string): string {
  const m = /^```[a-zA-Z0-9]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(s);
  if (m) return m[1]!.trim();
  if (s.startsWith("{") || s.startsWith("[")) return s;
  // Texto alrededor («Aquí tienes: ```json … ``` Espero que…»): el primer bloque de código cuyo contenido empieza por { o [.
  // Se buscan las vallas con indexOf (lineal) y como mucho unas pocas, para no gastar CPU con textos raros.
  let from = 0;
  for (let i = 0; i < 8; i++) {
    const open = s.indexOf("```", from);
    if (open < 0) break;
    const nl = s.indexOf("\n", open + 3);
    if (nl < 0) break;
    const close = s.indexOf("```", nl + 1);
    if (close < 0) break;
    const inner = s.slice(nl + 1, close).trim();
    if (/^[a-zA-Z0-9]*[ \t\r]*$/.test(s.slice(open + 3, nl)) && (inner.startsWith("{") || inner.startsWith("["))) return inner;
    from = close + 3;
  }
  return s;
}

/**
 * Lee un texto (lo que hay en el portapapeles) como tarea. No lanza: si no es JSON o no es una tarea, `none`; si lleva el
 * marcador del formato (o tiene pinta de tarea) y no se puede leer, `invalid`.
 */
export function parseTaskJson(raw: string): TaskJsonParse {
  if (typeof raw !== "string") return { kind: "none" };
  const body = stripFence(raw.replace(/^﻿/, "").trim());
  if (!body.startsWith("{") && !body.startsWith("[")) return { kind: "none" };
  const marked = body.toLowerCase().includes(`"${TASK_JSON_FORMAT}"`);
  if (body.length > TASK_JSON_MAX_CHARS) return marked ? { kind: "invalid" } : { kind: "none" };
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return marked ? { kind: "invalid" } : { kind: "none" };
  }
  if (Array.isArray(data)) {
    if (data.length !== 1) return marked ? { kind: "invalid" } : { kind: "none" };
    data = data[0];
  }
  return parseTaskValue(data);
}

/** Proyecto de un enlace de Pizarro («https://…/p/ID?task=…»), para saber de qué proyecto viene una tarea. */
function projectIdOfUrl(url: string | undefined): string | undefined {
  if (!url || url.length > 2000) return undefined;
  const m = /\/p\/([A-Za-z0-9_-]{1,64})(?:[/?#]|$)/.exec(url);
  return m?.[1];
}

/** `info` del JSON: id de la tarea de origen y su proyecto (por `projectId` o por el enlace). */
function infoOf(v: unknown): TaskJsonInput["info"] | undefined {
  if (!isObject(v)) return undefined;
  const id = text(pick(v, ["id", "taskid"]))?.trim().slice(0, 100);
  const projectId = (text(pick(v, ["projectid", "proyectoid"]))?.trim() || projectIdOfUrl(text(pick(v, ["url", "link", "enlace"]))))?.slice(0, 100);
  if (!id && !projectId) return undefined;
  return { ...(id ? { id } : {}), ...(projectId ? { projectId } : {}) };
}

/**
 * Lee un valor ya interpretado como JSON (un objeto) como tarea; misma tolerancia y mismos resultados que parseTaskJson.
 * `fallbackProjectId`: el proyecto del envoltorio «pizarro.tasks», para las tareas que no traen el suyo en `info`.
 */
function parseTaskValue(data: unknown, fallbackProjectId?: string): TaskJsonParse {
  if (!isObject(data)) return { kind: "none" };
  // { "task": { … } } sin nada más reconocible fuera: se lee lo de dentro.
  const inner = pick(data, ["task", "tarea"]);
  if (isObject(inner) && pick(data, KEY_ALIASES.title) === undefined) data = inner;
  const obj = data as Record<string, unknown>;
  const format = pick(obj, ["format", "formato"]);
  const hasFormat = typeof format === "string" && format.trim().toLowerCase() === TASK_JSON_FORMAT;
  // Otro formato declarado: no es nuestro.
  if (typeof format === "string" && !hasFormat) return { kind: "none" };
  const titleRaw = pick(obj, KEY_ALIASES.title);
  if (!hasFormat && !(typeof titleRaw === "string" && titleRaw.trim())) return { kind: "none" };

  const task: TaskJsonInput = {};
  const problems: TaskJsonField[] = [];
  const seen = new Set<TaskJsonField>();
  const put = <K extends TaskJsonField>(field: K, value: TaskJsonInput[K] | undefined) => {
    if (value === undefined) problems.push(field);
    else task[field] = value;
  };
  for (const [key, value] of Object.entries(obj)) {
    const field = FIELD_OF_KEY.get(foldKey(key));
    if (!field || seen.has(field) || value === undefined) continue;
    seen.add(field);
    switch (field) {
      // En una línea, como lo deja el campo del título (un salto de línea o un tabulador pasan a ser un espacio).
      case "title": put("title", typeof value === "string" && value.trim() ? value.replace(/[ \t]*[\r\n\t]+\s*/g, " ").trim() : undefined); break;
      case "description": put("description", value === null ? "" : Array.isArray(value) && value.every((x) => typeof x === "string") ? value.join("\n") : typeof value === "string" ? value : undefined); break;
      // Sin tipo o sin columna no se puede dejar una tarea: null se ignora.
      case "type": if (value !== null) put("type", named(value)); break;
      case "column": if (value !== null) put("column", named(value)); break;
      case "labels": put("labels", labels(value)); break;
      case "assignee": put("assignee", assignee(value)); break;
      case "dueDate": put("dueDate", parseDayLoose(value)); break;
      case "startDate": put("startDate", parseDayLoose(value)); break;
      case "priority": put("priority", priority(value)); break;
      case "client": put("client", clearable(value)); break;
      case "cost": put("cost", decimal(value)); break;
      case "costPaid": if (value !== null) put("costPaid", bool(value)); break;
      case "estimatedHours": put("estimatedHours", decimal(value)); break;
      case "actualHours": put("actualHours", decimal(value)); break;
      case "recurrence": put("recurrence", recurrence(value)); break;
      case "color": {
        const c = clearable(value);
        put("color", typeof c === "string" ? c.toLowerCase() : c);
        break;
      }
      case "deliverable": put("deliverable", clearable(value)); break;
      case "link": put("link", clearable(value)); break;
      case "subtasks": put("subtasks", subtasks(value)); break;
      case "dependsOn": put("dependsOn", dependsOn(value)); break;
      case "googleDocs": put("googleDocs", googleDocs(value)); break;
    }
  }
  if (!Object.keys(task).length) return hasFormat || problems.length ? { kind: "invalid" } : { kind: "none" };
  const info = infoOf(pick(obj, ["info"]));
  const projectId = info?.projectId ?? fallbackProjectId?.slice(0, 100);
  if (info || projectId) task.info = { ...info, ...(projectId ? { projectId } : {}) };
  return { kind: "task", task, problems };
}

/** Por qué no se pudo leer una de las tareas de un texto con varias (texto en TASK_READ_FAILURE). */
type TaskReadFailure = "json" | "notTask" | "empty";
/** Texto (en español, clave de traducción) de cada motivo. */
export const TASK_READ_FAILURE: Record<TaskReadFailure, string> = {
  json: "no es un JSON válido",
  notTask: "no es una tarea",
  empty: "no trae ningún dato de la tarea que se entienda",
};

interface TasksTextParse {
  /** Tareas leídas, en el orden del texto. `n`: su posición (desde 1) entre todos los objetos encontrados. */
  tasks: { n: number; task: TaskJsonInput; problems: TaskJsonField[] }[];
  /** Objetos que parecían tareas y no se pudieron leer. */
  failed: { n: number; reason: TaskReadFailure }[];
  /** Objetos encontrados en total. Con más de TASKS_JSON_MAX solo se leen los primeros (`tooMany`). */
  total: number;
  tooMany: boolean;
  /** El texto pasa de TASKS_TEXT_MAX_CHARS: no se ha leído. */
  tooLong: boolean;
  /** Proyecto del envoltorio «pizarro.tasks», si lo hay. */
  project?: { name?: string; id?: string };
}

/** Intentos de buscar el cierre de un `{` o `[` que no se cierra: cada uno recorre el resto del texto. */
const UNBALANCED_RETRIES = 16;

/**
 * Final (índice siguiente al cierre) del valor JSON que empieza en `start` (`{` o `[`), contando llaves y corchetes fuera
 * de las cadenas; -1 si no se cierra. Una sola pasada, sin expresiones regulares.
 */
function closingOf(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // \ escapa el siguiente
      else if (c === 34) inString = false; // "
      continue;
    }
    if (c === 34) inString = true;
    else if (c === 123 || c === 91) depth++; // { [
    else if (c === 125 || c === 93) { // } ]
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** ¿Lo que empieza en `open` («{» o «[») puede ser JSON? Mira solo el primer carácter que no es un espacio. */
function startsLikeJson(s: string, open: number): boolean {
  let j = open + 1;
  // Como mucho unos pocos espacios: un trozo con miles no se mira entero en cada llave.
  for (let k = 0; k < 64 && j < s.length && (s[j] === " " || s[j] === "\n" || s[j] === "\r" || s[j] === "\t"); k++) j++;
  const c = s[j];
  if (c === undefined) return false;
  if (s[open] === "{") return c === '"' || c === "}";
  return c === "{" || c === "[" || c === '"' || c === "]" || c === "-" || (c >= "0" && c <= "9") || c === "t" || c === "f" || c === "n";
}

/**
 * Valores JSON (objetos o listas) que hay en un texto, en orden, con lo que haya entre ellos ignorado (vallas ```json,
 * explicaciones, líneas en blanco). Un trozo entre llaves que no es JSON pero lo parece (lleva `":`) cuenta como fallido;
 * el resto (texto con llaves o «[x]») se salta. Coste lineal: cada carácter se recorre una vez, salvo unos pocos
 * reintentos si hay una llave sin cerrar (UNBALANCED_RETRIES). `limit`: valores (más fallidos) que bastan.
 */
function jsonValuesIn(s: string, limit: number): unknown[] {
  // Los trozos que no se pueden leer van como UNREADABLE, en su sitio: así cada tarea conserva su número en el texto.
  const values: unknown[] = [];
  let retries = 0;
  let unclosed = false;
  let i = 0;
  // Siguiente «{» y siguiente «[»: se vuelven a buscar solo cuando ya han quedado atrás (buscar siempre las dos desde `i`
  // recorrería el resto del texto en cada vuelta si una de ellas no aparece: cuadrático).
  let brace = -2;
  let bracket = -2;
  while (i < s.length && values.length <= limit) {
    if (brace !== -1 && brace < i) brace = s.indexOf("{", i);
    if (bracket !== -1 && bracket < i) bracket = s.indexOf("[", i);
    const open = brace < 0 ? bracket : bracket < 0 ? brace : Math.min(brace, bracket);
    if (open < 0) break;
    // Ni objeto con clave ni lista de valores («{nombre}», «[x]»): es texto, sin intentar leerlo (cada error de JSON.parse
    // cuesta; con cientos de miles de trozos así se notaría).
    if (!startsLikeJson(s, open)) {
      i = open + 1;
      continue;
    }
    const end = closingOf(s, open);
    if (end < 0) {
      // Sin cierre: quizá la llave era del texto y la tarea viene después. Unos pocos intentos y se deja. Si al final no
      // sale nada y lo que no se cerraba parecía JSON (un objeto con claves, cortado), cuenta como uno que no se pudo leer.
      unclosed ||= s.indexOf('":', open) >= 0;
      if (++retries > UNBALANCED_RETRIES) break;
      i = open + 1;
      continue;
    }
    const slice = s.slice(open, end);
    try {
      values.push(JSON.parse(slice));
    } catch {
      if (slice.includes('":') || slice.includes('" :')) values.push(UNREADABLE);
    }
    i = end;
  }
  if (unclosed && !values.length) values.push(UNREADABLE);
  return values;
}

/** Marca de un trozo con pinta de JSON que no se pudo leer (ver jsonValuesIn). */
const UNREADABLE = Symbol("unreadable");

/** Lista de tareas del envoltorio «pizarro.tasks» (o de un objeto con una lista `tasks` y sin título propio); si no, null. */
function wrappedTasks(v: Record<string, unknown>): unknown[] | null {
  const list = pick(v, ["tasks", "tareas"]);
  if (!Array.isArray(list)) return null;
  const format = pick(v, ["format", "formato"]);
  if (typeof format === "string") return format.trim().toLowerCase() === TASKS_JSON_FORMAT ? list : null;
  return pick(v, KEY_ALIASES.title) === undefined ? list : null;
}

/**
 * Lee un texto con una o varias tareas, para importarlas: el envoltorio «pizarro.tasks», una lista de tareas, una sola
 * tarea, varios objetos seguidos (uno por línea, separados por líneas en blanco o por texto) o bloques ```json … ```.
 * Cada tarea se lee con la misma tolerancia que parseTaskJson. No lanza.
 */
export function parseTasksText(raw: string): TasksTextParse {
  const out: TasksTextParse = { tasks: [], failed: [], total: 0, tooMany: false, tooLong: false };
  if (typeof raw !== "string") return out;
  if (raw.length > TASKS_TEXT_MAX_CHARS) return { ...out, tooLong: true };
  const values = jsonValuesIn(raw, TASKS_JSON_MAX);
  const items: unknown[] = [];
  let projectId: string | undefined;
  for (const v of values) {
    if (Array.isArray(v)) {
      for (const x of v) items.push(x);
      continue;
    }
    const list = isObject(v) ? wrappedTasks(v) : null;
    if (list && isObject(v)) {
      const name = text(pick(v, ["project", "proyecto"]))?.trim().slice(0, 200);
      projectId = text(pick(v, ["projectid", "proyectoid"]))?.trim().slice(0, 100) || undefined;
      out.project = { ...(name ? { name } : {}), ...(projectId ? { id: projectId } : {}) };
      for (const x of list) items.push(x);
    } else items.push(v);
  }
  out.total = items.length;
  out.tooMany = out.total > TASKS_JSON_MAX;
  items.slice(0, TASKS_JSON_MAX).forEach((item, i) => {
    if (item === UNREADABLE) return void out.failed.push({ n: i + 1, reason: "json" });
    const r = parseTaskValue(item, projectId);
    if (r.kind === "task") out.tasks.push({ n: i + 1, task: r.task, problems: r.problems });
    else out.failed.push({ n: i + 1, reason: r.kind === "invalid" ? "empty" : "notTask" });
  });
  return out;
}

/**
 * Ctrl+V estricto: el formato del texto si es EXACTAMENTE un objeto JSON con `"format": "pizarro.task"` (o
 * «pizarro.tasks», con su lista `tasks`), sin bloque ```, sin texto alrededor (salvo espacios y la marca BOM) y sin ser una
 * lista; si no, null y el pegado sigue su curso. La importación con los botones es la tolerante (parseTasksText).
 */
export function strictJsonFormat(raw: string): "pizarro.task" | "pizarro.tasks" | null {
  if (typeof raw !== "string" || raw.length > TASKS_TEXT_MAX_CHARS) return null;
  const s = raw.replace(/^﻿/, "").trim();
  if (s.charCodeAt(0) !== 123 || s.charCodeAt(s.length - 1) !== 125) return null;
  let v: unknown;
  try {
    v = JSON.parse(s);
  } catch {
    return null;
  }
  if (!isObject(v)) return null;
  if (v.format === TASK_JSON_FORMAT) return s.length <= TASK_JSON_MAX_CHARS ? TASK_JSON_FORMAT : null;
  if (v.format === TASKS_JSON_FORMAT && Array.isArray(v.tasks)) return TASKS_JSON_FORMAT;
  return null;
}
