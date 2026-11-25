import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, Folder, ListChecks } from "lucide-react";
import { myOpenTasksWhere } from "@/lib/my-tasks-server";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { localizeGeneralKind } from "@/lib/kinds-localize";
import { TypeBadge } from "@/components/ui/TypeBadge";
import { MentionText } from "@/components/ui/MentionText";
import { cn } from "@/components/ui/cn";
import { MidnightRefresh } from "@/components/useMidnightRefresh";
import { appTimeZone } from "@/lib/board";
import { dateToIso, dueStatus, formatDay, todayIso } from "@/lib/dates";
import { bucketAnchor, bucketCount, cutBucket, groupByDue, type TaskBucket } from "@/lib/my-tasks";
import { intlLocale } from "@/i18n/core";
import { getLocale, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Mis tareas") };
}

/** Tope de tareas que se pintan en la página. */
const MAX_TASKS = 500;

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  const user = await requireUserPage();
  // Los filtros se quitaron (la línea de resumen enlaza a cada grupo): un marcador antiguo con ?filter= va a la página limpia.
  if ((await searchParams).filter !== undefined) redirect("/my-tasks");
  const t = await getT();
  const uiLocale = await getLocale();
  const locale = intlLocale(uiLocale);
  const where = myOpenTasksWhere(user);
  const fetched = await db.task.findMany({
    // Bandeja de lo pendiente: sin las ya terminadas (columnas «hechas») y con un tope razonable.
    where,
    take: MAX_TASKS + 1, // una de más para saber si hay más de las que se muestran
    // Dentro de cada grupo se ordena por fecha; a igual fecha, por proyecto y posición en el tablero.
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { project: { position: "asc" } }, { column: { position: "asc" } }, { position: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      kind: { select: { id: true, name: true, color: true } },
      color: true,
      linkUrl: true,
      dueDate: true,
      project: { select: { id: true, name: true } },
      column: { select: { name: true, isDone: true } },
    },
  });
  // Más de las que caben: se muestran las primeras y se avisa con el total (nunca se cortan en silencio).
  const rows = fetched.slice(0, MAX_TASKS);
  const ids = rows.map((r) => r.id);
  // Solo los recuentos de subtareas (hechas/total), calculados en SQL: leer cada fila eran hasta 100 por tarea.
  const [total, subtaskCounts] = await Promise.all([
    fetched.length > MAX_TASKS ? db.task.count({ where }) : rows.length,
    ids.length
      ? db.$queryRaw<{ taskId: string; total: number; done: number }[]>(Prisma.sql`
          SELECT "taskId", count(*)::int AS "total", (count(*) FILTER (WHERE "done"))::int AS "done" FROM "Subtask"
          WHERE "taskId" = ANY(${ids}::text[]) GROUP BY "taskId"`)
      : [],
  ]);
  const subtasksOf = new Map(subtaskCounts.map((c) => [c.taskId, c]));

  const today = todayIso(appTimeZone());
  // La consulta ya excluye las columnas «hechas»: cada tarea se agrupa por su fecha límite.
  const tasks = rows.map((task) => ({ ...task, due: dateToIso(task.dueDate), dueDate: dateToIso(task.dueDate) }));
  const groups = groupByDue(tasks, today);
  const fetchedHidden = fetched[MAX_TASKS];
  const cut = cutBucket(fetchedHidden && { dueDate: dateToIso(fetchedHidden.dueDate) }, today);

  const heading: Record<TaskBucket, string> = {
    overdue: t("Vencidas"),
    today: t("Hoy"),
    // Los 7 días siguientes a hoy, no la semana del calendario (el filtro del tablero «Esta semana» sí lo es).
    week: t("Próximos 7 días"),
    later: t("Más adelante"),
    none: t("Sin fecha"),
  };

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      {/* A medianoche (zona de la app) las de «Hoy» pasan a «Vencidas»: se pide la página de nuevo. */}
      <MidnightRefresh today={today} />
      <h1 className="mb-1 text-xl font-semibold">{t("Mis tareas asignadas")}</h1>
      <p className="mb-4 text-sm text-slate-500">{total === 1 ? t("1 tarea en todos tus proyectos.") : t("{n} tareas en todos tus proyectos.", { n: total })}</p>
      {total > tasks.length && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          {t("Se muestran las primeras {shown} de {total}, por fecha límite. Abre cada proyecto para ver el resto.", { shown: tasks.length, total })}
        </p>
      )}
      {/* Resumen con un enlace a cada grupo (solo los que tienen tareas; con un solo grupo no hace falta). */}
      {groups.length > 1 && (
        <nav className="mb-6" aria-label={t("Grupos de mis tareas")}>
          <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
            {groups.map((group, i) => (
              <li key={group.bucket} className="flex items-center gap-x-1">
                {i > 0 && <span className="text-slate-400" aria-hidden>·</span>}
                <a
                  href={`#${bucketAnchor(group.bucket)}`}
                  className={cn("rounded px-1 py-0.5 hover:underline", group.bucket === "overdue" ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-300")}
                >
                  {heading[group.bucket]} <span className="font-semibold">{bucketCount(group, cut)}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {tasks.length === 0 && (
        <div className="card flex flex-col items-center gap-2 p-10 text-sm text-slate-500">
          <ListChecks size={32} className="text-slate-300" />
          {t("No tienes tareas asignadas.")}
        </div>
      )}
      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.bucket} id={bucketAnchor(group.bucket)} aria-labelledby={`${bucketAnchor(group.bucket)}-h`} className="scroll-mt-4">
            <h2 id={`${bucketAnchor(group.bucket)}-h`} className={cn("mb-2 flex items-center gap-2 text-sm font-semibold", group.bucket === "overdue" ? "text-red-600" : "text-slate-600 dark:text-slate-300")}>
              {heading[group.bucket]}
              <span className="text-xs font-normal text-slate-500">{bucketCount(group, cut)}</span>
            </h2>
            <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
              {group.tasks.map((task) => {
                const sub = subtasksOf.get(task.id);
                const projectId = task.project.id;
                // El borde rojo de la izquierda solo marca las vencidas; el color propio de la tarea (el de la franja de su
                // tarjeta en el tablero) va en un punto junto al título, para no confundirse con él aunque sea rojo.
                const late = !!task.due && dueStatus(task.due, task.column.isDone, today) === "overdue";
                return (
                  <li key={task.id} data-overdue={late || undefined} className="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    {late && <span className="absolute inset-y-1 left-0 w-1 rounded-r bg-red-600 dark:bg-red-500" aria-hidden />}
                    {/* Proyecto como chip al principio de la fila: lo primero que se lee. */}
                    {/* Sin precarga en los enlaces de la lista: cada fila era una petición de su tablero entero. */}
                    <Link
                      prefetch={false}
                      href={`/p/${projectId}`}
                      title={task.project.name}
                      className="inline-flex max-w-[11rem] shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-700 hover:border-brand-400 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:text-brand-200"
                    >
                      <Folder size={12} className="shrink-0 text-slate-400" aria-hidden />
                      <span dir="auto" className="truncate">{task.project.name}</span>
                    </Link>
                    <TypeBadge kind={localizeGeneralKind(task.kind, uiLocale)} />
                    <Link prefetch={false} href={`/p/${projectId}?task=${task.id}`} className="flex min-w-0 flex-1 basis-40 items-center gap-1.5 text-sm font-medium hover:text-brand-600">
                      {task.color && <span data-task-color className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/25" style={{ backgroundColor: task.color }} title={t("Color de la tarea")} aria-hidden />}
                      <span dir="auto" className="min-w-0 truncate"><MentionText text={task.title} /></span>
                    </Link>
                    {task.due && (() => {
                      const st = dueStatus(task.due, task.column.isDone, today);
                      return (
                        <span className={cn("shrink-0 text-xs", st === "overdue" ? "font-semibold text-red-600" : st === "today" || st === "soon" ? "font-semibold text-amber-700 dark:text-amber-400" : "text-slate-500")}>
                          {st === "today" ? t("Hoy") : formatDay(task.due, today, locale)}
                        </span>
                      );
                    })()}
                    {sub && sub.total > 0 && <span className="text-xs text-slate-500">{sub.done}/{sub.total}</span>}
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
