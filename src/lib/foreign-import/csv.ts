// Lector de CSV genérico de tareas. Las columnas se reconocen por su cabecera (español e inglés, sin distinguir
// mayúsculas, acentos ni separadores como _ - /), de modo que sirve para las exportaciones de otros Kanban.
//
// Cabeceras reconocidas (HEADERS más abajo). Cada campo sale de la columna del primer nombre de su lista que aparezca; si
// una cabecera se repite, solo cuenta la primera. Etiquetas y responsables juntan además las columnas de nombres distintos
// que coincidan (p. ej. «Tags» y «Category», u «Owner» y «Members»):
//   título      title, name, summary, task name, card name, nombre, resumen, tarea…        (Asana/Notion «Name», GitHub/Kanboard/Wekan «Title»)
//   descripción description, notes, details, body, descripción, notas, detalle…         (Asana «Notes», Kanboard/Wekan «Description»)
//   columna     status, section/column, column, list, stage, state, estado, columna…     (Asana «Section/Column», Notion/GitHub «Status», Wekan «Stage», Kanboard «Column»)
//   etiquetas   labels, tags, category, categories, etiquetas…                           (Asana/Notion «Tags», GitHub/Wekan «Labels», Kanboard «Category»)
//   fecha límite due date, due, deadline, date due, fecha límite, vencimiento…           (Asana/Wekan «Due Date», Kanboard «Date Due»)
//   responsable assignee, assignees, assigned to, owner, members, responsable…, y su email («Assignee Email» de Asana)
//   prioridad   priority, prioridad                                                      (Urgent/High/Medium/Low, P0-P4, Kanboard 0-3)
//   archivada   archived, archivada, archivado
//   referencia  task id, card id, id, reference, referencia…                             (Asana «Task ID», Kanboard «Task Id»): va a la descripción
//   tarea madre parent task, tarea padre, tarea principal, subtarea de                   (Asana «Parent task»): si coincide por título con otra fila, la fila pasa a ser su subtarea
// Las columnas del tablero son los estados distintos por orden de aparición, salvo las que cuentan como terminadas
// («Hecho», «Done», «Cerrado»…), que van al final. Las cabeceras de cada herramienta están escritas de memoria (sin poder
// exportar de cada una): si alguna difiere en una versión, basta con renombrar la columna a una de las de arriba.
import type { T } from "@/i18n/core";
import { AppError } from "../errors";
import type { TaskPriorityValue } from "../task-fields";
import { FOREIGN_LIMITS, type ForeignBoard, type ForeignPerson, type ForeignTask } from "./types";
import { cleanMarkdown, cleanName, cleanTitle, fold, isDoneName, parseDay } from "./text";

/** Separador de campos: el que más aparece en la primera línea (fuera de comillas) entre «,», «;» y tabulador. */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch]!++;
  }
  if (counts[";"]! > counts[","]! && counts[";"]! >= counts["\t"]!) return ";";
  if (counts["\t"]! > counts[","]! && counts["\t"]! > counts[";"]!) return "\t";
  return ",";
}

/**
 * CSV según RFC 4180: campos entre comillas con «""» para una comilla, saltos de línea dentro de comillas, CRLF o LF,
 * BOM UTF-8 al principio. Las líneas totalmente vacías se ignoran. Una comilla en mitad de un campo sin comillas es literal.
 * Con `maxRows` se lanza un AppError en cuanto se supera (sin llegar a crear el resto de las filas).
 */
export function parseCsv(input: string, delimiter?: string, maxRows = Infinity): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  const endField = () => { row.push(field); field = ""; };
  const endRow = () => {
    const q = wasQuoted;
    endField();
    wasQuoted = false;
    if (row.length > 1 || row[0] !== "" || q) {
      rows.push(row);
      if (rows.length > maxRows) throw new AppError("El CSV tiene demasiadas filas.");
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      quoted = true;
      wasQuoted = true;
    } else if (ch === sep) endField();
    else if (ch === "\n") endRow();
    else if (ch === "\r") { if (text[i + 1] === "\n") i++; endRow(); }
    else field += ch;
  }
  if (field !== "" || row.length || wasQuoted) endRow();
  return rows;
}

type Field = "title" | "description" | "column" | "labels" | "due" | "assignee" | "assigneeEmail" | "priority" | "archived" | "key" | "parent" | "completed";

