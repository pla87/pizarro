"use client";

import { useRef } from "react";
import { Check } from "lucide-react";
import { useT } from "@/i18n/client";
import { COLOR_NAME, isWhite, PALETTE, swatchBorder } from "@/lib/constants";
import { cn } from "./cn";

/** Selector de color como grupo de radio: Tab entra en el color elegido (o el primero) y sale al siguiente Tab;
 *  las flechas, Inicio y Fin mueven el foco (con vuelta) y Espacio o Intro eligen el color enfocado. */
export function ColorPicker({ value, onChange, allowNone = true, label }: { value: string | null; onChange: (c: string | null) => void; allowNone?: boolean; label?: string }) {
  const t = useT();
  const groupRef = useRef<HTMLDivElement>(null);
  const options: (string | null)[] = allowNone ? [null, ...PALETTE] : [...PALETTE];
  const checked = options.findIndex((c) => c === value);
  // Rodante: solo un color está en el orden de Tab (el elegido, o el primero si no hay ninguno).
  const tabIndexOf = Math.max(0, checked);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const radios = Array.from(groupRef.current?.querySelectorAll<HTMLElement>("[role=radio]") ?? []);
    const i = radios.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % radios.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + radios.length) % radios.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = radios.length - 1;
    if (next < 0) return;
    e.preventDefault();
    radios[next]!.focus();
  }

  const base = "focus-visible:outline-offset-[3px]";
  const selectedRing = "ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900";
  return (
    // Relleno con margen negativo: deja sitio al anillo de selección y al de foco (que un contenedor con scroll recortaría).
    <div ref={groupRef} role="radiogroup" aria-label={label ?? t("Color")} onKeyDown={onKeyDown} className="-m-[3px] flex flex-wrap gap-1.5 p-1.5">
      {options.map((c, i) => {
        const name = c === null ? t("Sin color") : COLOR_NAME[c] ? t(COLOR_NAME[c]) : c;
        return c === null ? (
          <button
            key="none"
            type="button"
            role="radio"
            aria-checked={value === null}
            tabIndex={i === tabIndexOf ? 0 : -1}
            onClick={() => onChange(null)}
            className={cn("h-7 w-7 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600", base, value === null && selectedRing)}
            aria-label={name}
            title={name}
          />
        ) : (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            tabIndex={i === tabIndexOf ? 0 : -1}
            onClick={() => onChange(c)}
            className={cn("flex h-7 w-7 items-center justify-center rounded-full", swatchBorder(c), base, value === c && selectedRing)}
            style={{ backgroundColor: c }}
            aria-label={t("Color {name}", { name })}
            title={name}
          >
            {value === c && <Check size={14} className={isWhite(c) ? "text-slate-700" : "text-white"} />}
          </button>
        );
      })}
    </div>
  );
}
