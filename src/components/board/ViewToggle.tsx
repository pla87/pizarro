"use client";

import { Columns3, List } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "../ui/cn";
import type { BoardView } from "./listSort";

/** Conmutador Tablero / Lista de la cabecera. `compact`: solo iconos (móvil). */
export function ViewToggle({ view, onChange, compact = false, className }: { view: BoardView; onChange: (v: BoardView) => void; compact?: boolean; className?: string }) {
  const t = useT();
  const options: { value: BoardView; label: string; Icon: typeof List }[] = [
    { value: "board", label: t("Tablero"), Icon: Columns3 },
    { value: "list", label: t("Lista"), Icon: List },
  ];
  return (
    <div role="group" aria-label={t("Vista")} data-view-toggle className={cn("inline-flex shrink-0 rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900", className)}>
      {options.map(({ value, label, Icon }) => {
        const active = view === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={compact ? label : undefined}
            title={label}
            onClick={() => !active && onChange(value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded text-xs font-medium transition-colors",
              compact ? "w-8 justify-center" : "px-2",
              active ? "bg-brand-600 text-on-brand" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
            )}
          >
            <Icon size={14} aria-hidden />
            {!compact && <span className="@max-[1099px]:sr-only">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
