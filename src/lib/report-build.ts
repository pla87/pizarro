import "server-only";
import { intlLocale, type Locale, makeT } from "../i18n/core";
import { appTimeZone, listKinds } from "./board";
import { localizeGeneralKind, localizeGeneralKinds } from "./kinds-localize";
import { addDaysIso, dateToIso, isoToDate, todayIso } from "./dates";
import { normalizeTaskFields } from "./task-fields";
import { db } from "./db";
import { AppError } from "./errors";
import { mentionsToPlain } from "./mentions";
import { slugify } from "./search-accents";
import { buildReport, RECENT_DONE_DAYS, REPORT_MAX_TASKS, type ReportCounts } from "./report";
import { deliverableProgressByIds } from "./deliverable-progress-db";
import type { PdfJob } from "./report-pdf";
import { renderInWorker } from "./report-render";
import { groupChecklist, type ChecklistGroupBy } from "./checklist";
import { loadChecklistItems } from "./column-views";
import { buildWeekPlan, type WeekPlanGroupBy } from "./week-plan";
import { buildProgramSessions, programDocumentName } from "./course-program";
import { PROGRAM_MAX_SESSIONS } from "./program-limit";
import type { Prisma } from "@/generated/prisma/client";

// Genera el informe PDF de un proyecto. Lo usan la descarga (API) y el envío semanal por email;
// quien llama comprueba antes que la persona puede ver el proyecto.

