"use client";

import { isWhite, onColor } from "@/lib/constants";
import { cn } from "../ui/cn";

/**
 * Etiquetas del proyecto como botones que se marcan y desmarcan (aria-pressed): el detalle de la tarea, «Nueva tarea» y
 * «Varias tareas». Solo elige entre las que ya existen. Con `max`, al llegar al tope las no marcadas se desactivan.
 */
export function LabelToggles({ labels, selected, onToggle, max, className, children }: {
  labels: readonly { id: string; name: string; color: string }[];
  selected: readonly string[];
  onToggle: (id: string, on: boolean) => void;
  max?: number;
  className?: string;
  /** Lo que va detrás de las etiquetas (p. ej. «Gestionar»). */
  children?: React.ReactNode;
}) {
  const full = max !== undefined && selected.length >= max;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {labels.map((l) => {
        const on = selected.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => onToggle(l.id, !on)}
            disabled={!on && full}
            className={cn("rounded px-2 py-0.5 text-xs font-medium disabled:opacity-50", on ? "text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
            style={on ? { backgroundColor: l.color, color: onColor(l.color), boxShadow: isWhite(l.color) ? "inset 0 0 0 1px rgb(0 0 0 / 0.2)" : undefined } : undefined}
            aria-pressed={on}
          >
            {l.name}
          </button>
        );
      })}
      {children}
    </div>
  );
}
