"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { BoardColumn, BoardTask, CardStyleValue, DeliverableOption, EditorModeValue, KindOption, LabelOption, UserOption } from "@/lib/types";

import { countSelected, tasksById, type BoardStores } from "./stores";

/**
 * Contexto estable del tablero: datos casi estáticos y funciones. NO cambia al seleccionar ni al editar una tarea,
 * así que usarlo no obliga a redibujar. El estado rápido va aparte: `useTask(id)`, `useIsSelected(id)`, etc.
 */
export interface BoardApi {
  project: { id: string; name: string };
  users: UserOption[];
  currentUserId: string;
  columns: BoardColumn[];
  labels: LabelOption[];
  deliverables: DeliverableOption[];
  kinds: KindOption[];
  kindById: Map<string, KindOption>;
  cardStyle: CardStyleValue;
  editorMode: EditorModeValue;
  /** Táctil: las tarjetas se arrastran solo desde su asa. */
  dragHandle: boolean;
  google: { enabled: boolean; connected: boolean };
  today: string;
  setLabels: React.Dispatch<React.SetStateAction<LabelOption[]>>;
  /** Almacenes del estado rápido (tareas y selección); se leen con los hooks del final de este archivo. */
  stores: BoardStores;
  /** Lectura puntual (en manejadores, no al dibujar): una tarea por id o todas. Para dibujar, `useTask`. */
  getTask: (id: string) => BoardTask | undefined;
  getTasks: () => BoardTask[];
  upsertTask: (task: BoardTask) => void;
  /** Admite un parche o una función (para actualizaciones concurrentes sin perder cambios). */
  patchTask: (id: string, patch: Partial<BoardTask> | ((task: BoardTask) => Partial<BoardTask>)) => void;
  removeTask: (id: string) => void;
  setColumns: React.Dispatch<React.SetStateAction<BoardColumn[]>>;
  openTask: (id: string) => void;
  /** `evergreen`: crear la tarea como fija en la columna de la release. */
  openNewTask: (columnId?: string, evergreen?: boolean) => void;
  openRelease: (columnId: string) => void;
  /** Selección actual, lectura puntual. Para dibujar, `useIsSelected` / `useSelectionSize`. */
  getSelected: () => ReadonlySet<string>;
  clearSelection: () => void;
  toggleSelected: (id: string) => void;
  /** Marca (o desmarca) de golpe varias tareas, p. ej. todas las de una columna. */
  setSelectedMany: (ids: string[], on: boolean) => void;
  /** Atajos de tarjeta (ver cardActions.ts): cada uno hace el cambio optimista, avisa y deshace si falla. */
  assignToMe: (id: string) => void;
  moveToAdjacentColumn: (id: string, dir: -1 | 1) => void;
  setDueDate: (id: string, day: string | null) => Promise<void>;
  /** `true` si se guardó (o no hacía falta). */
  renameTask: (id: string, title: string) => Promise<boolean>;
  duplicateTask: (id: string) => Promise<void>;
  /** Marca una mutación en curso (evita que un refresco pise el estado optimista). */
  track: <T>(p: Promise<T>) => Promise<T>;
  /** Como `track`, pero deja pasar las excepciones (subidas de archivos). */
  trackRaw: <T>(p: Promise<T>) => Promise<T>;
  refresh: () => void;
}

export const BoardContext = createContext<BoardApi | null>(null);

export function useBoard(): BoardApi {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error("useBoard fuera de <Board>");
  return ctx;
}

/** La tarea con ese id; el componente solo se redibuja cuando cambia ESA tarea. */
export function useTask(id: string): BoardTask | undefined {
  const { stores } = useBoard();
  const snapshot = () => tasksById(stores.tasks.get()).get(id);
  return useSyncExternalStore(stores.tasks.subscribe, snapshot, snapshot);
}

/** Lista completa de tareas (se redibuja con cualquier cambio: solo para paneles que la necesitan entera). */
export function useTasks(): BoardTask[] {
  const { stores } = useBoard();
  return useSyncExternalStore(stores.tasks.subscribe, stores.tasks.get, stores.tasks.get);
}

/** ¿Está seleccionada esta tarjeta? Solo se redibuja la tarjeta cuyo estado cambia. */
export function useIsSelected(id: string): boolean {
  const { stores } = useBoard();
  const snapshot = () => stores.selection.get().has(id);
  return useSyncExternalStore(stores.selection.subscribe, snapshot, () => false);
}

/** Cuántas tarjetas hay seleccionadas. */
export function useSelectionSize(): number {
  const { stores } = useBoard();
  const snapshot = () => stores.selection.get().size;
  return useSyncExternalStore(stores.selection.subscribe, snapshot, () => 0);
}

/** Cuántos de estos ids están seleccionados (cabecera de columna). */
export function useSelectedCount(ids: string[]): number {
  const { stores } = useBoard();
  const snapshot = () => countSelected(stores.selection.get(), ids);
  return useSyncExternalStore(stores.selection.subscribe, snapshot, () => 0);
}