/** Cabeceras (ya sin acentos ni mayúsculas) de cada campo, en orden de preferencia. */
const HEADERS: Record<Field, string[]> = {
  title: ["titulo", "title", "name", "nombre", "summary", "resumen", "task name", "nombre de la tarea", "tarea", "task", "card name", "card title", "nombre de la tarjeta", "tarjeta", "issue", "asunto"],
  description: ["descripcion", "description", "notas", "notes", "detalle", "detalles", "details", "body", "contenido", "content", "observaciones"],
  column: ["columna", "estado", "status", "list", "lista", "section column", "section", "seccion", "column", "column name", "stage", "etapa", "state", "fase", "board column", "board list", "kanban column", "nombre de la columna"],
  labels: ["etiquetas", "etiqueta", "labels", "label", "tags", "tag", "categorias", "categoria", "categories", "category"],
  due: ["fecha limite", "fecha de vencimiento", "vencimiento", "fecha de entrega", "fecha fin", "fecha de fin", "due date", "due", "deadline", "date due", "target date", "end date", "finish date"],
  assignee: ["responsable", "asignado", "asignado a", "asignada a", "asignados", "asignadas", "assignee", "assignees", "assigned to", "assign", "owner", "persona", "person", "members", "miembros"],
  assigneeEmail: [
    "assignee email", "assignee e mail", "email del responsable", "responsable email", "correo del responsable", "asignado email", "owner email", "assigned to email", "email", "e mail", "correo",
  ],
  priority: ["prioridad", "priority"],
  archived: ["archivada", "archivado", "archivadas", "archived"],
  key: ["task id", "card id", "id", "clave", "referencia", "reference", "task number", "card number"],
  parent: ["parent task", "tarea principal", "tarea padre", "subtarea de"],
  completed: ["completed at", "completed", "completada", "completado", "fecha de finalizacion", "resolved", "resolucion", "resolution date"],
};
/** Campos que juntan las columnas de todos los nombres de su lista que aparezcan (el resto se queda con la primera). */
const MULTI: Field[] = ["labels", "assignee", "assigneeEmail"];

/** Columnas de la cabecera que se miran (el resto se ignoran): una cabecera de un millón de columnas no debe costar nada. */
const MAX_HEADER_COLUMNS = 1000;

export interface CsvMapping {
  /** Índices de las columnas del archivo que alimentan cada campo. */
  columns: Partial<Record<Field, number[]>>;
}

/** Qué columna del archivo es cada campo (por la cabecera). Una cabecera repetida solo cuenta la primera vez. */
export function mapHeaders(header: string[]): CsvMapping {
  const first = new Map<string, number>();
  header.slice(0, MAX_HEADER_COLUMNS).forEach((h, i) => { const name = fold(h); if (!first.has(name)) first.set(name, i); });
  const columns: Partial<Record<Field, number[]>> = {};
  const used = new Set<number>();
  for (const field of Object.keys(HEADERS) as Field[]) {
    const found: number[] = [];
    for (const name of HEADERS[field]) {
      const i = first.get(name);
      if (i === undefined || used.has(i)) continue;
      found.push(i);
      if (!MULTI.includes(field)) break;
    }
    if (found.length) { columns[field] = found; found.forEach((i) => used.add(i)); }
  }
  return { columns };
}

const PRIORITIES: Record<string, TaskPriorityValue> = {
  urgente: "URGENTE", urgent: "URGENTE", critical: "URGENTE", critica: "URGENTE", blocker: "URGENTE", bloqueante: "URGENTE", highest: "URGENTE", p0: "URGENTE", "3": "URGENTE", maxima: "URGENTE",
  alta: "ALTA", high: "ALTA", major: "ALTA", mayor: "ALTA", p1: "ALTA", "2": "ALTA",
  media: "MEDIA", medium: "MEDIA", normal: "MEDIA", moderate: "MEDIA", p2: "MEDIA", "1": "MEDIA",
  baja: "BAJA", low: "BAJA", minor: "BAJA", menor: "BAJA", lowest: "BAJA", trivial: "BAJA", p3: "BAJA", p4: "BAJA", "0": "BAJA", minima: "BAJA",
};

const TRUE_RE = /^(true|yes|si|sí|y|s|1|x|verdadero)$/i;
const isTruthy = (v: string) => { const s = v.trim(); return s !== "" && !/^(false|no|n|0|falso)$/i.test(s); };

