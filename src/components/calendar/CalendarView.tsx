"use client";

import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Flag, Loader2, Repeat, Undo2, X } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { undoLast } from "@/actions/undo";
import { moveDeliverable } from "@/actions/projects";
import { updateTask } from "@/actions/tasks";
import { BAND_DAYS, PERSON_UNASSIGNED, TOUCH_DRAG_DELAY_MS, bandsForWeek, outsideGrid, visibleBands, columnAt, dragRange, groupByDay, groupWeeks, isRange, pendingBandDrag, rangeBandsForWeek, shiftMonth, weekRangeEnds, type Band, type CalendarDay, type RangeDragMode } from "@/lib/calendar";
import { kindBadgeStyle } from "@/lib/constants";
import { addDaysIso, daysBetween, formatDay } from "@/lib/dates";
import { deliverableStatus, type DeliverableStatus } from "@/lib/report";
import { useIntlLocale, useT } from "@/i18n/client";
import { isTypingTarget } from "@/components/board/shortcuts";
import { cn } from "@/components/ui/cn";
import { InfoTip } from "@/components/ui/InfoTip";
import { Popover } from "@/components/ui/Popover";
import { CalendarSubscribe } from "./CalendarSubscribe";
import { useToast } from "@/components/ui/Toast";
import { useSafeRefresh } from "@/components/useSafeRefresh";
import { useMidnightRefresh } from "@/components/useMidnightRefresh";
import { initialsOf } from "@/lib/graphemes";
import type { RecurrenceRule } from "@/lib/recurrence-date";
import { recurrenceLabel } from "@/components/board/recurrence-ui";
import { actionThrowResult } from "@/lib/stale-action";

export interface CalendarTask {
  id: string;
  title: string;
  /** Fecha límite (YYYY-MM-DD). */
  due: string;
  /** Fecha de inicio (solo si el proyecto la tiene activada): con inicio anterior a la fecha límite se dibuja como rango. */
  start: string | null;
  projectId: string;
  projectName: string;
  kind: { name: string; color: string };
  /** Está en una columna de terminadas. */
  done: boolean;
}

/** Aparición futura prevista de una tarea que se repite (aún no existe: nace al terminar la anterior). */
export interface CalendarRepeat {
  /** `${taskId}:${due}` (única en el mes). */
  key: string;
  /** Tarea de la que sale (la que se abre al pulsarla). */
  taskId: string;
  title: string;
  /** Día previsto (YYYY-MM-DD). */
  due: string;
  projectId: string;
  projectName: string;
  kind: { name: string; color: string };
  recurrence: RecurrenceRule;
  recurrenceDay: number | null;
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

interface TaskDates {
  start: string | null;
  due: string;
}

/** Fechas que tendría la banda arrastrada si se soltara ahora. */
interface Preview {
  kind: "task" | "del";
  id: string;
  start: string;
  due: string;
}

/** Último cambio hecho desde el calendario (el que deshace Ctrl+Z). */
type Last = { kind: "task"; taskId: string; projectId: string; from: TaskDates } | { kind: "deliverable"; id: string; from: string };

interface BandDrag {
  kind: "task" | "del";
  id: string;
  mode: RangeDragMode;
  grabbed: string;
  origin: { start: string; due: string };
  x: number;
  y: number;
  moved: boolean;
  /** Ratón: siempre. Dedo o lápiz: tras la pulsación larga (TOUCH_DRAG_DELAY_MS sin moverse). */
  held: boolean;
  pointerType: string;
  last: string | null;
  result: Preview | null;
  stop: () => void;
}

/** Día de la cuadrícula bajo un punto de la pantalla (null fuera de las semanas). Cada fila lleva su primer día en data-week. */
function dayAtPoint(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const row = el.closest<HTMLElement>("[data-week]");
    if (row?.dataset.week) {
      const r = row.getBoundingClientRect();
      return addDaysIso(row.dataset.week, columnAt(x, r.left, r.width));
    }
  }
  return null;
}

interface Filters {
  /** Proyectos elegidos; vacío = todos aquellos en los que trabaja. */
  project: string[];
  /** Ids de personas elegidas (y/o PERSON_UNASSIGNED); vacío = cualquiera. */
  person: string[];
  hideDone: boolean;
}

interface Props {
  month: string;
  today: string;
  weeks: CalendarDay[][];
  tasks: CalendarTask[];
  /** Vencidas sin terminar de antes de la cuadrícula (solo en el mes actual y los siguientes): las primeras y el total. */
  overdue?: { tasks: CalendarTask[]; total: number };
  /** Apariciones futuras previstas de las tareas que se repiten (solo días posteriores a hoy). */
  repeats: CalendarRepeat[];
  deliverables: CalendarDeliverable[];
  projects: { id: string; name: string }[];
  people: { id: string; name: string }[];
  /** Usuario actual: aparece una sola vez en el selector de personas, como «Nombre (yo)». */
  meId: string;
  filters: Filters;
  /** Se alcanzó el tope de tareas cargadas. */
  truncated: boolean;
  /** Suscripción viva (.ics) de la persona: si la tiene activa y qué incluye (null sin suscripción: la opción que se
   * propone se pide al abrir «Suscribirse»). */
  feed: { active: boolean; scope: "MINE" | "ALL" | null };
}

/** Chips visibles por día antes de «+N más». */
const MAX_CHIPS = 3;
/** Bandas de entregable visibles por semana. */
const MAX_BANDS = 3;
/** Bandas de tareas con rango visibles por semana. */
const MAX_RANGES = 4;

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

/** Iniciales del proyecto: las dos primeras palabras con letras o números, sin puntuación («Trello «raro» 🎉» → «TR»). */
const initials = (name: string) => initialsOf(name, "firstTwo");

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

/** Vencida: sin terminar y con la fecha límite ya pasada. Se marca con el mismo rojo que «Vencidas» en «Mis tareas». */
const isOverdue = (task: { done: boolean; due: string }, today: string) => !task.done && task.due < today;
/** Marca de vencida en los chips y filas del calendario (borde izquierdo rojo, como las filas vencidas de «Mis tareas»). */
const OVERDUE_MARK = "border-l-[3px] border-l-red-600 dark:border-l-red-500";

