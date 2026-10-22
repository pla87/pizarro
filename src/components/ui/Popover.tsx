"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { useEscapeClose } from "./useEscapeClose";

export type PopoverAlign = "start" | "end";

const MARGIN = 8;
/** Elementos que reciben foco al abrir un panel con contenido libre (formularios, chips…). */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Opciones de un menú. */
export const MENU_ITEMS = '[role^="menuitem"]:not([disabled]):not([aria-disabled="true"])';

/** Elementos con foco dentro de un panel, visibles. */
function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
}

/**
 * Coloca el panel (position: fixed) junto al ancla: debajo y alineado al borde elegido; si no cabe y arriba hay más
 * sitio, lo pone encima; nunca se sale de la pantalla y, si aun así no cabe entero, se queda con scroll propio.
 */
function place(panel: HTMLElement, anchor: HTMLElement, align: PopoverAlign, gap: number, matchWidth: boolean) {
  const a = anchor.getBoundingClientRect();
  const scroll = panel.scrollTop;
  panel.style.maxHeight = "";
  if (matchWidth) panel.style.width = `${a.width}px`;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const w = panel.offsetWidth;
  const full = panel.offsetHeight;
  const below = vh - a.bottom - gap - MARGIN;
  const above = a.top - gap - MARGIN;
  const flip = full > below && above > below;
  const room = flip ? above : below;
  if (full > room) panel.style.maxHeight = `${Math.max(room, 96)}px`;
  const h = Math.min(full, Math.max(room, 96));
  const top = flip ? Math.max(MARGIN, a.top - gap - h) : a.bottom + gap;
  const left = align === "end" ? a.right - w : a.left;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.left = `${Math.round(Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - w - MARGIN)))}px`;
  panel.scrollTop = scroll;
  panel.style.visibility = "visible";
}

const HIDDEN_AT_FIRST = { position: "fixed", top: 0, left: 0, visibility: "hidden" } as const;

interface PanelProps {
  /** Elemento junto al que se coloca (el botón que lo abre, o una tarjeta). */
  anchor: HTMLElement;
  onClose: () => void;
  id?: string;
  role?: string;
  "aria-label"?: string;
  align?: PopoverAlign;
  /** Separación con el ancla, en px. */
  gap?: number;
  /** El panel mide lo mismo que el ancla. */
  matchWidth?: boolean;
  /**
   * Con fondo transparente a pantalla completa que se traga el clic de fuera (como un menú de toda la vida):
   * ese clic solo cierra. Sin él, un `pointerdown` fuera cierra y el clic llega a lo que haya debajo.
   */
  modal?: boolean;
  /** Sin `modal`: ¿un pulsar sobre el ancla cuenta como «fuera»? No si el ancla es el botón que alterna el panel. */
  anchorIsOutside?: boolean;
  /** A quién devolver el foco al cerrar (si el foco se perdió con el panel). */
  returnFocus?: HTMLElement | null;
  /** Qué enfocar al abrir. Por defecto, el primer elemento enfocable (o el panel). */
  initialFocus?: (panel: HTMLElement) => HTMLElement | null | undefined;
  /** Lo que se pulse dentro no sube a los componentes padres de React (p. ej. los atajos de una tarjeta). */
  isolate?: boolean;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}

/**
 * Panel flotante: se dibuja en el cuerpo de la página (nada lo recorta), se coloca junto al ancla, se recoloca al
 * cambiar el tamaño o hacer scroll, y se cierra con Escape o al pulsar fuera. Base de `Popover` y `Menu`; también
 * se usa suelto cuando el ancla no es un botón (selector de fecha de una tarjeta).
 */
