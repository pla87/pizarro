import Link from "next/link";
import { ExternalLink, ListChecks } from "lucide-react";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { TypeBadge } from "@/components/ui/TypeBadge";
import { cn } from "@/components/ui/cn";
import { appTimeZone } from "@/lib/board";
import { dateToIso, dueStatus, formatDay, todayIso } from "@/lib/dates";
import { intlLocale } from "@/i18n/core";
import { getLocale, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Mis tareas") };
}

export default async function MyTasksPage() {
  const user = await requireUserPage();
  const t = await getT();
  const locale = intlLocale(await getLocale());
  const tasks = await db.task.findMany({
    where: { assigneeId: user.id, archivedAt: null, project: visibleProjectsWhere(user) },
    orderBy: [{ project: { position: "asc" } }, { dueDate: { sort: "asc", nulls: "last" } }, { column: { position: "asc" } }, { position: "asc" }],
    select: {
      id: true,
      title: true,
      kind: { select: { name: true, color: true } },
      color: true,
      linkUrl: true,
      dueDate: true,
      project: { select: { id: true, name: true } },
      column: { select: { name: true, role: true, isDone: true } },
      subtasks: { select: { done: true } },
    },
  });

  const today = todayIso(appTimeZone());
  const byProject = new Map<string, { name: string; tasks: typeof tasks }>();
  for (const task of tasks) {
    const group = byProject.get(task.project.id) ?? { name: task.project.name, tasks: [] };
    group.tasks.push(task);
    byProject.set(task.project.id, group);
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-1 text-xl font-semibold">{t("Mis tareas asignadas")}</h1>
      <p className="mb-6 text-sm text-slate-500">{t("{n} tarea(s) en todos tus proyectos.", { n: tasks.length })}</p>
      {tasks.length === 0 && (
        <div className="card flex flex-col items-center gap-2 p-10 text-sm text-slate-500">
          <ListChecks size={32} className="text-slate-300" /> {t("No tienes tareas asignadas.")}
        </div>
      )}
      <div className="space-y-6">
        {[...byProject.entries()].map(([projectId, group]) => (
          <section key={projectId}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
              <Link href={`/p/${projectId}`} className="hover:underline">{group.name}</Link>
              <span className="text-xs font-normal text-slate-400">{group.tasks.length}</span>
            </h2>
            <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
              {group.tasks.map((task) => {
                const done = task.subtasks.filter((s) => s.done).length;
                return (
                  <li key={task.id} className="relative flex items-center gap-3 px-4 py-2.5">
                    {task.color && <span className="absolute inset-y-1 left-0 w-1 rounded-r" style={{ backgroundColor: task.color }} aria-hidden />}
                    <TypeBadge kind={task.kind} />
                    <Link href={`/p/${projectId}?task=${task.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-600">
                      {task.title}
                    </Link>
                    {task.dueDate && (() => {
                      const iso = dateToIso(task.dueDate)!;
                      const st = dueStatus(iso, task.column.isDone, today);
                      return (
                        <span className={cn("shrink-0 text-xs", st === "overdue" ? "font-semibold text-red-600" : st === "today" || st === "soon" ? "font-semibold text-amber-600" : "text-slate-500")}>
                          {st === "today" ? t("Hoy") : formatDay(iso, today, locale)}
                        </span>
                      );
                    })()}
                    {task.subtasks.length > 0 && <span className="text-xs text-slate-500">{done}/{task.subtasks.length}</span>}
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {task.column.name}
                    </span>
                    {task.linkUrl && (
                      <a href={task.linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-slate-400 hover:text-brand-600" aria-label={t("Enlace externo")}>
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
