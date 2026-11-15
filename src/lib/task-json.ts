// Una tarea como JSON, para copiarla del detalle (Ctrl+C sin texto seleccionado) y pegarla en otra (Ctrl+V fuera de un
// campo de texto), o para dársela a una IA y pegar lo que devuelva. Sin dependencias de Node ni de zod: lo usan el
// navegador (¿lo copiado es una tarea?) y el servidor (que es quien valida y aplica, ver pasteTaskJson en tasks.ts).
//
// Formato «pizarro.task», versión 1. Todas las claves salvo `format` son opcionales al pegar: la que no viene no se toca.
//
//   {
//     "format": "pizarro.task",          marcador del formato
//     "version": 1,
//     "title": "Preparar la demo",       hasta 210 caracteres visibles (si es más largo se recorta)
//     "description": "Texto **Markdown**",
//     "type": "Funcionalidad",           nombre de un tipo del proyecto
//     "column": "En progreso",           nombre de una columna del proyecto
//     "labels": ["cliente", "urgente"],  nombres; las que no existan se crean (máx. 20 por tarea)
//     "assignee": { "name": "Ana", "email": "ana@example.com" },   o null; se busca por email y, si no, por nombre
//                                        (al copiar, el email solo va si eres tú o eres admin)
//     "dueDate": "2026-12-01",           AAAA-MM-DD (o fecha ISO completa), o null
//     "recurrence": { "rule": "weekly", "day": 2 },   none | daily | weekly (day 1-7, lunes = 1) | monthly (day 1-31)
//     "color": "#ef4444",                color de la tarjeta (de la paleta) o null
//     "deliverable": "Entrega 1",        nombre de un entregable del proyecto o null
//     "link": "https://example.com/x",   enlace de la tarea o null
//     "subtasks": [{ "text": "Guion", "done": true }],   sustituyen a las que haya (máx. 100)
//     "dependsOn": "Título de otra tarea",   la tarea del mismo proyecto que bloquea a esta, o null
//     "googleDocs": [{ "kind": "doc", "title": "Acta", "url": "https://docs.google.com/…" }],   se añaden los que falten
//     -- solo si el proyecto tiene activado el campo:
//     "startDate": "2026-11-20", "priority": "high" (low | medium | high | urgent), "client": "Acme",
//     "cost": 120.5, "costPaid": false, "estimatedHours": 8, "actualHours": 2.5,
//     -- solo de referencia (al pegar se ignoran):
//     "attachments": [{ "name": "captura.png", "url": "https://…/api/attachments/ID" }],
//     "info": { "id": "…", "project": "…", "url": "https://…/p/ID?task=ID", "createdAt": "…", "updatedAt": "…", "createdBy": "…" }
//   }
//
// Al leer se es tolerante con lo que escriba una persona o una IA: claves en mayúsculas, con guiones o en español
// («título», «fecha_limite», «Etiquetas»), fechas ISO completas o DD/MM/AAAA, prioridad en español o en inglés, subtareas
// como textos sueltos («[x] Hecha»), etiquetas separadas por comas, el JSON dentro de un bloque ```json … ``` y sin el
// marcador `format` si al menos trae un título.

import { GOOGLE_FILE_KINDS, type GoogleFileKind } from "./google-files";
import { RECURRENCES, type RecurrenceRule } from "./recurrence-date";
import { TASK_PRIORITIES, type TaskFieldKey, type TaskPriorityValue } from "./task-fields";

const TASK_JSON_FORMAT = "pizarro.task";
const TASK_JSON_VERSION = 1;
/** Tamaño máximo del texto que se intenta leer como tarea (una descripción llena y 100 subtareas caben de sobra). */
export const TASK_JSON_MAX_CHARS = 200_000;
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

/** Lo que se sabe de una tarea al copiarla (ya con nombres en vez de ids). */
export interface TaskJsonSource {
  id: string;
  project: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  title: string;
  description: string;
  type: string | null;
  column: string | null;
  labels: string[];
  /** `email`: solo si quien copia puede verlo (ver getTaskJson). */
  assignee: { name: string; email?: string } | null;
  dueDate: string | null;
  recurrence: RecurrenceRule;
  recurrenceDay: number | null;
  color: string | null;
  deliverable: string | null;
  link: string | null;
  subtasks: { text: string; done: boolean }[];
  dependsOn: string | null;
  googleDocs: { kind: GoogleFileKind; title: string; url: string }[];
  attachments: { name: string; url: string }[];
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

/** El objeto que se copia: claves siempre en el mismo orden; los campos opcionales, solo los activos en el proyecto. */
export function buildTaskJson(s: TaskJsonSource): Record<string, unknown> {
  const on = (k: TaskFieldKey) => s.enabledFields.includes(k);
  return {
    format: TASK_JSON_FORMAT,
    version: TASK_JSON_VERSION,
    title: s.title,
    description: s.description,
    type: s.type,
    column: s.column,
    labels: s.labels,
    assignee: s.assignee,
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
    dependsOn: s.dependsOn,
    googleDocs: s.googleDocs.map((d) => ({ kind: GOOGLE_KIND_OUT[d.kind], title: d.title, url: d.url })),
    attachments: s.attachments.map((a) => ({ name: a.name, url: a.url })),
    info: { id: s.id, project: s.project, url: s.url, createdAt: s.createdAt, updatedAt: s.updatedAt, createdBy: s.createdBy },
  };
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

/** Lo que trae un JSON de tarea, ya normalizado. Un campo ausente no se toca; `null` lo vacía. */
export interface TaskJsonInput {
  title?: string;
  description?: string;
  type?: string;
  column?: string;
  labels?: string[];
  assignee?: { name?: string; email?: string } | null;
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
  const name = text(pick(v, ["name", "nombre", "fullname", "displayname"]))?.trim();
  const email = text(pick(v, ["email", "correo", "mail", "emailaddress"]))?.trim().toLowerCase();
  if (!name && !email) return undefined;
  return { ...(name ? { name } : {}), ...(email ? { email } : {}) };
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
  return m ? m[1]!.trim() : s;
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
      case "title": put("title", typeof value === "string" && value.trim() ? value.trim() : undefined); break;
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
  return { kind: "task", task, problems };
}
