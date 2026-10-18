"use client";

import { ArrowRightLeft, Rocket, Trash2, X } from "lucide-react";
import type { BoardColumn } from "@/lib/types";

interface Props {
  count: number;
  columns: BoardColumn[];
  nextReleaseColumn?: BoardColumn;
  onMove: (columnId: string) => void;
  onRelease: () => void;
  onDelete: () => void;
  onClear: () => void;
}

// En móvil: dos filas de dos botones del mismo ancho; en escritorio, todo en una línea.
export function SelectionBar({ count, columns, nextReleaseColumn, onMove, onRelease, onDelete, onClear }: Props) {
  return (
    <div className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl lg:left-64 dark:border-slate-700 dark:bg-slate-900">
      <span className="px-1 text-sm font-semibold max-md:flex-1">{count} seleccionada(s)</span>
      <button className="btn-icon md:order-last md:ml-auto" onClick={onClear} aria-label="Limpiar selección">
        <X size={17} />
      </button>
      <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:items-center">
        {nextReleaseColumn && (
          <button className="btn-primary min-w-0 px-2 py-1.5 text-xs md:px-3 md:text-sm" onClick={() => onMove(nextReleaseColumn.id)} title={`Mover a ${nextReleaseColumn.name}`}>
            <ArrowRightLeft size={15} className="shrink-0" /> <span className="truncate">Mover a {nextReleaseColumn.name}</span>
          </button>
        )}
        <label className={nextReleaseColumn ? "min-w-0" : "col-span-2 min-w-0"}>
          <span className="sr-only">Mover a otra columna</span>
          <select className="input w-full py-1.5 text-xs md:w-auto md:text-sm" value="" onChange={(e) => e.target.value && onMove(e.target.value)}>
            <option value="">Mover a…</option>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <button className="btn-secondary min-w-0 px-2 py-1.5 text-xs md:px-3 md:text-sm" onClick={onRelease}>
          <Rocket size={15} className="shrink-0" /> <span className="truncate">Release con selección</span>
        </button>
        <button className="btn-secondary min-w-0 px-2 py-1.5 text-xs text-red-600 md:px-3 md:text-sm dark:text-red-400" onClick={onDelete}>
          <Trash2 size={15} className="shrink-0" /> <span className="truncate">Borrar</span>
        </button>
      </div>
    </div>
  );
}
