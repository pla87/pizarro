"use client";

import { memo, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AlertTriangle, ArrowLeft, ArrowRight, Bot, CalendarDays, CalendarRange, Check, CheckCircle2, ClipboardCheck, FileDown, Flag, Gauge, GraduationCap, Hourglass, ListChecks, Minus, MoreHorizontal, Pencil, Plus, Repeat, Rocket, Shapes, Tag, Trash2, UserCheck, Users, Wallet, type LucideIcon } from "lucide-react";
import { deleteColumn, moveColumn, renameColumn, setColumnDefaultKind, setColumnDone, setColumnRole, setColumnRoutineTarget, setColumnWaitingDays, setColumnWipLimit } from "@/actions/columns";
import { COLUMN_ROLE_HINT, COLUMN_ROLE_LABEL, DEFAULT_WAITING_DAYS, hasEvergreenTasks, isUniqueColumnRole, MAX_WAITING_DAYS, type ColumnRoleValue } from "@/lib/constants";
import { currentRoleChoice, splitRoleChoices, type ColumnRoleChoice } from "@/lib/column-role-choices";
import type { BoardColumn } from "@/lib/types";
import { useIntlLocale, useT } from "@/i18n/client";
import { parseWipInput, WIP_MAX, WIP_MIN, wipExceeded } from "@/lib/wip";
import { columnAtSessionLimit, PROGRAM_MAX_SESSIONS } from "@/lib/program-limit";
import { budgetSummary, formatEuro } from "@/lib/task-fields";
import { isAssignColumn } from "@/lib/column-assign-core";
import { COLUMN_DRAG_PREFIX } from "@/lib/collision";
import { cn } from "../ui/cn";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import { usePrompt } from "../ui/PromptDialog";
import { Menu, MenuItem, MenuSeparator, MenuSub } from "../ui/Menu";
import { Modal } from "../ui/Modal";
import { ColumnActionButton, ColumnActionMenu } from "./ColumnActionButton";
import { AssignDialog, AssignHeader, AssignPlanButton, useAssignPlan } from "./AssignColumn";
import { downloadFile, useDownloadBusy } from "./columnDownload";
import { columnGateSnapshot } from "./columnGate";
import { useBoard, useSelectedCount, useTasks } from "./context";
import { cardsReserve } from "./deferredCards";
import { useShortcut } from "./shortcuts";
import { EvergreenPanel } from "./EvergreenPanel";
import { SortableTaskCard } from "./TaskCard";
import { useCardLimit } from "./useCardLimit";
import { useFileZone } from "./useFileZone";
import { lazyDialog } from "../lazyDialog";

// Diálogos de las columnas especiales: fuera del código inicial del tablero, se cargan al abrirlos.
const AiPlanDialog = lazyDialog(() => import("./AiPlanDialog"), (m) => m.AiPlanDialog);
const BudgetSummaryDialog = lazyDialog(() => import("./BudgetSummaryDialog"), (m) => m.BudgetSummaryDialog);
const ChecklistDialog = lazyDialog(() => import("./ChecklistDialog"), (m) => m.ChecklistDialog);
const ProgramDialog = lazyDialog(() => import("./ProgramDialog"), (m) => m.ProgramDialog);

interface Props {
  column: BoardColumn;
  taskIds: string[];
  /** Tareas evergreen de la columna (la de la release y las de plan para IA): fuera de la lista ordenable. */
  evergreenIds?: string[];
  /** Tarjetas de la columna sin filtrar (para borrar la columna o generar la release con un filtro activo). */
  cardCount: number;
  index: number;
  total: number;
  droppableId: string;
  mobileHidden: boolean;
  /** Arrastrando otra columna sobre esta: se pondría antes o después de ella (la marca en el borde). */
  columnDrop?: "before" | "after" | null;
  /** Es la columna que se está arrastrando (se atenúa en su sitio). */
  columnDragging?: boolean;
}

const NO_IDS: string[] = [];
/** Tarjetas del principio de cada columna que siempre se pintan enteras (las que se ven al abrir el tablero). */
const EAGER_CARDS = 15;

/** Icono de cada rol en el selector del menú de la columna (la explicación sale al pasar por encima: COLUMN_ROLE_HINT). */
const ROLE_ICON: Record<ColumnRoleValue, LucideIcon> = {
  NONE: Minus, NEXT_RELEASE: Rocket, IN_PRODUCTION: Flag, WAITING: Hourglass, WEEKLY_PLAN: CalendarRange, CHECKLIST: ListChecks,
  REVIEW: ClipboardCheck, ROUTINES: Repeat, BUDGET: Wallet, PROGRAM: GraduationCap, AI_PLAN: Bot,
};

/** Diálogos de una columna: los abre su menú o el botón de acción de su rol (ColumnActionButton). */
type ColumnDialog = "checklist" | "routine" | "program" | "plan" | "budget" | "assign" | "kind";

const columnUrl = (projectId: string, columnId: string, path: string) => `/api/projects/${projectId}/columns/${columnId}/${path}`;
/**
 * Rol «Planificación semanal»: PDF de la semana, por día o por persona. Se descarga sin salir del tablero
 * (columnDownload.ts): uno a la vez por columna (botón y menú comparten el estado) y un error sale en un aviso.
 */
function useWeekPdf(projectId: string, columnId: string): { busy: boolean; run: (by: "day" | "person") => void } {
  const t = useT();
  const toast = useToast();
  const key = `week:${columnId}`;
  const busy = useDownloadBusy(key);
  const run = (by: "day" | "person") => void downloadFile(key, columnUrl(projectId, columnId, `week?by=${by}`), {
    fallbackName: "semana.pdf",
    failed: t("No se pudo generar el PDF de la semana."),
    offline: t("Sin conexión: no se ha podido generar el PDF de la semana."),
  }, t, toast);
  return { busy, run };
}

