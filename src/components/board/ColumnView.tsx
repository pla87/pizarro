"use client";

import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AlertTriangle, ArrowLeft, ArrowRight, Bot, CalendarDays, CalendarRange, Check, CheckCircle2, ClipboardCheck, FileDown, Flag, Gauge, GraduationCap, Hourglass, ListChecks, Minus, MoreHorizontal, Pencil, Plus, Repeat, Rocket, Send, Tag, Trash2, Users, Wallet, type LucideIcon } from "lucide-react";
import { deleteColumn, moveColumn, renameColumn, setColumnDone, setColumnRole, setColumnRoutineTarget, setColumnWaitingDays, setColumnWipLimit } from "@/actions/columns";
import { COLUMN_ROLE_HINT, COLUMN_ROLE_LABEL, COLUMN_ROLES, DEFAULT_WAITING_DAYS, hasEvergreenTasks, isUniqueColumnRole, MAX_WAITING_DAYS, type ColumnRoleValue } from "@/lib/constants";
import type { BoardColumn } from "@/lib/types";
import { useIntlLocale, useT } from "@/i18n/client";
import { parseWipInput, WIP_MAX, WIP_MIN, wipExceeded } from "@/lib/wip";
import { columnAtSessionLimit, PROGRAM_MAX_SESSIONS } from "@/lib/program-limit";
import { budgetSummary, formatEuro } from "@/lib/task-fields";
import { cn } from "../ui/cn";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import { usePrompt } from "../ui/PromptDialog";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu";
import { Modal } from "../ui/Modal";
import { AiPlanDialog } from "./AiPlanDialog";
import { BudgetSummaryDialog } from "./BudgetSummaryDialog";
import { ColumnActionButton, ColumnActionMenu } from "./ColumnActionButton";
import { ChecklistDialog } from "./ChecklistDialog";
import { ProgramDialog } from "./ProgramDialog";
import { useBoard, useSelectedCount, useTasks } from "./context";
import { useShortcut } from "./shortcuts";
import { EvergreenPanel } from "./EvergreenPanel";
import { SortableTaskCard } from "./TaskCard";
import { useFileZone } from "./useFileZone";

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
}

const NO_IDS: string[] = [];

/** Icono de cada rol en el selector del menú de la columna (la explicación sale al pasar por encima: COLUMN_ROLE_HINT). */
const ROLE_ICON: Record<ColumnRoleValue, LucideIcon> = {
  NONE: Minus, NEXT_RELEASE: Rocket, IN_PRODUCTION: Flag, WAITING: Hourglass, WEEKLY_PLAN: CalendarRange, CHECKLIST: ListChecks,
  REVIEW: ClipboardCheck, AGENDA: CalendarDays, ROUTINES: Repeat, DELIVERY: Send, BUDGET: Wallet, PROGRAM: GraduationCap, AI_PLAN: Bot,
};

/** Diálogos de una columna: los abre su menú o el botón de acción de su rol (ColumnActionButton). */
type ColumnDialog = "checklist" | "routine" | "program" | "plan" | "budget";

const columnUrl = (projectId: string, columnId: string, path: string) => `/api/projects/${projectId}/columns/${columnId}/${path}`;
/** Rol «Planificación semanal»: PDF de la semana, por día o por persona. */
const weekPdf = (projectId: string, columnId: string, by: "day" | "person") => window.open(columnUrl(projectId, columnId, `week?by=${by}`), "_blank", "noopener");
const agendaIcs = (projectId: string, columnId: string) => window.location.assign(columnUrl(projectId, columnId, "ics"));
const deliveryPdf = (projectId: string, columnId: string) => window.open(columnUrl(projectId, columnId, "delivery"), "_blank", "noopener");

/**
 * Columna del tablero. Memorizada: al arrastrar una tarjeta de una columna a otra el tablero se redibuja, pero solo
 * cambian las listas de origen y destino (Board conserva el mismo array en las demás), así que el resto no se repinta.
 */
