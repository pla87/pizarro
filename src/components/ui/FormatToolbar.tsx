"use client";

import { MoreHorizontal } from "lucide-react";
import { createElement, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "./cn";

/** Botón de la barra de formato: `title` en español (con el atajo entre paréntesis) y `secondary` si en móvil va en «Más formatos». */
export interface FormatItem {
  title: string;
  icon: LucideIcon;
  pressed?: boolean;
  secondary?: boolean;
  run: () => void;
}

/** `null` separa grupos de botones. */
export type FormatItems = (FormatItem | null)[];

/**
 * Barra de formato compartida por el editor con barra (TipTap) y por el modo Markdown. Los botones quedan fuera del orden
 * de Tab (Título → descripción directo): se alcanzan con Alt+F10 y las flechas, o con el ratón. Tab o Escape devuelven el
 * foco al texto (`onLeave`). En móvil los botones secundarios se esconden tras «Más formatos».
 */
export function FormatToolbar({ items, onLeave, className }: { items: FormatItems; onLeave: () => void; className?: string }) {
  const t = useT();
  const [more, setMore] = useState(false);
  const hide = (secondary?: boolean) => (secondary && !more ? "hidden sm:inline-flex" : "");
  return (
    <div
      role="toolbar"
      aria-label={t("Formato")}
      className={cn("flex flex-wrap items-center gap-0.5", className)}
      onKeyDown={(e) => {
        // Se recorren solo los botones visibles (los secundarios están ocultos en móvil mientras no se despliegan).
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.offsetParent !== null);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          buttons[(index + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]!.focus();
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          buttons[e.key === "Home" ? 0 : buttons.length - 1]!.focus();
        } else if (e.key === "Escape" || (e.key === "Tab" && !e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          onLeave();
        }
      }}
    >
      {items.map((b, i) =>
        b === null ? (
          <span key={i} className={cn("mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700", items[i + 1]?.secondary && !more && "hidden sm:block")} aria-hidden />
        ) : (
          <button
            key={b.title}
            type="button"
            title={t(b.title)}
            aria-label={t(b.title).replace(/ \(.*\)$/, "")}
            aria-pressed={b.pressed === undefined ? undefined : b.pressed}
            tabIndex={-1}
            // mousedown no debe quitar el foco al texto
            onMouseDown={(e) => e.preventDefault()}
            onClick={b.run}
            className={cn("btn-icon h-7 w-7", hide(b.secondary), b.pressed && "bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100")}
          >
            {createElement(b.icon, { size: 15 })}
          </button>
        ),
      )}
      <button
        type="button"
        title={t("Más formatos")}
        aria-label={t("Más formatos")}
        aria-expanded={more}
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMore((m) => !m)}
        className={cn("btn-icon h-7 w-7 sm:hidden", more && "bg-slate-100 dark:bg-slate-800")}
      >
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
}
