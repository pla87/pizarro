"use client";

import { prefetchTaskDetail } from "./taskDetailPrefetch";
import { advanceCursor, announceOnArrival, announceRemoteChange, DEFAULT_LIVE_REFRESH_JITTER_MS, foreignRefreshDelay, missedWhileClosed, removalOf, settleIncoming, type IncomingChange, type LiveCursor, type Removal } from "./remoteChange";
import { actionThrowMessage } from "@/lib/stale-action";
import { importWhenOnline, isNetworkError, refreshWhenOnline, reportOffline, reportReachable, safeRefresh } from "@/lib/connection";
import { afterModalHistory } from "../ui/useBackToClose";
import {
  closestCorners, DndContext, type CollisionDetection, DragOverlay, pointerWithin, KeyboardSensor, MeasuringStrategy, PointerSensor,
  useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Archive, Plus, Search, Upload, X } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { archiveTasks, deleteTasks, duplicateTask, makeEvergreen, moveTask, moveTasks } from "@/actions/tasks";
import { createBoardCollisionDetection } from "@/lib/collision";
import { compareTaskOrder, insertBefore, moveOnto, neighboursOf, positionBetween } from "@/lib/positions";
import type { BoardColumn, BoardData, BoardTask, LabelOption } from "@/lib/types";
import { TASK_PRIORITIES } from "@/lib/task-fields";
import { FilterMenu } from "./FilterMenu";
import { ProjectMenu } from "../ProjectMenu";
import { UndoButton } from "../UndoButton";
import { setBoardModalOpen } from "../undo-context";
import { PlusStack } from "../ui/PlusStack";
import { useFloatingRect } from "../ui/useFloatingRect";
import { useT } from "@/i18n/client";
import { useConfirm } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import { cn } from "../ui/cn";
import { BoardContext, useSelectionSize, type BoardApi } from "./context";
import { createBoardStores, createStore, mergeTasks, tasksById, useStableValue } from "./stores";
import { ColumnView } from "./ColumnView";
import { wipExceeded } from "@/lib/wip";
import { boardDragA11y } from "./drag-a11y";
import { EVERGREEN_DROPPABLE_PREFIX } from "./EvergreenPanel";
import { NewColumnButton } from "./NewColumnButton";
import { useCardActions } from "./cardActions";
import { draggingCard } from "./nearCards";
import { useReviewGuard } from "./reviewGuard";
import { activeFilterCount, EMPTY_FILTERS, filtersKey, parseStoredFilters, sanitizeFilters, searchTerms, taskMatchesFilters, taskSearchText, type BoardFilters, type SearchNames } from "./filters";
import { Presence } from "./Presence";
import { ListView } from "./ListView";
import { parseStoredView, parseViewParam, viewStorageKey, type BoardView } from "./listSort";
import { ViewToggle } from "./ViewToggle";
import { SelectionBar } from "./SelectionBar";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { useShortcut } from "./shortcuts";
import { useBoardShortcuts } from "./useBoardShortcuts";
import { HEADER_LABEL, HEADER_SHORT_LABEL, useHeaderFit } from "./useHeaderFit";
import { TaskCard } from "./TaskCard";
import { ReportButton } from "../ReportButton";
import { filesFrom, hasFiles, isImageFile, useBlockStrayFileDrops } from "./upload";
import { claimPaste, isTextTarget, pastedFiles, pasteClaimed, recoverEmptyImages } from "../ui/pasteFiles";
import { draftKey, readDraft, type EditTaskDraft, type NewTaskDraft } from "./drafts";
import { mentionsToPlain } from "@/lib/mentions";
import { shouldRefreshOnFocus } from "@/lib/focus-refresh";
import { cardCount } from "./count-texts";

/**
 * Un diálogo cargado aparte, con su propio Suspense sin nada que mostrar mientras llega su código. next/dynamic (con
 * ssr, como aquí) no pone ninguno: la carga suspendía hasta el del loading.tsx del proyecto y, al abrir un diálogo en un
 * tablero recién abierto, el tablero se cambiaba un instante por el esqueleto de columnas. Así el tablero sigue a la
 * vista y el diálogo aparece en cuanto llega; cada uno con el suyo, para que abrir el segundo no esconda el primero.
 */
function ownSuspense<P extends object>(Dialog: ComponentType<P>): ComponentType<P> {
  function WithSuspense(props: P) {
    return (
      <Suspense fallback={null}>
        <Dialog {...props} />
      </Suspense>
    );
  }
  return WithSuspense;
}

// Los diálogos (con el editor de texto y el Markdown) no van en el código inicial del tablero:
// se cargan al abrirlos y se precargan cuando el navegador está libre. Si al abrirlos no hay red, esperan a que vuelva
// (importWhenOnline) en vez de fallar: el fallo llegaba a la pantalla de error, que recargaba la página sin red.
const loadTaskDialog = () => import("./TaskDialog");
const loadNewTaskDialog = () => import("./NewTaskDialog");
const loadReleaseDialog = () => import("./ReleaseDialog");
const loadBulkTaskDialog = () => import("./BulkTaskDialog");
const loadArchivedDialog = () => import("./ArchivedDialog");
const TaskDialog = ownSuspense(dynamic(() => importWhenOnline(loadTaskDialog).then((m) => m.TaskDialog)));
const NewTaskDialog = ownSuspense(dynamic(() => importWhenOnline(loadNewTaskDialog).then((m) => m.NewTaskDialog)));
const ReleaseDialog = ownSuspense(dynamic(() => importWhenOnline(loadReleaseDialog).then((m) => m.ReleaseDialog)));
const BulkTaskDialog = ownSuspense(dynamic(() => importWhenOnline(loadBulkTaskDialog).then((m) => m.BulkTaskDialog)));
const ArchivedDialog = ownSuspense(dynamic(() => importWhenOnline(loadArchivedDialog).then((m) => m.ArchivedDialog)));

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

/**
 * ¿La pestaña está a la vista? Oculta (otra pestaña delante, ventana minimizada) no mantiene abierto el canal en vivo:
 * por HTTP/1.1 (red local sin TLS) el navegador solo abre 6 conexiones por servidor, y con 6 pestañas abiertas cada canal
 * ocupaba una y la séptima ya no cargaba ni guardaba nada.
 */
function usePageVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
    () => document.visibilityState !== "hidden",
    () => true,
  );
}

/** Quita `?task=` de la dirección sin pedir la página otra vez (ni recargar el tablero). */
function dropTaskParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("task")) return;
  url.searchParams.delete("task");
  window.history.replaceState(window.history.state, "", url);
}

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

