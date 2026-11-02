"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * Trampa de foco de un diálogo (lo llama su keydown con Tab): Tab desde el último elemento vuelve al primero y Mayús+Tab
 * al revés, sin salir a lo que hay debajo. Con el foco en otro diálogo (el otro modal de una pareja, el visor de imágenes,
 * un modal abierto encima) no hace nada: ese diálogo se encarga.
 */
export function trapTab(e: KeyboardEvent, panel: HTMLElement | null): void {
  if (!panel) return;
  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => (el.offsetParent !== null && el.tabIndex >= 0) || el === document.activeElement);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const current = document.activeElement;
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

/**
 * Foco de un panel con `role="dialog"` que no es un Modal (el menú móvil): al abrir va a `initialRef` (o al panel), Tab no
 * sale de él y al cerrar vuelve a `returnRef` (el botón que lo abrió; en iPhone tocar un botón no lo enfoca) o, sin él,
 * a donde estaba, si sigue en la página.
 */
export function useFocusTrap(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  { initialRef, returnRef }: { initialRef?: RefObject<HTMLElement | null>; returnRef?: RefObject<HTMLElement | null> } = {},
): void {
  useEffect(() => {
    if (!open) return;
    const previous = returnRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      // Panel oculto por CSS (el menú móvil al pasar a pantalla ancha): no se atrapa nada.
      if (e.key === "Tab" && !e.defaultPrevented && panel?.getClientRects().length) trapTab(e, panel);
    };
    document.addEventListener("keydown", onKey);
    const frame = requestAnimationFrame(() => (initialRef?.current ?? panelRef.current)?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, panelRef, initialRef, returnRef]);
}
