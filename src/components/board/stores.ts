import { useState } from "react";
import type { BoardTask } from "@/lib/types";

/**
 * Almacén externo mínimo (para useSyncExternalStore): guarda un valor inmutable y avisa a quien se suscribe.
 * Sirve para el estado que cambia a menudo (tareas, selección): cada componente se suscribe solo a su trozo
 * y el tablero entero no se vuelve a dibujar.
 */
export interface Store<T> {
  get: () => T;
  /** Admite un valor o una función del valor anterior. No avisa si el resultado es el mismo objeto. */
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      const v = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
      if (Object.is(v, value)) return;
      value = v;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Los dos almacenes del tablero: lista de tareas y selección. */
export interface BoardStores {
  tasks: Store<BoardTask[]>;
  selection: Store<ReadonlySet<string>>;
}

export function createBoardStores(tasks: BoardTask[]): BoardStores {
  return { tasks: createStore(tasks), selection: createStore<ReadonlySet<string>>(new Set()) };
}

// Índice por id de una lista de tareas; se calcula una vez por lista (la lista es inmutable).
const maps = new WeakMap<BoardTask[], Map<string, BoardTask>>();
export function tasksById(list: BoardTask[]): Map<string, BoardTask> {
  let map = maps.get(list);
  if (!map) {
    map = new Map(list.map((t) => [t.id, t]));
    maps.set(list, map);
  }
  return map;
}

const sameTask = (a: BoardTask, b: BoardTask) => {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  return keys.every((k) => {
    const p = x[k];
    const q = y[k];
    if (p === q) return true;
    return Array.isArray(p) && Array.isArray(q) && p.length === q.length && p.every((v, i) => v === q[i]);
  });
};

/**
 * Datos nuevos del servidor sobre la lista actual: las tareas que no han cambiado conservan su objeto
 * (así sus tarjetas no se redibujan en cada refresco) y, si no cambió ninguna, se devuelve la misma lista.
 */
export function mergeTasks(prev: BoardTask[], next: BoardTask[]): BoardTask[] {
  const old = tasksById(prev);
  const merged = next.map((t) => {
    const before = old.get(t.id);
    return before && sameTask(before, t) ? before : t;
  });
  return merged.length === prev.length && merged.every((t, i) => t === prev[i]) ? prev : merged;
}

/**
 * Devuelve el mismo objeto mientras el valor nuevo sea igual (por contenido) al anterior: los datos que llegan
 * del servidor en cada refresco son objetos nuevos aunque no hayan cambiado, y no deben invalidar el contexto.
 */
export function useStableValue<T>(value: T): T {
  const [stable, setStable] = useState(value);
  if (stable === value) return stable;
  if (JSON.stringify(stable) === JSON.stringify(value)) return stable;
  setStable(value);
  return value;
}

/** Cuántos de `ids` están en la selección. */
export function countSelected(selection: ReadonlySet<string>, ids: string[]): number {
  if (selection.size === 0) return 0;
  let n = 0;
  for (const id of ids) if (selection.has(id)) n++;
  return n;
}
