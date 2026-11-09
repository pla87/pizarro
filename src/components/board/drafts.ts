"use client";

import { useEffect, useRef } from "react";
import type { FieldsForm } from "@/lib/fields-form";
import { clearDraft, writeDraft } from "./draft-storage";

// Almacenamiento (sin React, compartido con los borradores de comentarios): ver draft-storage.ts.
export { clearAllDrafts, readDraft } from "./draft-storage";
export { purgeExpiredCommentDrafts, readCommentDraft, saveCommentDraft, type CommentDraft } from "./draft-storage";

// Borradores locales de las tareas que se están creando o editando: se guardan cada 5 s en el
// navegador (por usuario y proyecto). Si la página se cierra sin cancelar ni guardar, al volver
// al tablero se reabre el modal con lo escrito. Cerrar el modal (cancelar o guardar) los borra.

const SAVE_MS = 5000;

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
  /** Campos opcionales activados (coste, horas, prioridad, cliente, inicio). */
  fields?: FieldsForm;
}

export interface EditTaskDraft {
  taskId: string;
  /** Título escrito y no guardado (si difiere del de la tarea). */
  title?: string;
  /** Descripción en edición (si se estaba editando). */
  description?: string;
  /**
   * Versión del texto sobre la que se escribió (TaskDetail.textVersion). Al recuperar el borrador se guarda contra ella:
   * si otra persona cambió el texto entretanto, se avisa del conflicto en vez de pisar su cambio.
   */
  base?: string | null;
}

export const draftKey = (kind: "new" | "edit", userId: string, projectId: string) => `pz-draft-${kind}:${userId}:${projectId}`;

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
