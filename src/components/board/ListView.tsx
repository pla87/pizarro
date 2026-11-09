"use client";

import { ArrowDown, ArrowUp, CalendarClock, CheckSquare, ChevronsUpDown, Lock } from "lucide-react";
import { memo, useMemo, useState, useSyncExternalStore } from "react";
import { blockerIsDone } from "@/lib/blocked";
import { isWhite } from "@/lib/constants";
import { mentionsToPlain } from "@/lib/mentions";
import { dueStatus, formatDay } from "@/lib/dates";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "@/lib/task-fields";
import type { BoardColumn, BoardTask, LabelOption, UserOption } from "@/lib/types";
import { useIntlLocale, useT } from "@/i18n/client";
import { Avatar } from "../ui/Avatar";
import { MentionText } from "../ui/MentionText";
import { TypeBadge } from "../ui/TypeBadge";
import { cn } from "../ui/cn";
import { useBoard, useTask } from "./context";
import { ariaSortOf, DEFAULT_LIST_SORT, nextSort, sortTasks, type ListSort, type ListSortKey } from "./listSort";

type Translate = ReturnType<typeof useT>;

/** Mismo punto de corte que `sm:` de Tailwind: desde aquí, tabla; por debajo, lista compacta. */
const DESKTOP_QUERY = "(min-width: 640px)";
/** Solo se monta una de las dos versiones (así no hay filas ni data-task-card duplicados). En el servidor se supone escritorio. */
function useDesktopLayout(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(DESKTOP_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

/** Vista de lista del tablero: las tareas no archivadas (con búsqueda y filtros del tablero) en una tabla ordenable. */
export function ListView({ tasks, matchingIds, filtering }: { tasks: BoardTask[]; matchingIds: Set<string> | null; filtering: boolean }) {
  const { project, columns, users, labels, today, kindById } = useBoard();
  const t = useT();
  const locale = useIntlLocale();
  const [sort, setSort] = useState<ListSort>(DEFAULT_LIST_SORT);
  const priorityEnabled = project.taskFields.includes("priority");
  const desktop = useDesktopLayout();

  const lookups = useMemo(
    () => ({
      columnById: new Map<string, BoardColumn>(columns.map((c) => [c.id, c])),
      userById: new Map<string, UserOption>(users.map((u) => [u.id, u])),
      labelById: new Map<string, LabelOption>(labels.map((l) => [l.id, l])),
    }),
    [columns, users, labels],
  );
  const sortContext = useMemo(
    () => ({
      columnPosition: new Map(columns.map((c) => [c.id, c.position])),
      userName: new Map(users.map((u) => [u.id, u.name])),
      labelName: new Map(labels.map((l) => [l.id, l.name])),
      locale,
    }),
    [columns, users, labels, locale],
  );
  // Ordenar es lo único caro: solo se rehace al cambiar las tareas, el filtro, el orden o el idioma.
  const rows = useMemo(() => sortTasks(matchingIds ? tasks.filter((x) => matchingIds.has(x.id)) : tasks, sort, sortContext), [tasks, matchingIds, sort, sortContext]);

  const headers: { key: ListSortKey; label: string }[] = [
    { key: "title", label: t("Título") },
    { key: "column", label: t("Columna") },
    { key: "assignee", label: t("Responsable") },
    { key: "due", label: t("Fecha límite") },
    { key: "labels", label: t("Etiquetas") },
    ...(priorityEnabled ? [{ key: "priority" as const, label: t("Prioridad") }] : []),
    { key: "subtasks", label: t("Subtareas") },
  ];
  const sortLabel = headers.find((h) => h.key === sort.key)?.label ?? "";
  const status = filtering ? t("{shown} de {total}", { shown: rows.length, total: tasks.length }) : t("{n} tarjetas", { n: tasks.length });
  const announce = `${status}. ${t("Orden: {col}, {dir}", { col: sortLabel, dir: sort.dir === "asc" ? t("ascendente") : t("descendente") })}`;

  return (
    <div data-list-view className="flex min-h-0 flex-1 flex-col">
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {/* Móvil: el orden se elige en un desplegable. */}
      {!desktop && (
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:hidden dark:border-slate-800 dark:bg-slate-900">
        <label htmlFor="list-sort-select" className="shrink-0 text-xs text-slate-500">{t("Ordenar por")}</label>
        <select
          id="list-sort-select"
          className="input h-8 min-w-0 flex-1 py-0 text-sm"
          value={sort.key}
          onChange={(e) => setSort({ key: e.target.value as ListSortKey, dir: "asc" })}
        >
          {headers.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
        </select>
        <button
          type="button"
          className="btn-icon h-8 w-8 shrink-0"
          onClick={() => setSort(nextSort(sort, sort.key))}
          aria-label={sort.dir === "asc" ? t("Orden ascendente (cambiar a descendente)") : t("Orden descendente (cambiar a ascendente)")}
        >
          {sort.dir === "asc" ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
        </button>
      </div>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate-500">{filtering ? t("Ninguna tarjeta coincide con el filtro.") : t("Este tablero aún no tiene tareas.")}</p>
      ) : (
        <>
          {/* Hueco al final (pb-36) en móvil y tableta: si no, los botones flotantes de crear tapan las últimas filas. */}
          {!desktop ? (
          <ul className="min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto bg-white pb-36 sm:hidden dark:divide-slate-800 dark:bg-slate-900" aria-label={t("Lista de tareas")}>
            {rows.map((task) => <CompactRow key={task.id} task={task} lookups={lookups} today={today} locale={locale} t={t} />)}
          </ul>
          ) : (
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-36 max-sm:hidden lg:pb-4">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <caption className="sr-only">{t("Lista de tareas")}</caption>
              <thead>
                <tr>
                  {headers.map((h) => {
                    const active = sort.key === h.key;
                    return (
                      <th
                        key={h.key}
                        scope="col"
                        aria-sort={ariaSortOf(sort, h.key)}
                        className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 p-0 text-left text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        <button
                          type="button"
                          onClick={() => setSort(nextSort(sort, h.key))}
                          className={cn("flex w-full items-center gap-1 px-2 py-2 text-left whitespace-nowrap hover:bg-slate-100 dark:hover:bg-slate-800", active && "text-brand-700 dark:text-brand-300")}
                        >
                          {h.label}
                          {active ? (sort.dir === "asc" ? <ArrowUp size={13} aria-hidden /> : <ArrowDown size={13} aria-hidden />) : <ChevronsUpDown size={13} className="opacity-40" aria-hidden />}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => (
                  <TableRow key={task.id} task={task} lookups={lookups} today={today} locale={locale} t={t} priorityEnabled={priorityEnabled} kind={kindById.get(task.kindId)} />
                ))}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}
    </div>
  );
}

interface Lookups {
  columnById: Map<string, BoardColumn>;
  userById: Map<string, UserOption>;
  labelById: Map<string, LabelOption>;
}

/** Fecha límite con los mismos avisos de la tarjeta (vencida, hoy, próxima, terminada). */
function DueBadge({ task, done, today, locale, t }: { task: BoardTask; done: boolean; today: string; locale: string; t: Translate }) {
  if (!task.dueDate) return <span className="text-slate-400" aria-label={t("Sin fecha límite")}>—</span>;
  const due = dueStatus(task.dueDate, done, today);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1 text-xs font-medium whitespace-nowrap",
        due === "overdue" && "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
        (due === "today" || due === "soon") && "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
        due === "done" && "text-emerald-600",
      )}
      title={due === "overdue" ? t("Plazo vencido") : t("Fecha límite")}
    >
      <CalendarClock size={12} aria-hidden /> {due === "today" ? t("Hoy") : formatDay(task.dueDate, today, locale)}
      {due === "overdue" && <span className="sr-only"> ({t("Plazo vencido")})</span>}
    </span>
  );
}

/** Raya de color de la tarea (la misma que la tarjeta). */
function ColorBar({ color }: { color: string | null }) {
  if (!color) return <span className="w-1 shrink-0 self-stretch rounded-full bg-transparent" aria-hidden />;
  return <span className={cn("w-1 shrink-0 self-stretch rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/25")} style={{ backgroundColor: color }} aria-hidden />;
}

/** Candado de «bloqueada por», como en la tarjeta: desaparece cuando la tarea que bloquea está terminada o archivada. */
function BlockedBadge({ task, t }: { task: BoardTask; t: Translate }) {
  const { columns } = useBoard();
  const blocker = useTask(task.blockedBy?.id ?? "");
  if (!task.blockedBy || blockerIsDone(blocker, columns)) return null;
  const label = t("Bloqueada por: {title}", { title: mentionsToPlain(blocker?.title ?? task.blockedBy.title) });
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-amber-100 px-1 py-0.5 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" title={label} data-blocked>
      <Lock size={12} aria-hidden /><span className="sr-only">{label}</span>
    </span>
  );
}

const TableRow = memo(function TableRow({ task, lookups, today, locale, t, priorityEnabled, kind }: {
  task: BoardTask; lookups: Lookups; today: string; locale: string; t: Translate; priorityEnabled: boolean; kind: { name: string; color: string } | undefined;
}) {
  const { openTask } = useBoard();
  const column = lookups.columnById.get(task.columnId);
  const assignee = task.assigneeId ? lookups.userById.get(task.assigneeId) : undefined;
  const taskLabels = task.labelIds.map((id) => lookups.labelById.get(id)).filter((l): l is LabelOption => !!l);
  return (
    <tr onClick={() => openTask(task.id)} className="group cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 [&>td]:border-b [&>td]:border-slate-100 dark:[&>td]:border-slate-800">
      <td className="w-2/5 max-w-0 min-w-56 px-2 py-1.5 align-middle">
        <div className="flex items-center gap-2">
          <ColorBar color={task.color} />
          <button
            type="button"
            data-task-card={task.id}
            className="min-w-0 flex-1 rounded text-left font-medium break-words"
            // El resto de la fila abre la tarea con el ratón; el botón es la parada del teclado.
          >
            <MentionText text={task.title} />
          </button>
          <BlockedBadge task={task} t={t} />
          <TypeBadge kind={kind} />
        </div>
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-slate-600 dark:text-slate-300">{column?.name}</td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        {assignee ? (
          <span className="inline-flex items-center gap-1.5"><Avatar id={assignee.id} name={assignee.name} title={assignee.name} /> <span className="max-w-32 truncate">{assignee.name}</span></span>
        ) : (
          <span className="text-slate-400" aria-label={t("Sin responsable")}>—</span>
        )}
      </td>
      <td className="px-2 py-1.5"><DueBadge task={task} done={column?.isDone ?? false} today={today} locale={locale} t={t} /></td>
      <td className="px-2 py-1.5">
        {taskLabels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {taskLabels.map((l) => (
              <span key={l.id} className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", isWhite(l.color) ? "text-slate-800 ring-1 ring-slate-300 ring-inset" : "text-white")} style={{ backgroundColor: l.color }}>{l.name}</span>
            ))}
          </div>
        ) : (
          <span className="text-slate-400" aria-label={t("Sin etiquetas")}>—</span>
        )}
      </td>
      {priorityEnabled && (
        <td className="px-2 py-1.5 whitespace-nowrap">
          {task.priority ? (
            <span className="rounded px-1.5 py-px text-[10px] font-semibold text-white" style={{ backgroundColor: PRIORITY_COLOR[task.priority] }}>{t(PRIORITY_LABEL[task.priority])}</span>
          ) : (
            <span className="text-slate-400" aria-label={t("Sin prioridad")}>—</span>
          )}
        </td>
      )}
      <td className="px-2 py-1.5 whitespace-nowrap">
        {task.subtaskTotal > 0 ? (
          <span className={cn("inline-flex items-center gap-0.5 text-xs text-slate-500 dark:text-slate-400", task.subtaskDone === task.subtaskTotal && "text-emerald-600")}>
            <CheckSquare size={13} aria-hidden /> {task.subtaskDone}/{task.subtaskTotal}
          </span>
        ) : (
          <span className="text-slate-400" aria-label={t("Sin subtareas")}>—</span>
        )}
      </td>
    </tr>
  );
});

const CompactRow = memo(function CompactRow({ task, lookups, today, locale, t }: { task: BoardTask; lookups: Lookups; today: string; locale: string; t: Translate }) {
  const { openTask } = useBoard();
  const column = lookups.columnById.get(task.columnId);
  return (
    <li>
      <button type="button" data-task-card={task.id} onClick={() => openTask(task.id)} className="flex w-full items-stretch gap-2.5 px-3 py-2.5 text-left focus-visible:outline-offset-[-3px]">
        <ColorBar color={task.color} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug font-medium break-words"><MentionText text={task.title} /></span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>{column?.name}</span>
            <BlockedBadge task={task} t={t} />
            {task.dueDate && <DueBadge task={task} done={column?.isDone ?? false} today={today} locale={locale} t={t} />}
          </span>
        </span>
      </button>
    </li>
  );
});
