"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronDown, Loader2 } from "lucide-react";
import { useId } from "react";
import { Menu, MenuItem } from "../ui/Menu";

/**
 * Botón de acción de una columna con rol especial («Generar release», «Generar plan de trabajo», «Publicar programa
 * (PDF)», «PDF de la semana»…), bajo la cabecera y a todo el ancho. Todas las columnas especiales lo muestran con el
 * mismo aspecto (el botón principal de la app, en claro y en oscuro); su acción también está en el menú de la columna.
 */
const CLASS = "btn-primary w-full py-1.5";
/**
 * Desactivado «a medias» (aria-disabled, no `disabled`): se ve apagado y el lector de pantalla lo anuncia, y sigue en el
 * orden de Tab. Tocarlo no hace nada: el motivo ya está a la vista bajo él (OffReason). Antes salía además como aviso
 * rojo, que repetía lo que ya se leía debajo.
 */
export const OFF = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/**
 * El motivo de un botón apagado, a la vista bajo él y como su descripción accesible (`aria-describedby`): solo con el
 * `title`, en el móvil no se veía y sin pasar el ratón nadie sabía por qué estaba apagado («PDF de la semana» con la
 * columna vacía).
 */
function OffReason({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return <p id={id} data-column-action-reason className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">{text}</p>;
}

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
  const reasonId = useId();
  const off = disabled && !busy;
  return (
    <div className="px-2 pb-1.5" data-column-action>
      <button
        type="button"
        className={`${CLASS} ${OFF} aria-busy:cursor-progress`}
        onClick={busy || disabled ? undefined : onClick}
        aria-disabled={off ? true : undefined}
        aria-busy={busy || undefined}
        aria-describedby={off && title ? reasonId : undefined}
        title={title}
      >
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Icon size={15} />} {label}
      </button>
      {off && <OffReason id={reasonId} text={title} />}
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
  const reasonId = useId();
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
        <button type="button" className={`${CLASS} ${OFF}`} title={title} aria-disabled aria-describedby={title ? reasonId : undefined}>
          <Icon size={15} /> {label} <ChevronDown size={14} className="opacity-80" />
        </button>
        <OffReason id={reasonId} text={title} />
      </div>
    );
  }
  return (
    <div className="px-2 pb-1.5" data-column-action>
      {/* El panel va en un portal con `position: fixed` (Popover): su ancho se toma del botón (`matchWidth`), nunca con
          `w-full`, que ahí es el ancho de la ventana (en una ventana muy ancha salía una franja de lado a lado, pegada a la
          izquierda, encima de la barra lateral). */}
      <Menu
        align="start"
        label={label}
        matchWidth
        className="relative"
        panelClassName="min-w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
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
