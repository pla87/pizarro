// Tareas de otros Kanban para «Importar tareas» del tablero (y «Importar tarea» del detalle y de «Nueva tarea», cuando
// es una sola): las lee parseTasksText (lib/task-json.ts) antes de buscar el JSON de Pizarro. Cada lector devuelve
// TaskJsonInput, lo mismo que el JSON propio, así que después todo es igual: columnas, tipos y etiquetas por nombre,
// topes, permisos y deshacer (lib/task-import.ts). Sin dependencias de Node: también lo usa la vista previa del navegador.
//
// El formato se reconoce por el contenido, no por la extensión del fichero:
//   - Trello: el JSON de un tablero («Imprimir y exportar» → «Exportar como JSON»: `lists` y `cards`; se usa el mismo lector
//     que al importar un proyecto, lib/foreign-import/trello.ts) o el de una tarjeta (su URL con «.json» al final: `name`,
//     `idList`…), o una lista de tarjetas (la API). Del tablero, las tarjetas archivadas no se importan.
//   - Jira: el JSON de la API REST de una incidencia (`fields.summary`) o de una búsqueda (`issues`).
//   - GitHub Issues: el JSON de la API (una incidencia o una lista) o de `gh issue list --json title,body,labels,state,…`.
//     Las cerradas y las pull requests no se importan.
//   - Asana: el JSON de la API (`{ "data": [ … ] }` con `gid` y `name`). Las completadas no se importan.
//   - CSV (o separado por «;» o tabuladores, también lo copiado de una hoja de cálculo) con cabecera: el lector CSV de la
//     importación de proyectos (lib/foreign-import/csv.ts), con unos retoques para lo que exporta cada herramienta
//     (normalizeCsv). La primera línea debe tener una columna de título reconocible; si no, no es un CSV.
// Lo que no tiene sitio en una tarea (comentarios, colores de las etiquetas, más de un responsable) se avisa sin importarlo.
import type { Locale, T } from "@/i18n/core";
import { AppError } from "../errors";
import type { TaskJsonInput } from "../task-json";
import { foreignPriority, mapHeaders, parseCsv, parseCsvRows } from "./csv";
import { cleanMarkdown, cleanName, cleanTitle, fold, parseDay, safeHttpUrl } from "./text";
import { parseTrello } from "./trello";
import { FOREIGN_LIMITS, type ForeignBoard } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** Lo que se ha leído de otro Kanban: tareas, de dónde vienen (ya traducido) y avisos de lo que no se importa. */
interface ForeignTasksRead {
  /** «Trello (tablero)», «CSV de Jira»…, ya traducido. */
  source: string;
  tasks: TaskJsonInput[];
  /** Ya traducidos. */
  warnings: string[];
  /** El formato se ha reconocido pero no se puede leer (CSV sin filas, con demasiadas…): ya traducido. */
  error?: string;
  /** Fechas con barras en los dos órdenes (día/mes y mes/día): el aviso, ya traducido (va también en `warnings`). */
  dateWarning?: string;
}

interface ReadOptions {
  t: T;
  /** Zona con la que una fecha con hora (Trello, Asana) pasa a día. */
  timeZone?: string;
  /** Idioma de quien importa: desempata el orden día/mes de las fechas con barras de un CSV (decideDayOrder). */
  locale?: Locale;
}

/** Etiquetas de una lista de nombres u objetos con `name`: limpias y sin repetir (las de más, las corta el importador). */
function labelNames(v: unknown): string[] | undefined {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(v) ? v.slice(0, FOREIGN_LIMITS.labels * 2) : []) {
    const name = cleanName(isObj(x) ? str(x.name) : str(x), FOREIGN_LIMITS.labelName);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out.length ? out : undefined;
}

/** Pone en `o` solo lo que tiene valor (una clave ausente no se toca al importar). */
function put(o: TaskJsonInput, extra: Partial<TaskJsonInput>): TaskJsonInput {
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) (o as Record<string, unknown>)[k] = v;
  return o;
}

/** El aviso de una cuenta, en singular o en plural (ninguno si es 0). */
const counted = (n: number, one: string, many: string): string[] => (n <= 0 ? [] : [n === 1 ? one : many]);

// --- Trello y CSV: tablero neutro (ForeignBoard) → tareas ------------------------------------------------------------------

