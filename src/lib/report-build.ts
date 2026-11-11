import "server-only";
import { intlLocale, type Locale, makeT } from "../i18n/core";
import { appTimeZone, listKinds } from "./board";
import { localizeGeneralKind, localizeGeneralKinds } from "./kinds-localize";
import { dateToIso, todayIso } from "./dates";
import { normalizeTaskFields } from "./task-fields";
import { db } from "./db";
import { AppError } from "./errors";
import { mentionsToPlain } from "./mentions";
import { buildReport, RECENT_DONE_DAYS } from "./report";
import type { PdfJob } from "./report-pdf";
import { renderInWorker } from "./report-render";
import { groupChecklist, type ChecklistGroupBy } from "./checklist";
import { loadChecklistItems } from "./column-views";
import { buildWeekPlan, type WeekPlanGroupBy } from "./week-plan";

// Genera el informe PDF de un proyecto. Lo usan la descarga (API) y el envío semanal por email;
// quien llama comprueba antes que la persona puede ver el proyecto.

export interface ProjectReportPdf {
  project: { id: string; name: string };
  pdf: Uint8Array;
  today: string;
  /** informe-nombre-del-proyecto-2026-10-23.pdf */
  filename: string;
  taskCount: number;
}

// El render del PDF (@react-pdf/renderer) se hace en un worker_thread aparte (report-render.ts): aquí se cargan los
// datos y se comprueba el acceso, y al worker solo le llega un objeto serializable. Así un informe de miles de tareas
// no frena el tablero, el canal en vivo ni las subidas. Se generan de uno en uno (en cola) para no ocupar más de un
// núcleo ni más memoria de la cuenta aunque se pidan varios a la vez; solo el render ocupa turno. Un render atascado
// no bloquea la cola para siempre: a los 90 s se termina el worker (deja de gastar CPU), queda libre el turno y quien
// lo pidió recibe un error claro.
let reportQueue: Promise<unknown> = Promise.resolve();

export const PDF_RENDER_TIMEOUT_MS = 90_000;
export const PDF_TIMEOUT_MESSAGE = "El PDF tardó demasiado; inténtalo de nuevo";

/** Error de un render que superó el tiempo máximo (504 para las rutas). */
export class PdfTimeoutError extends AppError {
  constructor() {
    super(PDF_TIMEOUT_MESSAGE, 504, "pdf_timeout");
  }
}

/** Con tantos renders ya esperando turno, los nuevos se rechazan al instante (503) en vez de apilarse sin fin. */
export const PDF_MAX_WAITING = 5;
export const PDF_BUSY_MESSAGE = "Hay muchos PDF generándose; inténtalo en un momento.";
let waitingRenders = 0;

/** Errores esperables de la cola (tiempo agotado 504, cola llena 503): las rutas los traducen y devuelven con su estado. */
export function isPdfQueueError(err: unknown): err is AppError {
  return err instanceof PdfTimeoutError || (err instanceof AppError && err.code === "pdf_busy");
}

/**
 * Ejecuta un render en la cola (de uno en uno) con tiempo máximo; `timeoutMs` es inyectable para los tests. Al
 * agotarse se aborta `signal` (el worker se termina) y se rechaza con PdfTimeoutError.
 */
export function queuedRender<T>(render: (signal: AbortSignal) => Promise<T>, timeoutMs: number = PDF_RENDER_TIMEOUT_MS): Promise<T> {
  if (waitingRenders >= PDF_MAX_WAITING) return Promise.reject(new AppError(PDF_BUSY_MESSAGE, 503, "pdf_busy"));
  waitingRenders++;
  const run = reportQueue.then(
    () =>
      new Promise<T>((resolve, reject) => {
        waitingRenders--;
        const abort = new AbortController();
        const timer = setTimeout(() => {
          const err = new PdfTimeoutError();
          reject(err);
          abort.abort(err);
        }, timeoutMs);
        render(abort.signal).then(
          (v) => { clearTimeout(timer); resolve(v); },
          (e) => { clearTimeout(timer); reject(e); },
        );
      }),
  );
  reportQueue = run.catch(() => {});
  return run;
}

/** Genera un PDF en el worker, en la cola y con tiempo máximo. */
export const renderPdf = (job: PdfJob): Promise<Uint8Array> => queuedRender((signal) => renderInWorker(job, signal));

/**
 * Añade a cada release su número de tareas con un groupBy filtrado por sus ids (un `_count` de relación agruparía todas
 * las ReleaseTask del servidor: Prisma 7 lo hace con un LEFT JOIN a un GROUP BY sin filtro).
 */
