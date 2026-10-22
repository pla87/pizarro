"use client";

import { useSyncExternalStore } from "react";

// Quién tiene abierta cada tarea (otras personas): lo alimenta el sondeo de presencia del tablero
// (Presence.tsx, cada ~20 s) y lo leen las tarjetas sin que cada una haga su propia petición.

export interface TaskViewer {
  id: string;
  name: string;
}

const EMPTY: TaskViewer[] = [];
let current: Record<string, TaskViewer[]> = {};
const listeners = new Set<() => void>();

export function setTaskViewers(next: Record<string, TaskViewer[]>): void {
  // Solo se notifica si cambia algo: el sondeo repite casi siempre lo mismo.
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTaskViewers(taskId: string): TaskViewer[] {
  return useSyncExternalStore(subscribe, () => current[taskId] ?? EMPTY, () => EMPTY);
}
