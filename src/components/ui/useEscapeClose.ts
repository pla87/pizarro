"use client";

import { useEffect, useRef } from "react";

/**
 * Cierra un menú desplegable con Escape mientras está abierto. Escucha en captura y marca el evento:
 * si el menú está dentro de un modal, Escape cierra solo el menú y no también el modal.
 */
export function useEscapeClose(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      ref.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);
}
