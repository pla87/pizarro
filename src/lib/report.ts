// Cálculo del informe de estado de un proyecto. Funciones puras (sin BD) para poder testearlas.
import { esT, type T } from "../i18n/shared";
import { daysBetween, isoInZone } from "./dates";
import { centsToAmount, sumCents, type TaskFieldKey, type TaskFieldValues } from "./task-fields";
import { deliverableProgress, type DeliverableProgress } from "./deliverable-progress";

export const UPCOMING_DAYS = 14;
const RISK_DAYS = 7;
/** Ventana de «terminadas recientemente». */
export const RECENT_DONE_DAYS = 14;
const RECENT_DONE_MAX = 15;

export interface ReportInput {
  project: { name: string; description: string };
  generatedBy: string;
  today: string;
  /** Hora de generación (HH:mm, zona de la app). */
  time?: string;
  /** Zona horaria de la app: los instantes de cierre se pasan a día natural en ella (por defecto UTC). */
  timeZone?: string;
  columns: { id: string; name: string; isDone: boolean }[];
  /** Nombres de los tipos de tarea, en su orden. */
  kinds: string[];
  tasks: {
    id: string;
    title: string;
    kind: string;
    columnId: string;
    assigneeName: string | null;
    dueDate: string | null;
    deliverableId: string | null;
    subtaskTotal: number;
    subtaskDone: number;
    /** Última modificación (ISO): para «terminadas recientemente» solo si no hay `doneAt`. */
    updatedAt?: string;
    /** Última vez que pasó a una columna terminada (ISO), según el historial de la tarea. */
    doneAt?: string | null;
    /** Valores de los campos opcionales (si el proyecto los usa). */
    fields?: TaskFieldValues;
    /**
     * Tarea fija («Siempre en la release» o en el plan para IA): nunca se termina, así que no cuenta en el avance ni en
     * las pendientes; el informe solo dice cuántas hay (`kpis.fixed`).
     */
    evergreen?: boolean;
  }[];
  /**
   * `progress`: total y hechas contadas en la BD (deliverableProgressByIds), con las archivadas, que no están en `tasks`.
   * Sin él, se cuentan las de `tasks` con el mismo criterio (deliverableProgress).
   */
  deliverables: { id: string; name: string; description: string; dueDate: string | null; progress?: DeliverableProgress }[];
  releases: { number: number; title: string; deployedAt: string; taskCount: number }[];
  archivedCount: number;
  /** Campos opcionales que el proyecto tiene activados (el informe solo incluye esos). */
  taskFields?: TaskFieldKey[];
  /**
   * Recuentos de TODAS las tareas activas, hechos en la BD (`tasks` puede ser solo las primeras): de ellos salen el avance,
   * las vencidas, los totales por columna, tipo y persona. Sin ellos se cuentan las de `tasks` (countsFromTasks).
   */
  counts?: ReportCounts;
  /**
   * Máximo de tareas por listado (cada columna pendiente, plazos y campos opcionales), con «… y N más» y un enlace al
   * tablero (`boardUrl`) debajo. Lo usa el informe semanal por email (WEEKLY_REPORT_LIST_LIMIT): en un proyecto enorme,
   * un PDF de cientos de páginas no lo lee nadie y pesa en el buzón. Sin él (la descarga desde la app), salen todas.
   */
  listLimit?: number;
  boardUrl?: string;
}

/** Tareas por listado del informe semanal por email (ver ReportInput.listLimit). */
export const WEEKLY_REPORT_LIST_LIMIT = 15;

/**
 * Tareas activas (no archivadas ni fijas) de una misma columna, responsable y tipo: cuántas son y cuántas vencidas
 * (plazo antes de hoy), con plazo en los próximos 7 días (hoy incluido) y sin plazo.
 */
interface ReportCountRow {
  columnId: string;
  assigneeName: string | null;
  kind: string;
  count: number;
  overdue: number;
  dueSoon: number;
  withoutDue: number;
}

export interface ReportCounts {
  rows: ReportCountRow[];
  /** Tareas fijas activas. */
  fixed: number;
}

/** Una tarea con algún campo opcional relleno, para la tabla «Campos opcionales» del informe. */
export interface ReportFieldRow {
  title: string;
  column: string;
  priority: TaskFieldValues["priority"];
  client: string | null;
  startDate: string | null;
  dueDate: string | null;
  cost: string | null;
  costPaid: boolean;
  estimatedHours: string | null;
  actualHours: string | null;
}

