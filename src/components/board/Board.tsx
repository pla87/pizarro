"use client";

import {
  closestCorners, DndContext, pointerWithin, useDroppable, type CollisionDetection, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { FileDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { moveTask, moveTasks } from "@/actions/tasks";
import { positionBetween } from "@/lib/positions";
import type { BoardColumn, BoardData, BoardTask, LabelOption } from "@/lib/types";
import { ProjectMenu } from "../ProjectMenu";
import { useToast } from "../ui/Toast";
import { cn } from "../ui/cn";
import { BoardContext, type BoardApi } from "./context";
import { ColumnView } from "./ColumnView";
import { NewColumnButton } from "./NewColumnButton";
import { BulkTaskDialog } from "./BulkTaskDialog";
import { NewTaskDialog } from "./NewTaskDialog";
import { ReleaseDialog } from "./ReleaseDialog";
import { SelectionBar } from "./SelectionBar";
import { TaskCard } from "./TaskCard";
import { TaskDialog } from "./TaskDialog";
import { imageFilesFrom } from "./upload";

const COLUMN_PREFIX = "col:";
const TAB_PREFIX = "tab:";

/** Encima de una pestaña móvil manda el puntero; en el resto, la esquina más cercana. */
const collisionDetection: CollisionDetection = (args) => {
  const tab = pointerWithin(args).find((c) => String(c.id).startsWith(TAB_PREFIX));
  if (tab) return [tab];
  // Fuera de las pestañas: solo columnas y tarjetas visibles (las ocultas miden 0×0 y
  // las pestañas, pequeñas y cercanas, «ganarían» el cálculo de esquinas).
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (c) => !String(c.id).startsWith(TAB_PREFIX) && (args.droppableRects.get(c.id)?.width ?? 0) > 0,
    ),
  });
};

function MobileTab({ id, active, dragging, onClick, children }: { id: string; active: boolean; dragging: boolean; onClick: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
        active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        dragging && !active && "ring-1 ring-brand-500/40",
        isOver && "bg-brand-500 text-white ring-2 ring-brand-300",
      )}
    >
      {children}
    </button>
  );
}
const REFRESH_MS = 30_000;

type Items = Record<string, string[]>;

function groupItems(columns: BoardColumn[], tasks: BoardTask[]): Items {
  const items: Items = Object.fromEntries(columns.map((c) => [c.id, [] as string[]]));
  for (const t of [...tasks].sort((a, b) => a.position - b.position)) items[t.columnId]?.push(t.id);
  return items;
}

function findContainer(items: Items, id: string): string | undefined {
  if (id.startsWith(COLUMN_PREFIX)) return id.slice(COLUMN_PREFIX.length);
  if (id.startsWith(TAB_PREFIX)) return id.slice(TAB_PREFIX.length);
  return Object.keys(items).find((col) => items[col]!.includes(id));
}

