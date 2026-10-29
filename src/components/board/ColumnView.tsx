"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, FileDown, Hourglass, ListChecks, Minus, MoreHorizontal, Pencil, Plus, Repeat, Rocket, Tag, Trash2, Wallet } from "lucide-react";
import { deleteColumn, moveColumn, renameColumn, setColumnDone, setColumnRole, setColumnRoutineTarget, setColumnWaitingDays } from "@/actions/columns";
import { COLUMN_ROLE_LABEL, COLUMN_ROLES, DEFAULT_WAITING_DAYS, isUniqueColumnRole, MAX_WAITING_DAYS, type ColumnRoleValue } from "@/lib/constants";
import type { BoardColumn } from "@/lib/types";
import { useIntlLocale, useT } from "@/i18n/client";
import { budgetSummary, formatEuro } from "@/lib/task-fields";
import { cn } from "../ui/cn";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu";
import { Modal } from "../ui/Modal";
import { BudgetSummaryDialog } from "./BudgetSummaryDialog";
import { ChecklistDialog } from "./ChecklistDialog";
import { useBoard, useSelectedCount, useSelectionSize, useTasks } from "./context";
import { useShortcut } from "./shortcuts";
import { EvergreenPanel } from "./EvergreenPanel";
import { SortableTaskCard } from "./TaskCard";
import { useFileZone } from "./useFileZone";

interface Props {
  column: BoardColumn;
  taskIds: string[];
  /** Tareas evergreen de la columna (solo la de la release): fuera de la lista ordenable. */
  evergreenIds?: string[];
  /** Tarjetas de la columna sin filtrar (para borrar la columna o generar la release con un filtro activo). */
  cardCount: number;
  index: number;
  total: number;
  droppableId: string;
  mobileHidden: boolean;
}

export function ColumnView({ column, taskIds, evergreenIds = [], cardCount, index, total, droppableId, mobileHidden }: Props) {
  const { openNewTask, openRelease, setSelectedMany } = useBoard();
  const t = useT();
  const sc = useShortcut();
  const selectedHere = useSelectedCount(taskIds);
  const hasSelection = useSelectionSize() > 0;
  const allSelected = taskIds.length > 0 && selectedHere === taskIds.length;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  const isNextRelease = column.role === "NEXT_RELEASE";
  // Archivos soltados en el hueco bajo las tarjetas: nueva tarea en esta columna.
  const fileZone = useFileZone((files) => openNewTask(column.id, false, files));

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex w-full shrink-0 flex-col rounded-xl bg-slate-100/80 dark:bg-slate-900/60",
        // Con cuatro columnas o más, en escritorio se reparten el ancho del tablero (mínimo 18 rem; si no caben, scroll).
        // Con 1-3 miden lo mismo que con 4: (ancho útil - barra «+» de 2.5 rem - 4 huecos de 0.75 rem) / 4. Es CSS puro, sin estado.
        total >= 4 ? "md:min-w-72 md:flex-1" : "md:w-[calc((100%-5.5rem)/4)] md:min-w-72",
        mobileHidden && "max-md:hidden",
        isNextRelease && "ring-1 ring-brand-500/30",
      )}
      aria-label={column.name}
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
        <span className="rounded-full bg-slate-200 px-1.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {taskIds.length}
        </span>
        {column.role === "BUDGET" && <BudgetTotal columnId={column.id} />}
        <div className="ml-auto flex items-center">
          <button className="btn-icon h-7 w-7" onClick={() => openNewTask(column.id)} aria-label={t("Añadir tarea en {name}", { name: column.name })}>
            <Plus size={16} />
          </button>
          <ColumnMenu column={column} index={index} total={total} empty={cardCount === 0} />
        </div>
      </header>
      {isNextRelease && (
        <div className="px-2 pb-1.5">
          <button
            className="btn-primary w-full py-1.5"
            onClick={() => openRelease(column.id)}
            disabled={cardCount === 0}
            title={cardCount === 0 ? t("No hay tarjetas en esta columna") : `${t("Generar Release")} (${sc("Alt+R")})`}
          >
            <Rocket size={15} /> {t("Generar Release")}
          </button>
        </div>
      )}
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          className={cn(
            // pt y -mt: margen interior para que el anillo de foco de la primera tarjeta no lo recorte el scroll.
            "-mt-1.5 flex min-h-20 flex-1 flex-col gap-2 overflow-y-auto rounded-b-xl px-2 pt-1.5 transition-colors",
            // Abajo se deja hueco: con selección lo tapa la barra inferior y en móvil los botones flotantes.
            hasSelection ? "pb-44 md:pb-20" : "pb-32 lg:pb-2",
            isOver && "bg-brand-50/60 dark:bg-brand-500/5",
            fileZone.over && "bg-brand-50 ring-2 ring-brand-500 ring-inset dark:bg-brand-500/10",
          )}
          {...fileZone.handlers}
        >
          {taskIds.map((id) => (
            <SortableTaskCard key={id} id={id} />
          ))}
          {taskIds.length === 0 && (
            <p className="py-6 text-center text-xs text-slate-400">{fileZone.over ? t("Suelta para crear tarea") : t("Arrastra tarjetas aquí")}</p>
          )}
        </div>
      </SortableContext>
      {isNextRelease && <EvergreenPanel columnId={column.id} taskIds={evergreenIds} />}
    </section>
  );
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

