"use client";

import { Popover, type PopoverProps } from "./Popover";
import { cn } from "./cn";

/**
 * Menú desplegable de opciones (`role="menu"`). Botón + panel flotante (ver Popover): debajo del botón o encima si
 * no cabe, sin recortes; al abrir, el foco va a la primera opción; ↑ ↓ Inicio Fin recorren las opciones; Escape y
 * Tab lo cierran (el foco vuelve al botón); elegir una opción lo cierra, salvo las marcadas con `data-keep-open`.
 *
 *   <Menu trigger={({ open, props }) => <button {...props}>…</button>} panelClassName="w-64 rounded-lg border …">
 *     <MenuItem icon={Pencil} onClick={rename}>Renombrar</MenuItem>
 *   </Menu>
 *
 * Las opciones llevan `role="menuitem"` (o menuitemradio / menuitemcheckbox); los enlaces también pueden serlo.
 */
export function Menu(props: Omit<PopoverProps, "kind">) {
  return <Popover {...props} kind="menu" />;
}

interface MenuItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "role"> {
  icon?: React.ComponentType<{ size?: number }>;
  danger?: boolean;
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox";
}

/** Opción de menú con el aspecto estándar (icono opcional; `danger` en rojo). */
export function MenuItem({ icon: Icon, danger, role = "menuitem", className, children, ...rest }: MenuItemProps) {
  return (
    <button
      type="button"
      role={role}
      tabIndex={-1}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800",
        danger && "text-red-600",
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={15} />} {children}
    </button>
  );
}

/** Línea que separa grupos de opciones. */
export function MenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn("my-1 border-t border-slate-200 dark:border-slate-800", className)} />;
}
