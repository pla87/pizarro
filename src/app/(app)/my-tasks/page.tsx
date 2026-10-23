import Link from "next/link";
import { ExternalLink, Folder, ListChecks } from "lucide-react";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { TypeBadge } from "@/components/ui/TypeBadge";
import { MentionText } from "@/components/ui/MentionText";
import { cn } from "@/components/ui/cn";
import { appTimeZone } from "@/lib/board";
import { dateToIso, dueStatus, formatDay, todayIso } from "@/lib/dates";
import { bucketOf, groupByDue, matchesFilter, parseFilter, type TaskBucket, type TaskFilter } from "@/lib/my-tasks";
import { intlLocale } from "@/i18n/core";
import { getLocale, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Mis tareas") };
}

const FILTERS: { value: TaskFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "overdue", label: "Vencidas" },
  { value: "week", label: "Esta semana" },
];

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  const user = await requireUserPage();
  const t = await getT();
  const locale = intlLocale(await getLocale());
  const filter = parseFilter((await searchParams).filter);
  const rows = await db.task.findMany({
    // Bandeja de lo pendiente: sin las ya terminadas (columnas «hechas») y con un tope razonable.
    where: { assigneeId: user.id, archivedAt: null, column: { isDone: false }, project: visibleProjectsWhere(user) },
    take: 500,
    // Dentro de cada grupo se ordena por fecha; a igual fecha, por proyecto y posición en el tablero.
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { project: { position: "asc" } }, { column: { position: "asc" } }, { position: "asc" }],
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
  // Una tarea en una columna «hecha» ya no corre prisa: se agrupa como «Sin fecha» aunque conserve su fecha límite.
  const tasks = rows.map((task) => ({ ...task, due: dateToIso(task.dueDate), dueDate: task.column.isDone ? null : dateToIso(task.dueDate) }));
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, tasks.filter((x) => matchesFilter(bucketOf(x.dueDate, today), f.value)).length])) as Record<TaskFilter, number>;
  const groups = groupByDue(tasks, today, filter);
  const shown = groups.reduce((n, g) => n + g.tasks.length, 0);

  const heading: Record<TaskBucket, string> = {
    overdue: t("Vencidas"),
    today: t("Hoy"),
    week: t("Esta semana"),
    later: t("Más adelante"),
    none: t("Sin fecha"),
  };

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-1 text-xl font-semibold">{t("Mis tareas asignadas")}</h1>
      <p className="mb-4 text-sm text-slate-500">{t("{n} tarea(s) en todos tus proyectos.", { n: tasks.length })}</p>
      <nav className="mb-6 flex flex-wrap gap-2" aria-label={t("Filtrar mis tareas")}>
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? "/my-tasks" : `/my-tasks?filter=${f.value}`}
            aria-current={filter === f.value ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
              filter === f.value ? "border-brand-600 bg-brand-600 text-on-brand" : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
            )}
          >
            {t(f.label)}
            <span className={cn("text-xs", filter === f.value ? "opacity-80" : "text-slate-400")}>{counts[f.value]}</span>
          </Link>
        ))}
      </nav>
      {shown === 0 && (
        <div className="card flex flex-col items-center gap-2 p-10 text-sm text-slate-500">
          <ListChecks size={32} className="text-slate-300" />
          {tasks.length === 0 ? t("No tienes tareas asignadas.") : t("No hay tareas en este filtro.")}
        </div>
      )}
      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.bucket}>
            <h2 className={cn("mb-2 flex items-center gap-2 text-sm font-semibold", group.bucket === "overdue" ? "text-red-600" : "text-slate-600 dark:text-slate-300")}>
              {heading[group.bucket]}
              <span className="text-xs font-normal text-slate-400">{group.tasks.length}</span>
            </h2>
            <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
              {group.tasks.map((task) => {
                const done = task.subtasks.filter((s) => s.done).length;
                const projectId = task.project.id;
                return (
                  <li key={task.id} className="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    {task.color && <span className="absolute inset-y-1 left-0 w-1 rounded-r" style={{ backgroundColor: task.color }} aria-hidden />}
                    {/* Proyecto como chip al principio de la fila: lo primero que se lee. */}
                    <Link
                      href={`/p/${projectId}`}
                      title={task.project.name}
                      className="inline-flex max-w-[11rem] shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-700 hover:border-brand-400 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:text-brand-200"
                    >
                      <Folder size={12} className="shrink-0 text-slate-400" aria-hidden />
                      <span className="truncate">{task.project.name}</span>
                    </Link>
                    <TypeBadge kind={task.kind} />
                    <Link href={`/p/${projectId}?task=${task.id}`} className="min-w-0 flex-1 basis-40 truncate text-sm font-medium hover:text-brand-600">
                      <MentionText text={task.title} />
                    </Link>
                    {task.due && (() => {
                      const st = dueStatus(task.due, task.column.isDone, today);
                      return (
                        <span className={cn("shrink-0 text-xs", st === "overdue" ? "font-semibold text-red-600" : st === "today" || st === "soon" ? "font-semibold text-amber-600" : "text-slate-500")}>
                          {st === "today" ? t("Hoy") : formatDay(task.due, today, locale)}
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
