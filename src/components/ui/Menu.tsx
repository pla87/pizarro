"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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
 * Las opciones llevan `role="menuitem"` (o menuitemradio / menuitemcheckbox); los enlaces también pueden serlo. Un grupo
 * largo de opciones va en un submenú (`MenuSub`): ↑ ↓ recorren solo el nivel en el que está el foco.
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
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800",
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

/**
 * Submenú dentro de un menú: una opción «Etiqueta (resumen) ›» que despliega sus opciones debajo, dentro del mismo panel
 * (así funciona igual con ratón, teclado y en el móvil, y nunca se sale de la pantalla). Es un `menuitem` con
 * `aria-haspopup="menu"` y `aria-expanded`; las opciones van en un `role="menu"` propio. Teclado: → o Intro lo abren y
 * llevan el foco a la opción marcada (o a la primera); ← o Escape lo cierran y devuelven el foco a la opción del submenú
 * (Escape no cierra el menú entero mientras el submenú está abierto); elegir una opción cierra el menú.
 */
export function MenuSub({ icon: Icon, label, summary, className, children }: {
  icon?: React.ComponentType<{ size?: number }>;
  label: string;
  /** Lo que se ve a la derecha de la etiqueta (p. ej. la opción elegida); forma parte del nombre accesible. */
  summary?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const items = list ? Array.from(list.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled]):not([aria-disabled="true"])')) : [];
    (items.find((el) => el.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
    // Escape cierra antes el submenú: en captura sobre window (antes que el cierre del panel, que escucha en document).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <div data-menu-sub>
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        // No cierra el menú: abre o cierra el submenú.
        data-keep-open
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800",
          open && "bg-slate-50 dark:bg-slate-800/60",
          className,
        )}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" && !open) {
            e.preventDefault();
            setOpen(true);
          } else if (e.key === "ArrowLeft" && open) {
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        {Icon && <Icon size={15} />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {summary != null && <span className="max-w-[45%] truncate text-xs text-slate-500 dark:text-slate-400">{summary}</span>}
        <ChevronRight size={15} aria-hidden className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div
          ref={listRef}
          id={id}
          role="menu"
          aria-label={label}
          className="ml-2 border-l border-slate-200 pl-1 dark:border-slate-700"
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft") return;
            e.preventDefault();
            close();
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