/** Las tareas de un tablero leído por los lectores de la importación de proyectos. */
function fromBoard(board: ForeignBoard, t: T, opts: { skipArchived: boolean }): { tasks: TaskJsonInput[]; warnings: string[] } {
  const tasks: TaskJsonInput[] = [];
  let archived = 0;
  let comments = 0;
  let morePeople = 0;
  for (const x of board.tasks) {
    if (x.archived && opts.skipArchived) {
      archived++;
      continue;
    }
    comments += x.comments.length;
    const [who, ...rest] = x.assignees;
    if (rest.length) morePeople++;
    tasks.push(put({ title: x.title }, {
      description: x.description || undefined,
      column: x.column !== null ? board.columns[x.column] : undefined,
      labels: x.labels.map((l) => l.name),
      dueDate: x.due ?? undefined,
      priority: x.priority ?? undefined,
      subtasks: x.subtasks.map((s) => ({ text: s.title, done: s.done })),
      assignee: who ? { ...(who.name ? { name: who.name } : {}), ...(who.email ? { email: who.email } : {}) } : undefined,
    }));
  }
  const warnings = [...board.warnings];
  warnings.push(...counted(archived, t("1 tarea archivada no se importa."), t("{n} tareas archivadas no se importan.", { n: archived })));
  // Solo Trello trae comentarios (el CSV no los tiene).
  warnings.push(...counted(comments, t("1 comentario de Trello no se importa (al importar tareas no se traen los comentarios)."), t("{n} comentarios de Trello no se importan (al importar tareas no se traen los comentarios).", { n: comments })));
  warnings.push(...counted(morePeople, t("1 tarea tenía varios responsables: solo se asigna el primero (si existe aquí)."), t("{n} tareas tenían varios responsables: solo se asigna el primero (si existe aquí).", { n: morePeople })));
  return { tasks, warnings };
}

const isTrelloBoard = (d: unknown): d is Obj => isObj(d) && Array.isArray(d.cards) && Array.isArray(d.lists);
const isTrelloCard = (d: unknown): d is Obj =>
  isObj(d) && typeof d.name === "string" && d.format === undefined && (typeof d.idList === "string" || typeof d.idBoard === "string" || typeof d.shortLink === "string");

/** Una tarjeta o varias sueltas (sin el tablero) como si fueran un tablero, para leerlas con parseTrello. */
function cardsAsBoard(cards: Obj[]): Obj {
  const lists = new Map<string, Obj>();
  const labels: Obj[] = [];
  const members: Obj[] = [];
  const checklists: Obj[] = [];
  const actions: Obj[] = [];
  for (const c of cards) {
    // Con «?list=true» la tarjeta trae su lista: así se sabe su columna.
    if (isObj(c.list) && typeof c.list.id === "string") lists.set(c.list.id, { id: c.list.id, name: str(c.list.name), closed: false, pos: lists.size });
    members.push(...objs(c.members));
    for (const cl of objs(c.checklists)) checklists.push({ ...cl, idCard: str(c.id) });
    actions.push(...objs(c.actions));
    labels.push(...objs(c.labels));
  }
  return { name: "", lists: [...lists.values()], cards, labels, members, checklists, actions };
}

function readTrello(data: Obj, t: T, timeZone: string | undefined, kind: "board" | "cards"): ForeignTasksRead {
  const board = parseTrello(data, { t, timeZone });
  const { tasks, warnings } = fromBoard(board, t, { skipArchived: kind === "board" });
  return { source: kind === "board" ? t("Trello (tablero)") : tasks.length === 1 ? t("Trello (tarjeta)") : t("Trello (tarjetas)"), tasks, warnings };
}

// --- Jira -----------------------------------------------------------------------------------------------------------------

const isJiraIssue = (d: unknown): d is Obj => isObj(d) && isObj(d.fields) && typeof d.fields.summary === "string";

/** Nodos de una descripción de Jira en formato ADF que se recorren como mucho (y profundidad máxima). */
const ADF_MAX_NODES = 20_000;
const ADF_MAX_DEPTH = 40;