/** Carácter que nunca va en un email: espacios, «@» y de control (un NUL rompe la consulta a la base de datos). */
const NOT_MAIL = "\\s@\\u0000-\\u001f\\u007f";
const EMAIL_RE = new RegExp(`^[^${NOT_MAIL}]+@[^${NOT_MAIL}]+\\.[^${NOT_MAIL}]+$`);
const ANGLE_RE = new RegExp(`^(.*?)\\s*<([^<>${NOT_MAIL}]+@[^<>\\s\\u0000-\\u001f\\u007f]+)>$`);
/** Personas que se leen de una celda como máximo (solo se usa una; el resto va a la descripción). */
const MAX_PEOPLE = 20;

/** Personas de una celda: «Ana, Luis», «ana@example.com», «Ana <ana@example.com>». */
function people(cell: string, emailCell: string): ForeignPerson[] {
  const out: ForeignPerson[] = [];
  const push = (email: string | null, name: string | null) => {
    if (!email && !name) return;
    if (out.some((p) => (email && p.email === email) || (!email && name && p.name?.toLowerCase() === name.toLowerCase()))) return;
    out.push({ email, name });
  };
  for (const raw of cell.split(/[;,\n]/)) {
    if (out.length >= MAX_PEOPLE) break;
    const part = raw.trim();
    if (!part) continue;
    const angle = part.length < 400 ? ANGLE_RE.exec(part) : null;
    if (angle) push(angle[2]!.toLowerCase(), cleanName(angle[1]!, 80) || null);
    else if (part.length < 400 && EMAIL_RE.test(part)) push(part.toLowerCase(), null);
    else push(null, cleanName(part, 80) || null);
  }
  const emails = emailCell.split(/[;,\n\s]+/).slice(0, MAX_PEOPLE).map((e) => e.trim().toLowerCase()).filter((e) => e.length < 400 && EMAIL_RE.test(e));
  // Un email suelto junto a un nombre suelto son la misma persona.
  if (emails.length && out.length === 1 && !out[0]!.email && emails.length === 1) out[0] = { email: emails[0]!, name: out[0]!.name };
  else for (const e of emails) push(e, null);
  return out;
}

export interface CsvOptions {
  t: T;
  timeZone?: string;
  /** Nombre del archivo sin extensión: nombre del proyecto. */
  fileName?: string;
}

const NO_TITLE_COLUMN = "El CSV no tiene una columna de título reconocible (título, title, name, summary…). Revisa la cabecera de la primera fila.";

/** Comprobación barata de la subida: con los primeros bytes del archivo basta para ver si hay una cabecera con título. */
export function assertCsvHeader(head: string): void {
  const first = parseCsv(head)[0];
  if (!first || !mapHeaders(first).columns.title) throw new AppError(NO_TITLE_COLUMN);
}

