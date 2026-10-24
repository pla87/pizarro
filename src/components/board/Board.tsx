"use client";

import {
  closestCorners, DndContext, type CollisionDetection, DragOverlay, pointerWithin, KeyboardSensor, MeasuringStrategy, PointerSensor,
  useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Archive, Plus, Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { archiveTasks, deleteTasks, duplicateTask, makeEvergreen, moveTask, moveTasks } from "@/actions/tasks";
import { createBoardCollisionDetection } from "@/lib/collision";
import { compareTaskOrder, insertBefore, moveOnto, neighboursOf, positionBetween } from "@/lib/positions";
import type { BoardColumn, BoardData, BoardTask, LabelOption } from "@/lib/types";
import { FilterMenu } from "./FilterMenu";
import { ProjectMenu } from "../ProjectMenu";
import { UndoButton } from "../UndoButton";
import { setBoardModalOpen } from "../undo-context";
import { useFloatingRect } from "../ui/useFloatingRect";
import { useT } from "@/i18n/client";
import { useConfirm } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import { cn } from "../ui/cn";
import { BoardContext, useSelectionSize, type BoardApi } from "./context";
import { createBoardStores, mergeTasks, tasksById, useStableValue } from "./stores";
import { ColumnView } from "./ColumnView";
import { EVERGREEN_DROPPABLE_PREFIX } from "./EvergreenPanel";
import { NewColumnButton } from "./NewColumnButton";
import { useCardActions } from "./cardActions";
import { activeFilterCount, EMPTY_FILTERS, filtersKey, parseStoredFilters, sanitizeFilters, taskMatchesFilters, type BoardFilters } from "./filters";
import { Presence } from "./Presence";
import { SelectionBar } from "./SelectionBar";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { useShortcut } from "./shortcuts";
import { useBoardShortcuts } from "./useBoardShortcuts";
import { TaskCard } from "./TaskCard";
import { ReportButton } from "../ReportButton";
import { imageFilesFrom, useBlockStrayFileDrops } from "./upload";
import { draftKey, readDraft, type EditTaskDraft, type NewTaskDraft } from "./drafts";
import { mentionsToPlain } from "@/lib/mentions";

// Los diálogos (con el editor de texto y el Markdown) no van en el código inicial del tablero:
// se cargan al abrirlos y se precargan cuando el navegador está libre.
const loadTaskDialog = () => import("./TaskDialog");
const loadNewTaskDialog = () => import("./NewTaskDialog");
const TaskDialog = dynamic(() => loadTaskDialog().then((m) => m.TaskDialog));
const NewTaskDialog = dynamic(() => loadNewTaskDialog().then((m) => m.NewTaskDialog));
const ReleaseDialog = dynamic(() => import("./ReleaseDialog").then((m) => m.ReleaseDialog));
const BulkTaskDialog = dynamic(() => import("./BulkTaskDialog").then((m) => m.BulkTaskDialog));
const ArchivedDialog = dynamic(() => import("./ArchivedDialog").then((m) => m.ArchivedDialog));

const COLUMN_PREFIX = "col:";
/** Contenedor virtual del arrastre de una tarea fija (evergreen): origen fuera de las listas ordenables. */
const EVERGREEN_ORIGIN = "__evergreen__";
/** Entradas del historial que se guardan al cambiar de columna en móvil (atrás vuelve a ellas). */
const MAX_COLUMN_HISTORY = 5;

const baseCollisionDetection = createBoardCollisionDetection({ closestCorners, pointerWithin });
/** Si el puntero está dentro del panel de tareas fijas, manda él; si no, la detección normal del tablero. */
const boardCollisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const visible = args.droppableContainers.filter(
      (c) => String(c.id).startsWith(EVERGREEN_DROPPABLE_PREFIX) && (args.droppableRects.get(c.id)?.width ?? 0) > 0,
    );
    const hit = pointerWithin({ ...args, droppableContainers: visible });
    if (hit.length) return hit;
  }
  return baseCollisionDetection(args);
};

/** Pantalla táctil: las tarjetas se arrastran con su asa para que el resto de la tarjeta deje hacer scroll. */
const COARSE_QUERY = "(pointer: coarse)";
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(COARSE_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(COARSE_QUERY).matches,
    () => false,
  );
}

function MobileTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      data-active={active || undefined}
      className={cn(
        "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
        active ? "bg-brand-600 text-on-brand" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
      )}
    >
      {children}
    </button>
  );
}
// Respaldo del canal en vivo (SSE), que ya avisa de cada cambio: no hace falta refrescar más a menudo.
const REFRESH_MS = 120_000;

type Items = Record<string, string[]>;

function groupItems(columns: BoardColumn[], tasks: BoardTask[]): Items {
  const items: Items = Object.fromEntries(columns.map((c) => [c.id, [] as string[]]));
  // Mismo orden que el servidor (posición y, si coincidieran, id): no depende del orden en que lleguen las tareas.
  for (const t of [...tasks].sort(compareTaskOrder)) if (!t.evergreen) items[t.columnId]?.push(t.id);
  return items;
}

// Constante: un objeto nuevo en cada dibujo invalidaría el contexto de dnd-kit y redibujaría todas las tarjetas.
const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };
// Opciones de los sensores, también constantes: si cambian, cambian los `listeners` de todas las tarjetas.
const POINTER_OPTIONS = { activationConstraint: { distance: 6 } };
const KEYBOARD_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };
const DROP_ANIMATION = { duration: 150, easing: "ease-out" };

/**
 * Conserva el mismo array de ids en las columnas cuyo contenido no cambió: dnd-kit rehace su contexto (y redibuja
 * todas las tarjetas de la columna) cuando le llega un array nuevo, aunque tenga los mismos ids.
 */
function useStableItems(items: Items): Items {
  const [stable, setStable] = useState(items);
  if (stable === items) return stable;
  const cols = Object.keys(items);
  let changed = cols.length !== Object.keys(stable).length;
  const next: Items = {};
  for (const col of cols) {
    const before = stable[col];
    const now = items[col]!;
    if (before && before.length === now.length && before.every((id, i) => id === now[i])) next[col] = before;
    else {
      next[col] = now;
      changed = true;
    }
  }
  if (!changed) return stable;
  setStable(next);
  return next;
}