/** Descripción de Jira: texto (API v2, se deja tal cual) o documento ADF (API v3), del que se saca el texto por párrafos. */
function jiraText(v: unknown): string {
  if (typeof v === "string") return v;
  if (!isObj(v)) return "";
  let budget = ADF_MAX_NODES;
  const walk = (n: unknown, depth: number): string => {
    if (!isObj(n) || budget-- <= 0 || depth > ADF_MAX_DEPTH) return "";
    if (n.type === "text") return str(n.text);
    if (n.type === "hardBreak") return "\n";
    if (n.type === "mention" || n.type === "emoji") return isObj(n.attrs) ? str(n.attrs.text) : "";
    const inner = objs(n.content).map((c) => walk(c, depth + 1));
    switch (n.type) {
      case "paragraph": case "heading": case "blockquote": return `${inner.join("")}\n\n`;
      case "codeBlock": return `\`\`\`\n${inner.join("")}\n\`\`\`\n\n`;
      case "listItem": return `- ${inner.join("").trim()}\n`;
      case "bulletList": case "orderedList": return `${inner.join("")}\n`;
      default: return inner.join("");
    }
  };
  return walk(v, 0).replace(/\n{3,}/g, "\n\n").trim();
}

/** Enlace a la incidencia a partir de `self` (la URL de la API, https://x.atlassian.net/rest/api/2/issue/10001). */
function jiraBrowseUrl(self: unknown, key: string): string | undefined {
  const url = safeHttpUrl(self);
  if (!url) return undefined;
  try {
    return `${new URL(url).origin}/browse/${key}`;
  } catch {
    return undefined;
  }
}

function readJira(issues: Obj[], t: T, timeZone: string | undefined): ForeignTasksRead {
  const tasks: TaskJsonInput[] = [];
  let noTitle = 0;
  let resolved = 0;
  const clipped = { n: 0 };
  for (const issue of issues) {
    const f = issue.fields as Obj;
    // Resueltas (categoría de estado «done»): no se importan, como las cerradas de GitHub o las completadas de Asana.
    if (isObj(f.status) && isObj(f.status.statusCategory) && f.status.statusCategory.key === "done") {
      resolved++;
      continue;
    }
    const title = cleanTitle(str(f.summary), undefined, clipped);
    if (!title) {
      noTitle++;
      continue;
    }
    const key = cleanName(str(issue.key), 80);
    const link = key && /^[A-Z][A-Z0-9_]*-\d+$/.test(key) ? jiraBrowseUrl(issue.self, key) : undefined;
    const description = cleanMarkdown([jiraText(f.description), key ? `_${t("Referencia original: {key}", { key })}_` : ""].filter((s) => s.trim()).join("\n\n"), undefined, clipped);
    const assignee = isObj(f.assignee) ? { name: cleanName(str(f.assignee.displayName), 200), email: str(f.assignee.emailAddress).trim().toLowerCase().slice(0, 300) } : null;
    const subtasks = objs(f.subtasks).flatMap((s) => {
      const sf = isObj(s.fields) ? s.fields : {};
      const text = cleanTitle(str(sf.summary));
      const status = isObj(sf.status) ? sf.status : {};
      return text ? [{ text, done: isObj(status.statusCategory) && status.statusCategory.key === "done" }] : [];
    });
    tasks.push(put({ title }, {
      description,
      column: isObj(f.status) ? cleanName(str(f.status.name), FOREIGN_LIMITS.columnName) || undefined : undefined,
      labels: labelNames(f.labels),
      dueDate: str(f.duedate) ? (parseDay(str(f.duedate), timeZone) ?? undefined) : undefined,
      priority: isObj(f.priority) ? (foreignPriority(str(f.priority.name)) ?? undefined) : undefined,
      assignee: assignee && (assignee.name || assignee.email) ? { ...(assignee.name ? { name: assignee.name } : {}), ...(assignee.email ? { email: assignee.email } : {}) } : undefined,
      subtasks,
      link,
    }));
  }
  const warnings = [
    ...counted(resolved, t("1 incidencia resuelta no se importa."), t("{n} incidencias resueltas no se importan.", { n: resolved })),
    ...counted(noTitle, t("1 incidencia no tenía título y se ha ignorado."), t("{n} incidencias no tenían título y se han ignorado.", { n: noTitle })),
    ...counted(clipped.n, t("1 texto era más largo de lo permitido y se ha recortado."), t("{n} textos eran más largos de lo permitido y se han recortado.", { n: clipped.n })),
  ];
  return { source: t("Jira"), tasks, warnings };
}

