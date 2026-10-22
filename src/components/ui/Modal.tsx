"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/client";
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
  /** Escritorio (lg+): "left"/"right" colocan el modal en una mitad de la pantalla (pareja de modales); "center" por defecto. */
  side?: "left" | "right" | "center";
  /** Escritorio (lg+): si se pasa, muestra un «+» fuera del panel (esquina inferior derecha) que lo llama. */
  onAddSecond?: () => void;
}

/** Pila de modales abiertos (el último es el de más arriba): solo él responde a Escape y al clic en el fondo. */
const modalStack: { close: () => void }[] = [];
let scrollLocks = 0;
let savedOverflow = "";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

const SIZES = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl" };
/** Ancho máximo de cada tamaño (para combinarlo con el límite de media pantalla en lg). */
const SIZE_REM = { sm: "28rem", md: "36rem", lg: "48rem", xl: "64rem" };

const noopSubscribe = () => () => {};

export function Modal({ open, onClose, title, children, footer, size = "md", header, placement = "bottom", panelClassName, side = "center", onAddSecond }: ModalProps) {
  const t = useT();
  // El portal solo existe en el navegador: durante la hidratación se pinta como en el servidor (nada) y
  // justo después aparece. Sin esto, un modal abierto desde el primer render (?task=) daba el error #418.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
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
    const entry = { close: () => onCloseRef.current() };
    modalStack.push(entry);
    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== entry) return;
      if (e.key === "Escape" && !e.defaultPrevented) onCloseRef.current();
      else if (e.key === "Tab" && !e.defaultPrevented) {
        // Trampa de foco: Tab desde el último campo vuelve al primero (y Mayús+Tab al revés), sin salir al tablero de debajo.
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const current = document.activeElement;
        // Foco en otro diálogo (el otro modal de la pareja, el visor de imágenes): se deja al navegador.
        const otherDialog = current?.closest?.("[role=dialog]");
        if (otherDialog && !panel.contains(otherDialog) && !otherDialog.contains(panel)) return;
        if (!first || !last) return e.preventDefault();
        if (!panel.contains(current) || current === panel) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && current === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && current === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    if (scrollLocks++ === 0) savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Enfoca el primer campo, o el panel.
    requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
      (first ?? panelRef.current)?.focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      modalStack.splice(modalStack.indexOf(entry), 1);
      if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
      previous?.focus?.();
    };
  }, [open]);

  const top = placement === "top";
  if (!open || !hydrated) return null;
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center sm:items-center sm:p-4",
        top ? "items-start pt-[env(safe-area-inset-top)] sm:pt-4" : "items-end",
        // Pareja de modales: cada uno ocupa una mitad y se pega al centro (hueco total ≈ 1rem).
        side === "left" && "lg:right-1/2 lg:justify-end lg:pr-2",
        // El segundo modal no tapa al primero: solo su panel recibe clics.
        side === "right" && "lg:pointer-events-none lg:left-1/2 lg:justify-start lg:pl-2",
      )}
    >
      {/* Un solo fondo para la pareja (lo pone el modal de la izquierda o el único); cierra el de más arriba. */}
      {side !== "right" && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]"
          onMouseDown={() => (modalStack[modalStack.length - 1]?.close ?? onClose)()}
          aria-hidden
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        style={{ "--mw": SIZE_REM[size], ...(top && viewportH ? { "--vvh": `${viewportH}px` } : {}) } as React.CSSProperties}
        className={cn(
          "relative flex w-full flex-col border border-slate-200 bg-white shadow-2xl outline-none sm:rounded-2xl dark:border-slate-600/70 dark:bg-slate-900",
          top ? "max-h-[calc(var(--vvh,100dvh)-env(safe-area-inset-top))] rounded-b-2xl sm:max-h-[calc(100dvh-2rem)]" : "max-h-[92dvh] rounded-t-2xl",
          SIZES[size],
          side === "center" && onAddSecond && "lg:max-w-[min(var(--mw),calc(100vw-9rem))]", // hueco para el «+»
          // En pareja, mismo ancho los dos: juntos en el centro forman un bloque centrado.
          side !== "center" && "lg:w-[min(44rem,calc(50vw-1.5rem))] lg:max-w-none lg:pointer-events-auto",
          panelClassName,
        )}
      >
        {header ?? (
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            <button type="button" className="btn-icon" onClick={onClose} aria-label={t("Cerrar")}>
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
        {onAddSecond && side === "center" && (
          <button
            type="button"
            onClick={onAddSecond}
            className="absolute bottom-0 left-full ml-3 hidden h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-on-brand shadow-lg shadow-brand-600/30 hover:bg-brand-700 active:scale-95 lg:flex"
            aria-label={t("Abrir otra tarea nueva al lado")}
            title={t("Abrir otra tarea nueva al lado")}
          >
            <Plus size={26} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