/** Botón «PDF de la semana» (por día o por persona), con el icono girando mientras se genera. */
function WeekPdfButton({ column, projectId, empty, hint }: { column: BoardColumn; projectId: string; empty: boolean; hint: string }) {
  const t = useT();
  const { busy, run } = useWeekPdf(projectId, column.id);
  return (
    <ColumnActionMenu icon={CalendarRange} label={busy ? t("Generando PDF…") : t("PDF de la semana")} disabled={empty} busy={busy} title={empty ? t("No hay tarjetas en esta columna") : hint} items={[
      { label: t("PDF de la semana (por día)"), icon: CalendarDays, onClick: () => run("day") },
      { label: t("PDF de la semana (por persona)"), icon: Users, onClick: () => run("person") },
    ]} />
  );
}
/**
 * Columna del tablero. Memorizada: al arrastrar una tarjeta de una columna a otra el tablero se redibuja, pero solo
 * cambian las listas de origen y destino (Board conserva el mismo array en las demás), así que el resto no se repinta.
 */
export const ColumnView = memo(function ColumnView({ column, taskIds, evergreenIds = NO_IDS, cardCount, index, total, droppableId, mobileHidden, columnDrop = null, columnDragging = false }: Props) {
  const { openNewTask, openRelease, setSelectedMany, project, kinds } = useBoard();
  const t = useT();
  const sc = useShortcut();
  const selectedHere = useSelectedCount(taskIds);
  const allSelected = taskIds.length > 0 && selectedHere === taskIds.length;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  // La cabecera se arrastra para cambiar la columna de sitio (escritorio con ratón; si no, «Mover a la izquierda/derecha»
  // del menú o Alt+flechas sobre el nombre). No es un droppable: Board la reconoce por COLUMN_DRAG_PREFIX.
  const dragEnabled = useColumnDragEnabled() && total > 1;
  const { setNodeRef: setDragNode, listeners: dragListeners } = useDraggable({ id: COLUMN_DRAG_PREFIX + column.id, disabled: !dragEnabled });
  const moveColumnBy = useMoveColumn(column);
  // Tipo por defecto de la columna (si sigue entre los del proyecto): un punto de su color junto al recuento.
  const defaultKind = column.defaultKindId ? kinds.find((k) => k.id === column.defaultKindId) : undefined;
  const isNextRelease = column.role === "NEXT_RELEASE";
  // La release y los planes para IA acaban en su panel de tareas fijas («Siempre en la release» / «… en el plan»).
  const withFixed = hasEvergreenTasks(column.role);
  // «Asignación a persona» (rol NONE con persona o plazo): «Generar plan» bajo la cabecera (como los botones de los demás
  // roles) y la persona debajo.
  const assign = isAssignColumn(column);
  // Columnas que acaban en algo fijo al pie (el panel de fijas).
  const withFooter = withFixed;
  const [dialog, setDialog] = useState<ColumnDialog | null>(null);
  const action = assign ? <AssignPlanButton column={column} cardCount={cardCount} /> : roleAction(column, project.id, cardCount, setDialog, openRelease, t, sc);
  // Límite orientativo: solo avisa al pasarlo (con las tarjetas justas no), nunca impide mover ni crear.
  const wipOver = wipExceeded(cardCount, column.wipLimit);
  // «Programa del curso»: tope de PROGRAM_MAX_SESSIONS sesiones (el servidor lo impone; aquí, el contador y el «+»).
  const sessionsFull = columnAtSessionLimit(column.role, cardCount);
  // Archivos soltados en el hueco bajo las tarjetas: nueva tarea en esta columna.
  const fileZone = useFileZone((files) => openNewTask(column.id, false, files));
  // Esquinas inferiores rectas mientras quedan tarjetas por ver abajo (las de tareas fijas acaban siempre en su panel).
  const listRef = useRef<HTMLDivElement>(null);
  useMoreBelow(listRef, !withFooter);
  // Con panel de fijas o pie: sin hueco final mientras las tarjetas caben (ver useFitsWithoutTail).
  useFitsWithoutTail(listRef, withFooter);
  // Columnas largas: el servidor pinta las primeras tarjetas y el resto llega justo después de hidratar (deferredCards.ts).
  const shown = useCardLimit(taskIds.length);
  const painted = taskIds.length > shown ? taskIds.slice(0, shown) : taskIds;
  const reserve = cardsReserve(taskIds.length - painted.length);

  return (
    <section
      ref={setNodeRef}
      data-column-id={column.id}
      className={cn(
        "relative",
        // Hueco al que iría la columna arrastrada: una barra en ese borde.
        columnDrop === "before" && "before:absolute before:inset-y-0 before:-left-2 before:w-1 before:rounded-full before:bg-brand-500 before:content-['']",
        columnDrop === "after" && "after:absolute after:inset-y-0 after:-right-2 after:w-1 after:rounded-full after:bg-brand-500 after:content-['']",
        columnDragging && "opacity-50",
        // data-more-below (ver useMoreBelow): quedan tarjetas por debajo de lo visible; la columna sigue, sin esquinas abajo.
        "group/column flex w-full shrink-0 flex-col rounded-xl data-[more-below]:rounded-b-none",
        wipOver ? "bg-red-50/90 ring-1 ring-red-300 dark:bg-red-950/30 dark:ring-red-500/40" : "bg-slate-100/80 dark:bg-slate-900/60",
        // Con cuatro columnas o más, en escritorio se reparten el ancho del tablero (mínimo 18 rem; si no caben, scroll).
        // Con 1-3 miden lo mismo que con 4: (ancho útil - barra «+» de 2.5 rem - 4 huecos de 0.75 rem) / 4. Es CSS puro, sin estado.
        total >= 4 ? "md:min-w-72 md:flex-1" : "md:w-[calc((100%-5.5rem)/4)] md:min-w-72",
        mobileHidden && "max-md:hidden",
        // Todas las columnas llegan hasta abajo, también en el móvil las que acaban en el panel de fijas («Siempre en la
        // release» / «… en el plan»): el panel va pegado al fondo de la columna y su barra deja libre a la derecha el sitio
        // del «+» flotante (EvergreenPanel). Antes esas columnas acababan 4,75 rem más arriba y dejaban un hueco vacío.
        // Columnas especiales (con botón de acción): el mismo borde suave del color de la app.
        (action != null || assign) && !wipOver && "ring-1 ring-brand-500/30",
      )}
      aria-label={column.name}
      data-wip-over={wipOver || undefined}
    >
      <header
        // El arrastre lleva la cabecera (el fantasma que se ve al arrastrar tiene su tamaño).
        ref={setDragNode}
        className={cn("flex items-center gap-1.5 px-3 pt-2.5 pb-1.5", dragEnabled && "cursor-grab active:cursor-grabbing")}
        // Solo el ratón sobre la cabecera (no sobre sus botones) empieza el arrastre de la columna.
        onPointerDown={dragEnabled ? (e) => {
          if ((e.target as HTMLElement).closest("button, a, input, select, [role=menu]")) return;
          dragListeners?.onPointerDown?.(e);
        } : undefined}
      >
        {taskIds.length > 0 && (
          <button
            type="button"
            onClick={() => setSelectedMany(taskIds, !allSelected)}
            className={cn(
              // Móvil: zona de toque de 36 px (pseudo-elemento invisible) sin cambiar el tamaño visible; cabe en el
              // relleno de la cabecera y solo roza el nombre de la columna, que no es un botón.
              "relative flex h-4 w-4 shrink-0 items-center justify-center rounded border max-md:after:absolute max-md:after:-inset-2.5 max-md:after:content-['']",
              allSelected || selectedHere ? "border-brand-600 bg-brand-600 text-on-brand" : "border-slate-300 dark:border-slate-600",
            )}
            aria-label={allSelected ? t("Quitar la selección de «{name}»", { name: column.name }) : t("Seleccionar todas las tareas de «{name}»", { name: column.name })}
            title={allSelected ? t("Quitar selección") : t("Seleccionar todas")}
            aria-pressed={allSelected ? true : selectedHere ? "mixed" : false}
          >
            {allSelected ? <Check size={12} strokeWidth={3} /> : selectedHere ? <Minus size={12} strokeWidth={3} /> : null}
          </button>
        )}
        <h2
          className="min-w-0 truncate rounded text-sm font-semibold"
          title={dragEnabled ? t("{name} (arrastra la cabecera o pulsa Alt+flechas para moverla)", { name: column.name }) : column.name}
          // Alternativa de teclado al arrastre: con el foco en el nombre, Alt+← / Alt+→ la mueven (como las tarjetas).
          tabIndex={dragEnabled ? 0 : undefined}
          aria-keyshortcuts={dragEnabled ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
          data-column-handle
          onKeyDown={dragEnabled ? (e) => {
            // Sin repetición al mantener la tecla (como las tarjetas): una columna por pulsación.
            if (!e.altKey || e.repeat || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
            e.preventDefault();
            void moveColumnBy(e.key === "ArrowLeft" ? -1 : 1, true);
          } : undefined}
        >
          {column.name}
        </h2>
        {column.role === "PROGRAM" ? (
          <span
            data-session-badge
            className={cn(
              "shrink-0 rounded-full px-1.5 text-xs font-medium",
              sessionsFull ? "bg-amber-100 font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
            )}
            title={t("Sesiones: {n} de {max} como mucho", { n: cardCount, max: PROGRAM_MAX_SESSIONS })}
          >
            {cardCount}/{PROGRAM_MAX_SESSIONS}
          </span>
        ) : column.wipLimit == null ? (
          <span className="rounded-full bg-slate-200 px-1.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {taskIds.length}
          </span>
        ) : (
          // Con límite se muestra siempre el total real («n / límite»): el aviso no depende solo del color (texto, icono y título).
          <span
            data-wip-badge
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 text-xs font-medium",
              wipOver ? "bg-red-100 font-semibold text-red-700 dark:bg-red-500/20 dark:text-red-300" : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
            )}
            title={wipOver ? t("Límite superado: {n} tarjetas de {limit}", { n: cardCount, limit: column.wipLimit }) : t("Límite de tarjetas: {limit}", { limit: column.wipLimit })}
          >
            {wipOver && <AlertTriangle size={11} aria-hidden />}
            {cardCount} / {column.wipLimit}
            {wipOver && <span className="sr-only">{t("Límite superado")}</span>}
          </span>
        )}
        {defaultKind && (
          <span
            data-column-default-kind
            className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/20"
            style={{ backgroundColor: defaultKind.color }}
            title={t("Tipo por defecto: {name}", { name: defaultKind.name })}
            role="img"
            aria-label={t("Tipo por defecto: {name}", { name: defaultKind.name })}
          />
        )}
        {column.role === "BUDGET" && <BudgetTotal columnId={column.id} />}
        <div className="ml-auto flex items-center">
          <button
            className="btn-icon h-7 w-7"
            onClick={() => openNewTask(column.id)}
            aria-label={t("Añadir tarea en {name}", { name: column.name })}
            disabled={sessionsFull}
            title={sessionsFull ? t("La columna «{name}» admite como mucho {max} sesiones.", { name: column.name, max: PROGRAM_MAX_SESSIONS }) : undefined}
          >
            <Plus size={16} />
          </button>
          <ColumnMenu column={column} index={index} total={total} empty={cardCount === 0} cardCount={cardCount} openDialog={setDialog} />
        </div>
      </header>
      {action}
      {assign && <AssignHeader column={column} onEdit={() => setDialog("assign")} />}
      {dialog === "assign" && <AssignDialog column={column} onClose={() => setDialog(null)} />}
      {dialog === "checklist" && <ChecklistDialog column={column} onClose={() => setDialog(null)} />}
      {dialog === "routine" && <RoutineTargetDialog column={column} onClose={() => setDialog(null)} />}
      {dialog === "program" && <ProgramDialog column={column} onClose={() => setDialog(null)} />}
      {dialog === "budget" && <BudgetSummaryDialog column={column} onClose={() => setDialog(null)} />}
      {dialog === "plan" && <AiPlanDialog column={column} onClose={() => setDialog(null)} />}
      {dialog === "kind" && <DefaultKindDialog column={column} onClose={() => setDialog(null)} />}
      {/* La lista lleva el id de la columna: la detección de colisiones (lib/collision.ts) solo repasa las tarjetas de la columna bajo el puntero. */}
      <SortableContext id={droppableId} items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          ref={listRef}
          data-card-list
          className={cn(
            // pt y -mt: margen interior para que el anillo de foco de la primera tarjeta no lo recorte el scroll.
            "-mt-1.5 flex min-h-20 flex-1 flex-col gap-2 overflow-y-auto rounded-b-xl px-2 pt-1.5 transition-colors group-data-[more-below]/column:rounded-b-none",
            // Sin anclaje del scroll mientras se arrastra una tarjeta (ver nearCards.ts).
            "[[data-card-drag]_&]:[overflow-anchor:none]",
            // Hueco fijo al final (con el de la zona de archivos) para que la última tarjeta pueda quedar por encima
            // de la barra de selección y, sin ella, de los botones flotantes. Es el mismo haya o no selección: la barra
            // flota encima sin cambiar el alto ni el contenido de la columna, y el scroll no salta al aparecer.
            "pb-40 md:pb-32 lg:pb-6",
            // Columnas con panel de fijas al pie: si las tarjetas caben, sin ese hueco (ni el mínimo de la zona de archivos ni su separación),
            // que solo hacía aparecer la barra de scroll al abrir el panel (data-fits, useFitsWithoutTail). Solo desde `lg`:
            // en móvil y tableta el hueco es el que deja subir la última tarjeta por encima de la barra de selección y de
            // los botones flotantes, que tapan el final de la lista aunque las tarjetas quepan.
            // `relative`: la lista es el offsetParent de sus tarjetas (useFitsWithoutTail mide con offsetTop).
            "group/list relative lg:data-[fits]:pb-0",
            isOver && "bg-brand-50/60 dark:bg-brand-500/5",
          )}
          {...fileZone.handlers}
        >
          {painted.map((id, i) => (
            <SortableTaskCard key={id} id={id} eager={i < EAGER_CARDS} />
          ))}
          {/* Las que aún no se han pintado: un hueco del mismo alto, para que nada se mueva al llegar. */}
          {reserve && <div aria-hidden data-cards-pending className="shrink-0" style={{ height: reserve }} />}
          {/* Único hueco que acepta archivos para crear una tarea: lo que queda libre bajo la última tarjeta (los huecos entre tarjetas no). */}
          <div
            data-file-zone
            className={cn("min-h-10 flex-1 rounded-lg transition-colors lg:group-data-[fits]/list:-mt-2 lg:group-data-[fits]/list:min-h-0", fileZone.over && "bg-brand-50 ring-2 ring-brand-500 ring-inset dark:bg-brand-500/10")}
          >
            {taskIds.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-600 dark:text-slate-400">
                {fileZone.over ? t("Suelta para crear tarea") : (
                  // Con un filtro o una búsqueda activos (data-filtering en la raíz del tablero) el texto es otro. Por CSS: la
                  // columna (memorizada dentro de DndContext) no se vuelve a dibujar al escribir en el buscador.
                  <>
                    <span className="[[data-filtering]_&]:hidden">{t("Arrastra tarjetas aquí")}</span>
                    {/* Si coincide alguna tarea fija del panel de esta columna, no se dice que no coincide ninguna. */}
                    {evergreenIds.length === 0 && <span className="hidden [[data-filtering]_&]:inline">{t("Ninguna tarjeta coincide")}</span>}
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      </SortableContext>
      {withFixed && <EvergreenPanel columnId={column.id} taskIds={evergreenIds} kind={isNextRelease ? "release" : "plan"} />}
    </section>
  );
});

/**
 * Marca `data-more-below` en la columna (el padre de la lista) mientras hay tarjetas, o parte de una, por debajo de lo que
 * se ve: la lista tiene scroll y no se ha llegado a la última, o la columna se corta por el borde inferior de la ventana.
 * El hueco del final (zona de archivos y relleno) no cuenta: con la última tarjeta a la vista no queda nada más. Sin estado
 * de React (atributo + CSS, como `data-stuck` de la barra de formato): se mide como mucho una vez por fotograma, con el
 * scroll de la lista o de la página (pasivos), al cambiar la ventana o el viewport visual, y con un ResizeObserver sobre la
 * lista y cada tarjeta (añadir, quitar o arrastrar tarjetas, cambios en vivo, pasar de una columna a otra en móvil).
 */
/**
 * Lista de una columna con panel de fijas al pie (la de la release, las de plan para IA): marca `data-fits` mientras sus
 * tarjetas caben enteras en lo que mide la lista. Con la marca, el CSS quita el hueco del final (el relleno para la barra de
 * selección y los botones flotantes, y el mínimo de la zona de archivos, que se queda con el sitio libre que haya): el panel
 * ya está debajo, y ese hueco era lo único que no cabía al abrir el panel, de modo que aparecía la barra de scroll con
 * las tarjetas a la vista y sitio de sobra. Sin la marca (no caben), la lista tiene scroll como siempre, con su hueco.
 * La marca solo cambia el CSS desde `lg` (en móvil y tableta el hueco hace falta igual: ver la lista).
 * Sin estado de React (atributo + CSS, como useMoreBelow): lo que se mide (dónde acaban las tarjetas y el alto de la lista)
 * no depende de la marca, así que ponerla o quitarla no cambia la medida siguiente.
 */
function useFitsWithoutTail(listRef: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const set = (fits: boolean) => {
      if (fits !== list.hasAttribute("data-fits")) list.toggleAttribute("data-fits", fits);
    };
    if (!enabled) return set(false);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const zone = list.querySelector<HTMLElement>(":scope > [data-file-zone]");
      if (!zone || list.clientHeight === 0) return set(false);
      // Dónde acaba la última tarjeta dentro del contenido de la lista (offsetTop: sin el scroll ni el desplazamiento que
      // pone dnd-kit al arrastrar). Sin tarjetas, caben.
      const last = zone.previousElementSibling as HTMLElement | null;
      const cardsEnd = last ? last.offsetTop + last.offsetHeight : 0;
      set(cardsEnd <= list.clientHeight + 0.5);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const stop = observeList(list, schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      stop();
      set(false);
    };
  }, [listRef, enabled]);
}

/** Vigila el tamaño de la lista y de cada tarjeta (también las que se añaden o quitan) y llama a `schedule`. Devuelve cómo dejar de hacerlo. */
function observeList(list: HTMLElement, schedule: () => void): () => void {
  const ro = new ResizeObserver(schedule);
  const observeAll = () => {
    ro.disconnect();
    ro.observe(list);
    for (const el of list.children) ro.observe(el);
  };
  observeAll();
  const mo = new MutationObserver(() => {
    observeAll();
    schedule();
  });
  mo.observe(list, { childList: true });
  return () => {
    ro.disconnect();
    mo.disconnect();
  };
}

function useMoreBelow(listRef: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    const list = listRef.current;
    const col = list?.parentElement;
    if (!list || !col) return;
    const set = (more: boolean) => {
      if (more !== col.hasAttribute("data-more-below")) col.toggleAttribute("data-more-below", more);
    };
    if (!enabled) return set(false);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const zone = list.querySelector<HTMLElement>(":scope > [data-file-zone]");
      // Sin tarjetas (solo la zona de archivos) o columna oculta (móvil): nada abajo.
      if (list.childElementCount < 2 || list.clientHeight === 0) return set(false);
      const cs = getComputedStyle(list);
      const tail = (parseFloat(cs.rowGap) || 0) + (zone?.offsetHeight ?? 0) + (parseFloat(cs.paddingBottom) || 0);
      const vv = window.visualViewport;
      const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const cut = Math.max(0, list.getBoundingClientRect().bottom - viewBottom);
      set(list.scrollHeight - list.scrollTop - list.clientHeight + cut - tail > 1);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const stop = observeList(list, schedule);
    const vvp = window.visualViewport;
    const opts = { passive: true } as const;
    list.addEventListener("scroll", schedule, opts);
    window.addEventListener("scroll", schedule, opts);
    window.addEventListener("resize", schedule, opts);
    vvp?.addEventListener("resize", schedule, opts);
    vvp?.addEventListener("scroll", schedule, opts);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      stop();
      list.removeEventListener("scroll", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      vvp?.removeEventListener("resize", schedule);
      vvp?.removeEventListener("scroll", schedule);
    };
  }, [listRef, enabled]);
}