async function withReleaseTaskCounts<R extends { id: string }>(releases: R[]): Promise<(R & { taskCount: number })[]> {
  const groups = releases.length
    ? await db.releaseTask.groupBy({ by: ["releaseId"], where: { releaseId: { in: releases.map((r) => r.id) } }, _count: { _all: true } })
    : [];
  const count = new Map(groups.map((g) => [g.releaseId, g._count._all]));
  return releases.map((r) => ({ ...r, taskCount: count.get(r.id) ?? 0 }));
}

export function generateProjectReportPdf(projectId: string, opts: { generatedBy: string; locale: Locale }): Promise<ProjectReportPdf | null> {
  return buildProjectReportPdf(projectId, opts);
}

async function buildProjectReportPdf(projectId: string, opts: { generatedBy: string; locale: Locale }): Promise<ProjectReportPdf | null> {
  const t = makeT(opts.locale);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, description: true, taskFields: true } });
  if (!project) return null;

  const [columns, tasks, deliverables, releases, archivedCount, kinds, [doneEvents, released]] = await Promise.all([
    db.column.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true } }),
    db.task.findMany({
      where: { projectId, archivedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: 2000,
      select: {
        id: true,
        title: true,
        kind: { select: { id: true, name: true } },
        columnId: true,
        dueDate: true,
        deliverableId: true,
        assignee: { select: { name: true } },
        updatedAt: true,
        subtasks: { select: { done: true } },
        cost: true, costPaid: true, estimatedHours: true, actualHours: true, priority: true, client: true, startDate: true,
      },
    }),
    db.deliverable.findMany({ where: { projectId }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { position: "asc" }], select: { id: true, name: true, description: true, dueDate: true } }),
    db.release.findMany({ where: { projectId }, orderBy: { deployedAt: "desc" }, take: 5, select: { id: true, number: true, title: true, deployedAt: true } }).then(withReleaseTaskCounts),
    db.task.count({ where: { projectId, archivedAt: { not: null } } }),
    listKinds(projectId),
    // Cuándo pasó cada tarea por última vez a una columna terminada: «terminadas recientemente» no depende de
    // la última edición (corregir una errata en una tarea cerrada hace meses no la vuelve reciente).
    // Cuenta también el despliegue en una release reciente (mueve a «En producción» sin dejar ese evento).
    Promise.all([
      db.taskEvent.groupBy({ by: ["taskId"], where: { projectId, code: "done", task: { archivedAt: null } }, _max: { createdAt: true } }),
      db.releaseTask.findMany({
        where: { taskId: { not: null }, release: { projectId, deployedAt: { gte: new Date(Date.now() - (RECENT_DONE_DAYS + 1) * 86_400_000) } } },
        select: { taskId: true, release: { select: { deployedAt: true } } },
      }),
    ]),
  ]);
  const doneAt = new Map<string, string>();
  const noteDone = (taskId: string | null, at: Date | null | undefined) => {
    const iso = at?.toISOString();
    if (taskId && iso && iso > (doneAt.get(taskId) ?? "")) doneAt.set(taskId, iso);
  };
  for (const e of doneEvents) noteDone(e.taskId, e._max.createdAt);
  for (const r of released) noteDone(r.taskId, r.release.deployedAt);

  const locale = intlLocale(opts.locale);
  const today = todayIso(appTimeZone());
  const report = buildReport({
    project: { name: project.name, description: project.description },
    generatedBy: opts.generatedBy,
    today,
    timeZone: appTimeZone(),
    time: new Intl.DateTimeFormat(locale, { timeZone: appTimeZone(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()),
    columns,
    kinds: localizeGeneralKinds(kinds, opts.locale).map((k) => k.name),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: mentionsToPlain(task.title),
      kind: localizeGeneralKind(task.kind, opts.locale).name,
      columnId: task.columnId,
      assigneeName: task.assignee?.name ?? null,
      dueDate: dateToIso(task.dueDate),
      deliverableId: task.deliverableId,
      subtaskTotal: task.subtasks.length,
      subtaskDone: task.subtasks.filter((x) => x.done).length,
      updatedAt: task.updatedAt.toISOString(),
      doneAt: doneAt.get(task.id) ?? null,
      fields: {
        cost: task.cost?.toFixed(2) ?? null, costPaid: task.costPaid, estimatedHours: task.estimatedHours?.toFixed(2) ?? null, actualHours: task.actualHours?.toFixed(2) ?? null,
        priority: task.priority, client: task.client, startDate: dateToIso(task.startDate),
      },
    })),
    deliverables: deliverables.map((d) => ({ ...d, dueDate: dateToIso(d.dueDate) })),
    releases: releases.map((r) => ({ number: r.number, title: r.title, deployedAt: r.deployedAt.toISOString(), taskCount: r.taskCount })),
    archivedCount,
    taskFields: normalizeTaskFields(project.taskFields),
  }, t);

  const pdf = await renderPdf({ kind: "report", locale: opts.locale, input: report });
  const slug = project.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || t("proyecto");
  return { project: { id: project.id, name: project.name }, pdf, today, filename: `${t("informe")}-${slug}-${today}.pdf`, taskCount: tasks.length };
}

