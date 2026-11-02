"use client";

// Demo interactiva de la página de presentación: un tablero ficticio que funciona solo en el navegador
// (sin sesión, sin servidor). El estado se guarda en localStorage; «Restablecer» vuelve al ejemplo.
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, Check, CheckSquare, Copy, FileText, Hourglass, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useIntlLocale, useT } from "@/i18n/client";
import {
  DEMO_STORAGE_KEY,
  DEMO_WAITING_DAYS,
  KIND_COLOR,
  KIND_ORDER,
  addTask,
  daysBetween,
  findColumn,
  isoDay,
  moveTask,
  parseState,
  releaseMarkdown,
  removeTask,
  seedState,
  subsProgress,
  taskTitle,
  toggleSub,
  updateTask,
  type DemoColumn,
  type DemoKind,
  type DemoState,
  type DemoTask,
} from "@/lib/landing-demo";

function loadState(): DemoState {
  try {
    const saved = parseState(window.localStorage.getItem(DEMO_STORAGE_KEY));
    if (saved) return saved;
  } catch {
    // Sin almacenamiento (navegación privada, datos bloqueados): se parte del ejemplo.
  }
  return seedState(isoDay(new Date()));
}

// Prefiere la tarjeta bajo el puntero; si no hay, la columna (también vacía) bajo el puntero y, al final, la más cercana.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length > 0) {
    const cards = hits.filter((h) => !String(h.id).startsWith("c"));
    return cards.length > 0 ? cards : hits;
  }
  return closestCenter(args);
};

export default function LandingDemo() {
  const t = useT();
  const intl = useIntlLocale();
  // Este componente solo se carga en el navegador (import dinámico sin SSR), así que puede leer localStorage al crearse.
  const [state, setState] = useState<DemoState>(loadState);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [release, setRelease] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState("");
  const today = isoDay(new Date());

  useEffect(() => {
    try {
      window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Sin almacenamiento: la demo sigue funcionando en memoria.
    }
  }, [state]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const move = useCallback((taskId: string, columnId: string, index?: number) => {
    setState((s) => {
      const to = s.columns.find((c) => c.id === columnId);
      const x = s.tasks[taskId];
      if (to && x) setLive(t("«{tarea}» movida a {columna}.", { tarea: taskTitle(t, x), columna: t(to.name) }));
      return moveTask(s, taskId, columnId, index, isoDay(new Date()));
    });
  }, [t]);

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const overId = String(over.id);
    const col = state.columns.find((c) => c.id === overId);
    if (col) return move(String(active.id), col.id);
    const target = findColumn(state, overId);
    if (target) move(String(active.id), target.id, target.taskIds.indexOf(overId));
  };

  const open = openId ? state.tasks[openId] : null;
  const md = release ? releaseMarkdown(state, t, today) : "";

  return (
    <div data-testid="demo" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-semibold">{t("App de reservas")} <span className="font-normal text-slate-500">· {t("proyecto de ejemplo")}</span></p>
        <button type="button" className="btn-secondary" data-testid="demo-release" onClick={() => setRelease(true)}>
          <FileText size={15} /> {t("Generar release")}
        </button>
        <button
          type="button"
          className="btn-ghost"
          data-testid="demo-reset"
          onClick={() => {
            setState(seedState(isoDay(new Date())));
            setOpenId(null);
            setLive(t("Demo restablecida."));
          }}
        >
          <RotateCcw size={15} /> {t("Restablecer")}
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
          {state.columns.map((col, i) => (
            <Column key={col.id} col={col} state={state} today={today} intl={intl} onOpen={setOpenId}>
              {i === 0 && (
                adding ? (
                  <form
                    className="mt-2 space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!draft.trim()) return;
                      setState((s) => addTask(s, col.id, draft, isoDay(new Date())));
                      setDraft("");
                      setAdding(false);
                    }}
                  >
                    <input autoFocus className="input" data-testid="demo-new-title" value={draft} maxLength={120} placeholder={t("Título de la tarea")} aria-label={t("Título de la tarea")} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} />
                    <div className="flex gap-2">
                      <button type="submit" className="btn-primary" data-testid="demo-new-submit">{t("Crear tarea")}</button>
                      <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setDraft(""); }}>{t("Cancelar")}</button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className="btn-ghost mt-2 w-full justify-start" data-testid="demo-new" onClick={() => setAdding(true)}>
                    <Plus size={15} /> {t("Añadir tarea")}
                  </button>
                )
              )}
            </Column>
          ))}
        </div>
        <DragOverlay>{dragId && state.tasks[dragId] ? <CardBody task={state.tasks[dragId]} state={state} today={today} intl={intl} overlay /> : null}</DragOverlay>
      </DndContext>

      <p className="text-xs text-slate-500">{t("Arrastra las tarjetas entre columnas, ábrelas para marcar subtareas y pulsa «Generar release» para ver las notas de la columna «Siguiente salto». Todo ocurre en tu navegador: no se envía nada.")}</p>
      <p className="sr-only" role="status" aria-live="polite">{live}</p>

      {open && (
        <Dialog title={taskTitle(t, open)} onClose={() => setOpenId(null)} testId="demo-task">
          <TaskDetail
            task={open}
            state={state}
            intl={intl}
            onToggle={(subId) => setState((s) => toggleSub(s, open.id, subId))}
            onKind={(kind) => setState((s) => updateTask(s, open.id, { kind }))}
            onMove={(colId) => move(open.id, colId)}
            onDelete={() => {
              setState((s) => removeTask(s, open.id));
              setOpenId(null);
            }}
          />
        </Dialog>
      )}

      {release && (
        <Dialog title={t("Notas de la release")} onClose={() => setRelease(false)} testId="demo-release-dialog">
          {md ? (
            <>
              <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">{t("Generadas con las tareas de «Siguiente salto», agrupadas por tipo. En Pizarro puedes editarlas, copiarlas y exportarlas.")}</p>
              <pre data-testid="demo-release-md" className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap dark:border-slate-700 dark:bg-slate-950">{md}</pre>
              <CopyButton text={md} />
            </>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400" data-testid="demo-release-empty">{t("No hay tareas en «Siguiente salto». Arrastra alguna a esa columna y vuelve a probar.")}</p>
          )}
        </Dialog>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary mt-3"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => setDone(true), () => setDone(false));
      }}
    >
      {done ? <Check size={15} /> : <Copy size={15} />} {done ? t("Copiado") : t("Copiar Markdown")}
    </button>
  );
}