function MobileTab({ active, onClick, over = false, title, children }: { active: boolean; onClick: () => void; /** La columna pasa de su límite de tarjetas (solo aviso). */ over?: boolean; title?: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-active={active || undefined}
      data-wip-over={over || undefined}
      title={title}
      className={cn(
        "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-offset-[-3px]",
        active ? "bg-brand-600 text-on-brand" : over ? "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        // Con la pestaña activa (fondo de marca) el aviso va en el anillo y en el texto «n / límite».
        over && "ring-2 ring-red-500 ring-inset",
      )}
    >
      {children}
      {over && <span className="sr-only">{t("Límite superado")}</span>}
    </button>
  );
}
// Respaldo del canal en vivo (SSE), que ya avisa de cada cambio: no hace falta refrescar más a menudo.
const REFRESH_MS = 120_000;

type Items = Record<string, string[]>;
/** Lista vacía compartida: un `[]` nuevo en cada dibujo haría repintar columnas memorizadas que no han cambiado. */
const NO_IDS: string[] = [];

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
  // Enlace ?task= a una tarea que no está en el tablero (no existe, archivada o sin acceso): no se abre nada y se avisa.
  const [badTaskLink] = useState(() => (initialTaskId && !data.tasks.some((x) => x.id === initialTaskId) ? initialTaskId : null));
  const [openTaskId, setOpenTaskId] = useState<string | null>(badTaskLink ? null : initialTaskId);
  const openTaskRef = useRef(openTaskId);
  useEffect(() => {
    openTaskRef.current = openTaskId;
  });
  // La tarea abierta ha desaparecido del tablero (otra persona la borró o archivó): su última versión y el aviso. El detalle
  // sigue montado lo justo para avisar y ofrecer lo que había sin guardar, y se cierra (ver TaskDialog `gone`). En un
  // almacén como el de las tareas: los dos cambios se pintan juntos (con la tarea ya quitada y sin el aviso aún, el
  // detalle se desmontaría y se perdería lo escrito).
  const [goneStore] = useState(() => createStore<{ task: BoardTask; message: string } | null>(null));
  const goneTask = useSyncExternalStore(goneStore.subscribe, goneStore.get, goneStore.get);
  const setGoneTask = goneStore.set;
  useEffect(() => {
    if (!badTaskLink) return;
    toast(t("La tarea no existe, está archivada o no tienes acceso"), "error");
    // Solo al abrir el tablero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Sin tarea abierta, la dirección no lleva ?task= (la de un enlace ya cerrado, o la de uno a una tarea que no está): al
  // recargar no se reabre. Se cambia tras retirar el diálogo su entrada del historial (useBackToClose), que también la lleva.
  useEffect(() => {
    if (!openTaskId) afterModalHistory(dropTaskParam);
  }, [openTaskId]);
  const [newTask, setNewTask] = useState<{ columnId?: string; files?: File[]; evergreen?: boolean; draft?: NewTaskDraft | null } | null>(null);
  const [editDraft, setEditDraft] = useState<EditTaskDraft | null>(null);
  const [secondNew, setSecondNew] = useState<{ columnId?: string } | null>(null);
  const [bulk, setBulk] = useState<{ columnId?: string } | null>(null);
  // «Varias tareas» en el hueco del segundo diálogo (a la derecha, con selector de proyecto).
  const [secondBulk, setSecondBulk] = useState(false);
  const [release, setRelease] = useState<{ taskIds: string[]; preselected: string[] } | null>(null);
  const [mobileColumn, setMobileColumn] = useState<string | null>(null);
  // Arrastrar archivos del escritorio sobre «Nueva tarea» abre el diálogo con ellos adjuntos.
  const [dropNew, setDropNew] = useState(false);
  const dropNewDepth = useRef(0);
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
  // Vista Tablero / Lista: la URL (?vista=lista) manda; si no hay, la última elegida en este proyecto (localStorage).
  const [view, setViewState] = useState<BoardView>(() => parseViewParam(searchParams.get("vista")) ?? "board");
  useEffect(() => {
    if (parseViewParam(searchParams.get("vista"))) return;
    const frame = requestAnimationFrame(() => {
      try {
        setViewState(parseStoredView(window.localStorage.getItem(viewStorageKey(data.project.id))));
      } catch {
        // Sin almacenamiento: tablero.
      }
    });
    return () => cancelAnimationFrame(frame);
    // Solo al abrir el proyecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.project.id]);
  const changeView = (next: BoardView) => {
    setViewState(next);
    // La lista no enseña qué tarjetas están seleccionadas: se limpia la selección (y con ella la barra).
    if (next === "list" && stores.selection.get().size) stores.selection.set(new Set());
    try {
      window.localStorage.setItem(viewStorageKey(data.project.id), next);
    } catch {
      // Sin almacenamiento: vale en esta sesión.
    }
    // La dirección refleja la vista (se puede compartir); sin recargar la página.
    const url = new URL(window.location.href);
    if (next === "list") url.searchParams.set("vista", "lista");
    else url.searchParams.delete("vista");
    window.history.replaceState(window.history.state, "", url);
  };
  const sc = useShortcut();
  const dragHandle = useCoarsePointer();

  // Precarga de los diálogos cuando el navegador queda libre: abrirlos es instantáneo, también si luego se va la red. Si
  // la precarga falla (sin red), no pasa nada: se vuelven a pedir al abrirlos.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => {
      for (const load of [loadTaskDialog, loadNewTaskDialog, loadArchivedDialog, loadReleaseDialog, loadBulkTaskDialog, () => import("@/components/ui/RichTextEditor")]) {
        load().catch(() => {});
      }
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
  // Si el tablero se desmonta a medio arrastre, las tarjetas no deben quedar esperando a que termine (nearCards.ts).
  useEffect(() => () => draggingCard.set(null), []);
  // Al soltar una tarjeta en otra columna no se anima el overlay (se decide en onDragEnd, en el mismo render que lo retira).
  const [skipDropAnimation, setSkipDropAnimation] = useState(false);
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
  // Para espaciar el refresco al enfocar la ventana (lib/focus-refresh.ts): cuándo se sincronizó el tablero por última vez y
  // estado del canal en vivo (abierto ahora; cortado desde la última sincronización, con avisos que pudieron perderse).
  const lastSyncAt = useRef(0); // se rellena al montar (efecto de datos)
  // `paused`: cerrado por tener la pestaña oculta (al volver a verse se reabre y su saludo decide si refrescar).
  const channel = useRef({ open: false, gap: false, paused: false });
  // Refresco escalonado pendiente por un cambio de otra persona (ver foreignRefreshDelay): cualquier refresco lo cubre.
  const foreignTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doRefresh = useCallback(() => {
    if (foreignTimer.current) {
      clearTimeout(foreignTimer.current);
      foreignTimer.current = null;
    }
    refreshAt.current = performance.now();
    lastSyncAt.current = refreshAt.current;
    // Un refresco pedido con el canal abierto ya recoge todo lo anterior: el corte queda cubierto.
    if (channel.current.open) channel.current.gap = false;
    router.refresh();
  }, [router]);
  // Sin conexión no se pide la página: Next, si no la consigue, la sustituye por la de error del navegador y se pierde lo
  // escrito. Se comprueba antes que el servidor responde; si no, el refresco queda pendiente hasta que vuelva (lib/connection.ts).
  const refresh = useCallback(() => void safeRefresh(doRefresh, router), [doRefresh, router]);
  const flushStale = useCallback(() => {
    if (staleRefresh.current && pending.current === 0) {
      staleRefresh.current = false;
      refresh();
    }
  }, [refresh]);
  // Avisos del servidor (SSE) pendientes de decidir y ids de cambios propios (los que devolvieron mis acciones):
  // el aviso de un cambio propio no refresca (el tablero ya aplicó el resultado) ni se reenvía a la página (los
  // comentarios abiertos ya muestran el suyo); cualquier otro, sí. Los de otras personas se reenvían al llegar
  // (announceOnArrival) y aquí solo esperan para refrescar el tablero.
  const incoming = useRef<IncomingChange[]>([]);
  const ownChanges = useRef(new Set<string>());
  const jitterMs = data.liveRefreshJitterMs ?? DEFAULT_LIVE_REFRESH_JITTER_MS;
  const drainIncoming = useCallback(() => {
    if (pending.current > 0 || !incoming.current.length) return;
    const delay = foreignRefreshDelay(incoming.current, ownChanges.current, jitterMs);
    const { announce, refresh: stale } = settleIncoming(incoming.current, ownChanges.current);
    incoming.current = [];
    for (const change of announce) announceRemoteChange(change);
    if (!stale) return;
    if (delay <= 0) return refresh();
    // Cambio de otra persona: todas las pestañas del proyecto lo reciben a la vez; cada una refresca tras una espera al
    // azar para no pedir todas el tablero en el mismo instante. Los avisos que lleguen mientras tanto van en ese refresco.
    if (foreignTimer.current) return;
    foreignTimer.current = setTimeout(() => {
      foreignTimer.current = null;
      // Con acciones propias en vuelo, se refresca cuando terminen (flushStale), como cualquier dato que pueda ser anterior.
      if (pending.current > 0) staleRefresh.current = true;
      else refresh();
    }, delay);
  }, [refresh, jitterMs]);
  useEffect(() => () => {
    if (foreignTimer.current) clearTimeout(foreignTimer.current);
  }, []);
  // Contador de operaciones en curso (evita refrescos intermedios). Sin capturar errores: lo usan las subidas, que informan por excepción.
  const trackRaw = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    mutationAt.current = performance.now();
    pending.current++;
    try {
      const res = await p;
      // Ha respondido el servidor: si se daba la conexión por perdida, ha vuelto.
      reportReachable();
      // Acción con cambio publicado: se anota su id para no refrescar con su propio aviso.
      const cid = res && typeof res === "object" && "cid" in res ? (res as { cid?: unknown }).cid : null;
      if (typeof cid === "string") {
        ownChanges.current.add(cid);
        // Acotado: los ids que nunca llegan por el canal (sin conexión) no se acumulan.
        if (ownChanges.current.size > 200) ownChanges.current.delete(ownChanges.current.values().next().value as string);
      }
      return res;
    } finally {
      pending.current--;
      flushStale();
      drainIncoming();
    }
  }, [flushStale, drainIncoming]);
  // Para server actions: si lanzan (sin red, acción inexistente tras un despliegue) se avisa, se refresca
  // desde el servidor para deshacer lo optimista y se devuelve un fallo como el de cualquier acción.
  // Si no llegó al servidor (sin red o caído), no se refresca: «Sin conexión: no se ha guardado», quien llamó deshace lo
  // optimista (como con cualquier fallo) y lo escrito se queda donde estaba; al volver la conexión se refresca.
  const track = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    try {
      return await trackRaw(p);
    } catch (e) {
      const error = actionThrowMessage(e, t);
      toast(error, "error");
      // Un refresco ya pedido antes del cambio podría traer datos viejos: se fuerza uno nuevo.
      mutationAt.current = 0;
      if (isNetworkError(e)) {
        reportOffline();
        refreshWhenOnline(doRefresh, router);
      } else refresh();
      return { ok: false, error } as T;
    }
  }, [trackRaw, toast, t, refresh, doRefresh, router]);

  const settle = useCallback(async () => {
    // Un guardado empezado al perder el foco (clic en un botón) puede no haber arrancado aún: un turno de espera.
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 200 && pending.current > 0; i++) await new Promise((r) => setTimeout(r, 50));
  }, []);

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

  // Último aviso visto del canal (lo numera el servidor): al reabrirlo se sabe si se perdió alguno mientras estuvo cerrado.
  const liveCursor = useRef<LiveCursor | null>(data.live ?? null);
  // Últimos borrados y archivados que han llegado por el canal: quién borró o archivó la tarea abierta (ver TaskDialog).
  const removals = useRef(new Map<string, Removal & { at: number }>());
  /** Aviso de que la tarea abierta ya no está: quién la borró o archivó, si llegó por el canal; si no, uno genérico. */
  const goneMessage = (taskId: string): string => {
    const bulk = removals.current.get("*");
    const r = removals.current.get(taskId) ?? (bulk && performance.now() - bulk.at < 60_000 ? bulk : undefined);
    if (!r) return t("Esta tarea ya no está en el tablero: la han borrado o archivado");
    const deleted = r.kind === "deleted";
    if (r.userId === data.currentUserId) return deleted ? t("Has borrado esta tarea desde otra pestaña") : t("Has archivado esta tarea desde otra pestaña");
    const name = data.users.find((u) => u.id === r.userId)?.name;
    if (name) return deleted ? t("{name} ha borrado esta tarea", { name }) : t("{name} ha archivado esta tarea", { name });
    return deleted ? t("Han borrado esta tarea") : t("Han archivado esta tarea");
  };
  // Sincroniza con el servidor cuando llegan datos nuevos (router.refresh).
  useEffect(() => {
    lastSyncAt.current = performance.now();
    if (pending.current > 0 || activeId || mutationAt.current > refreshAt.current) {
      // Datos que pueden ser anteriores a un cambio propio: se piden otra vez cuando no quede ninguno en vuelo.
      staleRefresh.current = true;
      if (!activeId) flushStale();
      return;
    }
    const openId = openTaskRef.current;
    const before = openId ? stores.tasks.get().find((x) => x.id === openId) : undefined;
    if (before && !data.tasks.some((x) => x.id === openId)) setGoneTask({ task: before, message: goneMessage(openId!) });
    setColumns(data.columns);
    setTasks((prev) => mergeTasks(prev, data.tasks));
    setLabels(data.labels);
    liveCursor.current = advanceCursor(liveCursor.current, data.live);
    // Quita de la selección múltiple lo que ya no existe (borrado o archivado desde otra pestaña).
    const present = new Set(data.tasks.map((t) => t.id));
    const sel = stores.selection.get();
    if (sel.size && [...sel].some((id) => !present.has(id))) stores.selection.set(new Set([...sel].filter((id) => present.has(id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Vuelve a abrir el canal en vivo cuando el navegador lo da por cerrado (ver el manejador de «error»).
  const [sseEpoch, setSseEpoch] = useState(0);
  const visible = usePageVisible();
  // Raíz del tablero: lleva data-live="open" mientras el canal en vivo está abierto (las pruebas en navegador lo esperan
  // en vez de una pausa fija). Se pone a mano, sin estado, para no volver a pintar el tablero en cada reconexión.
  const rootRef = useRef<HTMLDivElement>(null);
  // Cambios de otras pestañas y personas casi al momento: el servidor avisa (Server-Sent Events) y
  // se refresca (lo de otras personas, tras una espera al azar: drainIncoming). Se agrupan los avisos seguidos; si la
  // conexión cae, EventSource reconecta solo. Con la pestaña oculta el canal se cierra (usePageVisible) y, al volver, se
  // abre otra vez: el primer mensaje del servidor dice si hubo cambios mientras tanto y, si los hubo, se refresca.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const live = channel.current;
    if (!visible) {
      live.paused = true;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const root = rootRef.current;
    const source = new EventSource(`/api/projects/${data.project.id}/events`);
    source.addEventListener("open", () => {
      live.open = true;
      root?.setAttribute("data-live", "open");
    });
    // EventSource reconecta solo, pero lo ocurrido mientras estuvo cortado no llega por el canal. Si el servidor respondió
    // con un error (p. ej. 503 mientras se apaga en un despliegue), el navegador da el canal por cerrado y no reintenta:
    // se vuelve a abrir al cabo de unos segundos.
    let retry: ReturnType<typeof setTimeout> | null = null;
    source.addEventListener("error", () => {
      live.open = false;
      root?.removeAttribute("data-live");
      live.gap = true;
      // Sin canal, el respaldo (al volver a la ventana, cada 2 minutos) vuelve a decidir los refrescos.
      live.paused = false;
      if (source.readyState === EventSource.CLOSED && !retry) retry = setTimeout(() => setSseEpoch((n) => n + 1), 5000);
    });
    // Saludo del servidor al conectar (también al reconectar solo): si se perdió algún aviso, se refresca.
    source.addEventListener("hello", (e) => {
      const missed = missedWhileClosed(liveCursor, (e as MessageEvent<string>).data);
      live.paused = false;
      if (missed) refresh();
      else live.gap = false;
    });
    source.addEventListener("change", (e) => {
      let cid: string | null = null;
      let change: unknown = null;
      try {
        const parsed = JSON.parse((e as MessageEvent<string>).data) as { cid?: unknown; seq?: unknown };
        if (typeof parsed.cid === "string") cid = parsed.cid;
        change = parsed;
        const cursor = liveCursor.current;
        if (typeof parsed.seq === "number" && cursor && parsed.seq > cursor.seq) liveCursor.current = { boot: cursor.boot, seq: parsed.seq };
      } catch {
        // Aviso ilegible: se trata como ajeno y se refresca.
      }
      const removal = removalOf(change);
      if (removal) {
        removals.current.set(removal.taskId ?? "*", { ...removal, at: performance.now() });
        if (removals.current.size > 100) removals.current.delete(removals.current.keys().next().value as string);
      }
      // Lo de otra persona se reenvía a la página ya, aunque haya acciones propias en vuelo (una subida larga); lo propio,
      // al decidir (drainIncoming), cuando ya se sabe si es de una acción de esta pestaña.
      const announced = announceOnArrival(change, data.currentUserId);
      if (announced) announceRemoteChange(change);
      incoming.current.push({ cid, change, announced });
      if (timer) clearTimeout(timer);
      // Con acciones en vuelo se decide al terminar la última (trackRaw), cuando ya se conocen sus ids.
      timer = setTimeout(() => {
        timer = null;
        drainIncoming();
      }, 200);
    });
    return () => {
      if (timer) clearTimeout(timer);
      if (retry) clearTimeout(retry);
      source.close();
      live.open = false;
      root?.removeAttribute("data-live");
      // Lo que llegue mientras está cerrado no se ve: al reabrir decide el saludo del servidor (o, sin él, el respaldo).
      live.gap = true;
    };
  }, [data.project.id, data.currentUserId, drainIncoming, refresh, sseEpoch, visible]);

  // Refresco ligero de respaldo (por si el canal de avisos no llega) y al volver a la ventana. Al volver no se recarga cada
  // vez: se espacia según el estado del canal en vivo (reglas en lib/focus-refresh.ts).
  useEffect(() => {
    const idle = () => document.visibilityState === "visible" && pending.current === 0 && !document.querySelector("[role=dialog]");
    const tick = () => {
      if (idle()) refresh();
    };
    const onFocus = () => {
      if (!idle()) return;
      const { open, gap, paused } = channel.current;
      // Canal cerrado por tener la pestaña oculta y reabriéndose: decide su saludo (no se refresca dos veces).
      if (paused && typeof EventSource !== "undefined") return;
      if (shouldRefreshOnFocus({ sinceSyncMs: performance.now() - lastSyncAt.current, channelOpen: open, channelGap: gap })) refresh();
    };
    const timer = setInterval(tick, REFRESH_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const baseItems = useStableItems(useMemo(() => groupItems(columns, tasks), [columns, tasks]));
  // Filtro del buscador: por título, tipo, responsable y etiquetas (todas las palabras deben aparecer).
  // Diferido: el campo responde al momento y el tablero se vuelve a filtrar sin bloquear (al limpiar el filtro con Escape
  // reaparecen cientos de tarjetas de golpe).
  const filterQuery = useDeferredValue(query);
  const terms = useMemo(() => searchTerms(filterQuery), [filterQuery]);
  // Campos opcionales: prioridad y cliente filtran (y se buscan) solo si el proyecto los tiene activados.
  const priorityEnabled = data.project.taskFields.includes("priority");
  const clientEnabled = data.project.taskFields.includes("client");
  // Los datos del servidor llegan como objetos nuevos en cada refresco aunque no cambien: estables, para no invalidar el
  // contexto (más abajo) ni el texto de búsqueda ya calculado de cada tarea.
  const users = useStableValue(data.users);
  const kinds = useStableValue(data.kinds);
  // Nombres con los que se busca (tipo, responsable, etiquetas): el texto normalizado de cada tarea se calcula una vez por
  // versión de la tarea y juego de nombres (taskSearchText), no en cada pulsación.
  const searchNames = useMemo<SearchNames>(
    () => ({ kindName: new Map(kinds.map((k) => [k.id, k.name])), userName: new Map(users.map((u) => [u.id, u.name])), labelName: new Map(labels.map((l) => [l.id, l.name])), clientEnabled }),
    [kinds, users, labels, clientEnabled],
  );
  const clientOptions = useMemo(
    () => (clientEnabled ? [...new Set(tasks.map((x) => x.client).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b)) : []),
    [clientEnabled, tasks],
  );
  // Filtros rápidos sin lo que ya no existe (etiqueta borrada, persona que dejó el proyecto…).
  const activeFilters = useMemo(
    () => sanitizeFilters(filters, {
      labels: new Set(labels.map((l) => l.id)), kinds: new Set(kinds.map((k) => k.id)), users: new Set(users.map((u) => u.id)),
      priorities: new Set(priorityEnabled ? TASK_PRIORITIES : []), clients: new Set(clientOptions),
    }),
    [filters, labels, kinds, users, priorityEnabled, clientOptions],
  );
  const filterCount = activeFilterCount(activeFilters);
  const filtering = terms.length > 0 || filterCount > 0;
  const matchingIds = useMemo(() => {
    if (!filtering) return null;
    const ctx = { currentUserId: data.currentUserId, today: data.today, doneColumnIds: new Set(columns.filter((c) => c.isDone).map((c) => c.id)) };
    const ids = new Set<string>();
    for (const task of tasks) {
      if (terms.length) {
        const text = taskSearchText(task, searchNames);
        if (!terms.every((w) => text.includes(w))) continue;
      }
      if (taskMatchesFilters(task, activeFilters, ctx)) ids.add(task.id);
    }
    return ids;
  }, [filtering, terms, tasks, searchNames, data.currentUserId, data.today, columns, activeFilters]);
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
  // Estables (mismas listas si no cambian): el tablero memorizado (dndBoard) no se vuelve a dibujar en cada pulsación.
  const shownEvergreen = useStableItems(useMemo(
    () => (matchingIds ? Object.fromEntries(Object.entries(evergreenByColumn).map(([c, ids]) => [c, ids.filter((id) => matchingIds.has(id))])) : evergreenByColumn),
    [evergreenByColumn, matchingIds],
  ));
  const taskById = tasksById(tasks);
  const sortedColumns = useMemo(() => [...columns].sort((a, b) => a.position - b.position), [columns]);
  /** Tarjetas no archivadas de la columna (sin filtrar, con las fijas): la cifra que se compara con su límite. */
  const columnCardCount = (columnId: string) => (baseItems[columnId]?.length ?? 0) + (evergreenByColumn[columnId]?.length ?? 0);
  const nextReleaseColumn = sortedColumns.find((c) => c.role === "NEXT_RELEASE");
  const activeMobileColumn = sortedColumns.find((c) => c.id === mobileColumn)?.id ?? sortedColumns[0]?.id;

  // Pegar una imagen en el tablero (sin diálogo abierto) crea una tarea con ella.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (pasteClaimed(e) || document.querySelector("[role=dialog]") || isTextTarget(e.target)) return;
      // Una sola lectura (síncrona) de los archivos del pegado; una imagen que llega vacía se pide otra vez al portapapeles.
      const files = pastedFiles(e).filter(isImageFile);
      if (files.length) {
        claimPaste(e);
        void recoverEmptyImages(files).then((list) => setNewTask({ files: list }));
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
  const confirmLeaveReview = useReviewGuard(data.project.id, sortedColumns, getTask);
  const cardActions = useCardActions({ currentUserId: data.currentUserId, getTask, sortedColumns, baseItems, patchTask, upsertTask, track, toast, t, confirmLeaveReview });

  // El contexto solo cambia si cambia su contenido: los datos del servidor llegan como objetos nuevos en cada
  // refresco aunque sean iguales, y sin esto todas las tarjetas se redibujarían cada vez.
  const project = useStableValue(data.project);
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
      confirmLeaveReview,
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
      openTask: (id) => {
        prefetchTaskDetail(id);
        setOpenTaskId(id);
      },
      openNewTask: (columnId, evergreen, files) => setNewTask({ columnId, evergreen, files }),
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
      settle,
      refresh,
    }),
    [setTasks, revealTask, project, users, data.currentUserId, deliverables, kinds, data.cardStyle, data.editorMode, dragHandle, google, data.today, stableColumns, stableLabels, stores, getTask, track, trackRaw, settle, refresh, patchTask, upsertTask, cardActions, confirmLeaveReview],
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
    if (!(await confirmLeaveReview(ids, columnId))) return;
    const before = new Map(tasks.filter((t) => ids.includes(t.id)).map((t) => [t.id, t]));
    // Optimista: al final de la columna destino, conservando el orden actual.
    let pos = Math.max(0, ...tasks.filter((t) => t.columnId === columnId).map((t) => t.position));
    const ordered = sortedColumns.flatMap((c) => (baseItems[c.id] ?? []).filter((id) => selected.has(id) && c.id !== columnId));
    const optimistic = new Map(ordered.map((id) => [id, (pos += 1024)]));
    setTasks((prev) => prev.map((t) => (optimistic.has(t.id) ? { ...t, columnId, position: optimistic.get(t.id)!, evergreen: false, evergreenEvery: 1, columnEnteredAt: new Date().toISOString() } : t)));
    setSelected(new Set());
    const res = await track(moveTasks(ids, columnId));
    if (!res.ok) {
      restoreTasks(before);
      return toast(res.error, "error");
    }
    const server = new Map(res.data.moved.map((m) => [m.id, m.position]));
    setTasks((prev) => prev.map((t) => (server.has(t.id) ? { ...t, columnId, position: server.get(t.id)!, evergreen: false, evergreenEvery: 1, columnEnteredAt: new Date().toISOString() } : t)));
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
  // Avisos del lector de pantalla al arrastrar: título de la tarjeta y nombre de la columna (no el id).
  const dragTitleOf = (id: string) => {
    const task = taskById.get(id);
    return task ? mentionsToPlain(task.title) : t("Tarea");
  };
  const dragPlaceOf = (id: string): { column: string } | { evergreen: string } | null => {
    const name = (columnId: string | undefined) => columns.find((c) => c.id === columnId)?.name;
    if (id.startsWith(EVERGREEN_DROPPABLE_PREFIX)) {
      const column = name(id.slice(EVERGREEN_DROPPABLE_PREFIX.length));
      return column ? { evergreen: column } : null;
    }
    const container = findContainer(dragItems ?? baseItems, id);
    // Tarea fija aún sin soltar: sigue en el panel de su columna.
    if (container === EVERGREEN_ORIGIN) {
      const column = name(taskById.get(id)?.columnId);
      return column ? { evergreen: column } : null;
    }
    const column = name(container);
    return column ? { column } : null;
  };

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const id = String(active.id);
    const pointer = typeof PointerEvent !== "undefined" && activatorEvent instanceof PointerEvent ? activatorEvent : null;
    mouseDrag.current = pointer?.pointerType === "mouse";
    duplicateRef.current = mouseDrag.current && !!(pointer?.ctrlKey || pointer?.altKey);
    setDuplicating(duplicateRef.current);
    setSkipDropAnimation(false);
    // La tarjeta arrastrada sigue apuntada a dnd-kit aunque cambie de columna; las demás no se desapuntan hasta soltar.
    draggingCard.set(id);
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
    draggingCard.set(null);
    setDragItems(null);
    setActiveId(null);
    dragOrigin.current = null;
    flushStale();
  };

  /** Soltar una tarjeta en el panel de fijas: pasa a la columna de la release como evergreen. */
  const dropOnEvergreen = async (id: string, columnId: string) => {
    const previous = taskById.get(id);
    if (!previous) return;
    if (!(await confirmLeaveReview([id], columnId))) return;
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
    const { copyNotice, ...copy } = res.data;
    upsertTask(copy);
    toast(t("Tarea duplicada"), "undo");
    if (copyNotice) toast(copyNotice, "error");
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    const origin = dragOrigin.current;
    const current = dragItems;
    const copy = mouseDrag.current && duplicateRef.current;
    // La animación de soltado lleva el overlay al nodo original de la tarjeta; al cambiar de columna ese nodo se
    // desmonta y dnd-kit mide su hueco de ORIGEN: la tarjeta parecería volver atrás antes de aparecer en destino.
    if (origin && current && findContainer(current, String(active.id)) !== origin.columnId) setSkipDropAnimation(true);
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
    if (col !== origin.columnId && !(await confirmLeaveReview([id], col))) return;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, columnId: col, position, evergreen: false, evergreenEvery: 1, columnEnteredAt: new Date().toISOString() } : t)));

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
  const openTask = openTaskId ? (taskById.get(openTaskId) ?? (goneTask?.task.id === openTaskId ? goneTask.task : undefined)) : undefined;
  const openGone = !!openTask && !taskById.has(openTask.id) ? goneTask?.message : undefined;
  // Tarea abierta que ya no está (y sin aviso pendiente): se olvida. Si no, al reaparecer (deshacer) se volvía a abrir sola.
  if (openTaskId && !openTask) setOpenTaskId(null);
  const primaryOpen = !!newTask || !!openTask;
  // Mientras hay un diálogo de tarea, los botones de la cabecera (deshacer, «Nueva tarea») quedan por encima del fondo.
  useEffect(() => {
    setBoardModalOpen(primaryOpen);
    return () => setBoardModalOpen(false);
  }, [primaryOpen]);
  const newTaskBtnRef = useRef<HTMLButtonElement>(null);
  const newTaskRect = useFloatingRect(newTaskBtnRef, primaryOpen);
  const secondOpen = !!secondNew || secondBulk;
  const addSecondBulk = () => setSecondBulk(true);
  const addSecond = () => setSecondNew({ columnId: (sortedColumns.find((c) => c.name.trim().toLowerCase() === "backlog") ?? sortedColumns[0])?.id });

  // Atajos de teclado (escritorio). Alt+N con un modal abierto lo comporta como el «+» de al lado.
  useBoardShortcuts({
    newTask: () => {
      if (document.querySelector("[role=dialog]")) {
        if (primaryOpen && !secondOpen && window.matchMedia("(min-width: 1024px)").matches) addSecond();
        return;
      }
      setNewTask({});
    },
    bulk: () => {
      // Con un diálogo abierto, «Varias tareas» ocupa el hueco de la derecha (lo mismo que su botón junto al diálogo).
      if (document.querySelector("[role=dialog]")) {
        if (primaryOpen && !secondOpen && window.matchMedia("(min-width: 1024px)").matches) addSecondBulk();
        return;
      }
      setBulk({});
    },
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

  // --- Tablero con arrastre, memorizado -----------------------------------------
  // DndContext da en cada dibujo un valor de contexto nuevo (la posición del arrastre) y React recorre entonces todas las
  // tarjetas buscando quién lo lee: con miles de tarjetas, cada pulsación en el buscador (o abrir un diálogo) pagaba ese
  // recorrido. Así solo se vuelve a dibujar cuando cambia lo que muestra (columnas, listas, arrastre). Los manejadores
  // leen la última versión de lo que necesitan (latestDnd) para no cambiar en cada dibujo.
  const latestDnd = useRef({ onDragStart, onDragOver, onDragEnd, cancelDrag, onSwipeStart, onSwipeEnd, dragTitleOf, dragPlaceOf });
  useLayoutEffect(() => {
    latestDnd.current = { onDragStart, onDragOver, onDragEnd, cancelDrag, onSwipeStart, onSwipeEnd, dragTitleOf, dragPlaceOf };
  });
  const dndHandlers = useMemo(
    () => ({
      onDragStart: (e: DragStartEvent) => latestDnd.current.onDragStart(e),
      onDragOver: (e: DragOverEvent) => latestDnd.current.onDragOver(e),
      onDragEnd: (e: DragEndEvent) => latestDnd.current.onDragEnd(e),
      onDragCancel: () => latestDnd.current.cancelDrag(),
      onTouchStart: (e: React.TouchEvent) => latestDnd.current.onSwipeStart(e),
      onTouchEnd: (e: React.TouchEvent) => latestDnd.current.onSwipeEnd(e),
      titleOf: (id: string) => latestDnd.current.dragTitleOf(id),
      placeOf: (id: string) => latestDnd.current.dragPlaceOf(id),
    }),
    [],
  );
  // Avisos del lector de pantalla al arrastrar: título de la tarjeta y nombre de la columna (no el id).
  const dragAccessibility = useMemo(
    // boardDragA11y solo guarda las funciones: leen latestDnd al anunciar (en los eventos del arrastre), nunca al dibujar.
    // eslint-disable-next-line react-hooks/refs
    () => boardDragA11y(t, dndHandlers.titleOf, dndHandlers.placeOf),
    [t, dndHandlers],
  );
  const cardCounts = useStableValue(useMemo(
    () => Object.fromEntries(sortedColumns.map((c) => [c.id, columnCardCount(c.id)])) as Record<string, number>,
    // columnCardCount solo lee baseItems y evergreenByColumn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedColumns, baseItems, evergreenByColumn],
  ));
  const dndBoard = useMemo(
    () => (
      <DndContext
        sensors={sensors}
        collisionDetection={boardCollisionDetection}
        measuring={MEASURING}
        accessibility={dragAccessibility}
        onDragStart={dndHandlers.onDragStart}
        onDragOver={dndHandlers.onDragOver}
        onDragEnd={dndHandlers.onDragEnd}
        onDragCancel={dndHandlers.onDragCancel}
      >
        <div
          className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 max-md:no-scrollbar pt-2 pb-2 md:px-4 md:pb-4"
          onTouchStart={dndHandlers.onTouchStart}
          onTouchEnd={dndHandlers.onTouchEnd}
        >
          {sortedColumns.map((column, i) => (
            <ColumnView
              key={column.id}
              column={column}
              taskIds={items[column.id] ?? NO_IDS}
              evergreenIds={shownEvergreen[column.id] ?? NO_IDS}
              cardCount={cardCounts[column.id] ?? 0}
              index={i}
              total={sortedColumns.length}
              droppableId={COLUMN_PREFIX + column.id}
              mobileHidden={column.id !== activeMobileColumn}
            />
          ))}
          <NewColumnButton variant="desktop" />
        </div>
        {/* Sin animación de soltado con Ctrl/Alt (la copia aparece donde se suelta) ni al cambiar de columna (la tarjeta ya está en destino). */}
        <DragOverlay dropAnimation={duplicating || skipDropAnimation ? null : DROP_ANIMATION}>
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
    ),
    [sensors, dragAccessibility, dndHandlers, sortedColumns, items, shownEvergreen, cardCounts, activeMobileColumn, duplicating, skipDropAnimation, activeTask, t],
  );
  const headerRowRef = useRef<HTMLDivElement>(null);
  const headerNameRef = useRef<HTMLHeadingElement>(null);
  const headerFit = useHeaderFit(headerRowRef, headerNameRef);

  return (
    <BoardContext.Provider value={api}>
      <div ref={rootRef} className="flex h-full flex-col">
        {/* Contenedor de consulta: la cabecera se adapta al ancho que le deja la barra lateral, no al de la ventana. */}
        <div className="@container max-lg:hidden">
        {/* Nunca se sale de la pantalla: el nombre se trunca (entero en el tooltip) y, si así le queda poco sitio, los botones
            pasan a solo icono (useHeaderFit mide el espacio real; data-labels elige los textos). */}
        <div ref={headerRowRef} data-labels={headerFit ?? undefined} className="flex items-center gap-2 px-4 pt-4 pb-2 @min-[1000px]:gap-3 [&>*]:whitespace-nowrap [&_.btn-primary]:shrink-0 [&_.btn-secondary]:shrink-0">
          <h1 ref={headerNameRef} className="min-w-0 shrink-[8]"><ProjectMenu textClassName="text-lg" /></h1>
          <UndoButton projectId={data.project.id} shortcut className="-ml-2" />
          <span
            className="shrink-0 text-sm text-slate-500"
            aria-live="polite"
            title={filtering ? undefined : cardCount(t, tasks.length)}
          >
            {filtering ? (
              t("{shown} de {total}", { shown: shownCount, total: tasks.length })
            ) : (
              <>
                {/* Con poco ancho, solo el número (el texto completo queda en el tooltip y para lectores de pantalla). */}
                <span className="@min-[1000px]:hidden" aria-hidden>{tasks.length}</span>
                <span className="@max-[999px]:sr-only">{cardCount(t, tasks.length)}</span>
              </>
            )}
          </span>
          <Presence projectId={data.project.id} />
          <div data-fit-basis="144" className="relative ml-auto w-36 min-w-16 shrink transition-[width] @min-[1000px]:focus-within:w-56">
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
          <FilterMenu filters={activeFilters} onChange={changeFilters} labels={labels} kinds={data.kinds} users={data.users} currentUserId={data.currentUserId} priorityEnabled={priorityEnabled} clients={clientOptions} className="-ml-1.5 shrink-0" />
          {/* Justo a la derecha del filtro y antes de «Limpiar filtros» (que aparece y desaparece): no se mueve al cambiar de vista. */}
          <ViewToggle view={view} onChange={changeView} className="-ml-1" />
          {filterCount > 0 && (
            <button type="button" className="-ml-1 text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:hover:text-slate-300" onClick={() => changeFilters(EMPTY_FILTERS)}>
              {t("Limpiar filtros")}
            </button>
          )}
          <ReportButton projectId={data.project.id} variant="header" />
          <button className="btn-secondary" onClick={() => setArchivedOpen(true)} aria-label={t("Archivadas")} title={t("Archivadas")}>
            <Archive size={16} /> <span className={HEADER_LABEL}>{t("Archivadas")}</span>
          </button>
          <button className="btn-secondary" onClick={() => setBulk({})} aria-label={t("Varias tareas")} title={`${t("Crear varias tareas pegando una lista")} (${sc("Alt+Shift+N")})`}>
            <PlusStack size={16} /> <span className={HEADER_LABEL}>{t("Varias tareas")}</span>
          </button>
          <button
            ref={newTaskBtnRef}
            className={cn("btn-primary", dropNew && "bg-brand-700 ring-2 ring-brand-300 ring-offset-2")}
            onClick={() => (primaryOpen ? (!secondOpen && addSecond()) : setNewTask({}))}
            aria-label={t("Nueva tarea")}
            title={dropNew ? t("Suelta para crear tarea") : `${t("Nueva tarea")} (${sc("Alt+N")})`}
            onDragEnter={(e) => {
              if (primaryOpen || !hasFiles(e)) return;
              e.preventDefault();
              dropNewDepth.current++;
              setDropNew(true);
            }}
            onDragOver={(e) => {
              if (primaryOpen || !hasFiles(e)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(e) => {
              if (primaryOpen || !hasFiles(e)) return;
              dropNewDepth.current = Math.max(0, dropNewDepth.current - 1);
              if (dropNewDepth.current === 0) setDropNew(false);
            }}
            onDrop={(e) => {
              if (primaryOpen || !hasFiles(e)) return;
              e.preventDefault();
              dropNewDepth.current = 0;
              setDropNew(false);
              const files = filesFrom(e.dataTransfer.files);
              if (files.length) setNewTask({ files });
            }}
          >
            {/* Al arrastrar archivos solo cambian el icono y el estilo: el texto no varía para que el botón no cambie de tamaño. */}
            {dropNew ? <Upload size={16} /> : <Plus size={16} />} <span className={HEADER_SHORT_LABEL}>{t("Nueva")}</span><span className={HEADER_LABEL}>{t("Nueva tarea")}</span>
          </button>
          {/* Con un diálogo abierto, una copia encima del fondo difuminado: abre una segunda tarea al lado (como el «+» del modal). */}
          {primaryOpen && newTaskRect &&
            createPortal(
              <button
                type="button"
                tabIndex={-1}
                className={cn("btn-primary fixed z-[70] whitespace-nowrap shadow-lg", secondOpen && "opacity-60")}
                style={{ left: newTaskRect.left, top: newTaskRect.top, width: newTaskRect.width, height: newTaskRect.height }}
                onClick={() => !secondOpen && addSecond()}
                aria-disabled={secondOpen}
                // Nombre accesible propio: con el texto visible («Nueva tarea») se confundiría con el botón de la cabecera.
                aria-label={t("Abrir otra tarea nueva al lado")}
                title={t("Abrir otra tarea nueva al lado")}
              >
                {/* Mismo texto que el botón original: corto cuando la cabecera va justa de sitio y solo el icono si no cabe más. */}
                <Plus size={16} /> {newTaskRect.width < 60 ? null : newTaskRect.width < 130 ? t("Nueva") : t("Nueva tarea")}
              </button>,
              document.body,
            )}
        </div>
        </div>

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
          <FilterMenu filters={activeFilters} onChange={changeFilters} labels={labels} kinds={data.kinds} users={data.users} currentUserId={data.currentUserId} priorityEnabled={priorityEnabled} clients={clientOptions} className="shrink-0" />
          <ViewToggle view={view} onChange={changeView} className="ml-0.5" />
          {view === "board" && (
          <div data-mobile-tabs className="no-scrollbar ml-0.5 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-3">
            {sortedColumns.map((c) => (
              <MobileTab
                key={c.id}
                active={c.id === activeMobileColumn}
                onClick={() => showMobileColumn(c.id)}
                over={wipExceeded(columnCardCount(c.id), c.wipLimit)}
                title={c.wipLimit != null ? (wipExceeded(columnCardCount(c.id), c.wipLimit) ? t("Límite superado: {n} tarjetas de {limit}", { n: columnCardCount(c.id), limit: c.wipLimit }) : t("Límite de tarjetas: {limit}", { limit: c.wipLimit })) : undefined}
              >
                {c.name} <span className={c.wipLimit == null ? "opacity-70" : "font-semibold"}>{c.wipLimit != null ? `${columnCardCount(c.id)} / ${c.wipLimit}` : (items[c.id]?.length ?? 0)}</span>
              </MobileTab>
            ))}
            <NewColumnButton variant="mobile" onCreated={showMobileColumn} />
          </div>
          )}
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
          <FilterMenu filters={activeFilters} onChange={changeFilters} labels={labels} kinds={data.kinds} users={data.users} currentUserId={data.currentUserId} priorityEnabled={priorityEnabled} clients={clientOptions} className="max-md:hidden" />
          <ViewToggle view={view} onChange={changeView} className="max-md:hidden" />
          <span className="shrink-0 text-xs text-slate-500" aria-live="polite">{filtering ? t("{shown} de {total}", { shown: shownCount, total: tasks.length }) : cardCount(t, tasks.length)}</span>
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
        {view === "list" ? <ListView tasks={tasks} matchingIds={matchingIds} filtering={filtering} /> : dndBoard}

        <FloatingCreateButtons onBulk={() => setBulk({ columnId: activeMobileColumn })} onNew={() => setNewTask({ columnId: activeMobileColumn })} />

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


        {openTask && (
          <TaskDialog
            key={openTask.id}
            task={openTask}
            gone={openGone}
            draft={editDraft?.taskId === openTask.id ? editDraft : null}
            onClose={() => {
              setOpenTaskId(null);
              setEditDraft(null);
              setGoneTask(null);
            }}
            side={secondOpen ? "left" : "center"}
            onAddSecond={secondOpen ? undefined : addSecond}
            onAddSecondBulk={secondOpen ? undefined : addSecondBulk}
          />
        )}
        {newTask && (
          <NewTaskDialog
            side={secondOpen ? "left" : "center"}
            onAddSecond={secondOpen ? undefined : addSecond}
            onAddSecondBulk={secondOpen ? undefined : addSecondBulk}
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
            pickProject
            onClose={() => setSecondNew(null)}
          />
        )}
        {secondBulk && <BulkTaskDialog side={primaryOpen ? "right" : "center"} pickProject onClose={() => setSecondBulk(false)} />}
        {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
        {(archivedOpen || wantsArchived) && <ArchivedDialog onClose={closeArchived} />}
        {bulk && <BulkTaskDialog initialColumnId={bulk.columnId} onClose={() => setBulk(null)} />}
        {release && (
          <ReleaseDialog
            tasks={release.taskIds.map((id) => taskById.get(id)).filter((t): t is BoardTask => !!t)}
            preselected={release.preselected}
            templates={data.templates}
            projectTemplates={data.projectTemplates}
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

/**
 * Botones flotantes de crear (móvil y tableta). Mientras hay selección se retiran: la barra de selección ocupa el pie
 * de la pantalla con sus acciones y así ni la tapan ni quedan tapados (vuelven al limpiar la selección).
 */
function FloatingCreateButtons({ onBulk, onNew }: { onBulk: () => void; onNew: () => void }) {
  const t = useT();
  const selecting = useSelectionSize() > 0;
  if (selecting) return null;
  return (
    <>
      <button
        onClick={onBulk}
        className="fixed right-[1.625rem] bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-30 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-brand-600 shadow-lg hover:bg-slate-50 active:scale-95 lg:hidden dark:border-slate-700 dark:bg-slate-800 dark:text-brand-300"
        aria-label={t("Crear varias tareas")}
      >
        <PlusStack size={22} />
      </button>
      <button
        onClick={onNew}
        className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-on-brand shadow-lg shadow-brand-600/30 hover:bg-brand-700 active:scale-95 lg:hidden"
        aria-label={t("Nueva tarea o captura")}
      >
        <Plus size={26} />
      </button>
    </>
  );
}

/** La barra de selección se suscribe al contador por su cuenta: seleccionar no redibuja el tablero entero. */
function SelectionBarHost(props: Omit<React.ComponentProps<typeof SelectionBar>, "count">) {
  const count = useSelectionSize();
  if (count === 0) return null;
  return <SelectionBar count={count} {...props} />;
}
