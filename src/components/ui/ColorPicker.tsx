"use client";

import { Check } from "lucide-react";
import { useT } from "@/i18n/client";
import { COLOR_NAME, isWhite, PALETTE, swatchBorder } from "@/lib/constants";
import { cn } from "./cn";

export function ColorPicker({ value, onChange, allowNone = true }: { value: string | null; onChange: (c: string | null) => void; allowNone?: boolean }) {
  const t = useT();
  return (
    // Margen interior para que el anillo de selección no se recorte en contenedores con scroll.
    <div className="flex flex-wrap gap-1.5 p-[3px]">
      {allowNone && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "h-7 w-7 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600",
            value === null && "ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900",
          )}
          aria-label={t("Sin color")}
          title={t("Sin color")}
        />
      )}
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn("flex h-7 w-7 items-center justify-center rounded-full", swatchBorder(c), value === c && "ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900")}
          style={{ backgroundColor: c }}
          aria-label={t("Color {name}", { name: COLOR_NAME[c] ? t(COLOR_NAME[c]) : c })}
          title={COLOR_NAME[c] ? t(COLOR_NAME[c]) : undefined}
        >
          {value === c && <Check size={14} className={isWhite(c) ? "text-slate-700" : "text-white"} />}
        </button>
      ))}
    </div>
  );
}
