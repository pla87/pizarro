"use client";

import { useEffect, useRef } from "react";
import { hasOpenModal, modalDepth } from "./Modal";

/**
 * Cierra un menú desplegable con Escape mientras está abierto. Escucha en captura y marca el evento:
 * si el menú está dentro de un modal, Escape cierra solo el menú y no también el modal. Con `{ yieldToModal: true }` (menús
 * que NO están dentro de un modal, como el cajón móvil) no reacciona mientras haya un Modal abierto encima: Escape cierra antes ese.
 * Tampoco reacciona si, con el menú abierto, se abre un Modal encima (una confirmación pedida desde un panel): Escape cierra
 * ese Modal y el menú sigue abierto debajo.
 */
export function useEscapeClose(open: boolean, onClose: () => void, opts: { yieldToModal?: boolean } = {}) {
  const yieldRef = useRef(opts.yieldToModal);
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
    yieldRef.current = opts.yieldToModal;
  });
  useEffect(() => {
    if (!open) return;
    // Modales que ya estaban al abrirse el menú (el que lo contiene). Se mide al terminar de montar: si el menú y su modal
    // se abren en el mismo dibujo, el efecto del menú (hijo) va antes que el del modal.
    let below = modalDepth();
    queueMicrotask(() => {
      below = modalDepth();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (yieldRef.current && hasOpenModal()) return;
      if (modalDepth() > below) return;
      e.preventDefault();
      ref.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);
}