export const ColumnView = memo(function ColumnView({ column, taskIds, evergreenIds = NO_IDS, cardCount, index, total, droppableId, mobileHidden }: Props) {
  const { openNewTask, openRelease, setSelectedMany, project } = useBoard();
  const t = useT();
  const sc = useShortcut();
  const selectedHere = useSelectedCount(taskIds);
  const allSelected = taskIds.length > 0 && selectedHere === taskIds.length;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  const isNextRelease = column.role === "NEXT_RELEASE";
  // La release y los planes para IA acaban en su panel de tareas fijas («Siempre en la release» / «… en el plan»).
  const withFixed = hasEvergreenTasks(column.role);
  const [dialog, setDialog] = useState<ColumnDialog | null>(null);
  const action = roleAction(column, project.id, cardCount, setDialog, openRelease, t, sc);
  // Límite orientativo: solo avisa al pasarlo (con las tarjetas justas no), nunca impide mover ni crear.
  const wipOver = wipExceeded(cardCount, column.wipLimit);
  // «Programa del curso»: tope de PROGRAM_MAX_SESSIONS sesiones (el servidor lo impone; aquí, el contador y el «+»).
  const sessionsFull = columnAtSessionLimit(column.role, cardCount);
  // Archivos soltados en el hueco bajo las tarjetas: nueva tarea en esta columna.
  const fileZone = useFileZone((files) => openNewTask(column.id, false, files));
  // Esquinas inferiores rectas mientras quedan tarjetas por ver abajo (las de tareas fijas acaban siempre en su panel).
  const listRef = useRef<HTMLDivElement>(null);
  useMoreBelow(listRef, !withFixed);

  return (
    <section
      ref={setNodeRef}
      className={cn(
        // data-more-below (ver useMoreBelow): quedan tarjetas por debajo de lo visible; la columna sigue, sin esquinas abajo.
        "group/column flex w-full shrink-0 flex-col rounded-xl data-[more-below]:rounded-b-none",
        wipOver ? "bg-red-50/90 ring-1 ring-red-300 dark:bg-red-950/30 dark:ring-red-500/40" : "bg-slate-100/80 dark:bg-slate-900/60",
        // Con cuatro columnas o más, en escritorio se reparten el ancho del tablero (mínimo 18 rem; si no caben, scroll).
        // Con 1-3 miden lo mismo que con 4: (ancho útil - barra «+» de 2.5 rem - 4 huecos de 0.75 rem) / 4. Es CSS puro, sin estado.
        total >= 4 ? "md:min-w-72 md:flex-1" : "md:w-[calc((100%-5.5rem)/4)] md:min-w-72",
        mobileHidden && "max-md:hidden",
        // Móvil: el panel de fijas del pie («Siempre en la release» / «… en el plan») acaba por encima del «+» flotante
        // (que mide 3,5 rem a 1,25 rem del borde: 4,75 rem más el hueco de la zona segura); antes lo tapaba. Las demás
        // columnas siguen hasta abajo: su lista ya deja sitio a los botones flotantes con el relleno del final.
        withFixed && "max-md:mb-[calc(env(safe-area-inset-bottom)+4.75rem)]",
        // Columnas especiales (con botón de acción): el mismo borde suave del color de la app.
        action != null && !wipOver && "ring-1 ring-brand-500/30",
      )}
      aria-label={column.name}
      data-wip-over={wipOver || undefined}
    >
      <header className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
        {taskIds.length > 0 && (
          <button
            type="button"
            onClick={() => setSelectedMany(taskIds, !allSelected)}
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
              allSelected || selectedHere ? "border-brand-600 bg-brand-600 text-on-brand" : "border-slate-300 dark:border-slate-600",
            )}
            aria-label={allSelected ? t("Quitar la selección de «{name}»", { name: column.name }) : t("Seleccionar todas las tareas de «{name}»", { name: column.name })}
            title={allSelected ? t("Quitar selección") : t("Seleccionar todas")}
            aria-pressed={allSelected ? true : selectedHere ? "mixed" : false}
          >
            {allSelected ? <Check size={12} strokeWidth={3} /> : selectedHere ? <Minus size={12} strokeWidth={3} /> : null}
          </button>
        )}
        <h2 className="min-w-0 truncate text-sm font-semibold" title={column.name}>{column.name}</h2>
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
          <ColumnMenu column={column} index={index} total={total} empty={cardCount === 0} openDialog={setDialog} />
        </div>
      </header>
      {action}
      {dialog === "checklist" && <ChecklistDialog column={column} onClose={() => setDialog(null)} />}
      {dialog === "routine" && <RoutineTargetDialog column={column} onClose={() => setDialog(null)} />}
      {dialog === "program" && <ProgramDialog column={column} onClose={() => setDialog(null)} />}
      {dialog === "budget" && <BudgetSummaryDialog column={column} onClose={() => setDialog(null)} />}
      {dialog === "plan" && <AiPlanDialog column={column} onClose={() => setDialog(null)} />}
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
            isOver && "bg-brand-50/60 dark:bg-brand-500/5",
          )}
          {...fileZone.handlers}
        >
          {taskIds.map((id) => (
            <SortableTaskCard key={id} id={id} />
          ))}
          {/* Único hueco que acepta archivos para crear una tarea: lo que queda libre bajo la última tarjeta (los huecos entre tarjetas no). */}
          <div
            data-file-zone
            className={cn("min-h-10 flex-1 rounded-lg transition-colors", fileZone.over && "bg-brand-50 ring-2 ring-brand-500 ring-inset dark:bg-brand-500/10")}
          >
            {taskIds.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-400">{fileZone.over ? t("Suelta para crear tarea") : t("Arrastra tarjetas aquí")}</p>
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
      ro.disconnect();
      mo.disconnect();
      list.removeEventListener("scroll", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      vvp?.removeEventListener("resize", schedule);
      vvp?.removeEventListener("scroll", schedule);
    };
  }, [listRef, enabled]);
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
      return <ColumnActionButton icon={Rocket} label={t("Generar Release")} onClick={() => openRelease(column.id)} disabled={empty} title={empty ? t("No hay tarjetas en esta columna") : `${t("Generar Release")} (${sc("Alt+R")})`} />;
    case "AI_PLAN":
      return <ColumnActionButton icon={Bot} label={t("Generar plan de trabajo")} onClick={() => open("plan")} disabled={empty} title={empty ? t("No hay tarjetas en esta columna") : hint} />;
    case "PROGRAM":
      return <ColumnActionButton icon={GraduationCap} label={t("Publicar programa (PDF)")} onClick={() => open("program")} title={hint} />;
    case "WEEKLY_PLAN":
      return (
        <ColumnActionMenu icon={CalendarRange} label={t("PDF de la semana")} title={hint} items={[
          { label: t("PDF de la semana (por día)"), icon: CalendarDays, onClick: () => weekPdf(projectId, column.id, "day") },
          { label: t("PDF de la semana (por persona)"), icon: Users, onClick: () => weekPdf(projectId, column.id, "person") },
        ]} />
      );
    case "CHECKLIST":
      return <ColumnActionButton icon={ListChecks} label={t("Ver lista")} onClick={() => open("checklist")} title={hint} />;
    case "AGENDA":
      return <ColumnActionButton icon={CalendarDays} label={t("Exportar a calendario (.ics)")} onClick={() => agendaIcs(projectId, column.id)} title={hint} />;
    case "DELIVERY":
      return <ColumnActionButton icon={FileDown} label={t("Resumen para el cliente (PDF)")} onClick={() => deliveryPdf(projectId, column.id)} title={hint} />;
    case "BUDGET":
      return <ColumnActionButton icon={Wallet} label={t("Resumen de presupuesto")} onClick={() => open("budget")} title={hint} />;
    default:
      return null;
  }
}

