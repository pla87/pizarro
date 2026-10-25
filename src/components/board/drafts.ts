"use client";

import { useEffect, useRef } from "react";

// Borradores locales de las tareas que se están creando o editando: se guardan cada 5 s en el
// navegador (por usuario y proyecto). Si la página se cierra sin cancelar ni guardar, al volver
// al tablero se reabre el modal con lo escrito. Cerrar el modal (cancelar o guardar) los borra.

const SAVE_MS = 5000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface NewTaskDraft {
  title: string;
  kindId: string;
  description: string;
  columnId: string;
  assigneeId: string;
  dueDate: string;
  deliverableId: string;
  evergreen: boolean;
  subtasks: string[];
  subtaskDraft: string;
  /** Proyecto elegido en el diálogo (si no es el del tablero). */
  projectId?: string;
}

export interface EditTaskDraft {
  taskId: string;
  /** Título escrito y no guardado (si difiere del de la tarea). */
  title?: string;
  /** Descripción en edición (si se estaba editando). */
  description?: string;
}

export const draftKey = (kind: "new" | "edit", userId: string, projectId: string) => `pz-draft-${kind}:${userId}:${projectId}`;

/** Borra todos los borradores locales (`pz-draft-*`); las preferencias de filtros del tablero se conservan. */
export function clearAllDrafts(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("pz-draft-")) localStorage.removeItem(key);
  } catch {
    // Sin acceso a localStorage no hay borradores que borrar.
  }
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw) as { at: number; value: T };
    if (Date.now() - at > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function writeDraft(key: string, value: unknown): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Sin almacenamiento (modo privado, cuota): no hay borrador.
  }
}

function clearDraft(key: string): void {
  writeDraft(key, null);
}

/**
 * Guarda `get()` cada 5 s y al ocultar o cerrar la página (null = nada que guardar, se borra;
 * undefined = este modal no guarda borrador).
 * Devuelve una función que borra el borrador y detiene el guardado (para cancelar o guardar).
 */
export function useDraftAutosave(key: string, get: () => unknown): () => void {
  const getter = useRef(get);
  const stopped = useRef(false);
  useEffect(() => {
    getter.current = get;
  });
  useEffect(() => {
    stopped.current = false;
    const save = () => {
      const value = getter.current();
      if (!stopped.current && value !== undefined) writeDraft(key, value);
    };
    const timer = setInterval(save, SAVE_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      // Al cerrarse el modal por otra vía (tarea borrada o archivada, cambio de página) se guarda
      // el estado final: si no queda nada pendiente, el borrador desaparece.
      save();
      clearInterval(timer);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [key]);
  return () => {
    stopped.current = true;
    clearDraft(key);
  };
}
