"use client";

import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Flag, Loader2, Undo2, X } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { undoLast } from "@/actions/undo";
import { moveDeliverable } from "@/actions/projects";
import { updateTask } from "@/actions/tasks";
import { PERSON_UNASSIGNED, bandsForWeek, columnAt, dragRange, groupByDay, groupWeeks, isRange, rangeBandsForWeek, shiftMonth, type Band, type CalendarDay, type RangeDragMode } from "@/lib/calendar";
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
  /** Fecha de inicio (solo si el proyecto la tiene activada): con inicio anterior a la fecha límite se dibuja como rango. */
  start: string | null;
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
  deliverables: CalendarDeliverable[];
  projects: { id: string; name: string }[];
  people: { id: string; name: string }[];
  /** Usuario actual: aparece una sola vez en el selector de personas, como «Nombre (yo)». */
  meId: string;
  filters: Filters;
  /** Se alcanzó el tope de tareas cargadas. */
  truncated: boolean;
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

export function CalendarView({ month, today, weeks, tasks, deliverables, projects, people, meId, filters, truncated }: Props) {
  const t = useT();
  const locale = useIntlLocale();
  const router = useRouter();
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

  useEffect(() => {
    // Tras mover con teclado el chip se vuelve a pintar en otro día: recupera el foco.
    if (!focusAfter.current) return;
    document.querySelector<HTMLElement>(`[data-chip="${focusAfter.current}"], [data-band="${focusAfter.current}"]`)?.focus();
    focusAfter.current = null;
  });

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
      { id: PERSON_UNASSIGNED, label: t("Sin asignar") },
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
      const res = await updateTask(task.id, { ...(next.start !== from.start ? { startDate: next.start } : {}), dueDate: next.due });
      if (!res.ok) {
        // Vuelve a las fechas anteriores.
        setOverrides((o) => ({ ...o, [task.id]: from }));
        toast(res.error, "error");
        return;
      }
      setLast({ kind: "task", taskId: task.id, projectId: task.projectId, from });
      toast(next.start && next.start !== next.due ? t("Rango cambiado: {from} → {to}", { from: formatDay(next.start, today, locale), to: formatDay(next.due, today, locale) }) : t("Fecha límite cambiada al {date}", { date: formatDay(next.due, today, locale) }));
      router.refresh();
    },
    [overrides, toast, t, today, locale, router],
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
      const res = await moveDeliverable(d.id, to);
      if (!res.ok) {
        setDelOverrides((o) => ({ ...o, [d.id]: from }));
        toast(res.error, "error");
        return;
      }
      setLast({ kind: "deliverable", id: d.id, from });
      toast(t("Entregable movido al {date}", { date: formatDay(to, today, locale) }));
      router.refresh();
    },
    [delOverrides, toast, t, today, locale, router],
  );

  const undo = useCallback(async () => {
    if (!last || undoing) return;
    setUndoing(true);
    try {
      if (last.kind === "deliverable") {
        const res = await moveDeliverable(last.id, last.from);
        if (!res.ok) return toast(res.error, "error");
        setDelOverrides((o) => ({ ...o, [last.id]: last.from }));
        setLast(null);
        toast(t("Deshecho: {label}", { label: t("Entregable movido al {date}", { date: formatDay(last.from, today, locale) }) }), "undo");
        router.refresh();
        return;
      }
      const res = await undoLast(last.projectId, last.taskId);
      if (!res.ok) return toast(res.error, "error");
      setOverrides((o) => ({ ...o, [last.taskId]: last.from }));
      setLast(null);
      toast(t("Deshecho: {label}", { label: res.data.label }), "undo");
      router.refresh();
    } finally {
      setUndoing(false);
    }
  }, [last, undoing, toast, t, router, today, locale]);

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
      // Los botones «+N más» alternan el panel por su cuenta (si no, cerrar y reabrir en el mismo clic).
      if (!(e.target as HTMLElement).closest?.("[data-day-popover], [data-day-toggle]")) setOpenDay(null);
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

  // Teclado en una banda: Alt+flechas mueve el rango entero (±1 día, ±7 con arriba/abajo); Alt+Mayús+←/→ cambia solo su fin.
  const onBandKey = (e: React.KeyboardEvent, kind: "task" | "del", id: string) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -7 : e.key === "ArrowDown" ? 7 : 0;
    if (!step) return;
    e.preventDefault();
    focusAfter.current = id;
    if (kind === "del") {
      const d = delById.get(id);
      const del = deliverables.find((x) => x.id === id);
      if (d && del) void saveDeliverable(del, addDaysIso(d.due, step));
      return;
    }
    const task = tasks.find((x) => x.id === id);
    const cur = rangedById.get(id);
    if (!task || !cur?.start) return;
    if (e.shiftKey) {
      if (Math.abs(step) !== 1) return;
      const due = addDaysIso(cur.due, step);
      void saveTask(task, { start: cur.start, due: due < cur.start ? cur.start : due });
    } else void saveTask(task, { start: addDaysIso(cur.start, step), due: addDaysIso(cur.due, step) });
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

  const startBandDrag = (e: React.PointerEvent, kind: "task" | "del", id: string, mode: RangeDragMode, origin: { start: string; due: string }) => {
    if (e.button !== 0 || e.altKey || !e.isPrimary || dragRef.current) return;
    const grabbed = dayAtPoint(e.clientX, e.clientY);
    if (!grabbed) return;
    if (mode !== "move") e.stopPropagation();
    const drag: BandDrag = { kind, id, mode, grabbed, origin, x: e.clientX, y: e.clientY, moved: false, last: null, result: null, stop: () => {} };
    const onMove = (ev: PointerEvent) => {
      if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 5) return;
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
      if (drag.moved) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 150);
      }
      setPreview(null);
      if (!cancel && drag.moved && drag.result) commitRef.current(drag, drag.result);
    };
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    const onEsc = (ev: KeyboardEvent) => ev.key === "Escape" && finish(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onEsc);
    drag.stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onEsc);
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
  // Entre las bandas visibles siempre va la que se arrastra, aunque por su nueva posición quedara fuera del tope.
  const visibleBands = (bands: Band[], max: number) => {
    const shown = bands.slice(0, max);
    const keep = bands.find((b) => b.id === preview?.id);
    if (keep && !shown.includes(keep)) shown[max - 1] = keep;
    return shown;
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
  // Móvil: una tarea con rango que termina después del mes se muestra en su día de inicio (o el 1 si empezó antes).
  const monthEnd = `${month}-31`; // cota de cadena: mayor que cualquier día del mes y menor que el 1 del siguiente
  const mobileByDay = groupByDay(items, (x) => (isRange(x.start, x.due) && x.due > monthEnd ? (x.start! < `${month}-01` ? `${month}-01` : x.start!) : x.due));
  const mobileWeeks = groupWeeks(weeks, (iso) => mobileByDay.has(iso) || delByDay.has(iso));
  const mobileEmpty = !empty && mobileWeeks.length === 0;
  const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
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
        <Popover
          kind="dialog"
          label={t("Persona")}
          onOpenChange={(open) => (open ? setDraftPeople(filters.person) : applyPeople())}
          panelClassName="w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          trigger={({ open, props }) => (
            <button type="button" {...props} aria-label={t("Persona")} className={cn(selectCls, "flex w-44 items-center justify-between gap-1.5 text-left md:w-52")}>
              <span className="min-w-0 truncate">{personLabel}</span>
              {filters.person.length > 1 && <span className="shrink-0 rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-4 text-on-brand tabular-nums">{filters.person.length}</span>}
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
                  <span className="min-w-0 truncate">{o.label}</span>
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
            return (
              <div key={week[0]!.iso} data-week={week[0]!.iso} className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
                {bands.length > 0 && (
                  <div className="grid grid-cols-7 gap-y-0.5 px-0.5 pt-1" aria-label={t("Entregables")}>
                    {visibleBands(bands, MAX_BANDS).map((b) => {
                      const d = delById.get(b.id)!;
                      const status = d.status;
                      return (
                        <Link
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
                            "relative flex h-5 min-w-0 cursor-grab touch-none items-center gap-1 overflow-hidden border px-1.5 text-[11px] leading-5 outline-offset-1 hover:brightness-95 focus-visible:outline-3 focus-visible:outline-focus",
                            preview?.id === b.id && "z-10 opacity-80 ring-2 ring-brand-500",
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
                    {bands.length > MAX_BANDS && (
                      <div className="relative col-span-7">
                        <button type="button" data-day-toggle onClick={() => setOpenDay(openDay === `d:${week[0]!.iso}` ? null : `d:${week[0]!.iso}`)} aria-expanded={openDay === `d:${week[0]!.iso}`} className="rounded px-1 text-[11px] font-medium text-brand-700 hover:bg-slate-100 dark:text-brand-300 dark:hover:bg-slate-800">
                          {t("+{n} entregables más", { n: bands.length - MAX_BANDS })}
                        </button>
                        {openDay === `d:${week[0]!.iso}` && (
                          <div data-day-popover role="dialog" aria-label={t("Entregables")} className="absolute left-0 top-5 z-30 w-72 max-w-[80vw] space-y-0.5 rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                            {bands.slice(MAX_BANDS).map((b) => {
                              const d = delById.get(b.id)!;
                              return (
                                <Link key={b.id} href={`/p/${d.projectId}`} className={cn("flex min-w-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-5", STATUS_STYLE[d.status])}>
                                  <Flag size={11} className="shrink-0" aria-hidden />
                                  <span className="truncate font-medium">{d.name}</span>
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
                  <div className="grid grid-cols-7 gap-y-0.5 px-0.5 pt-1" aria-label={t("Tareas con rango de fechas")}>
                    {visibleBands(rangeBands, MAX_RANGES).map((b) => {
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
                            "kind-badge relative flex h-5 min-w-0 cursor-grab touch-none items-center gap-1 overflow-hidden px-1.5 text-xs leading-5 outline-offset-1 hover:brightness-95 focus-visible:outline-3 focus-visible:outline-focus",
                            preview?.id === b.id && "z-10 opacity-80 ring-2 ring-brand-500",
                            b.continuesLeft ? "rounded-l-none" : "rounded-l",
                            b.endsHere ? "rounded-r" : "rounded-r-none",
                            task.done && "opacity-55 line-through",
                          )}
                        >
                          {showProject && <span className="shrink-0 rounded bg-white/60 px-1 text-[10px] font-semibold leading-4 dark:bg-black/30" aria-label={task.projectName}>{initials(task.projectName)}</span>}
                          <span className="truncate">{task.title}</span>
                          {!b.continuesLeft && <span onPointerDown={(e) => startBandDrag(e, "task", b.id, "start", { start: task.start!, due: task.due })} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" aria-hidden />}
                          {b.endsHere && <span onPointerDown={(e) => startBandDrag(e, "task", b.id, "end", { start: task.start!, due: task.due })} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" aria-hidden />}
                        </Link>
                      );
                    })}
                    {rangeBands.length > MAX_RANGES && (
                      <div className="relative col-span-7">
                        <button type="button" data-day-toggle onClick={() => setOpenDay(openDay === `r:${week[0]!.iso}` ? null : `r:${week[0]!.iso}`)} aria-expanded={openDay === `r:${week[0]!.iso}`} className="rounded px-1 text-[11px] font-medium text-brand-700 hover:bg-slate-100 dark:text-brand-300 dark:hover:bg-slate-800">
                          {t("+{n} tareas con rango más", { n: rangeBands.length - MAX_RANGES })}
                        </button>
                        {openDay === `r:${week[0]!.iso}` && (
                          <div data-day-popover role="dialog" aria-label={t("Tareas con rango de fechas")} className="absolute left-0 top-5 z-30 w-72 max-w-[80vw] space-y-0.5 rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                            {rangeBands.slice(MAX_RANGES).map((b) => {
                              const task = rangedById.get(b.id)!;
                              return (
                                <Link key={b.id} href={`/p/${task.projectId}?task=${task.id}`} style={kindBadgeStyle(task.kind.color)} className={cn("kind-badge flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs leading-5", task.done && "opacity-55 line-through")}>
                                  <span className="truncate">{task.title}</span>
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
                              data-day-toggle
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
        <p className="mt-2 text-xs text-slate-500">{t("Arrastra una tarea, un rango o un entregable para cambiar sus fechas; en un rango, arrastra también sus bordes (o Alt+←/→ con él enfocado; Alt+Mayús+←/→ cambia su fin).")}</p>
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
                    {(mobileByDay.get(iso) ?? []).map((task) => (
                      <li key={task.id}>
                        <Link
                          href={`/p/${task.projectId}?task=${task.id}`}
                          style={kindBadgeStyle(task.kind.color)}
                          className={cn("kind-badge flex min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-sm", task.done && "opacity-55 line-through")}
                        >
                          <span className="min-w-0 flex-1 truncate">{task.title}</span>
                          {isRange(task.start, task.due) && <span className="shrink-0 text-xs tabular-nums opacity-80">{shortDay(task.start!)} → {shortDay(task.due)}</span>}
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
