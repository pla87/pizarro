"use client";

import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Flag, Loader2, Undo2, X } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { undoLast } from "@/actions/undo";
import { updateTask } from "@/actions/tasks";
import { bandsForWeek, groupByDay, groupWeeks, shiftMonth, type CalendarDay } from "@/lib/calendar";
import { kindBadgeStyle } from "@/lib/constants";
import { addDaysIso, daysBetween, formatDay } from "@/lib/dates";
import { deliverableStatus, type DeliverableStatus } from "@/lib/report";
import { useIntlLocale, useT } from "@/i18n/client";
import { isTypingTarget } from "@/components/board/shortcuts";
import { cn } from "@/components/ui/cn";
import { Popover } from "@/components/ui/Popover";
import { useToast } from "@/components/ui/Toast";

export interface CalendarTask {
  id: string;
  title: string;
  /** Fecha límite (YYYY-MM-DD). */
  due: string;
  projectId: string;
  projectName: string;
  kind: { name: string; color: string };
  /** Está en una columna de terminadas. */
  done: boolean;
}

export interface CalendarDeliverable {
  id: string;
  name: string;
  due: string;
  projectId: string;
  projectName: string;
  total: number;
  done: number;
}

interface Filters {
  /** Proyectos elegidos; vacío = todos aquellos en los que trabaja. */
  project: string[];
  person: string;
  hideDone: boolean;
}

interface Props {
  month: string;
  today: string;
  weeks: CalendarDay[][];
  tasks: CalendarTask[];
  deliverables: CalendarDeliverable[];
  projects: { id: string; name: string }[];
  people: { id: string; name: string }[];
  filters: Filters;
  /** Se alcanzó el tope de tareas cargadas. */
  truncated: boolean;
}

/** Chips visibles por día antes de «+N más». */
const MAX_CHIPS = 3;
/** Bandas de entregable visibles por semana. */
const MAX_BANDS = 3;

const STATUS_STYLE: Record<DeliverableStatus, string> = {
  Completado: "border-green-500/60 bg-green-100 text-green-900 dark:bg-green-950/60 dark:text-green-200",
  "En plazo": "border-sky-500/60 bg-sky-100 text-sky-900 dark:bg-sky-950/60 dark:text-sky-200",
  "En riesgo": "border-amber-500/70 bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
  Retrasado: "border-red-500/60 bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200",
  "Sin fecha": "border-slate-400/60 bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  "Sin tareas": "border-slate-400/60 bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
};
const STATUS_BAR: Record<DeliverableStatus, string> = {
  Completado: "bg-green-500/30",
  "En plazo": "bg-sky-500/30",
  "En riesgo": "bg-amber-500/35",
  Retrasado: "bg-red-500/30",
  "Sin fecha": "bg-slate-500/20",
  "Sin tareas": "bg-slate-500/20",
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0])
    .join("")
    .toUpperCase();

/** Casilla de las opciones del filtro de proyectos. */
function CheckBox({ on }: { on: boolean }) {
  return (
    <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-brand-600 bg-brand-600 text-on-brand" : "border-slate-400 dark:border-slate-600")} aria-hidden>
      {on && <Check size={12} strokeWidth={3} />}
    </span>
  );
}

/** Spinner dentro de un <Link> mientras se navega al mes siguiente. */
function LinkSpinner() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null;
}

