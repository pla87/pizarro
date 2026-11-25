// Columna «Asignación a persona»: reglas puras (sin base de datos), que usan el servidor, el tablero y las pruebas.
//
// No es un valor de ColumnRole (un valor de enum nuevo rompe la lectura en la versión anterior): la columna tiene rol NONE
// y la marcan dos campos, `assigneeId` (la persona) y `assignDueDays` (plazo opcional en días). Toda tarea que entra en
// ella pasa a la persona y, si la columna tiene plazo y la tarea no tiene fecha límite, vence hoy + N días. Elegir otro
// rol (o «Sin rol») quita los dos campos. Una plantilla de proyecto conserva el plazo pero no la persona: esa columna
// sigue siendo «Asignación a persona», sin persona hasta que se elija (y mientras, no asigna).
import type { T } from "@/i18n/shared";
import { addDaysIso, formatDay, isoWeekday } from "./dates";
import { FORM_LABEL_ONLY, withoutEmptyFormSections } from "./form-sections";
import { POSITION_STEP } from "./positions";

/** Plantilla cuyos proyectos ofrecen «Organizar por personas» (una columna «Asignación a persona» por cada una). */
export const PEOPLE_TEMPLATE = "casa-familia";

/**
 * Dónde van las columnas de «Organizar por personas» (`count`), dadas las del proyecto en su orden: justo antes de la
 * primera terminada (`isDone`, «Hecho») o, si no hay ninguna, al final; antes iban siempre detrás de «Hecho». Se renumeran
 * todas de POSITION_STEP en POSITION_STEP (como al mover una columna): `positions`, las de las nuevas en orden; `moved`,
 * las existentes que cambian de posición (con la de antes, para el deshacer).
 */
export function personColumnSlots(
  columns: readonly { id: string; position: number; isDone: boolean }[], count: number,
): { positions: number[]; moved: { id: string; position: number; before: number }[] } {
  const at = columns.findIndex((c) => c.isDone);
  const cut = at < 0 ? columns.length : at;
  const positions = Array.from({ length: count }, (_, i) => (cut + i + 1) * POSITION_STEP);
  const moved: { id: string; position: number; before: number }[] = [];
  columns.forEach((c, i) => {
    const position = (i < cut ? i + 1 : i + 1 + count) * POSITION_STEP;
    if (position !== c.position) moved.push({ id: c.id, position, before: c.position });
  });
  return { positions, moved };
}

/** Como mucho, cuántos nombres dice el aviso de «Organizar por personas» (luego, «y N más»). */
const NOTICE_NAMES = 4;

/** Aviso tras «Organizar por personas»: «2 columnas creadas: Ana y Luis» (con muchas, «… Ana, Bea, Carlos, Dani y 2 más»). */
export function personColumnsNotice(names: readonly string[], t: T, locale: string): string {
  const shown = names.length > NOTICE_NAMES ? [...names.slice(0, NOTICE_NAMES), t("{n} más", { n: names.length - NOTICE_NAMES })] : names;
  const list = new Intl.ListFormat(locale, { type: "conjunction" }).format(shown);
  return names.length === 1 ? t("1 columna creada: {names}", { names: list }) : t("{n} columnas creadas: {names}", { n: names.length, names: list });
}

/** Plazo máximo de «Vence en N días». */
export const MAX_ASSIGN_DUE_DAYS = 365;

/**
 * ¿Es una columna «Asignación a persona» (con persona o, venida de una plantilla, solo con el plazo)? Solo con rol NONE:
 * la versión anterior no conoce estos campos y, si allí se le da otro rol, la columna los conserva; de vuelta aquí se
 * comporta como la de su rol (y elegir «Sin rol» o «Asignación a persona» los limpia o los sustituye).
 */
export function isAssignColumn(c: { role: string; assigneeId?: string | null; assignDueDays?: number | null }): boolean {
  return c.role === "NONE" && (c.assigneeId != null || c.assignDueDays != null);
}

/** ¿Vale como plazo? Entero de 1 a MAX_ASSIGN_DUE_DAYS. */
export function isValidAssignDays(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_ASSIGN_DUE_DAYS;
}

/** Texto del campo «Vence en N días»: vacío = sin plazo (null); un plazo válido; undefined si no vale. */
export function parseAssignDays(raw: string): number | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return isValidAssignDays(n) ? n : undefined;
}