export function Board({ data, initialTaskId = null }: { data: BoardData; initialTaskId?: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [columns, setColumns] = useState(data.columns);
  const [tasks, setTasks] = useState(data.tasks);
  const [labels, setLabels] = useState<LabelOption[]>(data.labels);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialTaskId);
  const [newTask, setNewTask] = useState<{ columnId?: string; files?: File[] } | null>(null);
  const [bulk, setBulk] = useState<{ columnId?: string } | null>(null);
  const [release, setRelease] = useState<{ taskIds: string[]; preselected: string[] } | null>(null);
  const [mobileColumn, setMobileColumn] = useState<string | null>(null);

  // Estado temporal durante el arrastre.
  const [dragItems, setDragItems] = useState<Items | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragOrigin = useRef<{ columnId: string; index: number } | null>(null);

  // Mutaciones en vuelo: mientras haya alguna no se sobrescribe el estado con datos del servidor.
  // Si llegan datos en ese momento, se marcan como pendientes y se vuelven a pedir al terminar.
  const pending = useRef(0);
  const staleRefresh = useRef(false);
  const flushStale = useCallback(() => {
    if (staleRefresh.current && pending.current === 0) {
      staleRefresh.current = false;
      router.refresh();
    }
  }, [router]);
  const track = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    pending.current++;
    try {
      return await p;
    } finally {
      pending.current--;
      flushStale();
    }
  }, [flushStale]);

  const patchTask = useCallback((id: string, patch: Partial<BoardTask> | ((t: BoardTask) => Partial<BoardTask>)) => {
    setTasks((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        if (t.id !== id) return t;
        const values = typeof patch === "function" ? patch(t) : patch;
        if (Object.entries(values).every(([k, v]) => t[k as keyof BoardTask] === v)) return t;
        changed = true;
        return { ...t, ...values };
      });
      return changed ? next : prev;
    });
  }, []);

  // Sincroniza con el servidor cuando llegan datos nuevos (router.refresh).
  useEffect(() => {
    if (pending.current > 0 || activeId) {
      staleRefresh.current = true;
      return;
    }
    setColumns(data.columns);
    setTasks(data.tasks);
    setLabels(data.labels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Refresco ligero para ver cambios de otros usuarios.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && pending.current === 0 && !document.querySelector("[role=dialog]")) router.refresh();
    };
    const timer = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [router]);

  const baseItems = useMemo(() => groupItems(columns, tasks), [columns, tasks]);
  const items = dragItems ?? baseItems;
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const sortedColumns = useMemo(() => [...columns].sort((a, b) => a.position - b.position), [columns]);
  const nextReleaseColumn = sortedColumns.find((c) => c.role === "NEXT_RELEASE");
  const activeMobileColumn = sortedColumns.find((c) => c.id === mobileColumn)?.id ?? sortedColumns[0]?.id;

  // Pegar una imagen en el tablero (sin diálogo abierto) crea una tarea con ella.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (document.querySelector("[role=dialog]")) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      const files = imageFilesFrom(e.clipboardData?.items);
      if (files.length) {
        e.preventDefault();
        setNewTask({ files });
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const api: BoardApi = useMemo(
    () => ({
      project: data.project,
      users: data.users,
      currentUserId: data.currentUserId,
      columns: sortedColumns,
      labels,
      deliverables: data.deliverables,
      kinds: data.kinds,
      kindById: new Map(data.kinds.map((k) => [k.id, k])),
      cardStyle: data.cardStyle,
      google: data.google,
      today: data.today,
      setLabels,
      taskById,
      upsertTask: (task) =>
        setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev.map((t) => (t.id === task.id ? task : t)) : [...prev, task])),
      patchTask,
      removeTask: (id) => {
        setTasks((prev) => prev.filter((t) => t.id !== id));
        setSelected((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },
      setColumns,
      openTask: setOpenTaskId,
      openNewTask: (columnId) => setNewTask({ columnId }),
      openRelease: (columnId) => {
        const ids = (baseItems[columnId] ?? []);
        const pre = ids.filter((id) => selected.has(id));
        setRelease({ taskIds: ids, preselected: pre.length ? pre : ids });
      },
      selected,
      toggleSelected: (id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      track,
      refresh: () => router.refresh(),
    }),
    [data.project, data.users, data.currentUserId, data.deliverables, data.kinds, data.cardStyle, data.google, data.today, sortedColumns, labels, taskById, baseItems, selected, track, router, patchTask],
  );

  // --- Movimiento masivo ------------------------------------------------------
  const moveSelected = async (columnId: string) => {
    const ids = [...selected];
    if (!ids.length) return;
    const snapshot = tasks;
    // Optimista: al final de la columna destino, conservando el orden actual.
    let pos = Math.max(0, ...tasks.filter((t) => t.columnId === columnId).map((t) => t.position));
    const ordered = sortedColumns.flatMap((c) => (baseItems[c.id] ?? []).filter((id) => selected.has(id) && c.id !== columnId));
    const optimistic = new Map(ordered.map((id) => [id, (pos += 1024)]));
    setTasks((prev) => prev.map((t) => (optimistic.has(t.id) ? { ...t, columnId, position: optimistic.get(t.id)! } : t)));
    setSelected(new Set());
    const res = await track(moveTasks(ids, columnId));
    if (!res.ok) {
      setTasks(snapshot);
      return toast(res.error, "error");
    }
    const server = new Map(res.data.moved.map((m) => [m.id, m.position]));
    setTasks((prev) => prev.map((t) => (server.has(t.id) ? { ...t, columnId, position: server.get(t.id)! } : t)));
    const name = sortedColumns.find((c) => c.id === columnId)?.name;
    toast(`${res.data.moved.length} tarjeta(s) movidas a «${name}»`);
  };

  // --- Drag & drop --------------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = ({ active }: DragStartEvent) => {
    const id = String(active.id);
    const col = findContainer(baseItems, id);
    if (!col) return;
    dragOrigin.current = { columnId: col, index: baseItems[col]!.indexOf(id) };
    setDragItems(baseItems);
    setActiveId(id);
  };

  /** Mueve la tarjeta arrastrada a otra columna en el estado temporal del arrastre. */
  const moveActiveTo = (id: string, to: string, overId: string) =>
    setDragItems((prev) => {
      if (!prev) return prev;
      const from = findContainer(prev, id);
      if (!from || from === to) return prev;
      const target = prev[to]!;
      const overIndex = target.indexOf(overId);
      // Volver a la columna de origen por su pestaña recupera la posición original.
      const origin = dragOrigin.current;
      const index =
        overIndex >= 0 ? overIndex : overId.startsWith(TAB_PREFIX) && origin?.columnId === to ? Math.min(origin.index, target.length) : target.length;
      return {
        ...prev,
        [from]: prev[from]!.filter((x) => x !== id),
        [to]: [...target.slice(0, index), id, ...target.slice(index)],
      };
    });

  // Pestaña móvil bajo la tarjeta: cambia de columna tras una breve pausa, para que
  // cruzar la fila de pestañas de camino a la lista no cambie de columna sin querer.
  const tabHover = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clearTabHover = () => {
    if (tabHover.current) clearTimeout(tabHover.current.timer);
    tabHover.current = null;
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !dragItems) return;
    const id = String(active.id);
    const overId = String(over.id);
    if (overId.startsWith(TAB_PREFIX)) {
      if (tabHover.current?.id === overId) return;
      clearTabHover();
      const to = overId.slice(TAB_PREFIX.length);
      tabHover.current = {
        id: overId,
        timer: setTimeout(() => {
          setMobileColumn(to);
          moveActiveTo(id, to, overId);
        }, 350),
      };
      return;
    }
    clearTabHover();
    const from = findContainer(dragItems, id);
    const to = findContainer(dragItems, overId);
    if (!from || !to || from === to) return;
    moveActiveTo(id, to, overId);
  };

  const cancelDrag = () => {
    clearTabHover();
    setDragItems(null);
    setActiveId(null);
    dragOrigin.current = null;
    flushStale();
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    const origin = dragOrigin.current;
    const current = dragItems;
    cancelDrag();
    if (!over || !current || !origin) return;
    const id = String(active.id);
    const overId = String(over.id);
    let col = findContainer(current, id);
    if (!col) return;
    let list = current[col]!;
    // Soltar directamente sobre una pestaña: al final de esa columna (o en su sitio si es la de origen).
    if (overId.startsWith(TAB_PREFIX) && overId.slice(TAB_PREFIX.length) !== col) {
      const to = overId.slice(TAB_PREFIX.length);
      list = [...current[to]!.filter((x) => x !== id), id];
      col = to;
      setMobileColumn(to);
    }
    if (findContainer(current, overId) === col && overId !== id && !overId.startsWith(COLUMN_PREFIX) && !overId.startsWith(TAB_PREFIX)) {
      list = arrayMove(list, list.indexOf(id), list.indexOf(overId));
    }
    const index = list.indexOf(id);
    if (col === origin.columnId && index === origin.index) return;

    const prevId = list[index - 1] ?? null;
    const nextId = list[index + 1] ?? null;
    const position = positionBetween(prevId ? taskById.get(prevId)?.position : null, nextId ? taskById.get(nextId)?.position : null);
    const previous = taskById.get(id)!;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, columnId: col, position } : t)));

    const res = await track(moveTask(id, col, prevId, nextId));
    if (!res.ok) {
      setTasks((prev) => prev.map((t) => (t.id === id ? previous : t)));
      toast(res.error, "error");
    } else if (res.data.position !== position) {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, position: res.data.position } : t)));
    }
  };

  const activeTask = activeId ? taskById.get(activeId) : null;

  return (
    <BoardContext.Provider value={api}>
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 px-4 pt-4 pb-2 max-lg:hidden">
          <h1 className="min-w-0"><ProjectMenu textClassName="text-lg" /></h1>
          <span className="text-sm text-slate-500">{tasks.length} tarjetas</span>
          <a className="btn-secondary ml-auto" href={`/api/projects/${data.project.id}/report`} target="_blank" rel="noopener">
            <FileDown size={16} /> Informe PDF
          </a>
          <button className="btn-secondary" onClick={() => setBulk({})} title="Crear varias tareas pegando una lista">
            <PlusStack size={16} /> Varias tareas
          </button>
          <button className="btn-primary" onClick={() => setNewTask({})}>
            <Plus size={16} /> Nueva tarea
          </button>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={cancelDrag}
        >
          {/* Pestañas de columnas en móvil: también aceptan tarjetas arrastradas */}
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden dark:border-slate-800 dark:bg-slate-900">
            {sortedColumns.map((c) => (
              <MobileTab
                key={c.id}
                id={TAB_PREFIX + c.id}
                active={c.id === activeMobileColumn}
                dragging={!!activeId}
                onClick={() => setMobileColumn(c.id)}
              >
                {c.name} <span className="opacity-70">{items[c.id]?.length ?? 0}</span>
              </MobileTab>
            ))}
            <NewColumnButton variant="mobile" onCreated={setMobileColumn} />
          </div>
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 max-md:no-scrollbar pt-2 pb-24 md:px-4 md:pb-4">
            {sortedColumns.map((column, i) => (
              <ColumnView
                key={column.id}
                column={column}
                taskIds={items[column.id] ?? []}
                index={i}
                total={sortedColumns.length}
                droppableId={COLUMN_PREFIX + column.id}
                mobileHidden={column.id !== activeMobileColumn}
              />
            ))}
            <NewColumnButton variant="desktop" />
          </div>
          <DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>
            {activeTask ? <TaskCard task={activeTask} overlay /> : null}
          </DragOverlay>
        </DndContext>

        <button
          onClick={() => setBulk({ columnId: activeMobileColumn })}
          className="fixed right-[1.625rem] bottom-[calc(max(1.25rem,env(safe-area-inset-bottom))+4.25rem)] z-30 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-brand-600 shadow-lg hover:bg-slate-50 active:scale-95 lg:hidden dark:border-slate-700 dark:bg-slate-800 dark:text-brand-300"
          aria-label="Crear varias tareas"
        >
          <PlusStack size={22} />
        </button>
        <button
          onClick={() => setNewTask({ columnId: activeMobileColumn })}
          className="fixed right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700 active:scale-95 lg:hidden"
          aria-label="Nueva tarea o captura"
        >
          <Plus size={26} />
        </button>

        {selected.size > 0 && (
          <SelectionBar
            count={selected.size}
            columns={sortedColumns}
            nextReleaseColumn={nextReleaseColumn}
            onMove={moveSelected}
            onRelease={() => {
              const ids = sortedColumns.flatMap((c) => (baseItems[c.id] ?? []).filter((id) => selected.has(id)));
              setRelease({ taskIds: ids, preselected: ids });
            }}
            onClear={() => setSelected(new Set())}
          />
        )}

        {openTaskId && taskById.has(openTaskId) && (
          <TaskDialog key={openTaskId} task={taskById.get(openTaskId)!} onClose={() => setOpenTaskId(null)} />
        )}
        {newTask && (
          <NewTaskDialog
            initialColumnId={newTask.columnId}
            initialFiles={newTask.files}
            onClose={() => setNewTask(null)}
          />
        )}
        {bulk && <BulkTaskDialog initialColumnId={bulk.columnId} onClose={() => setBulk(null)} />}
        {release && (
          <ReleaseDialog
            tasks={release.taskIds.map((id) => taskById.get(id)).filter((t): t is BoardTask => !!t)}
            preselected={release.preselected}
            templates={data.templates}
            onClose={() => setRelease(null)}
            onDeployed={(result) => {
              setRelease(null);
              setSelected(new Set());
              const moved = new Map(result.moved.map((m) => [m.id, m]));
              const archived = new Set(result.archived);
              setTasks((prev) =>
                prev
                  .filter((t) => !archived.has(t.id))
                  .map((t) => (moved.has(t.id) ? { ...t, columnId: moved.get(t.id)!.columnId, position: moved.get(t.id)!.position } : t)),
              );
            }}
          />
        )}
      </div>
    </BoardContext.Provider>
  );
}

/** Dos «+» superpuestos: crear varias tareas. */
function PlusStack({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
      <path d="M9 11v9M4.5 15.5h9" />
      <path d="M16 3v8M12 7h8" />
    </svg>
  );
}