export function PopoverPanel({
  anchor, onClose, id, role, "aria-label": label, align = "start", gap = 4, matchWidth = false, modal = true, anchorIsOutside = false,
  returnFocus, initialFocus, isolate = false, className, onKeyDown, onClick, children,
}: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const live = useRef({ onClose, initialFocus, returnFocus });
  useEffect(() => {
    live.current = { onClose, initialFocus, returnFocus };
  });
  // Escape (en captura, marcando el evento): si hay un modal debajo, no se cierra también.
  useEscapeClose(true, onClose);

  // Colocación antes de pintar (sin parpadeo) y foco inicial.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    place(panel, anchor, align, gap, matchWidth);
    const target = live.current.initialFocus ? live.current.initialFocus(panel) : (focusables(panel)[0] ?? panel);
    (target ?? panel).focus({ preventScroll: true });
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let frame = 0;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => place(panel, anchor, align, gap, matchWidth));
    };
    window.addEventListener("resize", reposition);
    // El scroll del propio panel (listas largas) no lo recoloca.
    const onScroll = (e: Event) => {
      if (!panel.contains(e.target as Node)) reposition();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, align, gap, matchWidth]);

  // Sin fondo propio: un pulsar fuera cierra.
  useEffect(() => {
    if (modal) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (!anchorIsOutside && anchor.contains(target)) return;
      live.current.onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [modal, anchor, anchorIsOutside]);

  // Al cerrar: si el foco estaba dentro (o se perdió con el panel), vuelve a donde estaba. Si el usuario
  // pasó a otro campo, ahí se queda.
  useEffect(() => {
    const panel = panelRef.current;
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body || panel?.contains(active)) live.current.returnFocus?.focus({ preventScroll: true });
    };
  }, []);

  const stop = isolate ? (e: React.SyntheticEvent) => e.stopPropagation() : undefined;
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {modal && <div className="fixed inset-0 z-[59]" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-hidden />}
      <div
        ref={panelRef}
        id={id}
        role={role}
        aria-label={label}
        tabIndex={-1}
        style={HIDDEN_AT_FIRST}
        className={cn("z-[60] overflow-y-auto outline-none", className)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          stop?.(e);
        }}
        onClick={(e) => {
          onClick?.(e);
          stop?.(e);
        }}
        onPointerDown={stop}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export interface TriggerProps {
  ref: (el: HTMLElement | null) => void;
  "aria-haspopup": "menu" | "dialog";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export interface PopoverProps {
  /** Dibuja el botón que lo abre: `trigger={({ open, props }) => <button {...props}>…</button>}`. */
  trigger: (state: { open: boolean; props: TriggerProps }) => React.ReactNode;
  children: React.ReactNode | ((api: { close: () => void }) => React.ReactNode);
  /** Controlado desde fuera (p. ej. el atajo Alt+P abre el menú de proyectos). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** «menu»: opciones con flechas (ver Menu). «dialog»: contenido libre (formularios, filtros). */
  kind?: "menu" | "dialog";
  align?: PopoverAlign;
  matchWidth?: boolean;
  /** Etiqueta accesible del panel. */
  label?: string;
  /** Clases del contenedor del botón (para el diseño de la página). */
  className?: string;
  wrapperRef?: React.Ref<HTMLDivElement>;
  /** Clases del panel: aspecto (borde, fondo, sombra, ancho…). La posición la pone el componente. */
  panelClassName?: string;
}

/**
 * Desplegable genérico: botón + panel flotante. Cierra con Escape, clic fuera, y al salir con Tab; el foco vuelve al botón.
 * `Menu` (Menu.tsx) lo usa para listas de opciones.
 */
export function Popover({ trigger, children, open: controlled, onOpenChange, kind = "dialog", align = "start", matchWidth, label, className, wrapperRef, panelClassName }: PopoverProps) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // Con qué opción empieza el foco en un menú: la primera (abierto con clic o ↓) o la última (↑).
  const [startAt, setStartAt] = useState<"first" | "last">("first");
  const panelId = useId();
  const setOpen = useCallback(
    (next: boolean) => {
      setInner(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  const isMenu = kind === "menu";

  const props: TriggerProps = {
    ref: setAnchor,
    "aria-haspopup": isMenu ? "menu" : "dialog",
    "aria-expanded": open,
    "aria-controls": open ? panelId : undefined,
    onClick: () => {
      setStartAt("first");
      setOpen(!open);
    },
    onKeyDown: (e) => {
      if (!isMenu || open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
      e.preventDefault();
      setStartAt(e.key === "ArrowUp" ? "last" : "first");
      setOpen(true);
    },
  };

  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    const panel = e.currentTarget;
    if (e.key === "Tab") {
      if (isMenu) {
        // Tab sale del menú: se cierra y el foco sigue desde el botón.
        anchor?.focus({ preventScroll: true });
        close();
        return;
      }
      // Panel libre: Tab recorre su contenido y, al salir por un extremo, lo cierra y sigue desde el botón.
      const items = focusables(panel);
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === panel)) {
        e.preventDefault();
        anchor?.focus({ preventScroll: true });
        close();
      } else if (!e.shiftKey && (current === last || current === panel)) {
        anchor?.focus({ preventScroll: true });
        close();
      }
      return;
    }
    if (!isMenu) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(MENU_ITEMS));
    if (!items.length) return;
    e.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % items.length;
    else next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    items[next]!.focus({ preventScroll: true });
  };

  return (
    <div ref={wrapperRef} className={className}>
      {trigger({ open, props })}
      {open && anchor && (
        <PopoverPanel
          anchor={anchor}
          id={panelId}
          role={isMenu ? "menu" : "dialog"}
          aria-label={label}
          align={align}
          matchWidth={matchWidth}
          returnFocus={anchor}
          onClose={close}
          className={panelClassName}
          initialFocus={isMenu ? (panel) => {
            const items = panel.querySelectorAll<HTMLElement>(MENU_ITEMS);
            return startAt === "last" ? items[items.length - 1] : items[0];
          } : undefined}
          onKeyDown={onPanelKeyDown}
          onClick={(e) => {
            // Elegir una opción cierra el menú (después de que la opción haga lo suyo).
            if (isMenu && (e.target as HTMLElement).closest(MENU_ITEMS) && !(e.target as HTMLElement).closest("[data-keep-open]")) close();
          }}
        >
          {typeof children === "function" ? children({ close }) : children}
        </PopoverPanel>
      )}
    </div>
  );
}