/** Minúsculas y sin acentos, para comparar el filtro. */
const normalize = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function findContainer(items: Items, id: string): string | undefined {
  if (id.startsWith(COLUMN_PREFIX)) return id.slice(COLUMN_PREFIX.length);
  return Object.keys(items).find((col) => items[col]!.includes(id));
}

export function Board({ data, initialTaskId = null }: { data: BoardData; initialTaskId?: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const t = useT();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useBlockStrayFileDrops();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [columns, setColumns] = useState(data.columns);
  // Tareas y selección viven en almacenes externos: cada tarjeta se suscribe solo a lo suyo (ver context.ts)
  // y el tablero no se redibuja al seleccionar.
  const [stores] = useState(() => createBoardStores(data.tasks));
  const tasks = useSyncExternalStore(stores.tasks.subscribe, stores.tasks.get, stores.tasks.get);
  const setTasks = stores.tasks.set;
  const setSelected = stores.selection.set;
  const [labels, setLabels] = useState<LabelOption[]>(data.labels);
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialTaskId);
  const [newTask, setNewTask] = useState<{ columnId?: string; files?: File[]; evergreen?: boolean; draft?: NewTaskDraft | null } | null>(null);
  const [editDraft, setEditDraft] = useState<EditTaskDraft | null>(null);
  const [secondNew, setSecondNew] = useState<{ columnId?: string } | null>(null);
  const [bulk, setBulk] = useState<{ columnId?: string } | null>(null);
  const [release, setRelease] = useState<{ taskIds: string[]; preselected: string[] } | null>(null);
  const [mobileColumn, setMobileColumn] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  // Móvil: el buscador y los filtros se despliegan desde un icono (ver más abajo).
  const [mobileSearch, setMobileSearch] = useState(false);
  // Filtros rápidos: se recuerdan por persona y proyecto (localStorage; si no está disponible, solo dura la sesión).
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const filtersStorageKey = filtersKey(data.currentUserId, data.project.id);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        setFilters(parseStoredFilters(window.localStorage.getItem(filtersStorageKey)));
      } catch {
        // Sin almacenamiento: se empieza sin filtros.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [filtersStorageKey]);
  const changeFilters = (next: BoardFilters) => {
    setFilters(next);
    try {
      if (activeFilterCount(next) === 0) window.localStorage.removeItem(filtersStorageKey);
      else window.localStorage.setItem(filtersStorageKey, JSON.stringify(next));
    } catch {
      // Sin almacenamiento: el filtro vale igualmente en esta sesión.
    }
  };
  const sc = useShortcut();
  const dragHandle = useCoarsePointer();

  // Precarga de los diálogos más usados cuando el navegador queda libre: abrirlos es instantáneo.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => {
      void loadTaskDialog();
      void loadNewTaskDialog();
      void import("@/components/ui/RichTextEditor");
    });
    return () => cancel(id);
  }, []);

  // Borradores locales: si la página se cerró con una tarea abierta o a medio crear, se reabre.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const edit = readDraft<EditTaskDraft>(draftKey("edit", data.currentUserId, data.project.id));
      // Los borradores sin cambios (versiones anteriores los guardaban siempre) no reabren nada.
      if (edit && (edit.title !== undefined || edit.description !== undefined) && !initialTaskId && data.tasks.some((t) => t.id === edit.taskId)) {
        setEditDraft(edit);
        setOpenTaskId(edit.taskId);
      }
      const created = readDraft<NewTaskDraft>(draftKey("new", data.currentUserId, data.project.id));
      if (created) setNewTask({ draft: created });
    });
    return () => cancelAnimationFrame(frame);
    // Solo al abrir el tablero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Estado temporal durante el arrastre.
  const [dragItems, setDragItems] = useState<Items | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragOrigin = useRef<{ columnId: string; index: number } | null>(null);
  // Arrastre con ratón y Ctrl (o Alt/⌥) pulsada al soltar: se suelta una copia y la original se queda.
  // `mouseDrag`: solo con ratón (ni teclado ni táctil). Se sigue la tecla en vivo para el aviso «+ Duplicar».
  const mouseDrag = useRef(false);
  const duplicateRef = useRef(false);
  const [duplicating, setDuplicating] = useState(false);
  useEffect(() => {
    if (!activeId || !mouseDrag.current) return;
    const sync = (e: KeyboardEvent | PointerEvent) => {
      const on = e.ctrlKey || e.altKey;
      duplicateRef.current = on;
      setDuplicating(on);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Control" && e.key !== "Alt") return;
      // Alt suelta enfocaría la barra de menús en algunos navegadores.
      e.preventDefault();
      sync(e);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    // Captura: llega antes que el pointerup con el que dnd-kit termina el arrastre.
    window.addEventListener("pointermove", sync, true);
    window.addEventListener("pointerup", sync, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("pointermove", sync, true);
      window.removeEventListener("pointerup", sync, true);
      setDuplicating(false);
    };
  }, [activeId]);

  // Mutaciones en vuelo: mientras haya alguna no se sobrescribe el estado con datos del servidor.
  // Si llegan datos en ese momento, se marcan como pendientes y se vuelven a pedir al terminar.
  const pending = useRef(0);
  const staleRefresh = useRef(false);
  // Un refresco pedido antes de un cambio puede llegar después con el orden viejo (las tarjetas
  // «se reordenan solas» un momento): se anota cuándo se pidió el último y cuándo empezó el último cambio.
  const refreshAt = useRef(0);
  const mutationAt = useRef(0);
  const refresh = useCallback(() => {
    refreshAt.current = performance.now();
    router.refresh();
  }, [router]);
  const flushStale = useCallback(() => {
    if (staleRefresh.current && pending.current === 0) {
      staleRefresh.current = false;
      refresh();
    }
  }, [refresh]);
  // Contador de operaciones en curso (evita refrescos intermedios). Sin capturar errores: lo usan las subidas, que informan por excepción.
  const trackRaw = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    mutationAt.current = performance.now();
    pending.current++;
    try {
      return await p;
    } finally {
      pending.current--;
      flushStale();
    }
  }, [flushStale]);
  // Para server actions: si lanzan (sin red, acción inexistente tras un despliegue) se avisa, se refresca
  // desde el servidor para deshacer lo optimista y se devuelve un fallo como el de cualquier acción.
  const track = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    try {
      return await trackRaw(p);
    } catch {
      const error = t("Error inesperado. Inténtalo de nuevo.");
      toast(error, "error");
      // Un refresco ya pedido antes del cambio podría traer datos viejos: se fuerza uno nuevo.
      mutationAt.current = 0;
      refresh();
      return { ok: false, error } as T;
    }
  }, [trackRaw, toast, t, refresh]);

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
  }, [setTasks]);

  const upsertTask = useCallback(
    (task: BoardTask) => setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev.map((t) => (t.id === task.id ? task : t)) : [...prev, task])),
    [setTasks],
  );

  // Sincroniza con el servidor cuando llegan datos nuevos (router.refresh).
  useEffect(() => {
    if (pending.current > 0 || activeId || mutationAt.current > refreshAt.current) {
      // Datos que pueden ser anteriores a un cambio propio: se piden otra vez cuando no quede ninguno en vuelo.
      staleRefresh.current = true;
      if (!activeId) flushStale();
      return;
    }
    setColumns(data.columns);
    setTasks((prev) => mergeTasks(prev, data.tasks));
    setLabels(data.labels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Cambios de otras pestañas y personas casi al momento: el servidor avisa (Server-Sent Events) y
  // se refresca. Se agrupan los avisos seguidos; si la conexión cae, EventSource reconecta solo.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const source = new EventSource(`/api/projects/${data.project.id}/events`);
    source.addEventListener("change", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (pending.current > 0) staleRefresh.current = true;
        else refresh();
      }, 200);
    });
    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [data.project.id, refresh]);

  // Refresco ligero de respaldo (por si el canal de avisos no llega).
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && pending.current === 0 && !document.querySelector("[role=dialog]")) refresh();
    };
    const timer = setInterval(tick, REFRESH_MS);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [refresh]);

  const baseItems = useStableItems(useMemo(() => groupItems(columns, tasks), [columns, tasks]));
  // Filtro del buscador: por título, tipo, responsable y etiquetas (todas las palabras deben aparecer).
  const terms = useMemo(() => normalize(query).split(/\s+/).filter(Boolean), [query]);
  // Filtros rápidos sin lo que ya no existe (etiqueta borrada, persona que dejó el proyecto…).
  const activeFilters = useMemo(
    () => sanitizeFilters(filters, { labels: new Set(labels.map((l) => l.id)), kinds: new Set(data.kinds.map((k) => k.id)), users: new Set(data.users.map((u) => u.id)) }),
    [filters, labels, data.kinds, data.users],
  );
  const filterCount = activeFilterCount(activeFilters);
  const filtering = terms.length > 0 || filterCount > 0;
  const matchingIds = useMemo(() => {
    if (!filtering) return null;
    const doneColumnIds = new Set(columns.filter((c) => c.isDone).map((c) => c.id));
    const kindName = new Map(data.kinds.map((k) => [k.id, k.name]));
    const userName = new Map(data.users.map((u) => [u.id, u.name]));
    const labelName = new Map(labels.map((l) => [l.id, l.name]));
    const ids = new Set<string>();
    for (const task of tasks) {
      const hay = normalize(
        [mentionsToPlain(task.title), kindName.get(task.kindId), task.assigneeId ? userName.get(task.assigneeId) : "", ...task.labelIds.map((id) => labelName.get(id))].join(" "),
      );
      if (terms.every((w) => hay.includes(w)) && taskMatchesFilters(task, activeFilters, { currentUserId: data.currentUserId, today: data.today, doneColumnIds })) ids.add(task.id);
    }
    return ids;
  }, [filtering, terms, tasks, data.kinds, data.users, data.currentUserId, data.today, labels, columns, activeFilters]);
  // `dragItems` lleva siempre las listas COMPLETAS (también con filtro): al soltar, los vecinos que se
  // envían al servidor son los reales, de modo que las tarjetas ocultas conservan su orden relativo.
  const items = useStableItems(useMemo(() => {
    const all = dragItems ?? baseItems;
    if (!matchingIds) return all;
    return Object.fromEntries(Object.entries(all).map(([col, ids]) => [col, ids.filter((id) => matchingIds.has(id))])) as Items;
  }, [dragItems, baseItems, matchingIds]));
  const shownCount = matchingIds ? matchingIds.size : tasks.length;
  // Al filtrar se deseleccionan las tarjetas que quedan ocultas (las acciones masivas no deben tocar lo que no se ve).
  useEffect(() => {
    if (!matchingIds) return;
    const sel = stores.selection.get();
    if (sel.size && [...sel].some((id) => !matchingIds.has(id))) stores.selection.set(new Set([...sel].filter((id) => matchingIds.has(id))));
  }, [matchingIds, stores]);
  // Tareas evergreen por columna: fuera de la lista ordenable, se muestran en el pie de la columna de la release.
  const evergreenByColumn = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const t of [...tasks].sort(compareTaskOrder)) if (t.evergreen) (map[t.columnId] ??= []).push(t.id);
    return map;
  }, [tasks]);
  const shownEvergreen = useMemo(
    () => (matchingIds ? Object.fromEntries(Object.entries(evergreenByColumn).map(([c, ids]) => [c, ids.filter((id) => matchingIds.has(id))])) : evergreenByColumn),
    [evergreenByColumn, matchingIds],
  );
  const taskById = tasksById(tasks);
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

  const getTask = useCallback((id: string) => tasksById(stores.tasks.get()).get(id), [stores]);
  // Móvil: tras crear una tarea se salta a su columna (puede no ser la visible) y la tarjeta se centra con un destello.
  const showColumnRef = useRef<(columnId: string) => void>(() => {});
  const revealTask = useCallback((id: string) => {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    const task = getTask(id);
    if (!task) return;
    const start = performance.now();
    // Primero se espera a que el diálogo se cierre y retire su entrada del historial (useBackToClose): si la
    // pestaña se cambiara antes, ese «atrás» se llevaría la entrada de la columna y volvería a la anterior.
    const whenClosed = () => {
      const modalEntry = ((window.history.state ?? {}) as { pzModals?: string[] }).pzModals?.length;
      if ((modalEntry || document.querySelector("[role=dialog]")) && performance.now() - start < 1500) {
        requestAnimationFrame(whenClosed);
        return;
      }
      showColumnRef.current(task.columnId);
      requestAnimationFrame(reveal);
    };
    let frames = 0;
    const reveal = () => {
      const card = document.querySelector<HTMLElement>(`[data-task-card="${CSS.escape(id)}"]`);
      // Hasta que la columna se pinte la tarjeta no está o está oculta.
      if (!card || card.offsetParent === null) {
        if (++frames < 60) requestAnimationFrame(reveal);
        return;
      }
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ block: "center", inline: "nearest", behavior: smooth ? "smooth" : "auto" });
      delete card.dataset.flash;
      void card.offsetWidth; // reinicia la animación si ya estaba
      card.dataset.flash = "";
      // Al terminar la animación (o, si se interrumpe, al rato) se quita la marca.
      const clear = () => delete card.dataset.flash;
      card.addEventListener("animationend", clear, { once: true });
      window.setTimeout(clear, 3000);
    };
    requestAnimationFrame(whenClosed);
  }, [getTask]);
  const cardActions = useCardActions({ currentUserId: data.currentUserId, getTask, sortedColumns, baseItems, patchTask, upsertTask, track, toast, t });

  // El contexto solo cambia si cambia su contenido: los datos del servidor llegan como objetos nuevos en cada
  // refresco aunque sean iguales, y sin esto todas las tarjetas se redibujarían cada vez.
  const project = useStableValue(data.project);
  const users = useStableValue(data.users);
  const kinds = useStableValue(data.kinds);
  const deliverables = useStableValue(data.deliverables);
  const google = useStableValue(data.google);
  const stableColumns = useStableValue(sortedColumns);
  const stableLabels = useStableValue(labels);
  // Lo que necesitan las funciones del contexto sin ser dependencia suya (se leen al llamarlas).
  const latest = useRef({ baseItems, evergreenByColumn });
  useEffect(() => {
    latest.current = { baseItems, evergreenByColumn };
  });

  const api: BoardApi = useMemo(
    () => ({
      project,
      users,
      currentUserId: data.currentUserId,
      columns: stableColumns,
      labels: stableLabels,
      deliverables,
      kinds,
      kindById: new Map(kinds.map((k) => [k.id, k])),
      cardStyle: data.cardStyle,
      editorMode: data.editorMode,
      dragHandle,
      google,
      today: data.today,
      setLabels,
      stores,
      getTask,
      getTasks: stores.tasks.get,
      upsertTask,
      patchTask,
      ...cardActions,
      removeTask: (id) => {
        setTasks((prev) => prev.filter((t) => t.id !== id));
        stores.selection.set((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },
      setColumns,
      openTask: setOpenTaskId,
      openNewTask: (columnId, evergreen) => setNewTask({ columnId, evergreen }),
      revealTask,
      openRelease: (columnId) => {
        // Las evergreen van siempre incluidas y preseleccionadas (se pueden desmarcar en el diálogo).
        const { baseItems: base, evergreenByColumn: evergreen } = latest.current;
        const fixed = evergreen[columnId] ?? [];
        const ids = [...(base[columnId] ?? []), ...fixed];
        const selected = stores.selection.get();
        const pre = ids.filter((id) => selected.has(id));
        setRelease({ taskIds: ids, preselected: pre.length ? [...new Set([...pre, ...fixed])] : ids });
      },
      getSelected: stores.selection.get,
      clearSelection: () => stores.selection.set(new Set()),
      setSelectedMany: (ids, on) =>
        stores.selection.set((prev) => {
          const next = new Set(prev);
          for (const id of ids) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
      toggleSelected: (id) =>
        stores.selection.set((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      track,
      trackRaw,
      refresh,
    }),
    [setTasks, revealTask, project, users, data.currentUserId, deliverables, kinds, data.cardStyle, data.editorMode, dragHandle, google, data.today, stableColumns, stableLabels, stores, getTask, track, trackRaw, refresh, patchTask, upsertTask, cardActions],
  );

  // --- Movimiento masivo ------------------------------------------------------
  // Deshace un cambio masivo fallido tocando solo esas tareas (por id): no pisa lo que haya llegado mientras tanto
  // (refrescos por SSE, ediciones desde un diálogo). Las que ya no estén se vuelven a añadir.
  const restoreTasks = (before: Map<string, BoardTask>) =>
    setTasks((prev) => {
      const seen = new Set<string>();
      const next = prev.map((t) => {
        const old = before.get(t.id);
        if (!old) return t;
        seen.add(t.id);
        return old;
      });
      for (const [id, old] of before) if (!seen.has(id)) next.push(old);
      return next;
    });

  const moveSelected = async (columnId: string) => {
    const selected = stores.selection.get();
    const ids = [...selected];
    if (!ids.length) return;
    const before = new Map(tasks.filter((t) => ids.includes(t.id)).map((t) => [t.id, t]));
    // Optimista: al final de la columna destino, conservando el orden actual.
    let pos = Math.max(0, ...tasks.filter((t) => t.columnId === columnId).map((t) => t.position));
    const ordered = sortedColumns.flatMap((c) => (baseItems[c.id] ?? []).filter((id) => selected.has(id) && c.id !== columnId));
    const optimistic = new Map(ordered.map((id) => [id, (pos += 1024)]));
    setTasks((prev) => prev.map((t) => (optimistic.has(t.id) ? { ...t, columnId, position: optimistic.get(t.id)!, evergreen: false } : t)));
    setSelected(new Set());
    const res = await track(moveTasks(ids, columnId));
    if (!res.ok) {
      restoreTasks(before);
      return toast(res.error, "error");
    }
    const server = new Map(res.data.moved.map((m) => [m.id, m.position]));
    setTasks((prev) => prev.map((t) => (server.has(t.id) ? { ...t, columnId, position: server.get(t.id)!, evergreen: false } : t)));
    res.data.spawned.forEach(upsertTask);
    const name = sortedColumns.find((c) => c.id === columnId)?.name;
    toast(t("{moved} a «{name}»", { moved: res.data.moved.length === 1 ? t("1 tarjeta movida") : t("{n} tarjetas movidas", { n: res.data.moved.length }), name: name ?? "" }));
  };

  const archiveSelected = async () => {
    const ids = [...stores.selection.get()];
    if (!ids.length) return;
    const before = new Map(tasks.filter((t) => ids.includes(t.id)).map((t) => [t.id, t]));
    const gone = new Set(ids);
    setTasks((prev) => prev.filter((t) => !gone.has(t.id)));
    setSelected(new Set());
    const res = await track(archiveTasks(ids));
    if (!res.ok) {
      restoreTasks(before);
      return toast(res.error, "error");
    }
    res.data.spawned.forEach(upsertTask);
    toast(res.data.archived === 1 ? t("1 tarea archivada") : t("{n} tareas archivadas", { n: res.data.archived }));
  };

  // «?archivadas=1» (enlace del menú lateral en móvil) abre el listado de archivadas.
  const wantsArchived = searchParams.has("archivadas");
  const closeArchived = () => {
    setArchivedOpen(false);
    if (searchParams.has("archivadas")) {
      const rest = new URLSearchParams(searchParams);
      rest.delete("archivadas");
      const qs = rest.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  };

  const deleteSelected = async () => {
    const ids = [...stores.selection.get()];
    if (!ids.length) return;
    const ok = await confirm({
      title: ids.length === 1 ? t("Borrar tarea") : t("Borrar tareas"),
      message: ids.length === 1 ? t("¿Borrar definitivamente la tarea seleccionada y sus adjuntos?") : t("¿Borrar definitivamente las {n} tareas seleccionadas y sus adjuntos?", { n: ids.length }),
      confirmLabel: t("Borrar"),
      danger: true,
    });
    if (!ok) return;
    const before = new Map(tasks.filter((t) => ids.includes(t.id)).map((t) => [t.id, t]));
    const gone = new Set(ids);
    setTasks((prev) => prev.filter((t) => !gone.has(t.id)));
    setSelected(new Set());
    const res = await track(deleteTasks(ids));
    if (!res.ok) {
      restoreTasks(before);
      return toast(res.error, "error");
    }
    toast(res.data.deleted === 1 ? t("1 tarea borrada") : t("{n} tareas borradas", { n: res.data.deleted }));
  };

  // --- Columna visible en móvil e historial -----------------------------------
  // Cada cambio de columna añade una entrada al historial (hasta MAX_COLUMN_HISTORY seguidas):
  // el botón atrás devuelve a la columna anterior antes de salir del tablero.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const col = (e.state as { pzColumn?: string } | null)?.pzColumn;
      setMobileColumn(col ?? null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const showMobileColumn = (columnId: string) => {
    if (columnId === activeMobileColumn) return;
    const state = (window.history.state ?? {}) as { pzColumn?: string; pzDepth?: number };
    const depth = state.pzDepth ?? 0;
    const next = { ...state, pzColumn: columnId, pzDepth: Math.min(depth + 1, MAX_COLUMN_HISTORY) };
    if (depth < MAX_COLUMN_HISTORY) window.history.pushState(next, "");
    else window.history.replaceState(next, "");
    setMobileColumn(columnId);
  };
  useEffect(() => {
    showColumnRef.current = showMobileColumn;
  });

  // Deslizar el dedo a los lados cambia de columna en móvil (no al arrastrar una tarjeta ni al hacer scroll vertical).
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const onSwipeStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (e.touches.length !== 1 || activeId || target.closest(`button[aria-label='${t("Arrastrar para reordenar")}'], input, textarea, select`)) {
      swipe.current = null;
      return;
    }
    swipe.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, t: Date.now() };
  };
  // La pestaña de la columna visible siempre a la vista (al deslizar puede quedar fuera).
  useEffect(() => {
    document.querySelector<HTMLElement>("[data-mobile-tabs] [data-active]")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [activeMobileColumn]);
  const onSwipeEnd = (e: React.TouchEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || activeId || !window.matchMedia("(max-width: 767px)").matches) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Date.now() - start.t > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const index = sortedColumns.findIndex((c) => c.id === activeMobileColumn);
    const next = sortedColumns[index + (dx < 0 ? 1 : -1)];
    if (next) showMobileColumn(next.id);
  };

  // --- Drag & drop --------------------------------------------------------------
  const sensors = useSensors(
    // Con ratón, toda la tarjeta; en táctil, solo el asa (touch-action: none), así que basta con poca distancia.
    useSensor(PointerSensor, POINTER_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_OPTIONS),
  );

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const id = String(active.id);
    const pointer = typeof PointerEvent !== "undefined" && activatorEvent instanceof PointerEvent ? activatorEvent : null;
    mouseDrag.current = pointer?.pointerType === "mouse";
    duplicateRef.current = mouseDrag.current && !!(pointer?.ctrlKey || pointer?.altKey);
    setDuplicating(duplicateRef.current);
    const col = findContainer(baseItems, id);
    if (!col) {
      // Tarea fija: no está en ninguna lista; se arrastra desde un contenedor virtual.
      if (!taskById.get(id)?.evergreen) return;
      dragOrigin.current = { columnId: EVERGREEN_ORIGIN, index: 0 };
      setDragItems({ ...baseItems, [EVERGREEN_ORIGIN]: [id] });
      setActiveId(id);
      return;
    }
    dragOrigin.current = { columnId: col, index: baseItems[col]!.indexOf(id) };
    setDragItems(baseItems);
    setActiveId(id);
  };

  /** Mueve la tarjeta arrastrada a otra columna en el estado temporal del arrastre. */
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !dragItems) return;
    const id = String(active.id);
    const overId = String(over.id);
    setDragItems((prev) => {
      if (!prev) return prev;
      const from = findContainer(prev, id);
      if (!from) return prev;
      // Tarea fija que vuelve sobre su panel: regresa al origen virtual.
      if (overId.startsWith(EVERGREEN_DROPPABLE_PREFIX)) {
        if (dragOrigin.current?.columnId !== EVERGREEN_ORIGIN || from === EVERGREEN_ORIGIN) return prev;
        return { ...prev, [from]: prev[from]!.filter((x) => x !== id), [EVERGREEN_ORIGIN]: [id] };
      }
      const to = findContainer(prev, overId);
      if (!to || from === to) return prev;
      return {
        ...prev,
        [from]: prev[from]!.filter((x) => x !== id),
        [to]: insertBefore(prev[to]!, id, overId),
      };
    });
  };

  const cancelDrag = () => {
    setDragItems(null);
    setActiveId(null);
    dragOrigin.current = null;
    flushStale();
  };

  /** Soltar una tarjeta en el panel de fijas: pasa a la columna de la release como evergreen. */
  const dropOnEvergreen = async (id: string, columnId: string) => {
    const previous = taskById.get(id);
    if (!previous) return;
    const position = Math.max(0, ...tasks.filter((t) => t.columnId === columnId).map((t) => t.position)) + 1024;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, columnId, position, evergreen: true } : t)));
    const res = await track(makeEvergreen(id));
    if (!res.ok) {
      setTasks((prev) => prev.map((t) => (t.id === id ? previous : t)));
      return toast(res.error, "error");
    }
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, columnId: res.data.columnId, position: res.data.position, evergreen: true } : t)));
  };

  /** Ctrl/Alt al soltar: una copia de la tarea (duplicateTask) en esa columna, entre esas vecinas; la original no se mueve. */
  const dropCopy = async (id: string, columnId: string, prevId: string | null, nextId: string | null) => {
    const res = await track(duplicateTask(id, { columnId, prevId, nextId }));
    if (!res.ok) return toast(res.error, "error");
    upsertTask(res.data);
    toast(t("Tarea duplicada"), "undo");
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    const origin = dragOrigin.current;
    const current = dragItems;
    const copy = mouseDrag.current && duplicateRef.current;
    cancelDrag();
    if (!over || !current || !origin) return;
    const id = String(active.id);
    const overId = String(over.id);
    if (overId.startsWith(EVERGREEN_DROPPABLE_PREFIX)) {
      // Soltar una tarea fija en su propio panel no hace nada.
      if (origin.columnId === EVERGREEN_ORIGIN) return;
      // Copia sobre el panel de fijas: al final de esa columna, como tarea normal.
      if (copy) return dropCopy(id, overId.slice(EVERGREEN_DROPPABLE_PREFIX.length), null, null);
      return dropOnEvergreen(id, overId.slice(EVERGREEN_DROPPABLE_PREFIX.length));
    }
    const col = findContainer(current, id);
    if (!col || col === EVERGREEN_ORIGIN) return;
    let list = current[col]!;
    if (findContainer(current, overId) === col && overId !== id && !overId.startsWith(COLUMN_PREFIX)) {
      list = moveOnto(list, id, overId);
    }
    const index = list.indexOf(id);
    // La copia se suelta donde quedaría la tarjeta (también en su mismo sitio: justo detrás de la original).
    if (copy) {
      const at = neighboursOf(list, id);
      return dropCopy(id, col, at.prevId, at.nextId);
    }
    if (col === origin.columnId && index === origin.index) return;

    const { prevId, nextId } = neighboursOf(list, id);
    const position = positionBetween(prevId ? taskById.get(prevId)?.position : null, nextId ? taskById.get(nextId)?.position : null);
    const previous = taskById.get(id)!;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, columnId: col, position, evergreen: false } : t)));

    const res = await track(moveTask(id, col, prevId, nextId));
    if (!res.ok) {
      setTasks((prev) => prev.map((t) => (t.id === id ? previous : t)));
      toast(res.error, "error");
    } else if (res.data.position !== position) {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, position: res.data.position } : t)));
    }
    if (res.ok) res.data.spawned.forEach(upsertTask);
  };

  // Dos modales a la vez (escritorio): el «+» del abierto crea un segundo de nueva tarea (columna «Backlog» si existe, si no la primera; no hay rol BACKLOG).
  const primaryOpen = !!newTask || (!!openTaskId && taskById.has(openTaskId));
  // Mientras hay un diálogo de tarea, los botones de la cabecera (deshacer, «Nueva tarea») quedan por encima del fondo.
  useEffect(() => {
    setBoardModalOpen(primaryOpen);
    return () => setBoardModalOpen(false);
  }, [primaryOpen]);
  const newTaskBtnRef = useRef<HTMLButtonElement>(null);
  const newTaskRect = useFloatingRect(newTaskBtnRef, primaryOpen);
  const addSecond = () => setSecondNew({ columnId: (sortedColumns.find((c) => c.name.trim().toLowerCase() === "backlog") ?? sortedColumns[0])?.id });

  // Atajos de teclado (escritorio). Alt+N con un modal abierto lo comporta como el «+» de al lado.
  useBoardShortcuts({
    newTask: () => {
      if (document.querySelector("[role=dialog]")) {
        if (primaryOpen && !secondNew && window.matchMedia("(min-width: 1024px)").matches) addSecond();
        return;
      }
      setNewTask({});
    },
    bulk: () => setBulk({}),
    search: () => {
      // El buscador de escritorio, o el de móvil/tableta si es el visible.
      const input = [searchRef.current, mobileSearchRef.current].find((el) => el && el.offsetParent !== null);
      if (!input) return setMobileSearch(true);
      input.focus();
      input.select();
    },
    help: () => setHelpOpen(true),
    release: () => {
      if (nextReleaseColumn && (baseItems[nextReleaseColumn.id]?.length || evergreenByColumn[nextReleaseColumn.id]?.length)) api.openRelease(nextReleaseColumn.id);
    },
  });

  const activeTask = activeId ? taskById.get(activeId) : null;

  return (
    <BoardContext.Provider value={api}>
      <div className="flex h-full flex-col">
        {/* Contenedor de consulta: la cabecera se adapta al ancho que le deja la barra lateral, no al de la ventana. */}
        <div className="@container max-lg:hidden">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 @min-[1000px]:gap-3 [&>*]:whitespace-nowrap [&_.btn-primary]:shrink-0 [&_.btn-secondary]:shrink-0">
          {/* El nombre del proyecto no se encoge: el resto de la cabecera cede sitio antes (solo se trunca si ocupa media cabecera). */}
          <h1 className="max-w-[45%] shrink-0"><ProjectMenu textClassName="text-lg" /></h1>
          <UndoButton projectId={data.project.id} shortcut className="-ml-2" />
          <span
            className="shrink-0 text-sm text-slate-500"
            aria-live="polite"
            title={filtering ? undefined : t("{n} tarjetas", { n: tasks.length })}
          >
            {filtering ? (
              t("{shown} de {total}", { shown: shownCount, total: tasks.length })
            ) : (
              <>
                {/* Con poco ancho, solo el número (el texto completo queda en el tooltip y para lectores de pantalla). */}
                <span className="@min-[1000px]:hidden" aria-hidden>{tasks.length}</span>
                <span className="@max-[999px]:sr-only">{t("{n} tarjetas", { n: tasks.length })}</span>
              </>
            )}
          </span>
          <Presence projectId={data.project.id} />
          <div className="relative ml-auto w-36 min-w-16 shrink transition-[width] @min-[1000px]:focus-within:w-56">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setQuery("");
                  e.currentTarget.blur();
                }
              }}
              placeholder={t("Filtrar ({keys})", { keys: "/" })}
              aria-label={t("Filtrar tarjetas")}
              title={t("Filtrar tarjetas por título, tipo, responsable o etiqueta ({keys})", { keys: "/" })}
              className="input h-8 [&::-webkit-search-cancel-button]:hidden pr-7 pl-8 text-sm"
            />
            {query && (
              <button type="button" className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label={t("Quitar el filtro")}>
                <X size={14} />
              </button>
            )}
          </div>
          <FilterMenu filters={activeFilters} onChange={changeFilters} labels={labels} kinds={data.kinds} users={data.users} currentUserId={data.currentUserId} className="-ml-1.5 shrink-0" />
          {filterCount > 0 && (
            <button type="button" className="-ml-1 text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:hover:text-slate-300" onClick={() => changeFilters(EMPTY_FILTERS)}>
              {t("Limpiar filtros")}
            </button>
          )}
          <ReportButton projectId={data.project.id} variant="header" />
          <button className="btn-secondary" onClick={() => setArchivedOpen(true)} aria-label={t("Archivadas")} title={t("Archivadas")}>
            <Archive size={16} /> <span className="hidden @min-[1240px]:inline">{t("Archivadas")}</span>
          </button>
          <button className="btn-secondary" onClick={() => setBulk({})} aria-label={t("Varias tareas")} title={`${t("Crear varias tareas pegando una lista")} (${sc("Alt+Shift+N")})`}>
            <PlusStack size={16} /> <span className="hidden @min-[1240px]:inline">{t("Varias tareas")}</span>
          </button>
          <button ref={newTaskBtnRef} className="btn-primary" onClick={() => (primaryOpen ? (!secondNew && addSecond()) : setNewTask({}))} aria-label={t("Nueva tarea")} title={`${t("Nueva tarea")} (${sc("Alt+N")})`}>
            <Plus size={16} /> <span className="@min-[1240px]:hidden">{t("Nueva")}</span><span className="hidden @min-[1240px]:inline">{t("Nueva tarea")}</span>
          </button>
          {/* Con un diálogo abierto, una copia encima del fondo difuminado: abre una segunda tarea al lado (como el «+» del modal). */}
          {primaryOpen && newTaskRect &&
            createPortal(
              <button
                type="button"
                tabIndex={-1}
                className={cn("btn-primary fixed z-[70] whitespace-nowrap shadow-lg", secondNew && "opacity-60")}
                style={{ left: newTaskRect.left, top: newTaskRect.top, width: newTaskRect.width, height: newTaskRect.height }}
                onClick={() => !secondNew && addSecond()}
                aria-disabled={!!secondNew}
                title={t("Abrir otra tarea nueva al lado")}
              >
                {/* Mismo texto que el botón original: corto cuando la cabecera va justa de sitio. */}
                <Plus size={16} /> {newTaskRect.width < 130 ? t("Nueva") : t("Nueva tarea")}
              </button>,
              document.body,
            )}
        </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={boardCollisionDetection}
          measuring={MEASURING}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={cancelDrag}
        >
          {/* Móvil: buscador y filtros siempre a mano (fijos a la izquierda) y pestañas de columnas (con scroll lateral). */}
          <div className="flex items-center gap-1 border-b border-slate-200 bg-white py-2 pl-3 md:hidden dark:border-slate-800 dark:bg-slate-900">
            <button
              type="button"
              className={cn("btn-icon relative h-8 w-8 shrink-0", query.trim() && "text-brand-600")}
              onClick={() => setMobileSearch((o) => !o)}
              aria-label={t("Buscar")}
              aria-expanded={mobileSearch || filtering}
            >
              <Search size={16} />
              {query.trim() && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-brand-600" aria-hidden />}
            </button>
            <FilterMenu filters={activeFilters} onChange={changeFilters} labels={labels} kinds={data.kinds} users={data.users} currentUserId={data.currentUserId} className="shrink-0" />
            <div data-mobile-tabs className="no-scrollbar ml-0.5 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-3">
              {sortedColumns.map((c) => (
                <MobileTab key={c.id} active={c.id === activeMobileColumn} onClick={() => showMobileColumn(c.id)}>
                  {c.name} <span className="opacity-70">{items[c.id]?.length ?? 0}</span>
                </MobileTab>
              ))}
              <NewColumnButton variant="mobile" onCreated={showMobileColumn} />
            </div>
          </div>
          {/* Móvil y tableta: buscador y filtros (en móvil, solo al pulsar el icono de la lupa o con un filtro activo). */}
          <div className={cn("flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 lg:hidden dark:border-slate-800 dark:bg-slate-900", !(mobileSearch || filtering) && "max-md:hidden")}>
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                ref={mobileSearchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setQuery("");
                    e.currentTarget.blur();
                  }
                }}
                autoFocus={mobileSearch && !filtering}
                placeholder={t("Filtrar tarjetas")}
                aria-label={t("Filtrar tarjetas")}
                className="input h-8 w-full [&::-webkit-search-cancel-button]:hidden pr-3 pl-8 text-sm"
              />
            </div>
            {/* En móvil los filtros ya están en la barra de pestañas. */}
            <FilterMenu filters={activeFilters} onChange={changeFilters} labels={labels} kinds={data.kinds} users={data.users} currentUserId={data.currentUserId} className="max-md:hidden" />
            <span className="shrink-0 text-xs text-slate-500" aria-live="polite">{filtering ? t("{shown} de {total}", { shown: shownCount, total: tasks.length }) : t("{n} tarjetas", { n: tasks.length })}</span>
            {(mobileSearch || filtering) && (
              <button
                type="button"
                className="btn-icon h-8 w-8 shrink-0 md:hidden"
                onClick={() => {
                  setQuery("");
                  changeFilters(EMPTY_FILTERS);
                  setMobileSearch(false);
                }}
                aria-label={t("Quitar el filtro")}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div
            className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 max-md:no-scrollbar pt-2 pb-2 md:px-4 md:pb-4"
            onTouchStart={onSwipeStart}
            onTouchEnd={onSwipeEnd}
          >
            {sortedColumns.map((column, i) => (
              <ColumnView
                key={column.id}
                column={column}
                taskIds={items[column.id] ?? []}
                evergreenIds={shownEvergreen[column.id] ?? []}
                cardCount={(baseItems[column.id]?.length ?? 0) + (evergreenByColumn[column.id]?.length ?? 0)}
                index={i}
                total={sortedColumns.length}
                droppableId={COLUMN_PREFIX + column.id}
                mobileHidden={column.id !== activeMobileColumn}
              />
            ))}
            <NewColumnButton variant="desktop" />
          </div>
          {/* Con Ctrl/Alt la tarjeta no vuelve a su sitio al soltar: la copia aparece donde se suelta. */}
          <DragOverlay dropAnimation={duplicating ? null : DROP_ANIMATION}>
            {activeTask ? (
              <div className={cn("relative", duplicating && "cursor-copy")}>
                <TaskCard task={activeTask} overlay />
                {duplicating && (
                  <span data-duplicate-hint className="pointer-events-none absolute -top-2.5 -right-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-on-brand shadow-md">
                    + {t("Duplicar")}
                  </span>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        <button
          onClick={() => setBulk({ columnId: activeMobileColumn })}
          className="fixed right-[1.625rem] bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-30 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-brand-600 shadow-lg hover:bg-slate-50 active:scale-95 lg:hidden dark:border-slate-700 dark:bg-slate-800 dark:text-brand-300"
          aria-label={t("Crear varias tareas")}
        >
          <PlusStack size={22} />
        </button>
        <button
          onClick={() => setNewTask({ columnId: activeMobileColumn })}
          className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-on-brand shadow-lg shadow-brand-600/30 hover:bg-brand-700 active:scale-95 lg:hidden"
          aria-label={t("Nueva tarea o captura")}
        >
          <Plus size={26} />
        </button>

        <SelectionBarHost
          columns={sortedColumns}
          nextReleaseColumn={nextReleaseColumn}
          onMove={moveSelected}
          onArchive={archiveSelected}
          onDelete={deleteSelected}
          onRelease={() => {
            const selected = stores.selection.get();
            const ids = sortedColumns.flatMap((c) => (baseItems[c.id] ?? []).filter((id) => selected.has(id)));
            // Con selección solo van las elegidas (las fijas entran únicamente desde «Generar Release»).
            setRelease({ taskIds: ids, preselected: ids });
          }}
          onClear={() => setSelected(new Set())}
        />


        {openTaskId && taskById.has(openTaskId) && (
          <TaskDialog
            key={openTaskId}
            task={taskById.get(openTaskId)!}
            draft={editDraft?.taskId === openTaskId ? editDraft : null}
            onClose={() => {
              setOpenTaskId(null);
              setEditDraft(null);
            }}
            side={secondNew ? "left" : "center"}
            onAddSecond={secondNew ? undefined : addSecond}
          />
        )}
        {newTask && (
          <NewTaskDialog
            side={secondNew ? "left" : "center"}
            onAddSecond={secondNew ? undefined : addSecond}
            initialColumnId={newTask.columnId}
            initialEvergreen={newTask.evergreen}
            initialFiles={newTask.files}
            draft={newTask.draft}
            autosave
            onClose={() => setNewTask(null)}
          />
        )}
        {secondNew && (
          <NewTaskDialog
            initialColumnId={secondNew.columnId}
            side={primaryOpen ? "right" : "center"}
            onClose={() => setSecondNew(null)}
          />
        )}
        {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
        {(archivedOpen || wantsArchived) && <ArchivedDialog onClose={closeArchived} />}
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
              result.spawned?.forEach(upsertTask);
            }}
          />
        )}
      </div>
    </BoardContext.Provider>
  );
}

/** La barra de selección se suscribe al contador por su cuenta: seleccionar no redibuja el tablero entero. */
function SelectionBarHost(props: Omit<React.ComponentProps<typeof SelectionBar>, "count">) {
  const count = useSelectionSize();
  if (count === 0) return null;
  return <SelectionBar count={count} {...props} />;
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