export function parseCsvBoard(text: string, opts: CsvOptions): ForeignBoard {
  const { t } = opts;
  const rows = parseCsv(text, undefined, FOREIGN_LIMITS.csvRows + 1); // + la cabecera
  if (rows.length < 2) throw new AppError("El CSV no tiene filas de tareas (solo cabecera o está vacío).");
  const { columns } = mapHeaders(rows[0]!);
  if (!columns.title) throw new AppError(NO_TITLE_COLUMN);

  const cell = (row: string[], f: Field): string => (columns[f] ?? []).map((i) => row[i] ?? "").filter((s) => s.trim() !== "").join(f === "labels" || f === "assignee" ? ", " : " ");
  const warnings: string[] = [];
  const clipped = { n: 0 };
  let badDates = 0;
  let badPriorities = 0;
  let noTitle = 0;
  let extraLabels = 0;

  type Row = { title: string; row: string[]; parent: string; index: number };
  const data: Row[] = [];
  rows.slice(1).forEach((row, index) => {
    const title = cleanTitle(cell(row, "title"), undefined, clipped);
    if (!title) { noTitle++; return; }
    data.push({ title, row, parent: cleanTitle(cell(row, "parent")), index });
  });

  // Subtareas: una fila con «tarea madre» que coincide por título con otra fila de primer nivel.
  const topByTitle = new Map<string, number>();
  data.forEach((r, i) => { if (!r.parent && !topByTitle.has(fold(r.title))) topByTitle.set(fold(r.title), i); });
  const subOf = new Map<number, number>();
  data.forEach((r, i) => {
    if (!r.parent) return;
    const p = topByTitle.get(fold(r.parent));
    if (p !== undefined && p !== i) subOf.set(i, p);
  });

  // Columnas: estados distintos en el orden en que aparecen (sin contar las subtareas); las terminadas se pasan al final después.
  const columnNames: string[] = [];
  const columnIndex = new Map<string, number>();
  const hasColumn = !!columns.column;
  const columnFor = (row: string[]): number | null => {
    if (!hasColumn) return null;
    const name = cleanName(cell(row, "column"), FOREIGN_LIMITS.columnName);
    if (!name) return null;
    const key = fold(name);
    let i = columnIndex.get(key);
    if (i === undefined) { i = columnNames.length; columnIndex.set(key, i); columnNames.push(name); }
    return i;
  };

  const tasks: ForeignTask[] = [];
  const taskAt = new Map<number, ForeignTask>();
  const subtasks = new Map<number, { title: string; done: boolean }[]>();
  data.forEach((r, i) => {
    const { row } = r;
    const doneCell = cell(row, "completed");
    if (subOf.has(i)) {
      const list = subtasks.get(subOf.get(i)!) ?? [];
      list.push({ title: r.title, done: isTruthy(doneCell) });
      subtasks.set(subOf.get(i)!, list);
      return;
    }
    const extra: string[] = [];
    const key = cleanName(cell(row, "key"), 80);
    if (key) extra.push(`_${t("Referencia original: {key}", { key })}_`);
    if (r.parent) extra.push(`_${t("Subtarea de: {name}.", { name: r.parent })}_`);
    const description = cleanMarkdown([cell(row, "description"), ...extra].filter((s) => s.trim()).join("\n\n"), undefined, clipped);

    const labels: ForeignTask["labels"] = [];
    const seen = new Set<string>();
    for (const raw of cell(row, "labels").split(/[,;\n]/)) {
      const name = cleanName(raw, FOREIGN_LIMITS.labelName);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      if (labels.length >= FOREIGN_LIMITS.labelsPerTask) extraLabels++; else labels.push({ name, color: null });
    }

    let due: string | null = null;
    const dueCell = cell(row, "due");
    if (dueCell) { due = parseDay(dueCell, opts.timeZone); if (!due) badDates++; }

    let priority: TaskPriorityValue | null = null;
    const prCell = cell(row, "priority");
    if (prCell) { priority = PRIORITIES[fold(prCell)] ?? null; if (!priority) badPriorities++; }

    const task: ForeignTask = {
      title: r.title, description, column: columnFor(row), archived: columns.archived ? TRUE_RE.test(cell(row, "archived").trim()) : false,
      due, labels, subtasks: [], comments: [], priority, assignees: people(cell(row, "assignee"), cell(row, "assigneeEmail")),
    };
    taskAt.set(i, task);
    tasks.push(task);
  });
  let extraSubtasks = 0;
  for (const [i, list] of subtasks) {
    const task = taskAt.get(i)!;
    extraSubtasks += Math.max(0, list.length - FOREIGN_LIMITS.subtasksPerTask);
    task.subtasks = list.slice(0, FOREIGN_LIMITS.subtasksPerTask);
  }

  if (noTitle) warnings.push(t("{n} filas no tenían título y se han ignorado.", { n: noTitle }));
  if (clipped.n) warnings.push(t("{n} textos eran más largos de lo permitido y se han recortado.", { n: clipped.n }));
  if (badDates) warnings.push(t("{n} fechas límite no se pudieron interpretar y se han ignorado.", { n: badDates }));
  if (badPriorities) warnings.push(t("{n} prioridades no se reconocieron y se han ignorado.", { n: badPriorities }));
  if (extraLabels) warnings.push(t("{n} etiquetas de tareas sobraban (máximo {max} por tarea) y no se han importado.", { n: extraLabels, max: FOREIGN_LIMITS.labelsPerTask }));
  if (extraSubtasks) warnings.push(t("{n} subtareas sobraban (máximo {max} por tarea) y no se han importado.", { n: extraSubtasks, max: FOREIGN_LIMITS.subtasksPerTask }));
  if (!tasks.length) throw new AppError("El CSV no tiene ninguna fila con título.");

  // Las columnas que cuentan como terminadas («Hecho», «Done», «Cerrado»…) van al final; cada grupo conserva su orden.
  const done = columnNames.map(isDoneName);
  const order = [...columnNames.keys()].sort((a, b) => Number(done[a]) - Number(done[b]));
  const moved = new Map(order.map((old, i) => [old, i]));
  for (const task of tasks) if (task.column !== null) task.column = moved.get(task.column)!;

  return { name: cleanName(opts.fileName ?? "", 80) || "CSV", description: "", columns: order.map((i) => columnNames[i]!), tasks, warnings };
}