export function CalendarView({ month, today, weeks, tasks, deliverables, projects, people, filters, truncated }: Props) {
  const t = useT();
  const locale = useIntlLocale();
  const router = useRouter();
  const toast = useToast();
  const [navigating, startNav] = useTransition();
  // Fechas cambiadas aquí y aún no reflejadas en los datos del servidor (cambio optimista).
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [last, setLast] = useState<{ taskId: string; projectId: string; from: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    // Tras mover con teclado el chip se vuelve a pintar en otro día: recupera el foco.
    if (!focusAfter.current) return;
    document.querySelector<HTMLElement>(`[data-chip="${focusAfter.current}"]`)?.focus();
    focusAfter.current = null;
  });

  const items = useMemo(() => tasks.map((x) => ({ ...x, due: overrides[x.id] ?? x.due })), [tasks, overrides]);
  const byDay = useMemo(() => {
    const map = groupByDay(items, (x) => x.due);
    // Pendientes antes que terminadas; dentro de cada grupo, el orden del servidor.
    for (const [day, list] of map) map.set(day, [...list].sort((a, b) => Number(a.done) - Number(b.done)));
    return map;
  }, [items]);

  // Entregables con su estado; los terminados desaparecen con «ocultar terminadas».
  const dels = useMemo(
    () =>
      deliverables
        .map((d) => ({ ...d, status: deliverableStatus(d.total, d.done, daysBetween(today, d.due)), pct: d.total ? Math.round((d.done / d.total) * 100) : 0 }))
        .filter((d) => !(filters.hideDone && d.status === "Completado")),
    [deliverables, today, filters.hideDone],
  );
  const delById = useMemo(() => new Map(dels.map((d) => [d.id, d])), [dels]);
  const delByDay = useMemo(() => groupByDay(dels, (d) => d.due), [dels]);

  const href = useCallback(
    (over: Partial<Filters> & { month?: string | null }) => {
      const f = { ...filters, ...over };
      const m = over.month === undefined ? month : over.month;
      const q = new URLSearchParams();
      if (m && m !== today.slice(0, 7)) q.set("month", m);
      if (f.project.length) q.set("project", f.project.join(","));
      if (f.person) q.set("person", f.person);
      if (f.hideDone) q.set("hideDone", "1");
      const s = q.toString();
      return s ? `/calendar?${s}` : "/calendar";
    },
    [filters, month, today],
  );
  const go = (over: Partial<Filters>) => startNav(() => router.push(href(over)));

  const dayLabel = useCallback((iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }), [locale]);
  const monthTitle = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const weekdays = weeks[0]!.map((d) => new Date(`${d.iso}T00:00:00Z`).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" }));
  // Con más de un proyecto a la vista, cada tarea lleva las iniciales del suyo.
  const showProject = (filters.project.length || projects.length) > 1;
  // Selección del desplegable de proyectos: se aplica al cerrarlo (una sola navegación por varios clics).
  const [draft, setDraft] = useState<string[]>(filters.project);
  const toggleProject = (id: string) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const applyProjects = () => {
    const same = draft.length === filters.project.length && draft.every((id) => filters.project.includes(id));
    if (!same) go({ project: draft });
  };
  const projectLabel =
    filters.project.length === 0 ? t("Todos los proyectos") : filters.project.length === 1 ? (projects.find((p) => p.id === filters.project[0])?.name ?? t("1 proyecto")) : t("{n} proyectos", { n: filters.project.length });

  const moveTask = useCallback(
    async (task: CalendarTask, to: string) => {
      const from = overrides[task.id] ?? task.due;
      if (from === to) return;
      setOverrides((o) => ({ ...o, [task.id]: to }));
      const res = await updateTask(task.id, { dueDate: to });
      if (!res.ok) {
        // Vuelve a la fecha anterior.
        setOverrides((o) => ({ ...o, [task.id]: from }));
        toast(res.error, "error");
        return;
      }
      setLast({ taskId: task.id, projectId: task.projectId, from });
      toast(t("Fecha límite cambiada al {date}", { date: formatDay(to, today, locale) }));
      router.refresh();
    },
    [overrides, toast, t, today, locale, router],
  );

  const undo = useCallback(async () => {
    if (!last || undoing) return;
    setUndoing(true);
    try {
      const res = await undoLast(last.projectId, last.taskId);
      if (!res.ok) return toast(res.error, "error");
      setOverrides((o) => ({ ...o, [last.taskId]: last.from }));
      setLast(null);
      toast(t("Deshecho: {label}", { label: res.data.label }), "undo");
      router.refresh();
    } finally {
      setUndoing(false);
    }
  }, [last, undoing, toast, t, router]);

  // Ctrl/⌘+Z deshace el último cambio de fecha hecho desde el calendario.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z" || isTypingTarget(e.target) || document.querySelector("[role=dialog]")) return;
      if (!last) return;
      e.preventDefault();
      void undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, undo]);

  // El panel «+N más» se cierra con clic fuera o Escape.
  useEffect(() => {
    if (!openDay) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-day-popover]")) setOpenDay(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenDay(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openDay]);

  const onChipKey = (e: React.KeyboardEvent, task: CalendarTask & { due: string }) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -7 : e.key === "ArrowDown" ? 7 : 0;
    if (!step) return;
    e.preventDefault();
    focusAfter.current = task.id;
    void moveTask(task, addDaysIso(task.due, step));
  };

  const chip = (task: CalendarTask & { due: string }) => (
    <Link
      key={task.id}
      href={`/p/${task.projectId}?task=${task.id}`}
      data-chip={task.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(task.id);
      }}
      onDragEnd={() => {
        setDragging(null);
        setDragOver(null);
      }}
      onKeyDown={(e) => onChipKey(e, task)}
      title={`${task.title} · ${task.kind.name}${showProject ? ` · ${task.projectName}` : ""}`}
      aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
      style={kindBadgeStyle(task.kind.color)}
      className={cn(
        "kind-badge flex w-full min-w-0 cursor-grab items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs leading-5 outline-offset-1 focus-visible:outline-3 focus-visible:outline-focus active:cursor-grabbing",
        task.done && "opacity-55 line-through",
        dragging === task.id && "opacity-40",
      )}
    >
      {showProject && <span className="shrink-0 rounded bg-white/60 px-1 text-[10px] font-semibold leading-4 dark:bg-black/30" aria-label={task.projectName}>{initials(task.projectName)}</span>}
      <span className="truncate">{task.title}</span>
    </Link>
  );

  const total = items.length;
  const empty = total === 0 && dels.length === 0;
  const mobileWeeks = groupWeeks(weeks, (iso) => byDay.has(iso) || delByDay.has(iso));
  const weekLabel = (start: string, end: string) => {
    const f = (iso: string, withMonth: boolean) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, withMonth ? { day: "numeric", month: "short", timeZone: "UTC" } : { day: "numeric", timeZone: "UTC" });
    return t("Semana del {from} al {to}", { from: f(start, start.slice(0, 7) !== end.slice(0, 7)), to: f(end, true) });
  };

  const navBtn = "inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-300 px-2.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800";
  const optionCls = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800";
  const selectCls = "h-9 min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900";

  return (
    <div className="mx-auto max-w-7xl p-3 md:p-6" aria-busy={navigating}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 flex items-center gap-2 text-xl font-semibold">
          <CalendarDays size={20} className="text-brand-600" aria-hidden />
          {t("Calendario")}
        </h1>
        <nav className="flex items-center gap-1.5" aria-label={t("Navegar por meses")}>
          <Link href={href({ month: shiftMonth(month, -1) })} className={navBtn} aria-label={t("Mes anterior")}>
            <ChevronLeft size={16} aria-hidden />
            <LinkSpinner />
          </Link>
          <Link href={href({ month: null })} className={navBtn}>
            {t("Hoy")}
            <LinkSpinner />
          </Link>
          <Link href={href({ month: shiftMonth(month, 1) })} className={navBtn} aria-label={t("Mes siguiente")}>
            <LinkSpinner />
            <ChevronRight size={16} aria-hidden />
          </Link>
        </nav>
        <h2 className="order-last min-w-0 basis-full text-lg font-semibold first-letter:uppercase md:order-none md:flex-1 md:basis-auto" aria-live="polite">{monthTitle}</h2>
        {last && (
          <button type="button" onClick={undo} disabled={undoing} className={cn(navBtn, "disabled:opacity-60")} title="Ctrl+Z">
            <Undo2 size={15} aria-hidden />
            {t("Deshacer")}
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("Filtros del calendario")}>
        <Popover
          kind="dialog"
          label={t("Proyectos")}
          onOpenChange={(open) => (open ? setDraft(filters.project) : applyProjects())}
          panelClassName="w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          trigger={({ open, props }) => (
            <button type="button" {...props} aria-label={t("Proyectos")} className={cn(selectCls, "flex w-44 items-center justify-between gap-1.5 text-left md:w-52")}>
              <span className="min-w-0 truncate">{projectLabel}</span>
              {filters.project.length > 1 && <span className="shrink-0 rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-4 text-on-brand tabular-nums">{filters.project.length}</span>}
              <ChevronDown size={14} className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden />
            </button>
          )}
        >
          <ul className="text-sm">
            <li>
              <button type="button" role="checkbox" aria-checked={draft.length === 0} onClick={() => setDraft([])} className={optionCls}>
                <CheckBox on={draft.length === 0} />
                <span className="font-medium">{t("Todos")}</span>
              </button>
            </li>
            {projects.map((p) => (
              <li key={p.id}>
                <button type="button" role="checkbox" aria-checked={draft.includes(p.id)} onClick={() => toggleProject(p.id)} className={optionCls}>
                  <CheckBox on={draft.includes(p.id)} />
                  <span className="min-w-0 truncate">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>
        <select aria-label={t("Persona")} value={filters.person} onChange={(e) => go({ person: e.target.value })} className={cn(selectCls, "w-40 md:w-48")}>
          <option value="">{t("Cualquier persona")}</option>
          <option value="me">{t("Yo")}</option>
          <option value="none">{t("Sin asignar")}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={filters.hideDone} onChange={(e) => go({ hideDone: e.target.checked })} className="size-4 accent-brand-600" />
          {t("Ocultar terminadas")}
        </label>
        {navigating && <Loader2 size={16} className="animate-spin text-slate-400" aria-label={t("Cargando")} />}
      </div>

      {truncated && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">{t("Hay muchas tareas este mes: se muestran solo las primeras. Filtra por proyecto o persona.")}</p>}

      {empty && (
        <div className="card mb-3 flex flex-col items-center gap-2 p-8 text-center text-sm text-slate-500">
          <CalendarDays size={32} className="text-slate-300" aria-hidden />
          {t("No hay tareas ni entregables con fecha en este mes.")}
        </div>
      )}

      {/* Escritorio: cuadrícula mensual */}
      <div className={cn("hidden md:block", navigating && "opacity-60 transition-opacity", empty && "hidden!")}>
        <div className="card overflow-visible">
          <div className="grid grid-cols-7 border-b border-slate-200 text-center text-xs font-semibold uppercase text-slate-500 dark:border-slate-800">
            {weekdays.map((w) => (
              <div key={w} className="py-2">{w}</div>
            ))}
          </div>
          {weeks.map((week) => {
            const bands = bandsForWeek(week.map((d) => d.iso), dels.map((d) => ({ id: d.id, dueDate: d.due })));
            return (
              <div key={week[0]!.iso} className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
                {bands.length > 0 && (
                  <div className="grid grid-cols-7 gap-y-0.5 px-0.5 pt-1" aria-label={t("Entregables")}>
                    {bands.slice(0, MAX_BANDS).map((b) => {
                      const d = delById.get(b.id)!;
                      const status = d.status;
                      return (
                        <Link
                          key={b.id}
                          href={`/p/${d.projectId}`}
                          style={{ gridColumn: `${b.colStart} / ${b.colEnd + 1}` }}
                          title={`${d.name} · ${showProject ? `${d.projectName} · ` : ""}${t("{done} de {total} tareas", { done: d.done, total: d.total })} · ${t(status)}`}
                          className={cn(
                            "relative flex h-5 min-w-0 items-center gap-1 overflow-hidden border px-1.5 text-[11px] leading-5 hover:brightness-95",
                            STATUS_STYLE[status],
                            b.continuesLeft ? "rounded-l-none border-l-0" : "rounded-l",
                            b.endsHere ? "rounded-r" : "rounded-r-none border-r-0",
                          )}
                        >
                          <span className={cn("pointer-events-none absolute inset-y-0 left-0", STATUS_BAR[status])} style={{ width: `${d.pct}%` }} aria-hidden />
                          {b.endsHere && <Flag size={11} className="relative shrink-0" aria-hidden />}
                          <span className="relative truncate font-medium">{d.name}</span>
                          <span className="relative ml-auto shrink-0 tabular-nums">{d.total ? `${d.done}/${d.total}` : t(status)}</span>
                        </Link>
                      );
                    })}
                    {bands.length > MAX_BANDS && <span className="col-span-7 px-1 text-[11px] text-slate-500">{t("+{n} entregables más", { n: bands.length - MAX_BANDS })}</span>}
                  </div>
                )}
                <div className="grid grid-cols-7">
                  {week.map((day, i) => {
                    const list = byDay.get(day.iso) ?? [];
                    const shown = list.length > MAX_CHIPS ? list.slice(0, MAX_CHIPS - 1) : list;
                    const hidden = list.length - shown.length;
                    const isToday = day.iso === today;
                    return (
                      <div
                        key={day.iso}
                        role="group"
                        aria-label={`${dayLabel(day.iso)}${list.length ? `, ${t("{n} tarea(s)", { n: list.length })}` : ""}`}
                        onDragOver={(e) => {
                          if (!dragging) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (dragOver !== day.iso) setDragOver(day.iso);
                        }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver((d) => (d === day.iso ? null : d));
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const id = e.dataTransfer.getData("text/plain") || dragging;
                          setDragging(null);
                          setDragOver(null);
                          const task = items.find((x) => x.id === id);
                          if (task) void moveTask(task, day.iso);
                        }}
                        data-day={day.iso}
                        className={cn(
                          "relative min-h-28 min-w-0 border-l border-slate-200 p-1 first:border-l-0 dark:border-slate-800",
                          !day.inMonth && "bg-slate-50/70 dark:bg-slate-900/40",
                          dragOver === day.iso && "bg-brand-50 ring-2 ring-inset ring-brand-500 dark:bg-brand-950/40",
                        )}
                      >
                        <div className={cn("mb-1 flex h-5 items-center justify-end text-xs", day.inMonth ? "text-slate-600 dark:text-slate-300" : "text-slate-400 dark:text-slate-600")}>
                          <span className={cn("inline-flex min-w-5 items-center justify-center rounded-full px-1 tabular-nums", isToday && "bg-brand-600 font-semibold text-on-brand")}>{Number(day.iso.slice(8))}</span>
                        </div>
                        <div className="space-y-0.5">
                          {shown.map(chip)}
                          {hidden > 0 && (
                            <button
                              type="button"
                              onClick={() => setOpenDay(openDay === day.iso ? null : day.iso)}
                              aria-expanded={openDay === day.iso}
                              className="w-full rounded px-1.5 py-0.5 text-left text-xs font-medium text-brand-700 hover:bg-slate-100 dark:text-brand-300 dark:hover:bg-slate-800"
                            >
                              {t("+{n} más", { n: hidden })}
                            </button>
                          )}
                        </div>
                        {openDay === day.iso && (
                          <div
                            data-day-popover
                            role="dialog"
                            aria-label={dayLabel(day.iso)}
                            className={cn("absolute top-0 z-30 w-60 max-w-[80vw] rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900", i >= 4 ? "right-0" : "left-0")}
                          >
                            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold first-letter:uppercase">
                              <span className="truncate">{dayLabel(day.iso)}</span>
                              <button type="button" autoFocus onClick={() => setOpenDay(null)} className="rounded p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t("Cerrar")}>
                                <X size={14} aria-hidden />
                              </button>
                            </div>
                            <div className="max-h-64 space-y-0.5 overflow-y-auto">{list.map(chip)}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">{t("Arrastra una tarea a otro día para cambiar su fecha límite (o Alt+←/→ con ella enfocada).")}</p>
      </div>

      {/* Móvil: lista por semanas */}
      <div className={cn("space-y-5 md:hidden", navigating && "opacity-60 transition-opacity", empty && "hidden!")}>
        {mobileWeeks.map((w) => (
          <section key={w.start} aria-label={weekLabel(w.start, w.end)}>
            <h3 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">{weekLabel(w.start, w.end)}</h3>
            <div className="card divide-y divide-slate-200 dark:divide-slate-800">
              {w.days.map((iso) => (
                <div key={iso} className="px-3 py-2">
                  <div className={cn("mb-1.5 text-xs font-semibold first-letter:uppercase", iso === today ? "text-brand-600" : "text-slate-500")}>
                    {dayLabel(iso)}
                    {iso === today && ` · ${t("Hoy")}`}
                  </div>
                  <ul className="space-y-1">
                    {(delByDay.get(iso) ?? []).map((d) => (
                      <li key={d.id}>
                        <Link href={`/p/${d.projectId}`} className={cn("relative flex min-w-0 items-center gap-1.5 overflow-hidden rounded border px-2 py-1 text-xs", STATUS_STYLE[d.status])}>
                          <span className={cn("pointer-events-none absolute inset-y-0 left-0", STATUS_BAR[d.status])} style={{ width: `${d.pct}%` }} aria-hidden />
                          <Flag size={12} className="relative shrink-0" aria-hidden />
                          <span className="relative min-w-0 flex-1 truncate font-medium">{d.name}</span>
                          <span className="relative shrink-0 tabular-nums">{d.total ? `${d.done}/${d.total} · ` : ""}{t(d.status)}</span>
                        </Link>
                      </li>
                    ))}
                    {(byDay.get(iso) ?? []).map((task) => (
                      <li key={task.id}>
                        <Link
                          href={`/p/${task.projectId}?task=${task.id}`}
                          style={kindBadgeStyle(task.kind.color)}
                          className={cn("kind-badge flex min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-sm", task.done && "opacity-55 line-through")}
                        >
                          <span className="min-w-0 flex-1 truncate">{task.title}</span>
                          {showProject && <span className="shrink-0 rounded bg-white/60 px-1 text-[10px] font-semibold leading-4 dark:bg-black/30" title={task.projectName} aria-label={task.projectName}>{initials(task.projectName)}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