function ColumnMenu({ column, index, total, empty, openDialog: setDialog }: { column: BoardColumn; index: number; total: number; empty: boolean; openDialog: (d: ColumnDialog) => void }) {
  const { setColumns, track, refresh, project, columns } = useBoard();
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

  const move = (dir: -1 | 1) =>
    run(
      () => moveColumn(column.id, dir),
      () =>
        setColumns((cols) => {
          const sorted = [...cols].sort((a, b) => a.position - b.position);
          const i = sorted.findIndex((c) => c.id === column.id);
          const j = i + dir;
          if (j < 0 || j >= sorted.length) return cols;
          [sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!];
          return sorted.map((c, k) => ({ ...c, position: (k + 1) * 1024 }));
        }),
    );

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
          cols.map((c) => (c.id === column.id ? { ...c, role } : isUniqueColumnRole(role) && c.role === role ? { ...c, role: "NONE" } : c)),
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
      <div className="flex items-center gap-2 px-2.5 pt-1 pb-0.5 text-xs font-medium text-slate-500"><Tag size={13} /> {t("Rol de la columna")}</div>
      {COLUMN_ROLES.map((r) => (
        <MenuItem
          key={r}
          role="menuitemradio"
          aria-checked={column.role === r}
          onClick={() => setRole(r)}
          icon={ROLE_ICON[r]}
          title={t(COLUMN_ROLE_HINT[r])}
          className={cn("py-1.5 pl-4 text-xs", column.role === r && "font-semibold text-brand-600 dark:text-brand-300")}
        >
          {column.role === r ? "● " : ""}{t(COLUMN_ROLE_LABEL[r])}
        </MenuItem>
      ))}
      {column.role === "WAITING" && (
        <MenuItem icon={Hourglass} onClick={editWaitingDays}>
          {t("Recordar tras {n} d…", { n: column.waitingDays ?? DEFAULT_WAITING_DAYS })}
        </MenuItem>
      )}
      {column.role === "WEEKLY_PLAN" && (
        <>
          <MenuItem icon={FileDown} onClick={() => weekPdf(project.id, column.id, "day")}>{t("PDF de la semana (por día)")}</MenuItem>
          <MenuItem icon={FileDown} onClick={() => weekPdf(project.id, column.id, "person")}>{t("PDF de la semana (por persona)")}</MenuItem>
        </>
      )}
      {column.role === "CHECKLIST" && <MenuItem icon={ListChecks} onClick={() => setDialog("checklist")}>{t("Ver lista")}</MenuItem>}
      {column.role === "AGENDA" && <MenuItem icon={CalendarDays} onClick={() => agendaIcs(project.id, column.id)}>{t("Exportar a calendario (.ics)")}</MenuItem>}
      {column.role === "ROUTINES" && (
        <MenuItem icon={Repeat} onClick={() => setDialog("routine")}>{t("Destino de la siguiente aparición: {name}…", { name: routineTarget?.name ?? t("esta columna") })}</MenuItem>
      )}
      {column.role === "DELIVERY" && <MenuItem icon={FileDown} onClick={() => deliveryPdf(project.id, column.id)}>{t("Resumen para el cliente (PDF)")}</MenuItem>}
      {column.role === "BUDGET" && <MenuItem icon={Wallet} onClick={() => setDialog("budget")}>{t("Resumen de presupuesto")}</MenuItem>}
      {column.role === "PROGRAM" && <MenuItem icon={GraduationCap} onClick={() => setDialog("program")}>{t("Publicar programa (PDF)")}</MenuItem>}
      {column.role === "AI_PLAN" && <MenuItem icon={Bot} onClick={() => setDialog("plan")} disabled={empty}>{t("Generar plan de trabajo")}</MenuItem>}
      <MenuSeparator />
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