/** Arrastrar cabeceras de columna: solo en escritorio con ratón (en el móvil hay pestañas; en táctil, el menú). */
const COLUMN_DRAG_QUERY = "(min-width: 768px) and (pointer: fine)";
function useColumnDragEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(COLUMN_DRAG_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(COLUMN_DRAG_QUERY).matches,
    () => false,
  );
}

/**
 * Mueve la columna un puesto a la izquierda (-1) o a la derecha (+1): «Mover a la izquierda/derecha» del menú y Alt+flechas
 * sobre su nombre (`keepFocus`: el foco sigue en el nombre, ya en su sitio nuevo). Optimista; si falla, vuelve y avisa.
 */
function useMoveColumn(column: BoardColumn): (dir: -1 | 1, keepFocus?: boolean) => Promise<void> {
  const { setColumns, track, refresh, columns } = useBoard();
  const toast = useToast();
  const t = useT();
  return async (dir, keepFocus = false) => {
    const sorted = [...columns].sort((a, b) => a.position - b.position);
    const i = sorted.findIndex((c) => c.id === column.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    const before = columns;
    [sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!];
    setColumns(sorted.map((c, k) => ({ ...c, position: (k + 1) * 1024 })));
    if (keepFocus) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-column-id="${CSS.escape(column.id)}"] [data-column-handle]`)?.focus());
      toast(t("«{name}» movida a la posición {n}", { name: column.name, n: j + 1 }));
    }
    const res = await track(moveColumn(column.id, dir));
    if (!res.ok) {
      setColumns(before);
      toast(res.error ?? t("Error"), "error");
      refresh();
    }
  };
}

/** Suma del coste de las tareas (no archivadas) de una columna «Presupuesto», en la cabecera. */
function BudgetTotal({ columnId }: { columnId: string }) {
  const locale = useIntlLocale();
  const t = useT();
  const tasks = useTasks();
  const sum = budgetSummary(tasks.filter((x) => x.columnId === columnId));
  return (
    <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" title={t("Suma del coste de las tareas de la columna")}>
      {formatEuro(sum.total / 100, locale)}
    </span>
  );
}

/**
 * «Ver lista» (rol Lista de comprobación) se apoya en datos de las tarjetas, no solo en que las haya: la lista muestra las
 * subtareas (sin ninguna queda vacía). Se desactiva también en ese caso, con su motivo. Devuelve el motivo por el que la
 * acción no se puede usar, o null si se puede.
 *
 * Se suscribe al almacén de tareas con una instantánea que es el motivo (columnGateSnapshot): el botón solo se redibuja
 * cuando cambia el motivo de SU columna, no con cada cambio de cualquier tarea del tablero (como hacía con useTasks).
 */
function useGate(column: BoardColumn, cardCount: number): string | null {
  const t = useT();
  const { stores } = useBoard();
  const snapshot = columnGateSnapshot(stores.tasks, column.id, column.role, cardCount);
  const gate = useSyncExternalStore(stores.tasks.subscribe, snapshot, snapshot);
  switch (gate) {
    case "empty": return t("No hay tarjetas en esta columna");
    case "noSubtasks": return t("Ninguna tarjeta tiene subtareas");
    default: return null;
  }
}

function GatedActionButton({ column, cardCount, icon, label, onClick }: { column: BoardColumn; cardCount: number; icon: LucideIcon; label: string; onClick: () => void }) {
  const t = useT();
  const reason = useGate(column, cardCount);
  return <ColumnActionButton icon={icon} label={label} onClick={onClick} disabled={reason != null} title={reason ?? t(COLUMN_ROLE_HINT[column.role])} />;
}

function GatedMenuItem({ column, cardCount, icon, onClick, children }: { column: BoardColumn; cardCount: number; icon: LucideIcon; onClick: () => void; children: React.ReactNode }) {
  const reason = useGate(column, cardCount);
  return <ReasonMenuItem icon={icon} onClick={onClick} reason={reason}>{children}</ReasonMenuItem>;
}

/** Opción de menú que, sin poder usarse, sigue tocable (aria-disabled) y muestra su motivo como aviso (el title no se ve en el móvil). */
function ReasonMenuItem({ reason, onClick, ...rest }: { reason: string | null; icon: LucideIcon; onClick: () => void; children: React.ReactNode }) {
  const toast = useToast();
  return <MenuItem {...rest} onClick={reason ? () => toast(reason, "error") : onClick} aria-disabled={reason ? true : undefined} title={reason ?? undefined} />;
}

/**
 * Botón de acción del rol de la columna (todas las columnas especiales con el mismo aspecto: ColumnActionButton), o null
 * si su rol no tiene ninguna. Su acción también está en el menú de la columna.
 */
function roleAction(
  column: BoardColumn, projectId: string, cardCount: number, open: (d: ColumnDialog) => void, openRelease: (columnId: string) => void,
  t: ReturnType<typeof useT>, sc: ReturnType<typeof useShortcut>,
): React.ReactNode {
  const empty = cardCount === 0;
  const hint = t(COLUMN_ROLE_HINT[column.role]);
  switch (column.role) {
    case "NEXT_RELEASE":
      // Solo se desactiva sin tarjetas (las fijas cuentan): el motivo dice qué hacer, al pasar el ratón y al tocarlo.
      return <ColumnActionButton icon={Rocket} label={t("Generar release")} onClick={() => openRelease(column.id)} disabled={empty} title={empty ? t("Añade tarjetas a esta columna para generar la release") : `${t("Generar release")} (${sc("Alt+R")})`} />;
    case "AI_PLAN":
      return <ColumnActionButton icon={Bot} label={t("Generar plan de trabajo")} onClick={() => open("plan")} disabled={empty} title={empty ? t("No hay tarjetas en esta columna") : hint} />;
    case "PROGRAM":
      return <ColumnActionButton icon={GraduationCap} label={t("Publicar programa (PDF)")} onClick={() => open("program")} disabled={empty} title={empty ? t("No hay tarjetas en esta columna") : hint} />;
    case "WEEKLY_PLAN":
      return <WeekPdfButton column={column} projectId={projectId} empty={empty} hint={hint} />;
    case "CHECKLIST":
      return <GatedActionButton column={column} cardCount={cardCount} icon={ListChecks} label={t("Ver lista")} onClick={() => open("checklist")} />;
    case "BUDGET":
      return <ColumnActionButton icon={Wallet} label={t("Resumen de presupuesto")} onClick={() => open("budget")} disabled={empty} title={empty ? t("No hay tarjetas en esta columna") : hint} />;
    default:
      return null;
  }
}

function ColumnMenu({ column, index, total, empty, cardCount, openDialog: setDialog }: { column: BoardColumn; index: number; total: number; empty: boolean; cardCount: number; openDialog: (d: ColumnDialog) => void }) {
  const { setColumns, track, refresh, project, columns, kinds } = useBoard();
  const assign = isAssignColumn(column);
  const plan = useAssignPlan(column, cardCount);
  const week = useWeekPdf(project.id, column.id);
  // Tipo por defecto: solo cuenta si sigue entre los tipos visibles del proyecto (borrado u oculto: «último usado»).
  const defaultKind = kinds.find((k) => k.id === column.defaultKindId);
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const t = useT();

  // El menú se cierra solo al elegir una opción (ver Menu).
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, optimistic?: () => void) => {
    // Sin conexión el refresco espera a que vuelva: lo optimista se deshace aquí (con conexión el refresco lo confirma).
    const before = columns;
    optimistic?.();
    const res = await track(fn());
    if (!res.ok) {
      if (optimistic) setColumns(before);
      toast(res.error ?? t("Error"), "error");
      refresh();
    }
  };

  // Vacío o el mismo nombre: no cambia nada.
  const rename = async () => {
    const name = (await prompt({ title: t("Renombrar columna"), label: t("Nombre de la columna"), defaultValue: column.name, maxLength: 80, confirmLabel: t("Guardar") }))?.trim();
    if (!name || name === column.name) return;
    run(() => renameColumn(column.id, name), () => setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, name } : c))));
  };

  const move = useMoveColumn(column);

  // Cambiar el rol puede convertir tareas fijas en normales (lo hace el servidor): se recarga después.
  const setRole = (role: ColumnRoleValue) =>
    run(
      async () => {
        const res = await setColumnRole(column.id, role);
        if (res.ok) {
          refresh();
          // «Presupuesto» necesita el campo Coste: el servidor lo activa si no lo estaba.
          if (res.data?.costEnabled) toast(t("Se ha activado el campo Coste"));
        }
        return res;
      },
      () =>
        setColumns((cols) =>
          cols.map((c) => (c.id === column.id ? { ...c, role, assigneeId: null, assignDueDays: null } : isUniqueColumnRole(role) && c.role === role ? { ...c, role: "NONE" } : c)),
        ),
    );

  // Rol «Esperando»: días hasta el recordatorio (entero de 1 a MAX_WAITING_DAYS; vacío = no cambiar).
  const editWaitingDays = async () => {
    const current = column.waitingDays ?? DEFAULT_WAITING_DAYS;
    const parseDays = (raw: string) => {
      const days = Number(raw.trim());
      return Number.isInteger(days) && days >= 1 && days <= MAX_WAITING_DAYS ? days : undefined;
    };
    const raw = (
      await prompt({
        title: t("Plazo de espera"),
        label: t("Avisar a la persona asignada tras cuántos días en esta columna (1-{max})", { max: MAX_WAITING_DAYS }),
        defaultValue: String(current),
        type: "number",
        min: 1,
        max: MAX_WAITING_DAYS,
        confirmLabel: t("Guardar"),
        validate: (v) => (v.trim() && parseDays(v) === undefined ? t("Indica un número entero de días.") : null),
      })
    )?.trim();
    if (!raw) return;
    const days = parseDays(raw);
    if (days === undefined || days === current) return;
    run(() => setColumnWaitingDays(column.id, days), () => setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, waitingDays: days } : c))));
  };

  // Límite de tarjetas (WIP): vacío = sin límite.
  const editWipLimit = async () => {
    const raw = await prompt({
      title: t("Límite de tarjetas"),
      label: t("Máximo de tarjetas en esta columna ({min}-{max})", { min: WIP_MIN, max: WIP_MAX }),
      description: t("Déjalo vacío para quitar el límite. Solo avisa: nunca impide mover ni crear tarjetas."),
      defaultValue: column.wipLimit != null ? String(column.wipLimit) : "",
      placeholder: t("Sin límite"),
      type: "number",
      min: WIP_MIN,
      max: WIP_MAX,
      confirmLabel: t("Guardar"),
      validate: (v) => (parseWipInput(v) === undefined ? t("Indica un número entero entre {min} y {max}, o déjalo vacío.", { min: WIP_MIN, max: WIP_MAX }) : null),
    });
    if (raw === null) return;
    const limit = parseWipInput(raw);
    if (limit === undefined || limit === column.wipLimit) return;
    run(() => setColumnWipLimit(column.id, limit), () => setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, wipLimit: limit } : c))));
  };

  const routineTarget = columns.find((c) => c.id === column.routineTargetColumnId);

  const toggleDone = () =>
    run(
      () => setColumnDone(column.id, !column.isDone),
      () => setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, isDone: !c.isDone } : c))),
    );

  // Submenú del rol: «Asignación a persona» abre su diálogo; «Sin rol» y los demás cambian el rol.
  const currentChoice = currentRoleChoice({ role: column.role, assign });
  const roleChoices = splitRoleChoices(project.suggestedRoles, currentChoice);
  const [moreRoles, setMoreRoles] = useState(false);
  const pickRole = (choice: ColumnRoleChoice | null) => {
    // La que ya tiene: nada que cambiar (antes anotaba «Cambió el rol de la columna» sin cambio).
    if (choice === currentChoice) return;
    if (choice === "ASSIGN") setDialog("assign");
    else setRole(choice ?? "NONE");
  };

  const remove = async () => {
    if (!empty) return toast(t("Solo se pueden borrar columnas vacías."), "error");
    const ok = await confirm({ title: t("Borrar columna"), message: t("¿Borrar la columna «{name}»?", { name: column.name }), confirmLabel: t("Borrar"), danger: true });
    if (!ok) return;
    run(() => deleteColumn(column.id), () => setColumns((cols) => cols.filter((c) => c.id !== column.id)));
  };

  return (
    <>
    <Menu
      align="end"
      label={t("Opciones de columna")}
      className="relative"
      panelClassName="w-64 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
      trigger={({ props }) => (
        <button className="btn-icon h-7 w-7" aria-label={t("Opciones de columna")} {...props}>
          <MoreHorizontal size={16} />
        </button>
      )}
    >
      <MenuItem icon={Pencil} onClick={rename}>{t("Renombrar")}</MenuItem>
      <MenuItem icon={ArrowLeft} onClick={() => move(-1)} disabled={index === 0}>{t("Mover a la izquierda")}</MenuItem>
      <MenuItem icon={ArrowRight} onClick={() => move(1)} disabled={index === total - 1}>{t("Mover a la derecha")}</MenuItem>
      <MenuSeparator />
      {/* Los roles en un submenú (antes, mezclados con las acciones, el menú tenía unas 30 opciones). Primero los que encajan
          con la plantilla del proyecto; el resto tras «Más roles…» (column-role-choices.ts). */}
      <MenuSub icon={Tag} label={t("Rol de la columna")} summary={assign ? t("Asignación a persona") : t(COLUMN_ROLE_LABEL[column.role])}>
        <RoleItem choice={null} current={currentChoice} onPick={pickRole} />
        {roleChoices.first.map((r) => <RoleItem key={r} choice={r} current={currentChoice} onPick={pickRole} />)}
        {roleChoices.more.length > 0 && !moreRoles && (
          <MenuItem
            data-keep-open
            icon={MoreHorizontal}
            className="py-1.5 text-xs text-slate-600 dark:text-slate-400"
            title={t("Roles pensados para otro tipo de proyecto")}
            onClick={(e) => {
              setMoreRoles(true);
              // El foco pasa a la primera de las que aparecen (el botón desaparece).
              const list = e.currentTarget.closest('[role="menu"]');
              requestAnimationFrame(() => list?.querySelector<HTMLElement>("[data-more-role]")?.focus());
            }}
          >
            {t("Más roles…")}
          </MenuItem>
        )}
        {moreRoles && roleChoices.more.map((r, i) => <RoleItem key={r} choice={r} current={currentChoice} onPick={pickRole} more={i === 0} />)}
      </MenuSub>
      {column.role === "WAITING" && (
        <MenuItem icon={Hourglass} onClick={editWaitingDays}>
          {t("Recordar tras {n} d…", { n: column.waitingDays ?? DEFAULT_WAITING_DAYS })}
        </MenuItem>
      )}
      {column.role === "WEEKLY_PLAN" && (
        <>
          <ReasonMenuItem icon={FileDown} onClick={() => week.run("day")} reason={empty ? t("No hay tarjetas en esta columna") : null}>{t("PDF de la semana (por día)")}</ReasonMenuItem>
          <ReasonMenuItem icon={FileDown} onClick={() => week.run("person")} reason={empty ? t("No hay tarjetas en esta columna") : null}>{t("PDF de la semana (por persona)")}</ReasonMenuItem>
        </>
      )}
      {column.role === "CHECKLIST" && <GatedMenuItem column={column} cardCount={cardCount} icon={ListChecks} onClick={() => setDialog("checklist")}>{t("Ver lista")}</GatedMenuItem>}
      {column.role === "ROUTINES" && (
        <MenuItem icon={Repeat} onClick={() => setDialog("routine")}>{t("Destino de la siguiente aparición: {name}…", { name: routineTarget?.name ?? t("esta columna") })}</MenuItem>
      )}
      {column.role === "BUDGET" && <ReasonMenuItem icon={Wallet} onClick={() => setDialog("budget")} reason={empty ? t("No hay tarjetas en esta columna") : null}>{t("Resumen de presupuesto")}</ReasonMenuItem>}
      {column.role === "PROGRAM" && <ReasonMenuItem icon={GraduationCap} onClick={() => setDialog("program")} reason={empty ? t("No hay tarjetas en esta columna") : null}>{t("Publicar programa (PDF)")}</ReasonMenuItem>}
      {assign && <ReasonMenuItem icon={FileDown} onClick={plan.run} reason={plan.reason}>{t("Generar plan")}</ReasonMenuItem>}
      {column.role === "AI_PLAN" && <ReasonMenuItem icon={Bot} onClick={() => setDialog("plan")} reason={empty ? t("No hay tarjetas en esta columna") : null}>{t("Generar plan de trabajo")}</ReasonMenuItem>}
      <MenuSeparator />
      <MenuItem icon={Shapes} onClick={() => setDialog("kind")} title={t("Tipo con el que se abre «Nueva tarea» desde esta columna")}>
        {defaultKind ? t("Tipo por defecto: {name}…", { name: defaultKind.name }) : t("Tipo por defecto…")}
      </MenuItem>
      <MenuItem icon={Gauge} onClick={editWipLimit}>
        {column.wipLimit != null ? t("Límite de tarjetas: {limit}…", { limit: column.wipLimit }) : t("Límite de tarjetas…")}
      </MenuItem>
      <MenuItem icon={CheckCircle2} onClick={toggleDone}>
        {column.isDone ? t("✓ Cuenta como terminada") : t("Contar como terminada")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={Trash2} onClick={remove} danger disabled={!empty}>
        {empty ? t("Borrar columna") : t("Borrar (debe estar vacía)")}
      </MenuItem>
    </Menu>
    </>
  );
}

/** Una opción del submenú «Rol de la columna» (`choice` null: «Sin rol»). `more`: la primera de las de «Más roles…». */
function RoleItem({ choice, current, onPick, more }: { choice: ColumnRoleChoice | null; current: ColumnRoleChoice | null; onPick: (c: ColumnRoleChoice | null) => void; more?: boolean }) {
  const t = useT();
  const on = choice === current;
  const label = choice === "ASSIGN" ? t("Asignación a persona") : t(COLUMN_ROLE_LABEL[choice ?? "NONE"]);
  // «Asignación a persona» no es un valor del rol (la columna queda con rol NONE): abre el diálogo de la persona y el plazo.
  const hint = choice === "ASSIGN" ? t("Todo lo que entra se asigna a una persona (y, opcional, con un plazo): botón «Generar plan».") : t(COLUMN_ROLE_HINT[choice ?? "NONE"]);
  return (
    <MenuItem
      role="menuitemradio"
      aria-checked={on}
      data-more-role={more || undefined}
      onClick={() => onPick(choice)}
      icon={choice === "ASSIGN" ? UserCheck : ROLE_ICON[choice ?? "NONE"]}
      title={hint}
      className={cn("py-1.5 text-xs", on && "font-semibold text-brand-600 dark:text-brand-300")}
    >
      {on ? "● " : ""}{label}
    </MenuItem>
  );
}

/**
 * «Tipo por defecto…»: el tipo con el que se abre «Nueva tarea» desde esta columna (el «+» o la columna elegida en el
 * diálogo), o «Ninguno» para seguir con el último que usó cada persona.
 */
function DefaultKindDialog({ column, onClose }: { column: BoardColumn; onClose: () => void }) {
  const { kinds, setColumns, track, refresh } = useBoard();
  const toast = useToast();
  const t = useT();
  const current = kinds.some((k) => k.id === column.defaultKindId) ? column.defaultKindId! : "";
  const [value, setValue] = useState(current);

  const save = async () => {
    onClose();
    const kindId = value || null;
    if (kindId === (current || null)) return;
    const before = column.defaultKindId;
    setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, defaultKindId: kindId } : c)));
    const res = await track(setColumnDefaultKind(column.id, kindId));
    if (!res.ok) {
      setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, defaultKindId: before } : c)));
      toast(res.error, "error");
      refresh();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t("Tipo por defecto")}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn-primary" onClick={save}>{t("Guardar")}</button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{t("Las tareas nuevas de «{name}» empiezan con este tipo. Con «Ninguno», con el último que hayas usado.", { name: column.name })}</p>
      <select className="input w-full" value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("Tipo por defecto")}>
        <option value="">{t("Ninguno")}</option>
        {kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
      </select>
    </Modal>
  );
}

/** Rutinas: a qué columna va la siguiente aparición de una tarea recurrente de esta columna. */
function RoutineTargetDialog({ column, onClose }: { column: BoardColumn; onClose: () => void }) {
  const { columns, setColumns, track, refresh } = useBoard();
  const toast = useToast();
  const t = useT();
  const [value, setValue] = useState(column.routineTargetColumnId ?? column.id);

  const save = async () => {
    const target = value === column.id ? null : value;
    onClose();
    if (target === column.routineTargetColumnId) return;
    const before = column.routineTargetColumnId;
    setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, routineTargetColumnId: target } : c)));
    const res = await track(setColumnRoutineTarget(column.id, target));
    if (!res.ok) {
      setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, routineTargetColumnId: before } : c)));
      toast(res.error, "error");
      refresh();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t("Destino de la siguiente aparición")}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn-primary" onClick={save}>{t("Guardar")}</button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{t("Cuando una tarea recurrente de esta columna se termine o se archive, su siguiente aparición se creará en:")}</p>
      <select className="input w-full" value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("Columna destino")}>
        {[...columns].sort((a, b) => a.position - b.position).map((c) => (
          <option key={c.id} value={c.id}>{c.id === column.id ? t("{name} (esta columna)", { name: c.name }) : c.name}</option>
        ))}
      </select>
    </Modal>
  );
}