/**
 * Fecha límite (YYYY-MM-DD) que recibe una tarea al entrar: la suya si ya tiene; si no, hoy + `days` (con plazo) o
 * ninguna (sin plazo). `today` es el día de hoy en la zona de la app.
 */
export function assignedDueDate(current: string | null, days: number | null | undefined, today: string): string | null {
  if (current) return current;
  return days ? addDaysIso(today, days) : null;
}

/**
 * Texto del aviso del tablero tras entrar tarjetas en una columna «Asignación a persona» (`null` si no se asignó ninguna). `moved`:
 * cuántas se movieron; si son más que las asignadas (algunas ya eran de esa persona y tenían fecha), el aviso dice las dos
 * cosas («5 tareas movidas · 2 asignadas a Ana»; lo enseña showAssignedNotice, assignNotice.ts): con solo las asignadas parecía que las demás no se habían movido.
 */
export function assignedNoticeText(assigned: readonly { assigneeId: string; dueDate: string | null }[], moved: number, ctx: { users: readonly { id: string; name: string }[]; today: string; locale: string; t: T }): string | null {
  const first = assigned[0];
  if (!first) return null;
  const { t } = ctx;
  const name = ctx.users.find((u) => u.id === first.assigneeId)?.name ?? "?";
  if (moved > assigned.length) {
    return assigned.length === 1
      ? t("{n} tareas movidas · 1 asignada a {name}", { n: moved, name })
      : t("{n} tareas movidas · {k} asignadas a {name}", { n: moved, k: assigned.length, name });
  }
  return assigned.length > 1
    ? t("{n} tareas asignadas a {name}", { n: assigned.length, name })
    : first.dueDate
      ? t("Asignada a {name} · vence el {date}", { name, date: formatDay(first.dueDate, ctx.today, ctx.locale) })
      : t("Asignada a {name}", { name });
}

/** Grupo del plan: vencidas, hoy, esta semana, este mes, más adelante y sin fecha (en ese orden). */
type AssignPlanBucket = "overdue" | "today" | "week" | "month" | "later" | "none";
const ASSIGN_PLAN_BUCKETS: readonly AssignPlanBucket[] = ["overdue", "today", "week", "month", "later", "none"];

/** Encabezado de cada grupo (clave de traducción). */
export const ASSIGN_PLAN_LABEL: Record<AssignPlanBucket, string> = {
  overdue: "Vencidas",
  today: "Hoy",
  week: "Esta semana",
  month: "Este mes",
  later: "Más adelante",
  none: "Sin fecha",
};

/**
 * Último día de «Esta semana» y de «Este mes» desde `today`. La semana empieza en `weekStart` (1 = lunes, 7 = domingo;
 * la de la cuadrícula del calendario en el idioma de quien lee: calendarWeekStart). «Este mes» es lo que queda del mes
 * después de esta semana: si la semana ya llega al mes siguiente, el mes no añade nada.
 */
export function assignPlanBounds(today: string, weekStart: number): { weekEnd: string; monthEnd: string } {
  const offset = (isoWeekday(today) - weekStart + 7) % 7;
  const weekEnd = addDaysIso(today, 6 - offset);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { weekEnd, monthEnd };
}

/** Grupo de una fecha límite (YYYY-MM-DD o null). */
function assignPlanBucket(due: string | null, today: string, bounds: { weekEnd: string; monthEnd: string }): AssignPlanBucket {
  if (!due) return "none";
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= bounds.weekEnd) return "week";
  if (due <= bounds.monthEnd) return "month";
  return "later";
}

/**
 * Tareas del plan agrupadas (solo los grupos con alguna), cada grupo ordenado por fecha límite y, a igual fecha, en el
 * orden en que llegan (el de la columna). Los grupos vacíos no salen.
 */
export function buildAssignPlan<T extends { dueDate: string | null }>(tasks: readonly T[], today: string, weekStart: number): { bucket: AssignPlanBucket; tasks: T[] }[] {
  const bounds = assignPlanBounds(today, weekStart);
  const groups = new Map<AssignPlanBucket, T[]>(ASSIGN_PLAN_BUCKETS.map((b) => [b, []]));
  for (const task of tasks) groups.get(assignPlanBucket(task.dueDate, today, bounds))!.push(task);
  return ASSIGN_PLAN_BUCKETS.flatMap((bucket) => {
    // sort es estable: a igual fecha se conserva el orden de la columna.
    const list = groups.get(bucket)!.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    return list.length ? [{ bucket, tasks: list }] : [];
  });
}