function Dialog({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  // onClose llega como función nueva en cada render: se guarda en una ref para no repetir el foco inicial.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} data-testid={testId} className="card max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 outline-none sm:rounded-b-xl">
        <div className="mb-3 flex items-start gap-2">
          <h3 className="mr-auto text-base font-semibold break-words">{title}</h3>
          <button type="button" className="btn-icon" onClick={onClose} aria-label={t("Cerrar")}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Column({ col, state, today, intl, onOpen, children }: { col: DemoColumn; state: DemoState; today: string; intl: string; onOpen: (id: string) => void; children?: React.ReactNode }) {
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <section
      ref={setNodeRef}
      data-testid={`demo-col-${col.id}`}
      aria-label={t(col.name)}
      className={`w-64 shrink-0 snap-start rounded-xl border p-2.5 transition-colors ${isOver ? "border-brand-500 bg-brand-50 dark:bg-brand-700/10" : "border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-900/60"}`}
    >
      <header className="mb-2 flex items-center gap-1.5 px-0.5">
        <h3 className="text-sm font-semibold">{t(col.name)}</h3>
        <span className="text-xs text-slate-500">{col.taskIds.length}</span>
        {col.role === "WAITING" && <span className="badge bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/40" title={t("Columna especial: avisa si una tarea lleva {n} días sin moverse.", { n: DEMO_WAITING_DAYS })}><Hourglass size={11} className="mr-0.5" />{t("Esperando")}</span>}
        {col.role === "NEXT" && <span className="badge bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/40" title={t("Columna especial: sus tareas forman la próxima release.")}>{t("Release")}</span>}
      </header>
      <SortableContext items={col.taskIds} strategy={verticalListSortingStrategy}>
        <ul className="min-h-12 space-y-2">
          {col.taskIds.map((id) => {
            const task = state.tasks[id];
            return task ? <SortableCard key={id} id={id} task={task} state={state} today={today} intl={intl} onOpen={onOpen} /> : null;
          })}
        </ul>
      </SortableContext>
      {children}
    </section>
  );
}

const SortableCard = memo(function SortableCard({ id, task, state, today, intl, onOpen }: { id: string; task: DemoTask; state: DemoState; today: string; intl: string; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`touch-manipulation ${isDragging ? "opacity-40" : ""}`}
      {...attributes}
      {...listeners}
      data-testid={`demo-card-${id}`}
      onClick={() => onOpen(id)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (!e.defaultPrevented && (e.key === "Enter")) onOpen(id);
      }}
    >
      <CardBody task={task} state={state} today={today} intl={intl} />
    </li>
  );
});