const slugOf = (name: string, fallback: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || fallback;

/** PDF de la lista consolidada de una columna CHECKLIST (por tarjeta o por tipo de tarea). */
export function generateChecklistPdf(
  projectId: string, columnId: string, opts: { locale: Locale; by: ChecklistGroupBy },
): Promise<{ pdf: Uint8Array; filename: string; itemCount: number } | null> {
  return (async () => {
    const t = makeT(opts.locale);
    const data = await loadChecklistItems(projectId, columnId, opts.locale);
    if (!data) return null;
    const locale = intlLocale(opts.locale);
    const today = todayIso(appTimeZone());
    const groups = groupChecklist(data.items, opts.by, locale);
    const pdf = await renderPdf({ kind: "checklist", locale: opts.locale, input: { project: data.column.projectName, column: data.column.name, today, by: opts.by, groups } });
    return { pdf, filename: `${t("lista")}-${slugOf(data.column.name, t("columna"))}-${today}.pdf`, itemCount: data.items.length };
  })();
}

/** PDF «Resumen para el cliente» de una columna DELIVERY: sin comentarios, descripciones ni personas. */
export function generateDeliveryPdf(
  projectId: string, columnId: string, opts: { locale: Locale },
): Promise<{ pdf: Uint8Array; filename: string; taskCount: number } | null> {
  return (async () => {
    const t = makeT(opts.locale);
    const column = await db.column.findFirst({ where: { id: columnId, projectId, role: "DELIVERY" }, select: { name: true, project: { select: { name: true } } } });
    if (!column) return null;
    const tasks = await db.task.findMany({
      where: { projectId, columnId, archivedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: 2000,
      select: {
        title: true, dueDate: true, kind: { select: { id: true, name: true } },
        subtasks: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { title: true, done: true } },
      },
    });
    const today = todayIso(appTimeZone());
    const pdf = await renderPdf({ kind: "delivery", locale: opts.locale, input: {
      project: column.project.name, column: column.name, today,
      tasks: tasks.map((x) => ({
        title: mentionsToPlain(x.title, false), kind: localizeGeneralKind(x.kind, opts.locale).name, dueDate: dateToIso(x.dueDate),
        subtaskTotal: x.subtasks.length, doneSubtasks: x.subtasks.filter((s) => s.done).map((s) => mentionsToPlain(s.title, false)),
      })),
    } });
    return { pdf, filename: `${t("entrega")}-${slugOf(column.project.name, t("proyecto"))}-${today}.pdf`, taskCount: tasks.length };
  })();
}

/** PDF de la planificación de la semana de una columna con rol WEEKLY_PLAN (por día o por persona). */
export function generateWeekPlanPdf(
  projectId: string, columnId: string, opts: { generatedBy: string; locale: Locale; groupBy: WeekPlanGroupBy },
): Promise<{ pdf: Uint8Array; filename: string; taskCount: number } | null> {
  return (async () => {
    const t = makeT(opts.locale);
    const column = await db.column.findFirst({ where: { id: columnId, projectId, role: "WEEKLY_PLAN" }, select: { name: true, project: { select: { name: true } } } });
    if (!column) return null;
    const tasks = await db.task.findMany({
      where: { projectId, columnId, archivedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: 2000,
      select: { title: true, dueDate: true, kind: { select: { id: true, name: true } }, assignee: { select: { name: true } } },
    });
    const locale = intlLocale(opts.locale);
    const today = todayIso(appTimeZone());
    const sections = buildWeekPlan(
      tasks.map((x) => ({ title: mentionsToPlain(x.title), kind: localizeGeneralKind(x.kind, opts.locale).name, assigneeName: x.assignee?.name ?? null, dueDate: dateToIso(x.dueDate) })),
      today, opts.groupBy, t, locale,
    );
    const pdf = await renderPdf({ kind: "weekPlan", locale: opts.locale, input: { project: column.project.name, column: column.name, today, generatedBy: opts.generatedBy, groupBy: opts.groupBy, sections } });
    return { pdf, filename: `${t("semana")}-${slugOf(column.name, t("columna"))}-${today}.pdf`, taskCount: tasks.length };
  })();
}
