"use client";

import { ArrowRightLeft, Rocket, X } from "lucide-react";
import type { BoardColumn } from "@/lib/types";

interface Props {
  count: number;
  columns: BoardColumn[];
  nextReleaseColumn?: BoardColumn;
  onMove: (columnId: string) => void;
  onRelease: () => void;
  onClear: () => void;
}

export function SelectionBar({ count, columns, nextReleaseColumn, onMove, onRelease, onClear }: Props) {
  return (
    <div className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl lg:left-64 dark:border-slate-700 dark:bg-slate-900">
      <span className="px-2 text-sm font-semibold">{count} seleccionada(s)</span>
      {nextReleaseColumn && (
        <button className="btn-primary py-1.5" onClick={() => onMove(nextReleaseColumn.id)}>
          <ArrowRightLeft size={15} /> Mover a {nextReleaseColumn.name}
        </button>
      )}
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Mover a otra columna</span>
        <select
          className="input w-auto py-1.5"
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value)}
        >
          <option value="">Mover a…</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <button className="btn-secondary py-1.5" onClick={onRelease}>
        <Rocket size={15} /> Release con selección
      </button>
      <button className="btn-icon ml-auto" onClick={onClear} aria-label="Limpiar selección">
        <X size={17} />
      </button>
    </div>
  );
}