function ColumnMenu({ column, index, total, empty }: { column: BoardColumn; index: number; total: number; empty: boolean }) {
  const { setColumns, track, refresh, project, columns } = useBoard();
  const [dialog, setDialog] = useState<"checklist" | "routine" | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const t = useT();
  const [summaryOpen, setSummaryOpen] = useState(false);

  // El menú se cierra solo al elegir una opción (ver Menu).
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, optimistic?: () => void) => {
    optimistic?.();
    const res = await track(fn());
    if (!res.ok) {
      toast(res.error ?? t("Error"), "error");
      refresh();
    }
  };

  const rename = () => {
    const name = window.prompt(t("Nuevo nombre de la columna"), column.name)?.trim();
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

  // Rol «Esperando»: días hasta el recordatorio.
  const editWaitingDays = () => {
    const current = column.waitingDays ?? DEFAULT_WAITING_DAYS;
    const raw = window.prompt(t("Avisar a la persona asignada tras cuántos días en esta columna (1-{max})", { max: MAX_WAITING_DAYS }), String(current))?.trim();
    if (!raw) return;
    const days = Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > MAX_WAITING_DAYS) return toast(t("Indica un número entero de días."), "error");
    if (days === current) return;
    run(() => setColumnWaitingDays(column.id, days), () => setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, waitingDays: days } : c))));
  };

  // Rol «Planificación semanal»: PDF de la semana, por día o por persona.
  const weekPdf = (by: "day" | "person") => window.open(`/api/projects/${project.id}/columns/${column.id}/week?by=${by}`, "_blank", "noopener");

  const columnUrl = (path: string) => `/api/projects/${project.id}/columns/${column.id}/${path}`;
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
          className={cn("py-1.5 pl-7 text-xs", column.role === r && "font-semibold text-brand-600 dark:text-brand-300")}
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
          <MenuItem icon={FileDown} onClick={() => weekPdf("day")}>{t("PDF de la semana (por día)")}</MenuItem>
          <MenuItem icon={FileDown} onClick={() => weekPdf("person")}>{t("PDF de la semana (por persona)")}</MenuItem>
        </>
      )}
      {column.role === "CHECKLIST" && <MenuItem icon={ListChecks} onClick={() => setDialog("checklist")}>{t("Ver lista")}</MenuItem>}
      {column.role === "AGENDA" && <MenuItem icon={CalendarDays} onClick={() => window.location.assign(columnUrl("ics"))}>{t("Exportar a calendario (.ics)")}</MenuItem>}
      {column.role === "ROUTINES" && (
        <MenuItem icon={Repeat} onClick={() => setDialog("routine")}>{t("Destino de la siguiente aparición: {name}…", { name: routineTarget?.name ?? t("esta columna") })}</MenuItem>
      )}
      {column.role === "DELIVERY" && <MenuItem icon={FileDown} onClick={() => window.open(columnUrl("delivery"), "_blank", "noopener")}>{t("Resumen para el cliente (PDF)")}</MenuItem>}
      {column.role === "BUDGET" && <MenuItem icon={Wallet} onClick={() => setSummaryOpen(true)}>{t("Resumen de presupuesto")}</MenuItem>}
      <MenuSeparator />
      <MenuItem icon={CheckCircle2} onClick={toggleDone}>
        {column.isDone ? t("✓ Cuenta como terminada") : t("Contar como terminada")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={Trash2} onClick={remove} danger disabled={!empty}>
        {empty ? t("Borrar columna") : t("Borrar (debe estar vacía)")}
      </MenuItem>
    </Menu>
    {summaryOpen && <BudgetSummaryDialog column={column} onClose={() => setSummaryOpen(false)} />}
    {dialog === "checklist" && <ChecklistDialog column={column} onClose={() => setDialog(null)} />}
    {dialog === "routine" && <RoutineTargetDialog column={column} onClose={() => setDialog(null)} />}
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
    setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, routineTargetColumnId: target } : c)));
    const res = await track(setColumnRoutineTarget(column.id, target));
    if (!res.ok) {
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