interface ProjectReportPdf {
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

const PDF_RENDER_TIMEOUT_MS = 90_000;
const PDF_TIMEOUT_MESSAGE = "El PDF tardó demasiado; inténtalo de nuevo";

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

/**
 * Quien pidió el PDF ya no lo espera (cerró la pestaña, canceló la descarga): su render sale de la cola o, si ya se
 * estaba pintando, se para. Nadie recibe la respuesta; el estado 499 solo queda para los registros.
 */
export class PdfAbortedError extends AppError {
  constructor() {
    super("Petición cancelada", 499, "pdf_aborted");
  }
}

/**
 * Errores esperables de la cola (tiempo agotado 504, cola llena 503, petición cancelada 499): las rutas los traducen y
 * devuelven con su estado.
 */
export function isPdfQueueError(err: unknown): err is AppError {
  return err instanceof PdfTimeoutError || err instanceof PdfAbortedError || (err instanceof AppError && err.code === "pdf_busy");
}

/**
 * Ejecuta un render en la cola (de uno en uno) con tiempo máximo; `timeoutMs` es inyectable para los tests. Al
 * agotarse se aborta la señal del render (el worker se termina) y se rechaza con PdfTimeoutError.
 *
 * `request`: la señal de la petición (`req.signal`). Si se aborta mientras espera turno, el render sale de la cola sin
 * pintarse (deja libre su sitio entre los PDF_MAX_WAITING); si ya se estaba pintando, se para igual que al agotarse el
 * tiempo (se termina el worker y el siguiente PDF arranca otro). En ambos casos se rechaza con PdfAbortedError.
 */
export function queuedRender<T>(
  render: (signal: AbortSignal) => Promise<T>, timeoutMs: number = PDF_RENDER_TIMEOUT_MS, request?: AbortSignal,
): Promise<T> {
  if (request?.aborted) return Promise.reject(new PdfAbortedError());
  if (waitingRenders >= PDF_MAX_WAITING) return Promise.reject(new AppError(PDF_BUSY_MESSAGE, 503, "pdf_busy"));
  waitingRenders++;
  let waiting = true;
  let started: ((err: unknown) => void) | null = null; // para el render en curso (si lo hay) con este error
  let rejectWaiting!: (err: unknown) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectWaiting = reject; });
  const onRequestAbort = () => {
    const err = new PdfAbortedError();
    if (waiting) {
      waiting = false;
      waitingRenders--;
      rejectWaiting(err);
    } else started?.(err);
  };
  request?.addEventListener("abort", onRequestAbort, { once: true });
  const turn = reportQueue.then(() => {
    if (!waiting) return cancelled; // cancelado mientras esperaba: no ocupa turno
    waiting = false;
    waitingRenders--;
    return new Promise<T>((resolve, reject) => {
      const abort = new AbortController();
      const stop = (err: unknown) => {
        clearTimeout(timer);
        reject(err);
        abort.abort(err);
      };
      const timer = setTimeout(() => stop(new PdfTimeoutError()), timeoutMs);
      started = stop;
      render(abort.signal).then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  });
  const run = Promise.race([turn, cancelled]).finally(() => request?.removeEventListener("abort", onRequestAbort));
  reportQueue = turn.catch(() => {});
  return run;
}

/** Genera un PDF en el worker, en la cola y con tiempo máximo; `request` cancela si la petición se aborta. */
const renderPdf = (job: PdfJob, request?: AbortSignal): Promise<Uint8Array> =>
  queuedRender((signal) => renderInWorker(job, signal), PDF_RENDER_TIMEOUT_MS, request);

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

/** Opciones comunes de los PDF: `signal`, la de la petición (req.signal), cancela el render si se aborta. */
interface PdfRequestOpts {
  locale: Locale;
  signal?: AbortSignal;
}

export function generateProjectReportPdf(projectId: string, opts: PdfRequestOpts & { generatedBy: string }): Promise<ProjectReportPdf | null> {
  return buildProjectReportPdf(projectId, opts);
}

async function buildProjectReportPdf(projectId: string, opts: PdfRequestOpts & { generatedBy: string }): Promise<ProjectReportPdf | null> {
  const t = makeT(opts.locale);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, description: true, taskFields: true } });
  if (!project) return null;

  const today = todayIso(appTimeZone());
  const [columns, tasks, deliverables, releases, archivedCount, kinds, [doneEvents, released], counts] = await Promise.all([
    db.column.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true } }),
    db.task.findMany({
      where: { projectId, archivedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: REPORT_MAX_TASKS,
      select: {
        id: true,
        title: true,
        kind: { select: { id: true, name: true } },
        columnId: true,
        dueDate: true,
        deliverableId: true,
        assignee: { select: { name: true } },
        updatedAt: true,
        evergreen: true,
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
    reportCounts(projectId, today, opts.locale),
  ]);
  const doneAt = new Map<string, string>();
  const noteDone = (taskId: string | null, at: Date | null | undefined) => {
    const iso = at?.toISOString();
    if (taskId && iso && iso > (doneAt.get(taskId) ?? "")) doneAt.set(taskId, iso);
  };
  for (const e of doneEvents) noteDone(e.taskId, e._max.createdAt);
  for (const r of released) noteDone(r.taskId, r.release.deployedAt);
  // Avance de los entregables con las archivadas (que no se leen arriba) y sin las fijas: el criterio del calendario.
  const progress = await deliverableProgressByIds(deliverables.map((d) => d.id));

  const locale = intlLocale(opts.locale);
  const report = buildReport({
    project: { name: project.name, description: project.description },
    generatedBy: opts.generatedBy,
    today,
    timeZone: appTimeZone(),
    // Con la zona («14:05 CET»): el PDF se envía por email y puede leerse en otra.
    time: new Intl.DateTimeFormat(locale, { timeZone: appTimeZone(), hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(new Date()),
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
      evergreen: task.evergreen,
      fields: {
        cost: task.cost?.toFixed(2) ?? null, costPaid: task.costPaid, estimatedHours: task.estimatedHours?.toFixed(2) ?? null, actualHours: task.actualHours?.toFixed(2) ?? null,
        priority: task.priority, client: task.client, startDate: dateToIso(task.startDate),
      },
    })),
    deliverables: deliverables.map((d) => ({ ...d, dueDate: dateToIso(d.dueDate), progress: progress.get(d.id) })),
    releases: releases.map((r) => ({ number: r.number, title: r.title, deployedAt: r.deployedAt.toISOString(), taskCount: r.taskCount })),
    archivedCount,
    taskFields: normalizeTaskFields(project.taskFields),
    counts,
  }, t);

  const pdf = await renderPdf({ kind: "report", locale: opts.locale, input: report }, opts.signal);
  const slug = slugify(project.name) || t("proyecto");
  return { project: { id: project.id, name: project.name }, pdf, today, filename: `${t("informe")}-${slug}-${today}.pdf`, taskCount: tasks.length };
}