interface ReportFields {
  enabled: TaskFieldKey[];
  rows: ReportFieldRow[];
  /** Coste de las tareas: pagado, pendiente y total (decimales «12.50»); horas sumadas. */
  totals: { cost: string; paid: string; pending: string; estimatedHours: string; actualHours: string };
}

/** Máximo de filas de la tabla de campos opcionales del PDF. */
const MAX_FIELD_ROWS = 300;

export type DeliverableStatus = "Completado" | "Retrasado" | "En riesgo" | "En plazo" | "Sin fecha" | "Sin tareas";

export interface ReportTask {
  title: string;
  kind: string;
  column: string;
  assignee: string | null;
  dueDate: string | null;
  daysLeft: number | null;
  checklist: string | null;
  done: boolean;
}

export interface Report {
  project: ReportInput["project"];
  generatedBy: string;
  today: string;
  time: string | null;
  kpis: {
    total: number;
    done: number;
    open: number;
    progressPct: number;
    overdue: number;
    dueSoon: number;
    unassignedOpen: number;
    withoutDueOpen: number;
    archived: number;
    /** Tareas fijas (fuera de todos los recuentos anteriores). */
    fixed: number;
  };
  /** `more`: tareas de la columna que no salen en `tasks` (por `listLimit`; 0 sin él). */
  columns: { name: string; isDone: boolean; count: number; overdue: number; byType: { label: string; count: number }[]; tasks: ReportTask[]; more: number }[];
  deliverables: { name: string; description: string; dueDate: string | null; daysLeft: number | null; total: number; done: number; pct: number; status: DeliverableStatus }[];
  overdue: ReportTask[];
  upcoming: ReportTask[];
  people: { name: string; open: number; done: number; overdue: number }[];
  types: { label: string; open: number; done: number }[];
  /** Terminadas con actividad en los últimos 14 días (más recientes primero). */
  recentDone: ReportTask[];
  releases: ReportInput["releases"];
  /** null si el proyecto no tiene ningún campo opcional activado. */
  fields: ReportFields | null;
  /**
   * Tareas activas que no salen en los listados (el informe lee como mucho las primeras REPORT_MAX_TASKS; los recuentos
   * sí son de todas). 0 si salen todas.
   */
  omittedTasks: number;
  /** Tope de tareas por listado (ReportInput.listLimit), o null si salen todas. */
  listLimit: number | null;
  boardUrl: string | null;
  /** Lo que el tope deja fuera de los plazos (vencidas y próximas) y de los campos opcionales. */
  more: { planned: number; fields: number };
}

/** Máximo de tareas que lee el informe para sus listados (los recuentos se hacen en la BD sobre todas). */
export const REPORT_MAX_TASKS = 2000;

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

export function deliverableStatus(total: number, done: number, daysLeft: number | null): DeliverableStatus {
  if (total === 0) return "Sin tareas";
  if (done === total) return "Completado";
  if (daysLeft === null) return "Sin fecha";
  if (daysLeft < 0) return "Retrasado";
  if (daysLeft <= RISK_DAYS && pct(done, total) < 75) return "En riesgo";
  return "En plazo";
}

/** Recuentos a partir de las tareas recibidas (cuando no llegan hechos en la BD). */
function countsFromTasks(tasks: ReportInput["tasks"], today: string): ReportCounts {
  const rows = new Map<string, ReportCountRow>();
  let fixed = 0;
  for (const t of tasks) {
    if (t.evergreen) {
      fixed++;
      continue;
    }
    const key = JSON.stringify([t.columnId, t.assigneeName, t.kind]);
    const row = rows.get(key) ?? { columnId: t.columnId, assigneeName: t.assigneeName, kind: t.kind, count: 0, overdue: 0, dueSoon: 0, withoutDue: 0 };
    const daysLeft = t.dueDate ? daysBetween(today, t.dueDate) : null;
    row.count++;
    if (daysLeft === null) row.withoutDue++;
    else if (daysLeft < 0) row.overdue++;
    else if (daysLeft <= RISK_DAYS) row.dueSoon++;
    rows.set(key, row);
  }
  return { rows: [...rows.values()], fixed };
}

