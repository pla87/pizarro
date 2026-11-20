"use client";

import { useSyncExternalStore } from "react";

// Quién tiene abierta cada tarea (otras personas): lo alimenta el canal en vivo del tablero (evento `presence`) o, sin
// él, el sondeo de presencia (Presence.tsx, cada ~60 s), y lo leen las tarjetas y el detalle sin hacer su propia petición.

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

// Id del canal en vivo abierto ahora por el tablero (lo da su saludo): el detalle de una tarea lo usa para anunciarla una
// sola vez en vez de repetir el aviso. null sin canal.
let liveStream: string | null = null;
const streamListeners = new Set<() => void>();

export function setLiveStream(id: string | null): void {
  if (id === liveStream) return;
  liveStream = id;
  streamListeners.forEach((l) => l());
}

function subscribeStream(listener: () => void) {
  streamListeners.add(listener);
  return () => {
    streamListeners.delete(listener);
  };
}

export function useLiveStream(): string | null {
  return useSyncExternalStore(subscribeStream, () => liveStream, () => null);
}