/**
 * Recuentos del informe sobre TODAS las tareas activas del proyecto (los listados solo leen las primeras
 * REPORT_MAX_TASKS): por columna, responsable y tipo, cuántas hay, vencidas, con plazo en 7 días y sin plazo, y las fijas.
 * Antes el avance, las vencidas y la carga por persona salían de esas 2.000 sin avisar.
 */
export async function reportCounts(projectId: string, today: string, locale: Locale): Promise<ReportCounts> {
  const active = { projectId, archivedAt: null, evergreen: false };
  const group = (where: Prisma.TaskWhereInput) => db.task.groupBy({ by: ["columnId", "assigneeId", "kindId"], where: { ...active, ...where }, _count: { _all: true } });
  const day = isoToDate(today);
  const [all, overdue, dueSoon, withoutDue, fixed] = await Promise.all([
    group({}),
    group({ dueDate: { lt: day } }),
    group({ dueDate: { gte: day, lte: isoToDate(addDaysIso(today, 7)) } }),
    group({ dueDate: null }),
    db.task.count({ where: { projectId, archivedAt: null, evergreen: true } }),
  ]);
  const key = (g: { columnId: string; assigneeId: string | null; kindId: string }) => `${g.columnId}|${g.assigneeId ?? ""}|${g.kindId}`;
  const countOf = (groups: Awaited<ReturnType<typeof group>>) => new Map(groups.map((g) => [key(g), g._count._all]));
  const [overdueN, soonN, noDueN] = [countOf(overdue), countOf(dueSoon), countOf(withoutDue)];
  const userIds = [...new Set(all.flatMap((g) => (g.assigneeId ? [g.assigneeId] : [])))];
  const kindIds = [...new Set(all.map((g) => g.kindId))];
  const [users, kinds] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    kindIds.length ? db.taskKind.findMany({ where: { id: { in: kindIds } }, select: { id: true, name: true } }) : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const kindName = new Map(localizeGeneralKinds(kinds, locale).map((k) => [k.id, k.name]));
  return {
    rows: all.map((g) => ({
      columnId: g.columnId,
      assigneeName: g.assigneeId ? (userName.get(g.assigneeId) ?? null) : null,
      kind: kindName.get(g.kindId) ?? "—",
      count: g._count._all,
      overdue: overdueN.get(key(g)) ?? 0,
      dueSoon: soonN.get(key(g)) ?? 0,
      withoutDue: noDueN.get(key(g)) ?? 0,
    })),
    fixed,
  };
}

const slugOf = (name: string, fallback: string) => slugify(name) || fallback;

/** PDF de la lista consolidada de una columna CHECKLIST (por tarjeta o por tipo de tarea). */
export function generateChecklistPdf(
  projectId: string, columnId: string, opts: PdfRequestOpts & { by: ChecklistGroupBy },
): Promise<{ pdf: Uint8Array; filename: string; itemCount: number } | null> {
  return (async () => {
    const t = makeT(opts.locale);
    const data = await loadChecklistItems(projectId, columnId, opts.locale);
    if (!data) return null;
    const locale = intlLocale(opts.locale);
    const today = todayIso(appTimeZone());
    const groups = groupChecklist(data.items, opts.by, locale);
    const pdf = await renderPdf({ kind: "checklist", locale: opts.locale, input: { project: data.column.projectName, column: data.column.name, today, by: opts.by, groups } }, opts.signal);
    return { pdf, filename: `${t("lista")}-${slugOf(data.column.name, t("columna"))}-${today}.pdf`, itemCount: data.items.length };
  })();
}

/** PDF «Resumen para el cliente» de una columna DELIVERY: sin comentarios, descripciones ni personas. */
export function generateDeliveryPdf(
  projectId: string, columnId: string, opts: PdfRequestOpts,
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
    } }, opts.signal);
    return { pdf, filename: `${t("entrega")}-${slugOf(column.project.name, t("proyecto"))}-${today}.pdf`, taskCount: tasks.length };
  })();
}

