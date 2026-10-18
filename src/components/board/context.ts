"use client";

import { createContext, useContext } from "react";
import type { BoardColumn, BoardTask, LabelOption, UserOption } from "@/lib/types";

export interface BoardApi {
  project: { id: string; name: string };
  users: UserOption[];
  currentUserId: string;
  columns: BoardColumn[];
  labels: LabelOption[];
  setLabels: React.Dispatch<React.SetStateAction<LabelOption[]>>;
  taskById: Map<string, BoardTask>;
  upsertTask: (task: BoardTask) => void;
  patchTask: (id: string, patch: Partial<BoardTask>) => void;
  removeTask: (id: string) => void;
  setColumns: React.Dispatch<React.SetStateAction<BoardColumn[]>>;
  openTask: (id: string) => void;
  openNewTask: (columnId?: string) => void;
  openRelease: (columnId: string) => void;
  selected: Set<string>;
  toggleSelected: (id: string) => void;
  /** Marca una mutación en curso (evita que un refresco pise el estado optimista). */
  track: <T>(p: Promise<T>) => Promise<T>;
  refresh: () => void;
}

export const BoardContext = createContext<BoardApi | null>(null);

export function useBoard(): BoardApi {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error("useBoard fuera de <Board>");
  return ctx;
}
