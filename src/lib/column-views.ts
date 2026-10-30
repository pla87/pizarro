import "server-only";
import type { Locale } from "../i18n/core";
import type { ChecklistItem } from "./checklist";
import { dateToIso } from "./dates";
import { db } from "./db";
import { buildIcs, markdownToPlain } from "./ics";
import { localizeGeneralKind } from "./kinds-localize";
import { mentionsToPlain } from "./mentions";
import { appUrl } from "./mail";
import type { ColumnRoleValue } from "./constants";

// Lecturas de las columnas con rol (lista consolidada, agenda): las comparten los diálogos, las rutas de
// descarga y los PDF. Quien llama comprueba antes que la persona puede ver el proyecto.

/** Subtareas de las tarjetas no archivadas de la columna, en el orden de la columna (si tiene ese rol). */
export async function loadChecklistItems(projectId: string, columnId: string, locale: Locale, role: ColumnRoleValue = "CHECKLIST"): Promise<{ column: { name: string; projectName: string }; items: ChecklistItem[] } | null> {
  const column = await db.column.findFirst({ where: { id: columnId, projectId, role }, select: { name: true, project: { select: { name: true } } } });
  if (!column) return null;
  const tasks = await db.task.findMany({
    where: { projectId, columnId, archivedAt: null, subtasks: { some: {} } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: 1000,
    select: {
      id: true, title: true,
      kind: { select: { id: true, name: true } },
      subtasks: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, title: true, done: true } },
    },
  });
  const items = tasks.flatMap((task) => {
    const kind = localizeGeneralKind(task.kind, locale);
    return task.subtasks.map((s) => ({ id: s.id, title: mentionsToPlain(s.title), done: s.done, taskId: task.id, taskTitle: mentionsToPlain(task.title), kindId: kind.id, kindName: kind.name }));
  });
  return { column: { name: column.name, projectName: column.project.name }, items };
}

/** Subtareas sin marcar de varias tarjetas del proyecto (para avisar al sacarlas de una columna de revisión). */
export async function loadPendingSubtasks(projectId: string, taskIds: string[]): Promise<{ taskId: string; title: string; pending: string[] }[]> {
  const tasks = await db.task.findMany({
    where: { projectId, id: { in: taskIds.slice(0, 500) }, subtasks: { some: { done: false } } },
    select: { id: true, title: true, subtasks: { where: { done: false }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { title: true } } },
  });
  return tasks.map((x) => ({ taskId: x.id, title: mentionsToPlain(x.title), pending: x.subtasks.map((s) => mentionsToPlain(s.title)) }));
}

/** Calendario .ics con las tareas no archivadas de una columna AGENDA que tienen fecha límite. */
export async function buildColumnIcs(projectId: string, columnId: string): Promise<{ ics: string; filename: string; count: number } | null> {
  const column = await db.column.findFirst({ where: { id: columnId, projectId, role: "AGENDA" }, select: { name: true, project: { select: { name: true, taskFields: true } } } });
  if (!column) return null;
  const tasks = await db.task.findMany({
    where: { projectId, columnId, archivedAt: null, dueDate: { not: null } },
    orderBy: [{ dueDate: "asc" }, { position: "asc" }],
    take: 2000,
    select: { id: true, title: true, description: true, dueDate: true, startDate: true },
  });
  const base = appUrl();
  const ics = buildIcs({
    name: `${column.project.name} · ${column.name}`,
    events: tasks.flatMap((x) => {
      const due = dateToIso(x.dueDate);
      // Con el campo «Fecha de inicio» activo y una fecha de inicio anterior, el evento abarca de inicio a límite.
      const start = column.project.taskFields.includes("startDate") ? dateToIso(x.startDate) : null;
      const range = due && start && start < due;
      const date = range ? start : due;
      return date ? [{ uid: `${x.id}@pizarro`, date, endDate: range ? due! : undefined, summary: mentionsToPlain(x.title), description: x.description ? markdownToPlain(x.description) : undefined, url: `${base}/p/${projectId}?task=${x.id}` }] : [];
    }),
  });
  const slug = column.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "agenda";
  return { ics, filename: `${slug}.ics`, count: tasks.length };
}
