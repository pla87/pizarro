"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Minus, MoreHorizontal, Pencil, Plus, Rocket, Tag, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteColumn, moveColumn, renameColumn, setColumnDone, setColumnRole } from "@/actions/columns";
import { COLUMN_ROLE_LABEL, COLUMN_ROLES, type ColumnRoleValue } from "@/lib/constants";
import type { BoardColumn } from "@/lib/types";
import { useT } from "@/i18n/client";
import { cn } from "../ui/cn";
import { useToast } from "../ui/Toast";
import { useEscapeClose } from "../ui/useEscapeClose";
import { useBoard } from "./context";
import { useShortcut } from "./shortcuts";
import { EvergreenPanel } from "./EvergreenPanel";
import { SortableTaskCard } from "./TaskCard";

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
  const { openNewTask, openRelease, selected, setSelectedMany } = useBoard();
  const t = useT();
  const sc = useShortcut();
  const selectedHere = taskIds.filter((id) => selected.has(id)).length;
  const allSelected = taskIds.length > 0 && selectedHere === taskIds.length;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  const isNextRelease = column.role === "NEXT_RELEASE";

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex w-full shrink-0 flex-col rounded-xl bg-slate-100/80 dark:bg-slate-900/60",
        // Con más de tres columnas, en escritorio se reparten el ancho de la ventana (mínimo 18 rem; si no caben, scroll).
        total > 3 ? "md:min-w-72 md:flex-1" : "md:w-72",
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
            "flex min-h-20 flex-1 flex-col gap-2 overflow-y-auto rounded-b-xl px-2 transition-colors",
            // Abajo se deja hueco: con selección lo tapa la barra inferior y en móvil los botones flotantes.
            selected.size > 0 ? "pb-44 md:pb-20" : "pb-32 lg:pb-2",
            isOver && "bg-brand-50/60 dark:bg-brand-500/5",
          )}
        >
          {taskIds.map((id) => (
            <SortableTaskCard key={id} id={id} />
          ))}
          {taskIds.length === 0 && (
            <p className="py-6 text-center text-xs text-slate-400">{t("Arrastra tarjetas aquí")}</p>
          )}
        </div>
      </SortableContext>
      {isNextRelease && <EvergreenPanel columnId={column.id} taskIds={evergreenIds} />}
    </section>
  );
}

function ColumnMenu({ column, index, total, empty }: { column: BoardColumn; index: number; total: number; empty: boolean }) {
  const { setColumns, track, refresh } = useBoard();
  const toast = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  useEscapeClose(open, () => setOpen(false));

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, optimistic?: () => void) => {
    setOpen(false);
    optimistic?.();
    const res = await track(fn());
    if (!res.ok) {
      toast(res.error ?? t("Error"), "error");
      refresh();
    }
  };

  const rename = () => {
    const name = window.prompt(t("Nuevo nombre de la columna"), column.name)?.trim();
    if (!name || name === column.name) return setOpen(false);
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
        if (res.ok) refresh();
        return res;
      },
      () =>
        setColumns((cols) =>
          cols.map((c) => (c.id === column.id ? { ...c, role } : role !== "NONE" && c.role === role ? { ...c, role: "NONE" } : c)),
        ),
    );

  const toggleDone = () =>
    run(
      () => setColumnDone(column.id, !column.isDone),
      () => setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, isDone: !c.isDone } : c))),
    );

  const remove = () => {
    if (!empty) {
      setOpen(false);
      return toast(t("Solo se pueden borrar columnas vacías."), "error");
    }
    if (!window.confirm(t("¿Borrar la columna «{name}»?", { name: column.name }))) return setOpen(false);
    run(() => deleteColumn(column.id), () => setColumns((cols) => cols.filter((c) => c.id !== column.id)));
  };

  return (
    <div className="relative">
      <button className="btn-icon h-7 w-7" onClick={() => setOpen((o) => !o)} aria-label={t("Opciones de columna")} aria-expanded={open}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <MenuItem icon={Pencil} onClick={rename}>{t("Renombrar")}</MenuItem>
            <MenuItem icon={ArrowLeft} onClick={() => move(-1)} disabled={index === 0}>{t("Mover a la izquierda")}</MenuItem>
            <MenuItem icon={ArrowRight} onClick={() => move(1)} disabled={index === total - 1}>{t("Mover a la derecha")}</MenuItem>
            <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
            <div className="flex items-center gap-2 px-2.5 pt-1 pb-0.5 text-xs font-medium text-slate-500"><Tag size={13} /> {t("Rol de la columna")}</div>
            {COLUMN_ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={cn(
                  "block w-full rounded-md px-2.5 py-1.5 pl-7 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800",
                  column.role === r && "font-semibold text-brand-600 dark:text-brand-300",
                )}
              >
                {column.role === r ? "● " : ""}{t(COLUMN_ROLE_LABEL[r])}
              </button>
            ))}
            <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
            <MenuItem icon={CheckCircle2} onClick={toggleDone}>
              {column.isDone ? t("✓ Cuenta como terminada") : t("Contar como terminada")}
            </MenuItem>
            <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
            <MenuItem icon={Trash2} onClick={remove} danger disabled={!empty}>
              {empty ? t("Borrar columna") : t("Borrar (debe estar vacía)")}
            </MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, children, onClick, disabled, danger }: { icon: typeof Pencil; children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-slate-800",
        danger && "text-red-600",
      )}
    >
      <Icon size={15} /> {children}
    </button>
  );
}