/** Líneas y caracteres del resumen de la descripción que lleva cada tarea del plan. */
const PLAN_SUMMARY_LINES = 6;
const PLAN_SUMMARY_CHARS = 400;
/** De cada descripción solo se lee (y se procesa) su comienzo: el resumen nunca llega más lejos. */
export const PLAN_DESCRIPTION_READ = 4000;

/** Una línea de Markdown en texto: sin imágenes, enlaces (su texto), marcas de título, cita o lista, ni negritas. */
function plainLine(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const clip = (line: string, max: number) => (line.length > max ? `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…` : line);

/**
 * Resumen de una descripción en Markdown para el plan: las líneas con texto, sin marcas de formato y sin los apartados del
 * formulario del tipo que siguen vacíos (withoutEmptyFormSections, el mismo filtro que el plan para IA). Una etiqueta
 * sola en su línea («**Quién:**») se une a su respuesta («Quién: Ana»). Los bloques de código (de ``` o ~~~ a la línea que
 * los cierra) se saltan enteros. Como mucho `maxLines` líneas y `maxChars` caracteres en total; si queda algo fuera, la
 * última acaba en «…».
 */
export function descriptionSummary(markdown: string, maxLines = PLAN_SUMMARY_LINES, maxChars = PLAN_SUMMARY_CHARS): string[] {
  const out: string[] = [];
  let used = 0;
  let cut = false;
  /** Etiqueta sola pendiente de su respuesta. */
  let label: string | null = null;
  const push = (line: string): boolean => {
    if (out.length >= maxLines || used >= maxChars) return !(cut = true);
    const room = maxChars - used;
    const text = clip(line, room);
    if (text !== line) cut = true;
    out.push(text);
    used += text.length;
    return true;
  };
  /** Valla del bloque de código abierto («```», «~~~~»…) o null fuera de uno. */
  let fence: string | null = null;
  for (const raw of withoutEmptyFormSections(markdown.split(/\r?\n/))) {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(raw)?.[1];
    if (fence) {
      // Lo cierra una valla del mismo carácter y al menos igual de larga, sin nada detrás.
      if (mark && mark[0] === fence[0] && mark.length >= fence.length && !raw.trim().slice(mark.length).trim()) fence = null;
      continue;
    }
    if (mark && !(mark[0] === "`" && raw.trim().slice(mark.length).includes("`"))) {
      fence = mark;
      continue;
    }
    const line = plainLine(raw);
    if (!line || /^(-{3,}|={3,})$/.test(line)) continue;
    if (FORM_LABEL_ONLY.test(raw.trim())) {
      if (label !== null && !push(label)) break;
      label = line;
      continue;
    }
    if (!push(label !== null ? `${label} ${line}` : line)) break;
    label = null;
  }
  if (label !== null && !cut) push(label);
  if (cut && out.length && !out.at(-1)!.endsWith("…")) out[out.length - 1] = `${out.at(-1)!}…`;
  return out;
}

/** Subtareas pendientes que el plan lista por tarea; las demás, en una línea «y N más». */
export const PLAN_SUBTASKS_SHOWN = 15;

/** Tarea tal como sale en el PDF del plan. */
export interface AssignPlanTask {
  title: string;
  kind: string;
  /** Clave de PRIORITY_LABEL (BAJA, MEDIA…) o null (sin prioridad, o el proyecto no usa el campo). */
  priority: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  /** Resumen de la descripción (descriptionSummary): líneas con texto, sin los apartados vacíos; vacío si no tiene. */
  summary: string[];
  /** Nombres de las etiquetas de la tarea («Urgente»…), en orden alfabético. */
  labels: string[];
  /** Títulos de las primeras PLAN_SUBTASKS_SHOWN subtareas sin marcar, en su orden (solo se leen esas). */
  pendingSubtasks: string[];
  /** Cuántas subtareas sin marcar tiene en total (las que no salen van en una línea «y N más»). */
  pendingCount: number;
}

/** Datos del PDF «Plan de <persona>» (los prepara report-build.ts; los pinta el worker). */
export interface AssignPlanPdfInput {
  project: string;
  column: string;
  person: string;
  today: string;
  /** Grupos ya hechos (buildAssignPlan): el worker solo los pinta. */
  groups: { bucket: AssignPlanBucket; tasks: AssignPlanTask[] }[];
  /** Tarjetas de la columna que son de otras personas (no salen en el plan). */
  others: number;
}
