"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { useBackToClose } from "./useBackToClose";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Contenido que reemplaza la cabecera estándar. */
  header?: React.ReactNode;
  /** En móvil: "bottom" (por defecto) es una hoja inferior; "top" ancla el panel arriba para que el teclado no lo tape. */
  placement?: "bottom" | "top";
  /** Clases extra para el panel (p. ej. una altura fija en escritorio). */
  panelClassName?: string;
}

const SIZES = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl" };

export function Modal({ open, onClose, title, children, footer, size = "md", header, placement = "bottom", panelClassName }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useBackToClose(open, () => onCloseRef.current());

  // Con placement "top", la altura sigue al viewport visual: se encoge al abrir el teclado.
  const [viewportH, setViewportH] = useState<number | null>(null);
  useEffect(() => {
    if (!open || placement !== "top") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => setViewportH(Math.round(vv.height));
    sync();
    vv.addEventListener("resize", sync);
    return () => vv.removeEventListener("resize", sync);
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    // Enfoca el primer campo, o el panel.
    requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
      (first ?? panelRef.current)?.focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  const top = placement === "top";
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center sm:items-center sm:p-4",
        top ? "items-start pt-[env(safe-area-inset-top)] sm:pt-4" : "items-end",
      )}
    >
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onMouseDown={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        style={top && viewportH ? ({ "--vvh": `${viewportH}px` } as React.CSSProperties) : undefined}
        className={cn(
          "relative flex w-full flex-col bg-white shadow-2xl outline-none sm:rounded-2xl dark:bg-slate-900",
          top ? "max-h-[calc(var(--vvh,100dvh)-env(safe-area-inset-top))] rounded-b-2xl sm:max-h-[calc(100dvh-2rem)]" : "max-h-[92dvh] rounded-t-2xl",
          SIZES[size],
          panelClassName,
        )}
      >
        {header ?? (
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar">
              <X size={18} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