export function buildReport(fullInput: ReportInput, tr: T = esT): Report {
  // Las tareas fijas no son trabajo pendiente (no se terminan nunca): fuera del avance, las pendientes, los plazos, las
  // columnas, los entregables y las personas. Los campos opcionales (coste, horas) sí las incluyen.
  const fixed = fullInput.tasks.filter((t) => t.evergreen).length;
  const input = fixed ? { ...fullInput, tasks: fullInput.tasks.filter((t) => !t.evergreen) } : fullInput;
  const { today } = input;
  const columnById = new Map(input.columns.map((c) => [c.id, c]));
  const isDone = (t: ReportInput["tasks"][number]) => columnById.get(t.columnId)?.isDone ?? false;

  const toReportTask = (t: ReportInput["tasks"][number]): ReportTask => ({
    title: t.title,
    kind: t.kind,
    column: columnById.get(t.columnId)?.name ?? "—",
    assignee: t.assigneeName,
    dueDate: t.dueDate,
    daysLeft: t.dueDate ? daysBetween(today, t.dueDate) : null,
    checklist: t.subtaskTotal ? `${t.subtaskDone}/${t.subtaskTotal}` : null,
    done: isDone(t),
  });

  const all = input.tasks.map(toReportTask);
  const counts = fullInput.counts ?? countsFromTasks(fullInput.tasks, today);
  const rowDone = (r: ReportCountRow) => columnById.get(r.columnId)?.isDone ?? false;
  const sum = (rows: ReportCountRow[], pick: (r: ReportCountRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const openRows = counts.rows.filter((r) => !rowDone(r));
  // Tipos configurados y, al final, cualquier otro que aparezca en las tareas.
  const kindNames = [...new Set([...input.kinds, ...counts.rows.map((r) => r.kind), ...input.tasks.map((t) => t.kind)])];
  const open = all.filter((t) => !t.done);
  const total = sum(counts.rows, (r) => r.count);
  const openCount = sum(openRows, (r) => r.count);
  const done = total - openCount;
  const overdue = open.filter((t) => t.daysLeft !== null && t.daysLeft < 0).sort((a, b) => a.daysLeft! - b.daysLeft!);
  const upcoming = open
    .filter((t) => t.daysLeft !== null && t.daysLeft >= 0 && t.daysLeft <= UPCOMING_DAYS)
    .sort((a, b) => a.daysLeft! - b.daysLeft!);

  const limit = fullInput.listLimit ?? Infinity;
  const columns = input.columns.map((c) => {
    const tasks = input.tasks.filter((t) => t.columnId === c.id).map(toReportTask);
    const rows = counts.rows.filter((r) => r.columnId === c.id);
    const count = sum(rows, (r) => r.count);
    // Pendientes primero por plazo; sin plazo al final. Con tope, las primeras: las más urgentes.
    const shown = tasks.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity)).slice(0, limit);
    return {
      name: c.name,
      isDone: c.isDone,
      count,
      overdue: c.isDone ? 0 : sum(rows, (r) => r.overdue),
      byType: kindNames.map((kind) => ({ label: kind, count: sum(rows.filter((r) => r.kind === kind), (r) => r.count) })).filter((x) => x.count > 0),
      tasks: shown,
      // Las que no salen, contadas sobre todas (también las que el informe no lee, más allá de REPORT_MAX_TASKS).
      more: Number.isFinite(limit) ? Math.max(0, count - shown.length) : 0,
    };
  });
  // Plazos: las vencidas primero y luego las próximas, hasta el tope entre las dos.
  const overdueShown = overdue.slice(0, limit);
  const upcomingShown = upcoming.slice(0, Math.max(0, limit - overdueShown.length));
  const fields = buildReportFields(fullInput, columnById);
  const fieldRows = fields ? fields.rows.slice(0, limit) : [];

  // Mismo criterio que el calendario: las archivadas cuentan como hechas y las fijas no cuentan (deliverableProgress).
  const deliverables = input.deliverables.map((d) => {
    const { total, done: doneCount } = d.progress ?? deliverableProgress(
      fullInput.tasks.filter((t) => t.deliverableId === d.id).map((t) => ({ evergreen: !!t.evergreen, archived: false, inDoneColumn: isDone(t) })),
    );
    const daysLeft = d.dueDate ? daysBetween(today, d.dueDate) : null;
    return {
      name: d.name,
      description: d.description,
      dueDate: d.dueDate,
      daysLeft,
      total,
      done: doneCount,
      pct: pct(doneCount, total),
      status: deliverableStatus(total, doneCount, daysLeft),
    };
  });

  const peopleMap = new Map<string, { name: string; open: number; done: number; overdue: number }>();
  for (const r of counts.rows) {
    const name = r.assigneeName ?? tr("Sin responsable");
    const p = peopleMap.get(name) ?? { name, open: 0, done: 0, overdue: 0 };
    if (rowDone(r)) p.done += r.count;
    else {
      p.open += r.count;
      p.overdue += r.overdue;
    }
    peopleMap.set(name, p);
  }

  return {
    project: input.project,
    generatedBy: input.generatedBy,
    today,
    time: input.time ?? null,
    kpis: {
      total,
      done,
      open: openCount,
      progressPct: pct(done, total),
      overdue: sum(openRows, (r) => r.overdue),
      dueSoon: sum(openRows, (r) => r.dueSoon),
      unassignedOpen: sum(openRows.filter((r) => !r.assigneeName), (r) => r.count),
      withoutDueOpen: sum(openRows, (r) => r.withoutDue),
      archived: input.archivedCount,
      fixed: counts.fixed,
    },
    columns,
    deliverables,
    overdue: overdueShown,
    upcoming: upcomingShown,
    people: [...peopleMap.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
    types: kindNames.map((kind) => {
      const rows = counts.rows.filter((r) => r.kind === kind);
      const openN = sum(rows.filter((r) => !rowDone(r)), (r) => r.count);
      return { label: kind, open: openN, done: sum(rows, (r) => r.count) - openN };
    }).filter((x) => x.open + x.done > 0),
    recentDone: input.tasks
      // Fecha de cierre (historial); sin ella (p. ej. creada ya terminada), la última modificación.
      .map((t) => ({ t, at: t.doneAt ?? t.updatedAt }))
      .filter(({ t, at }) => isDone(t) && at && daysBetween(isoInZone(new Date(at), input.timeZone ?? "UTC"), today) <= RECENT_DONE_DAYS)
      .sort((a, b) => b.at!.localeCompare(a.at!))
      .slice(0, RECENT_DONE_MAX)
      .map(({ t }) => toReportTask(t)),
    releases: input.releases,
    fields: fields && { ...fields, rows: fieldRows },
    omittedTasks: fullInput.counts ? Math.max(0, total + counts.fixed - fullInput.tasks.length) : 0,
    listLimit: Number.isFinite(limit) ? limit : null,
    boardUrl: fullInput.boardUrl ?? null,
    more: {
      planned: overdue.length + upcoming.length - overdueShown.length - upcomingShown.length,
      fields: fields ? fields.rows.length - fieldRows.length : 0,
    },
  };
}

/** Campos opcionales activados: totales de coste y horas y las tareas que tienen algún valor. */
function buildReportFields(input: ReportInput, columnById: Map<string, { name: string }>): ReportFields | null {
  const enabled = input.taskFields ?? [];
  if (!enabled.length) return null;
  const with_ = input.tasks.filter((t) => t.fields);
  const has = (k: TaskFieldKey) => enabled.includes(k);
  const costOf = (t: (typeof with_)[number]) => (has("cost") ? t.fields!.cost : null);
  const total = sumCents(with_.map(costOf));
  const paid = sumCents(with_.filter((t) => t.fields!.costPaid).map(costOf));
  const hours = (pick: "estimatedHours" | "actualHours") => (has("hours") ? sumCents(with_.map((t) => t.fields![pick])) : 0);
  const rows = with_
    .map((t) => {
      const f = t.fields!;
      return {
        title: t.title,
        column: columnById.get(t.columnId)?.name ?? "—",
        priority: has("priority") ? f.priority : null,
        client: has("client") ? f.client : null,
        startDate: has("startDate") ? f.startDate : null,
        dueDate: t.dueDate,
        cost: costOf(t),
        costPaid: has("cost") && f.costPaid,
        estimatedHours: has("hours") ? f.estimatedHours : null,
        actualHours: has("hours") ? f.actualHours : null,
      };
    })
    .filter((r) => r.priority || r.client || r.startDate || r.cost !== null || r.estimatedHours !== null || r.actualHours !== null)
    .slice(0, MAX_FIELD_ROWS);
  return {
    enabled,
    rows,
    totals: { cost: centsToAmount(total), paid: centsToAmount(paid), pending: centsToAmount(total - paid), estimatedHours: centsToAmount(hours("estimatedHours")), actualHours: centsToAmount(hours("actualHours")) },
  };
}
