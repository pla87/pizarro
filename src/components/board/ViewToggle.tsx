"use client";

import { Columns3, List } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "../ui/cn";
import type { BoardView } from "./listSort";

/**
 * Conmutador Tablero / Lista de la cabecera: UN solo botón de icono (como el de filtros), siempre en el mismo sitio.
 * Muestra el icono de la vista a la que se cambia (en el tablero, la lista; en la lista, las columnas), que es también
 * lo que dicen su título y su etiqueta («Ver como lista» / «Ver como tablero»). Es un botón de acción: sin aria-pressed,
 * que con la etiqueta cambiante se leería de forma confusa («Ver como lista, pulsado»).
 */
export function ViewToggle({ view, onChange, className }: { view: BoardView; onChange: (v: BoardView) => void; className?: string }) {
  const t = useT();
  const toList = view === "board";
  const label = toList ? t("Ver como lista") : t("Ver como tablero");
  const Icon = toList ? List : Columns3;
  return (
    <button
      type="button"
      data-view-toggle
      aria-label={label}
      title={label}
      onClick={() => onChange(toList ? "list" : "board")}
      className={cn("btn-icon h-8 w-8 shrink-0", className)}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}
