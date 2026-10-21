// Cálculo del informe de estado de un proyecto. Funciones puras (sin BD) para poder testearlas.
import { makeT, type T } from "../i18n/core";
import { daysBetween } from "./dates";

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
    /** Última modificación (ISO): sin fecha de cierre, se usa para «terminadas recientemente». */
    updatedAt?: string;
  }[];
  deliverables: { id: string; name: string; description: string; dueDate: string | null }[];
  releases: { number: number; title: string; deployedAt: string; taskCount: number }[];
  archivedCount: number;
}

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
  };
  columns: { name: string; isDone: boolean; count: number; overdue: number; byType: { label: string; count: number }[]; tasks: ReportTask[] }[];
  deliverables: { name: string; description: string; dueDate: string | null; daysLeft: number | null; total: number; done: number; pct: number; status: DeliverableStatus }[];
  overdue: ReportTask[];
  upcoming: ReportTask[];
  people: { name: string; open: number; done: number; overdue: number }[];
  types: { label: string; open: number; done: number }[];
  /** Terminadas con actividad en los últimos 14 días (más recientes primero). */
  recentDone: ReportTask[];
  releases: ReportInput["releases"];
}

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

export function deliverableStatus(total: number, done: number, daysLeft: number | null): DeliverableStatus {
  if (total === 0) return "Sin tareas";
  if (done === total) return "Completado";
  if (daysLeft === null) return "Sin fecha";
  if (daysLeft < 0) return "Retrasado";
  if (daysLeft <= RISK_DAYS && pct(done, total) < 75) return "En riesgo";
  return "En plazo";
}

export function buildReport(input: ReportInput, tr: T = makeT("es")): Report {
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
  // Tipos configurados y, al final, cualquier otro que aparezca en las tareas.
  const kindNames = [...new Set([...input.kinds, ...input.tasks.map((t) => t.kind)])];
  const open = all.filter((t) => !t.done);
  const done = all.length - open.length;
  const overdue = open.filter((t) => t.daysLeft !== null && t.daysLeft < 0).sort((a, b) => a.daysLeft! - b.daysLeft!);
  const upcoming = open
    .filter((t) => t.daysLeft !== null && t.daysLeft >= 0 && t.daysLeft <= UPCOMING_DAYS)
    .sort((a, b) => a.daysLeft! - b.daysLeft!);

  const columns = input.columns.map((c) => {
    const tasks = input.tasks.filter((t) => t.columnId === c.id).map(toReportTask);
    return {
      name: c.name,
      isDone: c.isDone,
      count: tasks.length,
      overdue: tasks.filter((t) => !t.done && t.daysLeft !== null && t.daysLeft < 0).length,
      byType: kindNames.map((kind) => ({ label: kind, count: tasks.filter((t) => t.kind === kind).length })).filter((x) => x.count > 0),
      // Pendientes primero por plazo; sin plazo al final.
      tasks: tasks.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity)),
    };
  });

  const deliverables = input.deliverables.map((d) => {
    const tasks = input.tasks.filter((t) => t.deliverableId === d.id);
    const doneCount = tasks.filter(isDone).length;
    const daysLeft = d.dueDate ? daysBetween(today, d.dueDate) : null;
    return {
      name: d.name,
      description: d.description,
      dueDate: d.dueDate,
      daysLeft,
      total: tasks.length,
      done: doneCount,
      pct: pct(doneCount, tasks.length),
      status: deliverableStatus(tasks.length, doneCount, daysLeft),
    };
  });

  const peopleMap = new Map<string, { name: string; open: number; done: number; overdue: number }>();
  for (const t of all) {
    const name = t.assignee ?? tr("Sin asignar");
    const p = peopleMap.get(name) ?? { name, open: 0, done: 0, overdue: 0 };
    if (t.done) p.done++;
    else p.open++;
    if (!t.done && t.daysLeft !== null && t.daysLeft < 0) p.overdue++;
    peopleMap.set(name, p);
  }

  return {
    project: input.project,
    generatedBy: input.generatedBy,
    today,
    time: input.time ?? null,
    kpis: {
      total: all.length,
      done,
      open: open.length,
      progressPct: pct(done, all.length),
      overdue: overdue.length,
      dueSoon: open.filter((t) => t.daysLeft !== null && t.daysLeft >= 0 && t.daysLeft <= RISK_DAYS).length,
      unassignedOpen: open.filter((t) => !t.assignee).length,
      withoutDueOpen: open.filter((t) => !t.dueDate).length,
      archived: input.archivedCount,
    },
    columns,
    deliverables,
    overdue,
    upcoming,
    people: [...peopleMap.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
    types: kindNames.map((kind) => ({
      label: kind,
      open: open.filter((t) => t.kind === kind).length,
      done: all.filter((t) => t.done && t.kind === kind).length,
    })).filter((x) => x.open + x.done > 0),
    recentDone: input.tasks
      .filter((t) => isDone(t) && t.updatedAt && daysBetween(t.updatedAt.slice(0, 10), today) <= RECENT_DONE_DAYS)
      .sort((a, b) => b.updatedAt!.localeCompare(a.updatedAt!))
      .slice(0, RECENT_DONE_MAX)
      .map(toReportTask),
    releases: input.releases,
  };
}