/** PDF de la planificación de la semana de una columna con rol WEEKLY_PLAN (por día o por persona). */
export function generateWeekPlanPdf(
  projectId: string, columnId: string, opts: PdfRequestOpts & { generatedBy: string; groupBy: WeekPlanGroupBy },
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
    const pdf = await renderPdf({ kind: "weekPlan", locale: opts.locale, input: { project: column.project.name, column: column.name, today, generatedBy: opts.generatedBy, groupBy: opts.groupBy, sections } }, opts.signal);
    return { pdf, filename: `${t("semana")}-${slugOf(column.name, t("columna"))}-${today}.pdf`, taskCount: tasks.length };
  })();
}

/**
 * PDF «Programa» de una columna PROGRAM: cada tarea no archivada es una sesión, en el orden de la columna, con su número,
 * su fecha (fecha límite, o rango inicio–fin si el proyecto usa la fecha de inicio), su título, su descripción (Markdown)
 * y, si se pide, su responsable. Como mucho PROGRAM_MAX_SESSIONS sesiones (las primeras): una columna con más (datos de
 * antes del límite, o devueltas con deshacer) da `omitted` > 0 para avisar. `documentName(versión)` es el nombre con el que
 * se guarda en la Documentación del proyecto.
 */
export function generateProgramPdf(
  projectId: string, columnId: string, opts: PdfRequestOpts & { withAssignee: boolean },
): Promise<{ pdf: Uint8Array; filename: string; documentName: (version: number) => string; taskCount: number; omitted: number } | null> {
  return (async () => {
    const t = makeT(opts.locale);
    const column = await db.column.findFirst({ where: { id: columnId, projectId, role: "PROGRAM" }, select: { project: { select: { name: true, taskFields: true } } } });
    if (!column) return null;
    const where = { projectId, columnId, archivedAt: null };
    const tasks = await db.task.findMany({
      where,
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: PROGRAM_MAX_SESSIONS,
      select: { title: true, description: true, dueDate: true, startDate: true, assignee: { select: { name: true } }, kind: { select: { titleTemplate: true } } },
    });
    const omitted = tasks.length < PROGRAM_MAX_SESSIONS ? 0 : (await db.task.count({ where })) - tasks.length;
    const today = todayIso(appTimeZone());
    const sessions = buildProgramSessions(
      tasks.map((x) => ({ title: x.title, titlePrefix: x.kind?.titleTemplate ?? "", description: x.description, startDate: dateToIso(x.startDate), dueDate: dateToIso(x.dueDate), assignee: x.assignee?.name ?? null })),
      { locale: intlLocale(opts.locale), t, withAssignee: opts.withAssignee, useStartDate: normalizeTaskFields(column.project.taskFields).includes("startDate") },
    );
    const pdf = await renderPdf({ kind: "program", locale: opts.locale, input: { project: column.project.name, today, withAssignee: opts.withAssignee, sessions } }, opts.signal);
    return {
      pdf,
      filename: `${t("programa")}-${slugOf(column.project.name, t("proyecto"))}-${today}.pdf`,
      documentName: (version: number) => programDocumentName(t, today, version),
      taskCount: tasks.length,
      omitted,
    };
  })();
}

/**
 * Reserva la versión siguiente del programa del curso del proyecto (Project.programVersion + 1) dentro de la transacción
 * que da de alta su documento: si el alta no se confirma, no se gasta. Una sola sentencia (UPDATE … RETURNING): dos
 * publicaciones a la vez nunca reciben el mismo número, y como no depende de los documentos que haya, sigue subiendo
 * aunque se borre alguno. Sin tocar updatedAt del proyecto (publicar no cambia el proyecto).
 */
export async function nextProgramVersion(tx: Prisma.TransactionClient, projectId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ programVersion: number }[]>`
    UPDATE "Project" SET "programVersion" = "programVersion" + 1 WHERE "id" = ${projectId} RETURNING "programVersion"`;
  if (!rows[0]) throw new AppError("El proyecto ya no existe.", 404, "project_gone");
  return rows[0].programVersion;
}
