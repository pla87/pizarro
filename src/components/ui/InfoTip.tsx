"use client";

import { Info } from "lucide-react";
import { useId, useState } from "react";
import { useT } from "@/i18n/client";
import { cn } from "./cn";
import { PopoverPanel } from "./Popover";

/**
 * Botón «i» con una nota breve: las explicaciones que no hace falta leer siempre (la pantalla queda con lo justo).
 * Se abre al pulsar (también en móvil y con el teclado) y se cierra con Escape, al pulsar fuera o al salir con Tab.
 * Es un <span>: cabe dentro de un título o un párrafo. No lo metas dentro de un <label> (sería otro control etiquetado).
 */
export function InfoTip({ children, topic, className }: { children: React.ReactNode; /** De qué trata (para el lector de pantalla), ya traducido. */ topic?: string; className?: string }) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const label = topic ? t("Más información: {topic}", { topic }) : t("Más información");
  return (
    <span className={cn("inline-flex align-middle", className)}>
      <button
        ref={setAnchor}
        type="button"
        className="-m-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:text-slate-700 aria-expanded:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 dark:aria-expanded:text-slate-200"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-info-tip
        onClick={() => setOpen((o) => !o)}
      >
        <Info size={14} aria-hidden />
      </button>
      {open && anchor && (
        <PopoverPanel
          anchor={anchor}
          id={id}
          role="dialog"
          aria-label={label}
          modal={false}
          returnFocus={anchor}
          initialFocus={(panel) => panel}
          onClose={() => setOpen(false)}
          onKeyDown={(e) => {
            // Tab sale de la nota: se cierra y el foco sigue desde el botón (el panel está al final de la página).
            if (e.key !== "Tab") return;
            anchor.focus({ preventScroll: true });
            setOpen(false);
          }}
          className="w-max max-w-[min(20rem,calc(100vw-16px))] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal leading-relaxed text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          {children}
        </PopoverPanel>
      )}
    </span>
  );
}
