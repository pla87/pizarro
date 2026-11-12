"use client";

import { useEffect, useRef } from "react";
import { takeEarlyShortcut } from "./earlyShortcut";
import { dialogOpen, isTypingTarget, OPEN_PROJECT_MENU_EVENT } from "./shortcuts";

export interface BoardShortcutHandlers {
  /** Alt+N: nueva tarea (o segunda tarea al lado si hay un modal de tarea abierto). */
  newTask: () => void;
  /** Alt+Shift+N: varias tareas (o «Varias tareas» al lado si hay un modal de tarea abierto). */
  bulk: () => void;
  /** «/» */
  search: () => void;
  /** «?» */
  help: () => void;
  /** Alt+R */
  release: () => void;
}

/**
 * Atajos de teclado del tablero (escritorio). Se usa `e.code` con `altKey` porque en Mac Option+letra
 * produce otro carácter; con Ctrl/⌘ pulsados no se dispara nada. Los atajos de una tecla (/, ?) y los
 * de Alt ignoran los campos de texto, salvo Alt+N y Alt+Shift+N dentro de un modal (para abrir el segundo al lado).
 * Alt+S/Alt+A (diálogos de tarea), Alt+Z y Alt+Shift+Z (UndoButton) y los de la tarjeta enfocada (Alt+M, Alt+←/→, Alt+D,
 * Alt+Shift+D, F2; en TaskCard) viven junto a lo que accionan.
 */
export function useBoardShortcuts(handlers: BoardShortcutHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    // Alt+N o Alt+Mayús+N pulsados antes de hidratar la página (ver earlyShortcut.ts): se ejecutan ahora.
    const early = takeEarlyShortcut();
    // Táctil: sin teclado físico no hay atajos.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (early === "new") ref.current.newTask();
    else if (early === "bulk") ref.current.bulk();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.isComposing) return;
      const typing = isTypingTarget(e.target);
      const open = dialogOpen();
      const h = ref.current;

      if (e.altKey) {
        if (e.repeat) return;
        if (e.code === "KeyN") {
          if (typing && !open) return;
          e.preventDefault();
          // Con un diálogo de tarea abierto, los dos abren su hueco al lado (como los botones de junto al diálogo).
          if (e.shiftKey) h.bulk();
          else h.newTask();
        } else if (e.shiftKey || typing || open) {
          return;
        } else if (e.code === "KeyP") {
          e.preventDefault();
          window.dispatchEvent(new Event(OPEN_PROJECT_MENU_EVENT));
        } else if (e.code === "KeyR") {
          e.preventDefault();
          h.release();
        }
        return;
      }

      if (typing || open) return;
      if (e.key === "/") {
        e.preventDefault();
        h.search();
      } else if (e.key === "?") {
        e.preventDefault();
        h.help();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
