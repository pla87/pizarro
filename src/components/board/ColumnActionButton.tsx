"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Menu, MenuItem } from "../ui/Menu";
import { useToast } from "../ui/Toast";

/**
 * Botón de acción de una columna con rol especial («Generar release», «Generar plan de trabajo», «Publicar programa
 * (PDF)», «PDF de la semana»…), bajo la cabecera y a todo el ancho. Todas las columnas especiales lo muestran con el
 * mismo aspecto (el botón principal de la app, en claro y en oscuro); su acción también está en el menú de la columna.
 */
const CLASS = "btn-primary w-full py-1.5";
/**
 * Desactivado «a medias» (aria-disabled, no `disabled`): se ve apagado y el lector de pantalla lo anuncia, pero se puede
 * tocar y entonces el motivo (el `title`, que en el móvil no se ve) sale como aviso, como el «+» flotante con el programa lleno.
 */
const OFF = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/**
 * `busy`: la acción está en curso (p. ej. generando un PDF): el icono gira y el botón no hace nada hasta que acabe. Se ve
 * ocupado, no desactivado: sin `aria-disabled` (su opacidad y su cursor de prohibido ganarían a los de `aria-busy`).
 */
export function ColumnActionButton({ icon: Icon, label, onClick, disabled, title, busy }: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  busy?: boolean;
}) {
  const toast = useToast();
  return (
    <div className="px-2 pb-1.5" data-column-action>
      <button
        type="button"
        className={`${CLASS} ${OFF} aria-busy:cursor-progress`}
        onClick={busy ? undefined : disabled ? () => title && toast(title, "error") : onClick}
        aria-disabled={disabled && !busy ? true : undefined}
        aria-busy={busy || undefined}
        title={title}
      >
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Icon size={15} />} {label}
      </button>
    </div>
  );
}

/**
 * Igual, pero con varias opciones (p. ej. el PDF de la semana por día o por persona): abre un menú con ellas. `busy`: una
 * de ellas está en curso; el icono gira y el botón no abre el menú hasta que acabe.
 */
export function ColumnActionMenu({ icon: Icon, label, title, items, disabled, busy }: {
  icon: LucideIcon;
  label: string;
  title?: string;
  disabled?: boolean;
  busy?: boolean;
  items: { label: string; icon: LucideIcon; onClick: () => void }[];
}) {
  const toast = useToast();
  if (busy) {
    return (
      <div className="px-2 pb-1.5" data-column-action>
        <button type="button" className={`${CLASS} cursor-progress`} title={title} aria-busy>
          <Loader2 size={15} className="animate-spin" aria-hidden /> {label}
        </button>
      </div>
    );
  }
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
