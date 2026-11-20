"use client";

import { Columns3, List } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "../ui/cn";
import type { BoardView } from "./listSort";

/**
 * Conmutador Tablero / Lista de la cabecera: UN solo botón de icono (como el de filtros), siempre en el mismo sitio.
 * Es un botón de alternar: su nombre no cambia («Ver como lista») y `aria-pressed` dice si la lista está puesta (un
 * lector de pantalla lee «Ver como lista, pulsado» en la lista). El icono es el de la vista a la que se pasa (en el
 * tablero, la lista; en la lista, las columnas) y el título, lo que hace al pulsarlo.
 */
export function ViewToggle({ view, onChange, className }: { view: BoardView; onChange: (v: BoardView) => void; className?: string }) {
  const t = useT();
  const toList = view === "board";
  const Icon = toList ? List : Columns3;
  return (
    <button
      type="button"
      data-view-toggle
      aria-label={t("Ver como lista")}
      aria-pressed={!toList}
      title={toList ? t("Ver como lista") : t("Ver como tablero")}
      onClick={() => onChange(toList ? "list" : "board")}
      className={cn("btn-icon h-8 w-8 shrink-0", className)}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}
