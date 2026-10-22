"use client";

import { useSyncExternalStore } from "react";

// Contexto del deshacer: con una tarea abierta, deshacer actúa solo sobre esa tarea.
// Lo fija el diálogo de la tarea al abrirse y lo quita al cerrarse.

let openTaskId: string | null = null;
const listeners = new Set<() => void>();

export function setUndoTask(taskId: string | null): void {
  if (openTaskId === taskId) return;
  openTaskId = taskId;
  for (const l of listeners) l();
}

export function useUndoTask(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => openTaskId,
    () => null,
  );
}

/** Aviso a la tarea abierta de que se ha deshecho algo suyo (para que recargue su detalle). */
export const UNDONE_EVENT = "pz:undone";

// Hay un diálogo de tarea (nueva o existente) abierto en el tablero: los botones de la cabecera
// (deshacer, «Nueva tarea») se dibujan encima del fondo difuminado. Lo fija el tablero.
let boardModalOpen = false;

export function setBoardModalOpen(open: boolean): void {
  if (boardModalOpen === open) return;
  boardModalOpen = open;
  for (const l of listeners) l();
}

export function useBoardModalOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => boardModalOpen,
    () => false,
  );
}
