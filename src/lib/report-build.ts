import "server-only";
import { intlLocale, type Locale, makeT } from "../i18n/core";
import { appTimeZone, listKinds } from "./board";
import { localizeGeneralKind, localizeGeneralKinds } from "./kinds-localize";
import { dateToIso, todayIso } from "./dates";
import { db } from "./db";
import { mentionsToPlain } from "./mentions";
import { buildReport } from "./report";
import { renderReportPdf } from "./report-pdf";

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

// El render del PDF ocupa la CPU del único proceso: se generan de uno en uno (en cola) para que el resto de la app
// (tablero, canal en vivo, subidas) siga respondiendo aunque se pidan varios a la vez.
let reportQueue: Promise<unknown> = Promise.resolve();

export function generateProjectReportPdf(projectId: string, opts: { generatedBy: string; locale: Locale }): Promise<ProjectReportPdf | null> {
  const run = reportQueue.then(() => buildProjectReportPdf(projectId, opts));
  reportQueue = run.catch(() => {});
  return run;
}

async function buildProjectReportPdf(projectId: string, opts: { generatedBy: string; locale: Locale }): Promise<ProjectReportPdf | null> {
  const t = makeT(opts.locale);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, description: true } });
  if (!project) return null;

  const [columns, tasks, deliverables, releases, archivedCount, kinds] = await Promise.all([
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
      },
    }),
    db.deliverable.findMany({ where: { projectId }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { position: "asc" }], select: { id: true, name: true, description: true, dueDate: true } }),
    db.release.findMany({ where: { projectId }, orderBy: { deployedAt: "desc" }, take: 5, select: { number: true, title: true, deployedAt: true, _count: { select: { tasks: true } } } }),
    db.task.count({ where: { projectId, archivedAt: { not: null } } }),
    listKinds(projectId),
  ]);

  const locale = intlLocale(opts.locale);
  const today = todayIso(appTimeZone());
  const report = buildReport({
    project: { name: project.name, description: project.description },
    generatedBy: opts.generatedBy,
    today,
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
    })),
    deliverables: deliverables.map((d) => ({ ...d, dueDate: dateToIso(d.dueDate) })),
    releases: releases.map((r) => ({ number: r.number, title: r.title, deployedAt: r.deployedAt.toISOString(), taskCount: r._count.tasks })),
    archivedCount,
  }, t);

  const pdf = await renderReportPdf(report, t, locale);
  const slug = project.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || t("proyecto");
  return { project: { id: project.id, name: project.name }, pdf, today, filename: `${t("informe")}-${slug}-${today}.pdf`, taskCount: tasks.length };
}
