"use client";

import { useEffect, useMemo, useRef } from "react";
import { duplicateTask, moveTask, updateTask } from "@/actions/tasks";
import { positionBetween } from "@/lib/positions";
import type { BoardColumn, BoardTask } from "@/lib/types";
import type { T } from "@/i18n/core";
import type { useToast } from "../ui/Toast";
import { focusCard } from "./shortcuts";

type Toast = ReturnType<typeof useToast>;

interface Deps {
  currentUserId: string;
  taskById: Map<string, BoardTask>;
  sortedColumns: BoardColumn[];
  /** Ids por columna, sin filtrar y en orden. */
  baseItems: Record<string, string[]>;
  patchTask: (id: string, patch: Partial<BoardTask>) => void;
  upsertTask: (task: BoardTask) => void;
  track: <R>(p: Promise<R>) => Promise<R>;
  toast: Toast;
  t: T;
}

/**
 * Acciones rápidas sobre una tarjeta (atajos de teclado en la tarjeta enfocada y «Duplicar» del diálogo).
 * Las funciones son estables y leen siempre el estado más reciente.
 */
export function useCardActions(deps: Deps) {
  const ref = useRef(deps);
  useEffect(() => {
    ref.current = deps;
  });

  return useMemo(() => {
    /** Guarda campos con cambio optimista; si el servidor lo rechaza, vuelve a como estaba. */
    const saveFields = async (id: string, patch: Parameters<typeof updateTask>[1], optimistic: Partial<BoardTask>, since?: string | null): Promise<boolean> => {
      const { taskById, patchTask, upsertTask, track, toast } = ref.current;
      const before = taskById.get(id);
      if (!before) return false;
      patchTask(id, optimistic);
      const res = await track(updateTask(id, patch, since));
      if (!res.ok) {
        upsertTask(before);
        toast(res.error, "error");
        return false;
      }
      upsertTask(res.data);
      return true;
    };

    return {
      assignToMe: async (id: string) => {
        const { taskById, currentUserId, toast, t } = ref.current;
        const task = taskById.get(id);
        if (!task) return;
        // Alterna: si ya es mía, la libera.
        const assigneeId = task.assigneeId === currentUserId ? null : currentUserId;
        if (await saveFields(id, { assigneeId }, { assigneeId })) toast(assigneeId ? t("Asignada a ti") : t("Responsable quitado"));
      },

      moveToAdjacentColumn: async (id: string, dir: -1 | 1) => {
        const { taskById, sortedColumns, baseItems, patchTask, upsertTask, track, toast, t } = ref.current;
        const task = taskById.get(id);
        if (!task) return;
        const target = sortedColumns[sortedColumns.findIndex((c) => c.id === task.columnId) + dir];
        if (!target) return;
        // Al final de la columna destino.
        const prevId = baseItems[target.id]?.at(-1) ?? null;
        const position = positionBetween(prevId ? taskById.get(prevId)?.position : null, null);
        patchTask(id, { columnId: target.id, position, evergreen: false });
        focusCard(id);
        const res = await track(moveTask(id, target.id, prevId, null));
        if (!res.ok) {
          upsertTask(task);
          focusCard(id);
          return toast(res.error, "error");
        }
        patchTask(id, { position: res.data.position });
        res.data.spawned.forEach(upsertTask);
        toast(t("Movida a «{name}»", { name: target.name }));
      },

      setDueDate: async (id: string, day: string | null) => {
        const { toast, t } = ref.current;
        if (await saveFields(id, { dueDate: day }, { dueDate: day })) toast(day ? t("Fecha límite guardada") : t("Fecha límite quitada"));
      },

      renameTask: async (id: string, title: string) => {
        const task = ref.current.taskById.get(id);
        const value = title.trim();
        if (!task || !value || value === task.title) return true;
        // `since`: si otra persona cambió el texto mientras tanto, el servidor avisa en vez de pisarlo.
        return saveFields(id, { title: value }, { title: value }, task.textVersion);
      },

      duplicateTask: async (id: string) => {
        const { upsertTask, track, toast, t } = ref.current;
        const res = await track(duplicateTask(id));
        if (!res.ok) return toast(res.error, "error");
        upsertTask(res.data);
        toast(t("Tarea duplicada"), "undo");
      },
    };
  }, []);
}