// --- GitHub Issues --------------------------------------------------------------------------------------------------------

const GITHUB_ISSUE_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/\d+(?:[?#]|$)/;
const isGithubIssue = (d: unknown): d is Obj => {
  if (!isObj(d) || typeof d.title !== "string" || d.format !== undefined || isObj(d.fields)) return false;
  const url = str(d.html_url) || str(d.url);
  if (url.length < 300 && GITHUB_ISSUE_URL.test(url)) return true;
  const state = typeof d.state === "string" && /^(open|closed)$/i.test(d.state);
  return state && ("body" in d || "labels" in d || Number.isInteger(d.number));
};

function readGithub(issues: Obj[], t: T): ForeignTasksRead {
  const tasks: TaskJsonInput[] = [];
  let closed = 0;
  let pulls = 0;
  let morePeople = 0;
  const clipped = { n: 0 };
  for (const i of issues) {
    if (i.pull_request !== undefined || i.isPullRequest === true || /\/pull\/\d+/.test(str(i.html_url) || str(i.url))) {
      pulls++;
      continue;
    }
    if (/^closed$/i.test(str(i.state))) {
      closed++;
      continue;
    }
    const title = cleanTitle(str(i.title), undefined, clipped);
    if (!title) continue;
    const people = objs(i.assignees).length ? objs(i.assignees) : isObj(i.assignee) ? [i.assignee] : [];
    if (people.length > 1) morePeople++;
    const who = people[0] ? cleanName(str(people[0].name) || str(people[0].login), 200) : "";
    const url = str(i.html_url) || str(i.url);
    tasks.push(put({ title }, {
      description: cleanMarkdown(str(i.body), undefined, clipped),
      labels: labelNames(i.labels),
      assignee: who ? { name: who } : undefined,
      link: GITHUB_ISSUE_URL.test(url) ? (safeHttpUrl(url) ?? undefined) : undefined,
    }));
  }
  const warnings = [
    ...counted(closed, t("1 incidencia cerrada no se importa."), t("{n} incidencias cerradas no se importan.", { n: closed })),
    ...counted(pulls, t("1 pull request no se importa."), t("{n} pull requests no se importan.", { n: pulls })),
    ...counted(morePeople, t("1 tarea tenía varios responsables: solo se asigna el primero (si existe aquí)."), t("{n} tareas tenían varios responsables: solo se asigna el primero (si existe aquí).", { n: morePeople })),
    ...counted(clipped.n, t("1 texto era más largo de lo permitido y se ha recortado."), t("{n} textos eran más largos de lo permitido y se han recortado.", { n: clipped.n })),
  ];
  return { source: t("GitHub Issues"), tasks, warnings };
}

// --- Asana ----------------------------------------------------------------------------------------------------------------

const isAsanaTask = (d: unknown): d is Obj =>
  isObj(d) && typeof d.gid === "string" && typeof d.name === "string" && (d.resource_type === undefined || d.resource_type === "task");

function readAsana(list: Obj[], t: T, timeZone: string | undefined): ForeignTasksRead {
  const tasks: TaskJsonInput[] = [];
  let done = 0;
  const clipped = { n: 0 };
  for (const a of list) {
    if (a.completed === true) {
      done++;
      continue;
    }
    const title = cleanTitle(str(a.name), undefined, clipped);
    if (!title) continue;
    const section = objs(a.memberships).map((m) => (isObj(m.section) ? cleanName(str(m.section.name), FOREIGN_LIMITS.columnName) : "")).find(Boolean);
    const due = str(a.due_on) || str(a.due_at);
    tasks.push(put({ title }, {
      description: cleanMarkdown(str(a.notes) || str(a.html_notes).replace(/<\/?body>/g, ""), undefined, clipped),
      column: section,
      labels: labelNames(a.tags),
      dueDate: due ? (parseDay(due, timeZone) ?? undefined) : undefined,
      assignee: isObj(a.assignee) && cleanName(str(a.assignee.name), 200) ? { name: cleanName(str(a.assignee.name), 200) } : undefined,
      link: safeHttpUrl(a.permalink_url) ?? undefined,
    }));
  }
  const warnings = [
    ...counted(done, t("1 tarea completada no se importa."), t("{n} tareas completadas no se importan.", { n: done })),
    ...counted(clipped.n, t("1 texto era más largo de lo permitido y se ha recortado."), t("{n} textos eran más largos de lo permitido y se han recortado.", { n: clipped.n })),
  ];
  return { source: t("Asana"), tasks, warnings };
}

// --- JSON: qué es ---------------------------------------------------------------------------------------------------------

/** Lee un JSON ya interpretado si es de otro Kanban; null si no lo es (y se lee como JSON de Pizarro). */
function readForeignJson(data: unknown, opts: ReadOptions): ForeignTasksRead | null {
  const { t, timeZone } = opts;
  if (isTrelloBoard(data)) return readTrello(data, t, timeZone, "board");
  if (isTrelloCard(data)) return readTrello(cardsAsBoard([data]), t, timeZone, "cards");
  if (isJiraIssue(data)) return readJira([data], t, timeZone);
  if (isObj(data) && Array.isArray(data.issues) && data.issues.some(isJiraIssue)) return readJira(objs(data.issues).filter(isJiraIssue), t, timeZone);
  if (isGithubIssue(data)) return readGithub([data], t);
  if (isObj(data) && isAsanaTask(data)) return readAsana([data], t, timeZone);
  if (isObj(data) && (isAsanaTask(data.data) || (Array.isArray(data.data) && data.data.length > 0 && data.data.every(isAsanaTask)))) {
    return readAsana(Array.isArray(data.data) ? objs(data.data) : [data.data as Obj], t, timeZone);
  }
  if (Array.isArray(data) && data.length > 0) {
    // Una lista: todos los elementos del mismo origen (si no, es la lista de tareas de Pizarro de siempre).
    const all = (test: (x: unknown) => boolean) => data.every(test);
    if (all(isTrelloCard)) return readTrello(cardsAsBoard(data as Obj[]), t, timeZone, "cards");
    if (all(isJiraIssue)) return readJira(data as Obj[], t, timeZone);
    if (all(isGithubIssue)) return readGithub(data as Obj[], t);
    if (all(isAsanaTask)) return readAsana(data as Obj[], t, timeZone);
  }
  return null;
}

// --- CSV ------------------------------------------------------------------------------------------------------------------

/**
 * Cabeceras (plegadas con fold) que solo pone Jira: «Issue key», «Issue id», «Issue Type» y las mismas con Jira en
 * español («Clave de incidencia», «Id de la incidencia», «Tipo de incidencia»).
 */
const JIRA_CSV_HEADERS = ["issue key", "issue id", "issue type", "clave de incidencia", "id de la incidencia", "tipo de incidencia"];

/** Herramienta que ha exportado un CSV, por su cabecera (ya plegada con fold): solo para decir de dónde viene. */
function csvTool(h: Set<string>, t: T): string {
  const has = (...names: string[]) => names.some((n) => h.has(n));
  if (h.has("type") && h.has("content") && h.has("indent")) return t("CSV de Todoist");
  if (has(...JIRA_CSV_HEADERS)) return t("CSV de Jira");
  if (has("card name", "card id") && has("list name", "list id")) return t("CSV de Trello");
  if (h.has("section column") || (h.has("task id") && h.has("assignee email"))) return t("CSV de Asana");
  if (h.has("task content") || (h.has("task id") && h.has("task name") && has("date created", "parent id"))) return t("CSV de ClickUp");
  if (h.has("team") && has("cycle name", "cycle number", "project milestone")) return t("CSV de Linear");
  if (h.has("linked pull requests") || (h.has("title") && h.has("repository"))) return t("CSV de GitHub Projects");
  if (h.has("bucket name")) return t("CSV de Microsoft Planner");
  if (h.has("swimlane")) return t("CSV de Kanboard");
  if (h.has("subject") && h.has("ref")) return t("CSV de Taiga");
  return t("CSV");
}

/**
 * Cabeceras de otras herramientas que el lector CSV de proyectos no reconoce (o reconoce de otra manera) → la que sí. Solo
 * si la de destino no está ya. Ver la cabecera de csv.ts.
 */
const CSV_RENAMES: [from: string, to: string][] = [
  ["issue key", "reference"], ["clave de incidencia", "reference"], ["parent summary", "parent task"], ["card description", "description"], ["list name", "list"],
  ["bucket name", "section"], ["subject", "title"], ["ref", "reference"], ["task content", "description"],
];
/** Columnas de etiquetas: si se repiten (Jira pone una «Labels» por etiqueta), se juntan en la primera. */
const LABEL_HEADERS = new Set(["labels", "label", "tags", "tag", "etiquetas", "etiqueta", "categories", "category"]);
const PEOPLE_HEADERS = new Set(["assignee", "assignees", "assigned to", "owner", "members", "responsable", "asignado", "asignados"]);
const NO_PRIORITY = new Set(["no priority", "none", "sin prioridad", "ninguna", "-"]);
const EXTRA_PRIORITY: Record<string, string> = { important: "high", importante: "alta" };
const TRELLO_COLOR_SUFFIX = /\s*\((?:green|yellow|orange|red|purple|blue|sky|lime|pink|black)(?:_light|_dark)?\)$/i;

/**
 * Retoca las filas de un CSV antes de leerlas: cabeceras de cada herramienta (CSV_RENAMES), columnas de etiquetas
 * repetidas juntas, «[Ana, Luis]» (ClickUp) sin corchetes, «Urgente (red)» (Trello) sin el color, «No priority» como
 * vacía y el CSV de Todoist (filas de sección, sangría para las subtareas, prioridad 1 = la más alta, @etiquetas en el
 * texto) pasado a columnas normales. Devuelve también los avisos de lo que no se importa.
 */
function normalizeCsv(input: string[][], t: T): { rows: string[][]; warnings: string[] } {
  const header = input[0]!.map(fold);
  if (header.includes("type") && header.includes("content") && header.includes("indent")) return todoist(input, header, t);
  const jira = jiraUnresolved(input, header, t);
  const rows = jira.rows;
  const out = rows.map((r) => [...r]);
  const head = out[0]!;
  const present = new Set(header);
  for (const [from, to] of CSV_RENAMES) {
    const i = header.indexOf(from);
    if (i >= 0 && !present.has(to)) {
      head[i] = to;
      present.add(to);
    }
  }
  const folded = head.map(fold);
  const firstLabel = new Map<string, number>();
  const merges: [into: number, from: number][] = [];
  folded.forEach((h, i) => {
    if (!LABEL_HEADERS.has(h)) return;
    const into = firstLabel.get(h);
    if (into === undefined) firstLabel.set(h, i);
    else merges.push([into, i]);
  });
  for (const [, from] of merges) head[from] = "";
  const trello = folded.includes("card name") || folded.includes("card id");
  const bracketed = folded.flatMap((h, i) => (LABEL_HEADERS.has(h) || PEOPLE_HEADERS.has(h) ? [i] : []));
  const priorityAt = folded.findIndex((h) => h === "priority" || h === "prioridad");
  for (const row of out.slice(1)) {
    for (const [into, from] of merges) {
      const extra = row[from]?.trim();
      if (extra) row[into] = row[into]?.trim() ? `${row[into]}, ${extra}` : extra;
    }
    for (const i of bracketed) {
      const v = row[i]?.trim();
      if (v && v.startsWith("[") && v.endsWith("]")) row[i] = v.slice(1, -1);
      if (trello && row[i] && LABEL_HEADERS.has(folded[i]!)) row[i] = row[i]!.split(",").map((p) => (p.length < 200 ? p.replace(TRELLO_COLOR_SUFFIX, "") : p)).join(",");
    }
    if (priorityAt >= 0 && row[priorityAt] !== undefined) {
      const p = fold(row[priorityAt]!);
      if (NO_PRIORITY.has(p)) row[priorityAt] = "";
      else if (EXTRA_PRIORITY[p]) row[priorityAt] = EXTRA_PRIORITY[p]!;
    }
  }
  return { rows: out, warnings: jira.warnings };
}

/**
 * Valores de «Resolution» de una incidencia sin resolver (Jira la deja vacía al exportar, pero algunos ponen el texto),
 * ya plegados con fold: «Sin resolución» se compara como «sin resolucion».
 */
const JIRA_UNRESOLVED = new Set(["", "unresolved", "sin resolver", "sin resolucion", "no resuelta", "none", "-"]);
/** «Status Category» de una incidencia terminada (en inglés y como la traduce Jira al español). */
const JIRA_DONE_CATEGORY = new Set(["done", "listo", "hecho", "finalizado", "finalizada", "terminado", "terminada"]);

/**
 * CSV de Jira: las incidencias resueltas («Resolution» rellena o «Status Category» terminada) no se importan, como en el
 * JSON. Una subtarea resuelta de una incidencia que sí se importa se queda (entra como subtarea hecha); si su incidencia
 * madre no se importa, tampoco ella (si no, saldría como tarea pendiente).
 */
function jiraUnresolved(rows: string[][], header: string[], t: T): { rows: string[][]; warnings: string[] } {
  if (!JIRA_CSV_HEADERS.some((h) => header.includes(h))) return { rows, warnings: [] };
  const resolution = header.findIndex((h) => h === "resolution" || h === "resolucion");
  const category = header.findIndex((h) => h === "status category" || h === "categoria de estado");
  if (resolution < 0 && category < 0) return { rows, warnings: [] };
  const title = header.findIndex((h) => h === "summary" || h === "resumen");
  const parent = header.findIndex((h) => h === "parent summary" || h === "parent task");
  const isResolved = (row: string[]) =>
    (resolution >= 0 && !JIRA_UNRESOLVED.has(fold(row[resolution] ?? ""))) || (category >= 0 && JIRA_DONE_CATEGORY.has(fold(row[category] ?? "")));
  const parentOf = (row: string[]) => (parent >= 0 ? fold(cleanTitle(row[parent] ?? "")) : "");
  // Títulos de las incidencias de primer nivel que se importan (las subtareas resueltas solo se quedan bajo una de ellas).
  const kept = new Set(rows.slice(1).filter((r) => !parentOf(r) && !isResolved(r)).map((r) => (title >= 0 ? fold(cleanTitle(r[title] ?? "")) : "")));
  let skipped = 0;
  const out = [rows[0]!];
  for (const row of rows.slice(1)) {
    if (isResolved(row) && !(parentOf(row) && kept.has(parentOf(row)))) {
      skipped++;
      continue;
    }
    out.push(row);
  }
  return { rows: out, warnings: counted(skipped, t("1 incidencia resuelta no se importa."), t("{n} incidencias resueltas no se importan.", { n: skipped })) };
}

/** Prioridad de Todoist en su CSV (1 = la más alta, 4 = sin prioridad) → la del lector CSV. */
const TODOIST_PRIORITY: Record<string, string> = { "1": "urgent", "2": "high", "3": "medium", "4": "" };

/** CSV de Todoist (TYPE, CONTENT, DESCRIPTION, PRIORITY, INDENT, RESPONSIBLE, DATE…) → columnas normales. */
function todoist(rows: string[][], header: string[], t: T): { rows: string[][]; warnings: string[] } {
  const col = (name: string) => header.indexOf(name);
  const [type, content, desc, prio, indent, resp, date] = ["type", "content", "description", "priority", "indent", "responsible", "date"].map(col);
  const out: string[][] = [["Title", "Description", "Section", "Priority", "Due Date", "Assignee", "Parent task", "Labels"]];
  let section = "";
  let notes = 0;
  const parents: string[] = [];
  for (const row of rows.slice(1)) {
    const kind = fold(row[type!] ?? "");
    const text = (row[content!] ?? "").trim();
    if (kind === "section") {
      section = text;
      continue;
    }
    if (kind === "note") {
      notes++;
      continue;
    }
    if (kind !== "task") continue;
    // Las @etiquetas van en el propio texto de la tarea.
    const labels: string[] = [];
    const title = text.length > 2000 ? text : text.replace(/(^|\s)@([^\s@,]+)/g, (_m, pre: string, name: string) => (labels.push(name), pre)).replace(/\s+/g, " ").trim();
    const level = Math.max(1, Math.min(10, Number.parseInt(row[indent!] ?? "1", 10) || 1));
    parents.length = level - 1;
    const parent = level > 1 ? (parents[level - 2] ?? "") : "";
    parents[level - 1] = title;
    out.push([title, row[desc!] ?? "", section, TODOIST_PRIORITY[(row[prio!] ?? "").trim()] ?? "", row[date!] ?? "", (row[resp!] ?? "").replace(/\s*\(\d+\)$/, ""), parent, labels.join(", ")]);
  }
  return { rows: out, warnings: counted(notes, t("1 comentario de Todoist no se importa."), t("{n} comentarios de Todoist no se importan.", { n: notes })) };
}

/** Largo máximo de la primera línea que se mira para ver si un texto es un CSV con cabecera. */
const CSV_HEADER_MAX = 20_000;

/** ¿Es un CSV con cabecera (con una columna de título reconocible)? Si lo es, lo lee; si no, null. */
function readForeignCsv(raw: string, opts: ReadOptions): ForeignTasksRead | null {
  const { t } = opts;
  const s = raw.replace(/^﻿/, "");
  let end = 0;
  while (end < s.length && end <= CSV_HEADER_MAX && s[end] !== "\n" && s[end] !== "\r") end++;
  if (end > CSV_HEADER_MAX) return null;
  const header = parseCsv(s.slice(0, end))[0];
  if (!header || header.length < 2) return null;
  const folded = header.map(fold);
  const todo = folded.includes("type") && folded.includes("content") && folded.includes("indent");
  if (!todo && !mapHeaders(normalizeCsv([header], t).rows[0]!).columns.title) return null;
  const source = csvTool(new Set(folded), t);
  try {
    const rows = parseCsv(s, undefined, FOREIGN_LIMITS.csvRows + 1);
    const norm = normalizeCsv(rows, t);
    const board = parseCsvRows(norm.rows, { t, timeZone: opts.timeZone, locale: opts.locale });
    const { tasks, warnings } = fromBoard(board, t, { skipArchived: true });
    return { source, tasks, warnings: [...norm.warnings, ...warnings], ...(board.dateWarning ? { dateWarning: board.dateWarning } : {}) };
  } catch (e) {
    if (e instanceof AppError) return { source, tasks: [], warnings: [], error: t(e.message) };
    throw e;
  }
}

/**
 * Tareas de otro Kanban en `raw` (ver la cabecera), o null si no lo es (entonces es JSON de Pizarro o texto con JSON).
 * Quien llama ya ha comprobado el largo (TASKS_TEXT_MAX_CHARS). No lanza.
 */
export function readForeignTasks(raw: string, opts: ReadOptions): ForeignTasksRead | null {
  const s = raw.replace(/^﻿/, "").trim();
  if (!s) return null;
  if (s[0] === "{" || s[0] === "[") {
    let data: unknown;
    try {
      data = JSON.parse(s);
    } catch {
      return null;
    }
    try {
      return readForeignJson(data, opts);
    } catch (e) {
      if (e instanceof AppError) return null;
      throw e;
    }
  }
  if (s.startsWith("```")) return null;
  return readForeignCsv(s, opts);
}

/**
 * Un JSON de un tablero de Trello que no cabe en la importación (5 M caracteres: el historial de `actions` suele ser lo que
 * más ocupa) sin lo que no se importa como tareas: el historial, los adjuntos subidos y los datos de los complementos. Si
 * no es un tablero de Trello, null.
 */
export function compactTrelloBoard(raw: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^﻿/, ""));
  } catch {
    return null;
  }
  if (!isTrelloBoard(data)) return null;
  const pick = (o: Obj, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  // Un anidamiento tan profundo que JSON.stringify agota la pila (RangeError; JSON.parse sí lo lee): no se puede importar.
  try {
    return JSON.stringify({
      name: data.name,
      lists: objs(data.lists).map((l) => pick(l, ["id", "name", "closed", "pos"])),
      labels: objs(data.labels).map((l) => pick(l, ["id", "name", "color"])),
      members: objs(data.members).map((m) => pick(m, ["id", "fullName", "username"])),
      checklists: objs(data.checklists).map((c) => ({ ...pick(c, ["idCard", "name", "pos"]), checkItems: objs(c.checkItems).map((i) => pick(i, ["name", "state", "pos"])) })),
      cards: objs(data.cards).map((c) => (c.closed === true
        ? pick(c, ["id", "idList", "name", "closed"])
        : { ...pick(c, ["id", "idList", "name", "desc", "closed", "pos", "due", "idLabels", "labels", "idMembers", "shortUrl"]), attachments: objs(c.attachments).filter((a) => a.isUpload !== true).map((a) => pick(a, ["name", "url"])) })),
    });
  } catch {
    return null;
  }
}
