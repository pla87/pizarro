"use client";

import { createContext, useContext } from "react";
import type { BoardColumn, BoardTask, CardStyleValue, DeliverableOption, EditorModeValue, KindOption, LabelOption, UserOption } from "@/lib/types";

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
  taskById: Map<string, BoardTask>;
  upsertTask: (task: BoardTask) => void;
  /** Admite un parche o una función (para actualizaciones concurrentes sin perder cambios). */
  patchTask: (id: string, patch: Partial<BoardTask> | ((task: BoardTask) => Partial<BoardTask>)) => void;
  removeTask: (id: string) => void;
  setColumns: React.Dispatch<React.SetStateAction<BoardColumn[]>>;
  openTask: (id: string) => void;
  /** `evergreen`: crear la tarea como fija en la columna de la release. */
  openNewTask: (columnId?: string, evergreen?: boolean) => void;
  openRelease: (columnId: string) => void;
  selected: Set<string>;
  toggleSelected: (id: string) => void;
  /** Marca (o desmarca) de golpe varias tareas, p. ej. todas las de una columna. */
  setSelectedMany: (ids: string[], on: boolean) => void;
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