export function CalendarView({ month, today, weeks, tasks, overdue, repeats, deliverables, projects, people, meId, filters, truncated, feed }: Props) {
  const t = useT();
  const locale = useIntlLocale();
  const router = useRouter();
  const safeRefresh = useSafeRefresh();
  // A medianoche (zona de la app) cambian «Hoy», las vencidas y, sin ?month, el mes mostrado: se pide la página de nuevo.
  useMidnightRefresh(today, safeRefresh);
  const toast = useToast();
  const [navigating, startNav] = useTransition();
  // Fechas cambiadas aquí y aún no reflejadas en los datos del servidor (cambio optimista).
  const [overrides, setOverrides] = useState<Record<string, TaskDates>>({});
  const [delOverrides, setDelOverrides] = useState<Record<string, string>>({});
  // Datos nuevos del servidor (ya con el cambio, o con el de otra persona): las fechas optimistas sobran.
  const [seenTasks, setSeenTasks] = useState(tasks);
  if (seenTasks !== tasks) {
    setSeenTasks(tasks);
    setOverrides({});
  }
  const [seenDels, setSeenDels] = useState(deliverables);
  if (seenDels !== deliverables) {
    setSeenDels(deliverables);
    setDelOverrides({});
  }
  // Vista previa mientras se arrastra una banda (tarea con rango o entregable): las fechas que tendría al soltar.
  const [preview, setPreview] = useState<Preview | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const [undoing, setUndoing] = useState(false);
  const focusAfter = useRef<string | null>(null);
  // Banda movida con el teclado: se sigue dibujando aunque en su nueva semana quede detrás de «+N más», para no perder el
  // foco. Se olvida en cuanto el foco va a otra cosa o se pulsa en otro sitio.
  const [kbMoved, setKbMoved] = useState<string | null>(null);
  useEffect(() => {
    if (!kbMoved) return;
    const sel = `[data-band="${CSS.escape(kbMoved)}"]`;
    const onFocus = (e: FocusEvent) => !(e.target as Element | null)?.closest?.(sel) && setKbMoved(null);
    // Pulsar la propia banda no la olvida (si no, pasaría a «+N más» antes del clic y el clic se perdería).
    const onDown = (e: PointerEvent) => !(e.target as Element | null)?.closest?.(sel) && setKbMoved(null);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [kbMoved]);
  const prevMonthRef = useRef<HTMLAnchorElement>(null);
  const nextMonthRef = useRef<HTMLAnchorElement>(null);


  // Móvil, mes actual: al abrirlo se baja hasta hoy (o hasta el primer día con algo a partir de hoy). Solo al cambiar de
  // mes, no en cada refresco de los datos, y no si ya se ha desplazado la página. Con vencidas de meses anteriores no se
  // baja: su aviso va arriba y quedaría fuera de la vista; el aviso lleva «Ir a hoy» para bajar a mano.
  const hasOverdue = (overdue?.total ?? 0) > 0;
  useEffect(() => {
    if (hasOverdue || month !== today.slice(0, 7) || !window.matchMedia("(max-width: 767px)").matches) return;
    const target = mobileTodayRow(today);
    if (!target) return;
    const scroller = target.closest("main");
    if ((scroller ? scroller.scrollTop : window.scrollY) > 0) return;
    target.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al llegar al mes
  }, [month]);

  const items = useMemo(
    () =>
      tasks.map((x) => {
        const o = preview?.kind === "task" && preview.id === x.id ? preview : overrides[x.id];
        return o ? { ...x, start: o.start, due: o.due } : x;
      }),
    [tasks, overrides, preview],
  );
  const byDay = useMemo(() => {
    const map = groupByDay(items, (x) => x.due);
    // Pendientes antes que terminadas; dentro de cada grupo, el orden del servidor.
    for (const [day, list] of map) map.set(day, [...list].sort((a, b) => Number(a.done) - Number(b.done)));
    return map;
  }, [items]);

  // Las tareas con rango se dibujan como banda y no como chip (la banda se arrastra con el puntero, ver startBandDrag).
  const ranged = useMemo(() => items.filter((x) => isRange(x.start, x.due)), [items]);
  const rangedById = useMemo(() => new Map(ranged.map((x) => [x.id, x])), [ranged]);
  const chipsByDay = useMemo(() => {
    if (!ranged.length) return byDay;
    const map = new Map<string, typeof items>();
    for (const [day, list] of byDay) {
      const rest = list.filter((x) => !rangedById.has(x.id));
      if (rest.length) map.set(day, rest);
    }
    return map;
  }, [byDay, ranged.length, rangedById]);

  // Entregables con su estado; los terminados desaparecen con «ocultar terminadas».
  const dels = useMemo(
    () =>
      deliverables
        .map((x) => {
          const d = { ...x, due: preview?.kind === "del" && preview.id === x.id ? preview.due : (delOverrides[x.id] ?? x.due) };
          return { ...d, status: deliverableStatus(d.total, d.done, daysBetween(today, d.due)), pct: d.total ? Math.round((d.done / d.total) * 100) : 0 };
        })
        .filter((d) => !(filters.hideDone && d.status === "Completado")),
    [deliverables, today, filters.hideDone, delOverrides, preview],
  );
  const delById = useMemo(() => new Map(dels.map((d) => [d.id, d])), [dels]);

  useEffect(() => {
    // Tras mover con teclado el chip se vuelve a pintar en otro día: recupera el foco.
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    const el = document.querySelector<HTMLElement>(`[data-chip="${CSS.escape(id)}"], [data-band="${CSS.escape(id)}"]`);
    if (el) return el.focus();
    const task = items.find((x) => x.id === id);
    const del = task ? undefined : dels.find((d) => d.id === id);
    const span = task ? { start: isRange(task.start, task.due) ? task.start! : task.due, due: task.due } : del ? { start: addDaysIso(del.due, -(BAND_DAYS - 1)), due: del.due } : null;
    if (!span) return;
    // Ha salido de la cuadrícula (Alt+↑ en la primera semana, Alt+↓ en la última): al botón del mes al que ha ido.
    const side = outsideGrid(span, weeks[0]![0]!.iso, weeks.at(-1)!.at(-1)!.iso);
    if (side) return (side === "prev" ? prevMonthRef : nextMonthRef).current?.focus();
    // En un día lleno la tarea puede quedar dentro de «+N más»: se abre ese panel y el foco va a la tarea (en el siguiente
    // dibujo, ya con el panel). Si el panel ya está abierto y no aparece, al menos al botón del día. Las bandas no van en
    // ese panel (siguen a la vista gracias a kbMoved).
    if (!task || isRange(task.start, task.due)) return;
    const toggle = document.querySelector<HTMLElement>(`[data-day-toggle="${CSS.escape(task.due)}"]`);
    if (!toggle) return;
    if (openDay === task.due) return toggle.focus();
    focusAfter.current = id;
    setOpenDay(task.due);
  }, [items, dels, openDay, weeks]);
  const repeatsByDay = useMemo(() => groupByDay(repeats, (r) => r.due), [repeats]);
  const delByDay = useMemo(() => groupByDay(dels, (d) => d.due), [dels]);

  const href = useCallback(
    (over: Partial<Filters> & { month?: string | null }) => {
      const f = { ...filters, ...over };
      const m = over.month === undefined ? month : over.month;
      const q = new URLSearchParams();
      if (m && m !== today.slice(0, 7)) q.set("month", m);
      if (f.project.length) q.set("project", f.project.join(","));
      if (f.person.length) q.set("person", f.person.join(","));
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
  // Selector de personas: igual que el de proyectos. Primero las opciones generales, luego el usuario actual y el resto.
  const [draftPeople, setDraftPeople] = useState<string[]>(filters.person);
  const togglePerson = (id: string) => setDraftPeople((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const applyPeople = () => {
    const same = draftPeople.length === filters.person.length && draftPeople.every((id) => filters.person.includes(id));
    if (!same) go({ person: draftPeople });
  };
  const personOptions = useMemo(() => {
    const me = people.find((p) => p.id === meId);
    return [
      { id: PERSON_UNASSIGNED, label: t("Sin responsable") },
      ...(me ? [{ id: me.id, label: t("{name} (yo)", { name: me.name }) }] : []),
      ...people.filter((p) => p.id !== meId).map((p) => ({ id: p.id, label: p.name })),
    ];
  }, [people, meId, t]);
  const personLabel =
    filters.person.length === 0
      ? t("Cualquier persona")
      : filters.person.length === 1
        ? (personOptions.find((o) => o.id === filters.person[0])?.label ?? t("1 persona"))
        : t("{n} personas", { n: filters.person.length });
  const projectLabel =
    filters.project.length === 0 ? t("Todos los proyectos") : filters.project.length === 1 ? (projects.find((p) => p.id === filters.project[0])?.name ?? t("1 proyecto")) : t("{n} proyectos", { n: filters.project.length });

  // Guarda las fechas nuevas de una tarea en una sola actualización (con deshacer en el servidor).
  const saveTask = useCallback(
    async (task: CalendarTask, next: TaskDates) => {
      const from = overrides[task.id] ?? { start: task.start, due: task.due };
      if (from.due === next.due && from.start === next.start) return;
      setOverrides((o) => ({ ...o, [task.id]: next }));
      // Sin red la acción lanza: vuelve a las fechas anteriores con «Sin conexión: no se ha guardado» (antes el chip se
      // quedaba en el día nuevo sin haberse guardado y sin ningún aviso).
      const res = await updateTask(task.id, { ...(next.start !== from.start ? { startDate: next.start } : {}), dueDate: next.due }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) {
        // Vuelve a las fechas anteriores.
        setOverrides((o) => ({ ...o, [task.id]: from }));
        toast(res.error, "error");
        return;
      }
      setLast({ kind: "task", taskId: task.id, projectId: task.projectId, from });
      toast(next.start && next.start !== next.due ? t("Rango cambiado: {from} → {to}", { from: formatDay(next.start, today, locale), to: formatDay(next.due, today, locale) }) : t("Fecha límite cambiada al {date}", { date: formatDay(next.due, today, locale) }));
      safeRefresh();
    },
    [overrides, toast, t, today, locale, safeRefresh],
  );
  // Un chip (sin rango) se mueve entero: el inicio, si lo tiene, acompaña a la fecha límite.
  const moveTask = useCallback(
    (task: CalendarTask, to: string) => {
      const cur = overrides[task.id] ?? { start: task.start, due: task.due };
      return saveTask(task, { start: isRange(cur.start, cur.due) ? cur.start : cur.start ? to : null, due: to });
    },
    [saveTask, overrides],
  );

  const saveDeliverable = useCallback(
    async (d: CalendarDeliverable, to: string) => {
      const from = delOverrides[d.id] ?? d.due;
      if (from === to) return;
      setDelOverrides((o) => ({ ...o, [d.id]: to }));
      const res = await moveDeliverable(d.id, to).catch((e) => actionThrowResult(e, t));
      if (!res.ok) {
        setDelOverrides((o) => ({ ...o, [d.id]: from }));
        toast(res.error, "error");
        return;
      }
      setLast({ kind: "deliverable", id: d.id, from });
      toast(t("Entregable movido al {date}", { date: formatDay(to, today, locale) }));
      safeRefresh();
    },
    [delOverrides, toast, t, today, locale, safeRefresh],
  );

  const undo = useCallback(async () => {
    if (!last || undoing) return;
    setUndoing(true);
    try {
      if (last.kind === "deliverable") {
        const res = await moveDeliverable(last.id, last.from).catch((e) => actionThrowResult(e, t));
        if (!res.ok) return toast(res.error, "error");
        setDelOverrides((o) => ({ ...o, [last.id]: last.from }));
        setLast(null);
        toast(t("Deshecho: {label}", { label: t("Entregable movido al {date}", { date: formatDay(last.from, today, locale) }) }), "undo");
        safeRefresh();
        return;
      }
      const res = await undoLast(last.projectId, last.taskId).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      setOverrides((o) => ({ ...o, [last.taskId]: last.from }));
      setLast(null);
      toast(t("Deshecho: {label}", { label: res.data.label }), "undo");
      safeRefresh();
    } finally {
      setUndoing(false);
    }
  }, [last, undoing, toast, t, safeRefresh, today, locale]);

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

  // Cierra el panel «+N más». Con Escape o «Cerrar» el foco vuelve al botón que lo abrió (si estaba en el panel o se ha
  // perdido): al desmontarse el panel el foco caía en <body>.
  const closeDay = useCallback((returnFocus: boolean) => {
    const key = openDay;
    setOpenDay(null);
    if (!returnFocus || !key) return;
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest("[data-day-popover]")) return;
    document.querySelector<HTMLElement>(`[data-day-toggle="${CSS.escape(key)}"]`)?.focus();
  }, [openDay]);

  // El panel «+N más» se cierra con clic fuera o Escape.
  useEffect(() => {
    if (!openDay) return;
    const onDown = (e: PointerEvent) => {
      // Los botones «+N más» alternan el panel por su cuenta (si no, cerrar y reabrir en el mismo clic).
      if (!(e.target as HTMLElement).closest?.("[data-day-popover], [data-day-toggle]")) closeDay(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeDay(true);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openDay, closeDay]);

  const onChipKey = (e: React.KeyboardEvent, task: CalendarTask & { due: string }) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -7 : e.key === "ArrowDown" ? 7 : 0;
    if (!step) return;
    e.preventDefault();
    focusAfter.current = task.id;
    void moveTask(task, addDaysIso(task.due, step));
  };

  // Teclado en una banda: Alt+flechas mueve el rango entero (±1 día, ±7 con arriba/abajo); Alt+Mayús+←/→ cambia solo su fin.
  const onBandKey = (e: React.KeyboardEvent, kind: "task" | "del", id: string) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -7 : e.key === "ArrowDown" ? 7 : 0;
    if (!step) return;
    e.preventDefault();
    // El foco sigue a la banda solo si de verdad se mueve: si no, focusAfter se quedaba puesto y lo robaba más tarde (al
    // abrir un «+N más» o con el siguiente cambio de las tareas).
    const moved = () => {
      focusAfter.current = id;
      setKbMoved(id);
    };
    if (kind === "del") {
      const d = delById.get(id);
      const del = deliverables.find((x) => x.id === id);
      if (!d || !del) return;
      moved();
      void saveDeliverable(del, addDaysIso(d.due, step));
      return;
    }
    const task = tasks.find((x) => x.id === id);
    const cur = rangedById.get(id);
    if (!task || !cur?.start) return;
    let next: TaskDates;
    if (e.shiftKey) {
      if (Math.abs(step) !== 1) return;
      const due = addDaysIso(cur.due, step);
      next = { start: cur.start, due: due < cur.start ? cur.start : due };
    } else next = { start: addDaysIso(cur.start, step), due: addDaysIso(cur.due, step) };
    if (next.start === cur.start && next.due === cur.due) return;
    moved();
    void saveTask(task, next);
  };

  // Arrastre con el puntero (ratón o dedo) de bandas: mover entera o redimensionar por un borde. Se usan eventos de
  // puntero y no el arrastre nativo porque hay que seguir al puntero entre semanas y dibujar el resultado en vivo.
  const dragRef = useRef<BandDrag | null>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const commitRef = useRef<(d: BandDrag, p: Preview) => void>(() => {});
  useEffect(() => {
    commitRef.current = (d, p) => {
      if (d.kind === "del") {
        const del = deliverables.find((x) => x.id === d.id);
        if (del) void saveDeliverable(del, p.due);
      } else {
        const task = tasks.find((x) => x.id === d.id);
        if (task) void saveTask(task, { start: p.start, due: p.due });
      }
    };
  });
  useEffect(() => {
    return () => dragRef.current?.stop();
  }, []);

  // Una banda cogida con el dedo no debe desplazar la página al arrastrarla a otra semana. iOS Safari decide al empezar
  // el toque si hay escuchadores de touchmove que bloquean; uno añadido a mitad del gesto (en pointerdown) llega tarde y
  // su preventDefault() no hace nada. Por eso los grupos de bandas llevan desde que se montan un touchmove no pasivo que
  // solo bloquea mientras hay una banda cogida; el resto de la página se sigue desplazando sin pasar por aquí.
  const holdBandTouch = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const onTouchMove = (ev: TouchEvent) => {
      if (dragRef.current?.held && ev.cancelable) ev.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  const startBandDrag = (e: React.PointerEvent, kind: "task" | "del", id: string, mode: RangeDragMode, origin: { start: string; due: string }) => {
    if (e.button !== 0 || e.altKey || !e.isPrimary || dragRef.current) return;
    const grabbed = dayAtPoint(e.clientX, e.clientY);
    if (!grabbed) return;
    if (mode !== "move") e.stopPropagation();
    const pointerType = e.pointerType || "mouse";
    const band = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-band]");
    const drag: BandDrag = { kind, id, mode, grabbed, origin, x: e.clientX, y: e.clientY, moved: false, held: pointerType === "mouse", pointerType, last: null, result: null, stop: () => {} };
    // Con el dedo, la banda se coge tras una pulsación larga (la marca data-held); antes, deslizar desplaza la página
    // (touch-pan-y) y el navegador cancela este puntero con pointercancel.
    const holdTimer = drag.held
      ? undefined
      : setTimeout(() => {
          drag.held = true;
          band?.setAttribute("data-held", "");
        }, TOUCH_DRAG_DELAY_MS);
    const onMove = (ev: PointerEvent) => {
      if (!drag.moved) {
        const step = pendingBandDrag(drag.pointerType, drag.held, Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y));
        if (step === "wait") return;
        if (step === "abort") return finish(true);
      }
      drag.moved = true;
      if (labelRef.current) labelRef.current.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 14}px)`;
      const day = dayAtPoint(ev.clientX, ev.clientY);
      if (!day) return;
      const next = dragRange(origin, mode, grabbed, day);
      const key = `${next.start}|${next.due}`;
      if (drag.last === key) return;
      drag.last = key;
      drag.result = { kind, id, ...next };
      setPreview(drag.result);
    };
    const finish = (cancel: boolean) => {
      drag.stop();
      dragRef.current = null;
      // Soltar tras una pulsación larga sin mover tampoco abre la tarea: se había cogido para arrastrarla.
      if (drag.moved || (drag.held && drag.pointerType !== "mouse")) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 150);
      }
      setPreview(null);
      if (!cancel && drag.moved && drag.result) commitRef.current(drag, drag.result);
    };
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    const onEsc = (ev: KeyboardEvent) => ev.key === "Escape" && finish(true);
    // Con el dedo, la pulsación larga no debe abrir el menú del enlace (el desplazamiento lo bloquea holdBandTouch).
    const onContextMenu = (ev: Event) => ev.preventDefault();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onEsc);
    if (!drag.held) window.addEventListener("contextmenu", onContextMenu);
    // Los eventos táctiles van siempre al elemento donde empezó el toque. Si la vista previa saca la banda de su semana,
    // React lo desmonta y los touchmove ya no suben al grupo (holdBandTouch): el navegador se quedaría con el gesto y
    // cancelaría el arrastre. Un escuchador en el propio elemento tocado sigue recibiéndolos aunque esté fuera del DOM.
    const touchTarget = pointerType === "mouse" ? null : (e.target as EventTarget | null);
    const onTargetTouchMove = (ev: Event) => {
      if (drag.held && ev.cancelable) ev.preventDefault();
    };
    touchTarget?.addEventListener("touchmove", onTargetTouchMove, { passive: false });
    drag.stop = () => {
      touchTarget?.removeEventListener("touchmove", onTargetTouchMove);
      clearTimeout(holdTimer);
      band?.removeAttribute("data-held");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onEsc);
      window.removeEventListener("contextmenu", onContextMenu);
    };
    dragRef.current = drag;
  };
  // Un clic que termina un arrastre no debe abrir la tarea.
  const onBandClick = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.preventDefault();
      suppressClick.current = false;
    }
  };
  // Entre las bandas visibles siempre van la que se arrastra y la recién movida con el teclado, aunque por su nueva
  // posición quedaran fuera del tope.
  const bandView = (bands: Band[], max: number) => visibleBands(bands, max, [preview?.id, kbMoved]);

  const chip = (task: CalendarTask & { due: string }) => (
    <Link
      // Sin precarga: cada tarea visible era una petición del tablero entero (el calendario pasaba de 23 a 97 consultas).
      prefetch={false}
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
        isOverdue(task, today) && OVERDUE_MARK,
        dragging === task.id && "opacity-40",
      )}
      data-overdue={isOverdue(task, today) || undefined}
    >
      {showProject && <span className="shrink-0 rounded bg-white/60 px-1 text-[10px] font-semibold leading-4 dark:bg-black/30" aria-label={task.projectName}>{initials(task.projectName)}</span>}
      <span dir="auto" className="truncate">{task.title}</span>
      {isOverdue(task, today) && <span className="sr-only">{` (${t("Plazo vencido")})`}</span>}
    </Link>
  );

  // Aparición prevista: sin fondo, con borde discontinuo y el icono de repetir; no se arrastra y abre la tarea de la que sale.
  const repeatChip = (r: CalendarRepeat, size: "sm" | "md" = "sm") => {
    const rule = recurrenceLabel(r, t, locale) ?? "";
    return (
      <Link
        // Sin precarga: cada tarea visible era una petición del tablero entero (el calendario pasaba de 23 a 97 consultas).
        prefetch={false}
        key={r.key}
        href={`/p/${r.projectId}?task=${r.taskId}`}
        data-repeat={r.taskId}
        data-repeat-day={r.due}
        draggable={false}
        title={`${r.title} · ${t("Repetición prevista")} (${rule})${showProject ? ` · ${r.projectName}` : ""}`}
        style={kindBadgeStyle(r.kind.color)}
        className={cn(
          "kind-badge flex w-full min-w-0 items-center gap-1 rounded border border-dashed bg-transparent! text-left opacity-75 shadow-none! outline-offset-1 [border-color:var(--kind)] hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-3 focus-visible:outline-focus",
          size === "sm" ? "px-1.5 py-px text-xs leading-5" : "px-2 py-1 text-sm",
        )}
      >
        <Repeat size={size === "sm" ? 11 : 13} className="shrink-0" aria-hidden />
        {showProject && <span className="shrink-0 rounded bg-white/60 px-1 text-[10px] font-semibold leading-4 dark:bg-black/30" aria-label={r.projectName}>{initials(r.projectName)}</span>}
        <span dir="auto" className="min-w-0 flex-1 truncate">{r.title}</span>
        <span className="sr-only">{` (${t("Repetición prevista")}: ${rule})`}</span>
      </Link>
    );
  };

  const total = items.length;
  const empty = total === 0 && dels.length === 0 && repeats.length === 0;
  // Móvil: una tarea con rango que termina después del mes se muestra en su día de inicio (o el 1 si empezó antes).
  const monthEnd = `${month}-31`; // cota de cadena: mayor que cualquier día del mes y menor que el 1 del siguiente
  const mobileByDay = groupByDay(items, (x) => (isRange(x.start, x.due) && x.due > monthEnd ? (x.start! < `${month}-01` ? `${month}-01` : x.start!) : x.due));
  const mobileWeeks = groupWeeks(weeks, (iso) => mobileByDay.has(iso) || delByDay.has(iso) || repeatsByDay.has(iso));
  const mobileEmpty = !empty && mobileWeeks.length === 0;
  const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const weekLabel = (start: string, end: string) => t("Semana del {from} al {to}", weekRangeEnds(start, end, locale));

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
          <Link ref={prevMonthRef} href={href({ month: shiftMonth(month, -1) })} className={navBtn} aria-label={t("Mes anterior")}>
            <ChevronLeft size={16} aria-hidden />
            <LinkSpinner />
          </Link>
          <Link href={href({ month: null })} className={navBtn}>
            {t("Hoy")}
            <LinkSpinner />
          </Link>
          <Link ref={nextMonthRef} href={href({ month: shiftMonth(month, 1) })} className={navBtn} aria-label={t("Mes siguiente")}>
            <LinkSpinner />
            <ChevronRight size={16} aria-hidden />
          </Link>
        </nav>
        <h2 className="order-last min-w-0 basis-full text-lg font-semibold first-letter:uppercase md:order-none md:flex-1 md:basis-auto" aria-live="polite">{monthTitle}</h2>
        <CalendarSubscribe initialActive={feed.active} initialScope={feed.scope} className="ml-auto md:ml-0" />
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
            <button type="button" {...props} className={cn(selectCls, "flex w-44 items-center justify-between gap-1.5 text-left md:w-52")}>
              <span className="min-w-0 truncate"><span className="sr-only">{`${t("Proyectos")}: `}</span>{projectLabel}</span>
              {filters.project.length > 1 && <span aria-hidden className="shrink-0 rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-4 text-on-brand tabular-nums">{filters.project.length}</span>}
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
                  <span dir="auto" className="min-w-0 truncate">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>
        <Popover
          kind="dialog"
          label={t("Responsable")}
          onOpenChange={(open) => (open ? setDraftPeople(filters.person) : applyPeople())}
          panelClassName="w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          trigger={({ open, props }) => (
            <button type="button" {...props} className={cn(selectCls, "flex w-44 items-center justify-between gap-1.5 text-left md:w-52")}>
              <span className="min-w-0 truncate"><span className="sr-only">{`${t("Responsable")}: `}</span>{personLabel}</span>
              {filters.person.length > 1 && <span aria-hidden className="shrink-0 rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-4 text-on-brand tabular-nums">{filters.person.length}</span>}
              <ChevronDown size={14} className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden />
            </button>
          )}
        >
          <ul className="text-sm">
            <li>
              <button type="button" role="checkbox" aria-checked={draftPeople.length === 0} onClick={() => setDraftPeople([])} className={optionCls}>
                <CheckBox on={draftPeople.length === 0} />
                <span className="font-medium">{t("Todos")}</span>
              </button>
            </li>
            {personOptions.map((o) => (
              <li key={o.id}>
                <button type="button" role="checkbox" aria-checked={draftPeople.includes(o.id)} onClick={() => togglePerson(o.id)} className={optionCls}>
                  <CheckBox on={draftPeople.includes(o.id)} />
                  <span dir="auto" className="min-w-0 truncate">{o.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>
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

      {overdue && overdue.total > 0 && <OverdueList overdue={overdue} today={today} showProject={showProject} jumpToToday={month === today.slice(0, 7) && !empty && !mobileEmpty} />}

      {/* Escritorio: cuadrícula mensual */}
      <div className={cn("hidden md:block", navigating && "opacity-60 transition-opacity", empty && "hidden!")}>
        <div className={cn("card overflow-visible", preview && "cursor-grabbing select-none")}>
          <div className="grid grid-cols-7 border-b border-slate-200 text-center text-xs font-semibold uppercase text-slate-500 dark:border-slate-800">
            {weekdays.map((w) => (
              <div key={w} className="py-2">{w}</div>
            ))}
          </div>
          {weeks.map((week) => {
            const bands = bandsForWeek(week.map((d) => d.iso), dels.map((d) => ({ id: d.id, dueDate: d.due })));
            const rangeBands = ranged.length ? rangeBandsForWeek(week.map((d) => d.iso), ranged.map((x) => ({ id: x.id, start: x.start!, due: x.due }))) : [];
            const delView = bandView(bands, MAX_BANDS);
            const rangeView = bandView(rangeBands, MAX_RANGES);
            return (
              <div key={week[0]!.iso} data-week={week[0]!.iso} className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
                {bands.length > 0 && (
                  <div ref={holdBandTouch} className="grid grid-cols-7 gap-y-0.5 px-0.5 pt-1" role="group" aria-label={t("Entregables")}>
                    {delView.shown.map((b) => {
                      const d = delById.get(b.id)!;
                      const status = d.status;
                      return (
                        <Link
                          // Sin precarga: cada tarea visible era una petición del tablero entero (el calendario pasaba de 23 a 97 consultas).
                          prefetch={false}
                          key={b.id}
                          href={`/p/${d.projectId}`}
                          data-band={b.id}
                          draggable={false}
                          onPointerDown={(e) => startBandDrag(e, "del", b.id, "move", { start: d.due, due: d.due })}
                          onClick={onBandClick}
                          onKeyDown={(e) => onBandKey(e, "del", b.id)}
                          aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                          style={{ gridColumn: `${b.colStart} / ${b.colEnd + 1}` }}
                          title={`${d.name} · ${showProject ? `${d.projectName} · ` : ""}${t("{done} de {total} tareas", { done: d.done, total: d.total })} · ${t(status)}`}
                          className={cn(
                            "relative flex h-5 min-w-0 cursor-grab touch-pan-y select-none items-center [-webkit-touch-callout:none] data-held:z-10 data-held:ring-2 data-held:ring-brand-500 gap-1 overflow-hidden border px-1.5 text-[11px] leading-5 outline-offset-1 hover:brightness-95 focus-visible:outline-3 focus-visible:outline-focus",
                            preview?.id === b.id && "z-10 opacity-80 ring-2 ring-brand-500",
                            STATUS_STYLE[status],
                            b.continuesLeft ? "rounded-l-none border-l-0" : "rounded-l",
                            b.endsHere ? "rounded-r" : "rounded-r-none border-r-0",
                          )}
                        >
                          <span className={cn("pointer-events-none absolute inset-y-0 left-0", STATUS_BAR[status])} style={{ width: `${d.pct}%` }} aria-hidden />
                          {b.endsHere && <Flag size={11} className="relative shrink-0" aria-hidden />}
                          <span dir="auto" className="relative truncate font-medium">{d.name}</span>
                          <span className="relative ml-auto shrink-0 tabular-nums">{d.total ? `${d.done}/${d.total}` : t(status)}</span>
                        </Link>
                      );
                    })}
                    {delView.hidden.length > 0 && (
                      <div className="relative col-span-7">
                        <button type="button" data-day-toggle={`d:${week[0]!.iso}`} onClick={() => setOpenDay(openDay === `d:${week[0]!.iso}` ? null : `d:${week[0]!.iso}`)} aria-expanded={openDay === `d:${week[0]!.iso}`} className="rounded px-1 text-[11px] font-medium text-brand-700 hover:bg-slate-100 dark:text-brand-300 dark:hover:bg-slate-800">
                          {delView.hidden.length === 1 ? t("+1 entregable más") : t("+{n} entregables más", { n: delView.hidden.length })}
                        </button>
                        {openDay === `d:${week[0]!.iso}` && (
                          <div data-day-popover role="dialog" aria-label={t("Entregables")} className="absolute left-0 top-5 z-30 w-72 max-w-[80vw] space-y-0.5 rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                            {delView.hidden.map((b) => {
                              const d = delById.get(b.id)!;
                              return (
                                <Link key={b.id} href={`/p/${d.projectId}`} className={cn("flex min-w-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-5", STATUS_STYLE[d.status])}>
                                  <Flag size={11} className="shrink-0" aria-hidden />
                                  <span dir="auto" className="truncate font-medium">{d.name}</span>
                                  <span className="ml-auto shrink-0 tabular-nums">{shortDay(d.due)}</span>
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {rangeBands.length > 0 && (
                  <div ref={holdBandTouch} className="grid grid-cols-7 gap-y-0.5 px-0.5 pt-1" role="group" aria-label={t("Tareas con rango de fechas")}>
                    {rangeView.shown.map((b) => {
                      const task = rangedById.get(b.id)!;
                      return (
                        <Link
                          key={b.id}
                          href={`/p/${task.projectId}?task=${task.id}`}
                          data-band={b.id}
                          draggable={false}
                          onPointerDown={(e) => startBandDrag(e, "task", b.id, "move", { start: task.start!, due: task.due })}
                          onClick={onBandClick}
                          onKeyDown={(e) => onBandKey(e, "task", b.id)}
                          aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+Shift+ArrowRight"
                          style={{ gridColumn: `${b.colStart} / ${b.colEnd + 1}`, ...kindBadgeStyle(task.kind.color) }}
                          title={`${task.title} · ${task.kind.name}${showProject ? ` · ${task.projectName}` : ""} · ${shortDay(task.start!)} → ${shortDay(task.due)}`}
                          className={cn(
                            "kind-badge relative flex h-5 min-w-0 cursor-grab touch-pan-y select-none items-center [-webkit-touch-callout:none] data-held:z-10 data-held:ring-2 data-held:ring-brand-500 gap-1 overflow-hidden px-1.5 text-xs leading-5 outline-offset-1 hover:brightness-95 focus-visible:outline-3 focus-visible:outline-focus",
                            preview?.id === b.id && "z-10 opacity-80 ring-2 ring-brand-500",
                            b.continuesLeft ? "rounded-l-none" : "rounded-l",
                            b.endsHere ? "rounded-r" : "rounded-r-none",
                            task.done && "opacity-55 line-through",
                          )}
                        >
                          {showProject && <span className="shrink-0 rounded bg-white/60 px-1 text-[10px] font-semibold leading-4 dark:bg-black/30" aria-label={task.projectName}>{initials(task.projectName)}</span>}
                          <span dir="auto" className="truncate">{task.title}</span>
                          {!b.continuesLeft && <span onPointerDown={(e) => startBandDrag(e, "task", b.id, "start", { start: task.start!, due: task.due })} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" aria-hidden />}
                          {b.endsHere && <span onPointerDown={(e) => startBandDrag(e, "task", b.id, "end", { start: task.start!, due: task.due })} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" aria-hidden />}
                        </Link>
                      );
                    })}
                    {rangeView.hidden.length > 0 && (
                      <div className="relative col-span-7">
                        <button type="button" data-day-toggle={`r:${week[0]!.iso}`} onClick={() => setOpenDay(openDay === `r:${week[0]!.iso}` ? null : `r:${week[0]!.iso}`)} aria-expanded={openDay === `r:${week[0]!.iso}`} className="rounded px-1 text-[11px] font-medium text-brand-700 hover:bg-slate-100 dark:text-brand-300 dark:hover:bg-slate-800">
                          {rangeView.hidden.length === 1 ? t("+1 tarea con rango más") : t("+{n} tareas con rango más", { n: rangeView.hidden.length })}
                        </button>
                        {openDay === `r:${week[0]!.iso}` && (
                          <div data-day-popover role="dialog" aria-label={t("Tareas con rango de fechas")} className="absolute left-0 top-5 z-30 w-72 max-w-[80vw] space-y-0.5 rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                            {rangeView.hidden.map((b) => {
                              const task = rangedById.get(b.id)!;
                              return (
                                <Link key={b.id} href={`/p/${task.projectId}?task=${task.id}`} style={kindBadgeStyle(task.kind.color)} className={cn("kind-badge flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs leading-5", task.done && "opacity-55 line-through")}>
                                  <span dir="auto" className="truncate">{task.title}</span>
                                  <span className="ml-auto shrink-0 tabular-nums opacity-80">{shortDay(task.start!)} → {shortDay(task.due)}</span>
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-7">
                  {week.map((day, i) => {
                    const list = chipsByDay.get(day.iso) ?? [];
                    // Primero las tareas del día y detrás las apariciones previstas; todas cuentan para «+N más».
                    const entries = [...list.map((x) => () => chip(x)), ...(repeatsByDay.get(day.iso) ?? []).map((r) => () => repeatChip(r))];
                    const shown = entries.length > MAX_CHIPS ? entries.slice(0, MAX_CHIPS - 1) : entries;
                    const hidden = entries.length - shown.length;
                    const isToday = day.iso === today;
                    return (
                      <div
                        key={day.iso}
                        role="group"
                        aria-label={`${dayLabel(day.iso)}${list.length ? `, ${list.length === 1 ? t("1 tarea") : t("{n} tareas", { n: list.length })}` : ""}`}
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
                          dragOver === day.iso && "bg-brand-50 ring-2 ring-inset ring-brand-500 dark:bg-brand-500/20",
                        )}
                      >
                        <div className={cn("mb-1 flex h-5 items-center justify-end text-xs", day.inMonth ? "text-slate-600 dark:text-slate-300" : "text-slate-500 dark:text-slate-400")}>
                          <span className={cn("inline-flex min-w-5 items-center justify-center rounded-full px-1 tabular-nums", isToday && "bg-brand-600 font-semibold text-on-brand")}>{Number(day.iso.slice(8))}</span>
                        </div>
                        <div className="space-y-0.5">
                          {shown.map((render) => render())}
                          {hidden > 0 && (
                            <button
                              type="button"
                              data-day-toggle={day.iso}
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
                              <button type="button" autoFocus onClick={() => closeDay(true)} className="rounded p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t("Cerrar")}>
                                <X size={14} aria-hidden />
                              </button>
                            </div>
                            <div className="max-h-64 space-y-0.5 overflow-y-auto">{entries.map((render) => render())}</div>
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
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
          {t("Arrastra tareas, rangos y entregables para cambiar sus fechas.")}
          <InfoTip topic={t("Calendario")}>{t("En un rango, arrastra también sus bordes. Con el teclado: Alt+←/→ lo mueve y Alt+Mayús+←/→ cambia su fin.")}</InfoTip>
        </p>
        {repeats.length > 0 && <RepeatLegend className="mt-1" />}
        {preview && (
          <div ref={labelRef} className="pointer-events-none fixed left-0 top-0 z-50 rounded bg-slate-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-slate-100 dark:text-slate-900" role="status">
            {preview.start === preview.due || preview.kind === "del" ? shortDay(preview.due) : `${shortDay(preview.start)} → ${shortDay(preview.due)}`}
          </div>
        )}
      </div>

      {mobileEmpty && (
        <div className="card mb-3 flex flex-col items-center gap-2 p-8 text-center text-sm text-slate-500 md:hidden">
          <CalendarDays size={32} className="text-slate-300" aria-hidden />
          {t("No hay tareas ni entregables con fecha en este mes.")}
        </div>
      )}

      {/* Móvil: lista por semanas */}
      <div className={cn("space-y-5 md:hidden", navigating && "opacity-60 transition-opacity", empty && "hidden!")}>
        {mobileWeeks.map((w) => (
          <section key={w.start} aria-label={weekLabel(w.start, w.end)}>
            <h3 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">{weekLabel(w.start, w.end)}</h3>
            <div className="card divide-y divide-slate-200 dark:divide-slate-800">
              {w.days.map((iso) => (
                <div key={iso} data-mobile-day={iso} className="scroll-mt-3 px-3 py-2">
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
                          <span dir="auto" className="relative min-w-0 flex-1 truncate font-medium">{d.name}</span>
                          <span className="relative shrink-0 tabular-nums">{d.total ? `${d.done}/${d.total} · ` : ""}{t(d.status)}</span>
                        </Link>
                      </li>
                    ))}
                    {(mobileByDay.get(iso) ?? []).map((task) => (
                      <li key={task.id}>
                        <Link
                          href={`/p/${task.projectId}?task=${task.id}`}
                          style={kindBadgeStyle(task.kind.color)}
                          className={cn("kind-badge flex min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-sm", task.done && "opacity-55 line-through", isOverdue(task, today) && OVERDUE_MARK)}
                          data-overdue={isOverdue(task, today) || undefined}
                        >
                          <span dir="auto" className="min-w-0 flex-1 truncate">{task.title}</span>
                          {isOverdue(task, today) && <span className="sr-only">{` (${t("Plazo vencido")})`}</span>}
                          {isRange(task.start, task.due) && <span className="shrink-0 text-xs tabular-nums opacity-80">{shortDay(task.start!)} → {shortDay(task.due)}</span>}
                          {showProject && <span className="shrink-0 rounded bg-white/60 px-1 text-[10px] font-semibold leading-4 dark:bg-black/30" title={task.projectName} aria-label={task.projectName}>{initials(task.projectName)}</span>}
                        </Link>
                      </li>
                    ))}
                    {(repeatsByDay.get(iso) ?? []).map((r) => (
                      <li key={r.key}>{repeatChip(r, "md")}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}
        {repeats.length > 0 && !mobileEmpty && <RepeatLegend />}
      </div>
    </div>
  );
}

/**
 * «N vencidas de antes de este mes»: tareas sin terminar con la fecha límite anterior a la cuadrícula (no salen en ella ni
 * en la lista del móvil). Plegado; al abrirlo, la lista con su fecha, cada una abre la tarea. En el móvil, en el mes
 * actual, lleva «Ir a hoy» (con vencidas no se baja solo hasta hoy, para que se vea este aviso).
 */
function OverdueList({ overdue, today, showProject, jumpToToday }: { overdue: { tasks: CalendarTask[]; total: number }; today: string; showProject: boolean; jumpToToday: boolean }) {
  const t = useT();
  const locale = useIntlLocale();
  const n = overdue.total;
  return (
    <div className="mb-3 flex items-start gap-2">
      <details data-testid="cal-overdue" className="min-w-0 flex-1 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
        <summary className="cursor-pointer select-none px-3 py-2 font-semibold">
          {n === 1 ? t("1 vencida de antes de este mes") : t("{n} vencidas de antes de este mes", { n })}
        </summary>
        <ul className="space-y-1 px-3 pb-3">
          {overdue.tasks.map((task) => (
            <li key={task.id}>
              <Link
                href={`/p/${task.projectId}?task=${task.id}`}
                style={kindBadgeStyle(task.kind.color)}
                className={cn("kind-badge flex min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-sm", OVERDUE_MARK)}
              >
                <span dir="auto" className="min-w-0 flex-1 truncate">{task.title}</span>
                {showProject && <span className="shrink-0 rounded bg-white/60 px-1 text-[10px] font-semibold leading-4 dark:bg-black/30" title={task.projectName} aria-label={task.projectName}>{initials(task.projectName)}</span>}
                <span className="shrink-0 text-xs font-semibold tabular-nums">
                  <span className="sr-only">{`${t("Plazo vencido")}: `}</span>
                  {formatDay(task.due, today, locale)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {n > overdue.tasks.length && <p className="px-3 pb-3 text-xs">{t("Se muestran las {shown} más antiguas.", { shown: overdue.tasks.length })}</p>}
      </details>
      {jumpToToday && (
        <button
          type="button"
          data-testid="cal-go-today"
          onClick={() => mobileTodayRow(today, true)?.scrollIntoView({ block: "start" })}
          className="btn-secondary shrink-0 px-3 py-2 text-sm md:hidden"
        >
          {t("Ir a hoy")}
        </button>
      )}
    </div>
  );
}

/**
 * Fila de hoy en la lista del móvil (o la del primer día con algo a partir de hoy). Sin `always`, null si es la primera
 * (no hay nada que bajar); con `always`, si no queda ninguno a partir de hoy, la última.
 */
function mobileTodayRow(today: string, always = false): HTMLElement | null {
  const days = [...document.querySelectorAll<HTMLElement>("[data-mobile-day]")];
  const target = days.find((el) => (el.dataset.mobileDay ?? "") >= today);
  if (always) return target ?? days.at(-1) ?? null;
  return !target || target === days[0] ? null : target;
}

/** Leyenda de las apariciones previstas (solo si hay alguna a la vista). */
function RepeatLegend({ className }: { className?: string }) {
  const t = useT();
  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-slate-500", className)}>
      <Repeat size={12} className="shrink-0" aria-hidden />
      {t("Repeticiones previstas: se crean al terminar la anterior. Púlsalas para abrir la tarea.")}
    </p>
  );
}