function dueTone(due: string, today: string): string {
  const d = daysBetween(today, due);
  if (d < 0) return "text-red-600 dark:text-red-400";
  if (d <= 2) return "text-amber-600 dark:text-amber-400";
  return "text-slate-500";
}

function CardBody({ task, state, today, intl, overlay }: { task: DemoTask; state: DemoState; today: string; intl: string; overlay?: boolean }) {
  const t = useT();
  const col = findColumn(state, task.id);
  const { done, total } = subsProgress(task);
  const waitDays = col?.role === "WAITING" && task.since ? Math.max(0, daysBetween(task.since, today)) : null;
  const late = waitDays !== null && waitDays >= DEMO_WAITING_DAYS;
  return (
    <div className={`card cursor-grab p-2.5 text-left active:cursor-grabbing ${overlay ? "shadow-lg ring-2 ring-brand-500" : "hover:border-slate-300 dark:hover:border-slate-700"}`}>
      <p className="mb-1.5 flex items-center gap-1.5">
        <span className="badge" style={{ color: KIND_COLOR[task.kind], background: `${KIND_COLOR[task.kind]}1a`, ["--tw-ring-color" as string]: `${KIND_COLOR[task.kind]}55` }}>{t(task.kind)}</span>
      </p>
      <p className="text-sm leading-snug font-medium break-words">{taskTitle(t, task)}</p>
      {task.labels.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <span key={l} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t(l)}</span>
          ))}
        </p>
      )}
      {(total > 0 || task.due || waitDays !== null) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {total > 0 && <span className="inline-flex items-center gap-1"><CheckSquare size={12} />{done}/{total}</span>}
          {task.due && <span className={`inline-flex items-center gap-1 ${dueTone(task.due, today)}`}><CalendarClock size={12} />{new Date(`${task.due}T00:00:00`).toLocaleDateString(intl, { day: "numeric", month: "short" })}</span>}
          {waitDays !== null && <span data-testid="demo-waiting" className={`inline-flex items-center gap-1 font-medium ${late ? "text-amber-600 dark:text-amber-400" : ""}`}><Hourglass size={12} />{t("Esperando {n} d", { n: waitDays })}</span>}
        </p>
      )}
      {total > 0 && (
        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" aria-hidden>
          <span className="block h-full rounded-full bg-progress" style={{ width: `${(done / total) * 100}%` }} />
        </span>
      )}
    </div>
  );
}

function TaskDetail({ task, state, intl, onToggle, onKind, onMove, onDelete }: { task: DemoTask; state: DemoState; intl: string; onToggle: (subId: string) => void; onKind: (k: DemoKind) => void; onMove: (colId: string) => void; onDelete: () => void }) {
  const t = useT();
  const col = findColumn(state, task.id);
  const { done, total } = subsProgress(task);
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">{t("Tipo")}</span>
          <select className="input" value={task.kind} onChange={(e) => onKind(e.target.value as DemoKind)}>
            {KIND_ORDER.map((k) => <option key={k} value={k}>{t(k)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">{t("Columna")}</span>
          <select className="input" data-testid="demo-move" value={col?.id ?? ""} onChange={(e) => onMove(e.target.value)}>
            {state.columns.map((c) => <option key={c.id} value={c.id}>{t(c.name)}</option>)}
          </select>
        </label>
      </div>
      {(task.labels.length > 0 || task.due) && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {task.labels.map((l) => <span key={l} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t(l)}</span>)}
          {task.due && <span className="inline-flex items-center gap-1"><CalendarClock size={12} />{t("Fecha límite")}: {new Date(`${task.due}T00:00:00`).toLocaleDateString(intl, { day: "numeric", month: "long" })}</span>}
        </p>
      )}
      {task.desc && <p className="text-slate-700 dark:text-slate-300">{task.custom ? task.desc : t(task.desc)}</p>}
      <div>
        <p className="label">{t("Subtareas")} {total > 0 && <span className="font-normal">({done}/{total})</span>}</p>
        {total === 0 ? (
          <p className="text-xs text-slate-500">{t("Esta tarea no tiene subtareas.")}</p>
        ) : (
          <ul className="space-y-1">
            {task.subs.map((u) => (
              <li key={u.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={u.done} onChange={() => onToggle(u.id)} />
                  <span className={u.done ? "text-slate-500 line-through" : ""}>{task.custom ? u.text : t(u.text)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end">
        <button type="button" className="btn-ghost text-red-600 dark:text-red-400" onClick={onDelete}><Trash2 size={15} /> {t("Borrar tarea")}</button>
      </div>
    </div>
  );
}
