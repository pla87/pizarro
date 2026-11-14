"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { Menu, MenuItem } from "../ui/Menu";
import { useToast } from "../ui/Toast";

/**
 * Botón de acción de una columna con rol especial («Generar Release», «Generar plan de trabajo», «Publicar programa
 * (PDF)», «PDF de la semana»…), bajo la cabecera y a todo el ancho. Todas las columnas especiales lo muestran con el
 * mismo aspecto (el botón principal de la app, en claro y en oscuro); su acción también está en el menú de la columna.
 */
const CLASS = "btn-primary w-full py-1.5";
/**
 * Desactivado «a medias» (aria-disabled, no `disabled`): se ve apagado y el lector de pantalla lo anuncia, pero se puede
 * tocar y entonces el motivo (el `title`, que en el móvil no se ve) sale como aviso, como el «+» flotante con el programa lleno.
 */
const OFF = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

export function ColumnActionButton({ icon: Icon, label, onClick, disabled, title }: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const toast = useToast();
  return (
    <div className="px-2 pb-1.5" data-column-action>
      <button type="button" className={`${CLASS} ${OFF}`} onClick={disabled ? () => title && toast(title, "error") : onClick} aria-disabled={disabled ? true : undefined} title={title}>
        <Icon size={15} /> {label}
      </button>
    </div>
  );
}

/** Igual, pero con varias opciones (p. ej. el PDF de la semana por día o por persona): abre un menú con ellas. */
export function ColumnActionMenu({ icon: Icon, label, title, items, disabled }: {
  icon: LucideIcon;
  label: string;
  title?: string;
  disabled?: boolean;
  items: { label: string; icon: LucideIcon; onClick: () => void }[];
}) {
  const toast = useToast();
  if (disabled) {
    return (
      <div className="px-2 pb-1.5" data-column-action>
        <button type="button" className={`${CLASS} ${OFF}`} title={title} aria-disabled onClick={() => title && toast(title, "error")}>
          <Icon size={15} /> {label} <ChevronDown size={14} className="opacity-80" />
        </button>
      </div>
    );
  }
  return (
    <div className="px-2 pb-1.5" data-column-action>
      <Menu
        align="start"
        label={label}
        className="relative"
        panelClassName="w-full min-w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        trigger={({ props }) => (
          <button type="button" className={CLASS} title={title} {...props}>
            <Icon size={15} /> {label} <ChevronDown size={14} className="opacity-80" />
          </button>
        )}
      >
        {items.map((item) => <MenuItem key={item.label} icon={item.icon} onClick={item.onClick}>{item.label}</MenuItem>)}
      </Menu>
    </div>
  );
}
