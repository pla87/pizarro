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
  getTask: (id: string) => BoardTask | undefined;
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
      const { getTask, patchTask, upsertTask, track, toast } = ref.current;
      const before = getTask(id);
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
      /** Cadencia de una tarea fija (1 = todas, 2 = cada dos, 3 = cada tres releases). */
      setEvergreenEvery: async (id: string, every: number) => {
        await saveFields(id, { evergreenEvery: every }, { evergreenEvery: every });
      },
      assignToMe: async (id: string) => {
        const { getTask, currentUserId, toast, t } = ref.current;
        const task = getTask(id);
        if (!task) return;
        // Alterna: si ya es mía, la libera.
        const assigneeId = task.assigneeId === currentUserId ? null : currentUserId;
        if (await saveFields(id, { assigneeId }, { assigneeId })) toast(assigneeId ? t("Asignada a ti") : t("Responsable quitado"));
      },

      moveToAdjacentColumn: async (id: string, dir: -1 | 1) => {
        const { getTask, sortedColumns, baseItems, patchTask, upsertTask, track, toast, t } = ref.current;
        const task = getTask(id);
        if (!task) return;
        const target = sortedColumns[sortedColumns.findIndex((c) => c.id === task.columnId) + dir];
        if (!target) return;
        // Al final de la columna destino.
        const prevId = baseItems[target.id]?.at(-1) ?? null;
        const position = positionBetween(prevId ? getTask(prevId)?.position : null, null);
        patchTask(id, { columnId: target.id, position, evergreen: false, evergreenEvery: 1, columnEnteredAt: new Date().toISOString() });
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

      moveWithinColumn: async (id: string, dir: -1 | 1) => {
        const { getTask, baseItems, patchTask, upsertTask, track, toast } = ref.current;
        const task = getTask(id);
        if (!task) return;
        // Lista completa de la columna (sin filtrar): los vecinos enviados al servidor son los reales.
        const list = baseItems[task.columnId] ?? [];
        const index = list.indexOf(id);
        const target = index + dir;
        if (index < 0 || target < 0 || target >= list.length) return;
        const rest = list.filter((x) => x !== id);
        const prevId = rest[target - 1] ?? null;
        const nextId = rest[target] ?? null;
        const position = positionBetween(prevId ? getTask(prevId)?.position : null, nextId ? getTask(nextId)?.position : null);
        patchTask(id, { position });
        focusCard(id);
        const res = await track(moveTask(id, task.columnId, prevId, nextId));
        if (!res.ok) {
          upsertTask(task);
          focusCard(id);
          return toast(res.error, "error");
        }
        patchTask(id, { position: res.data.position });
        focusCard(id);
      },

      setDueDate: async (id: string, day: string | null) => {
        const { toast, t } = ref.current;
        if (await saveFields(id, { dueDate: day }, { dueDate: day })) toast(day ? t("Fecha límite guardada") : t("Fecha límite quitada"));
      },

      renameTask: async (id: string, title: string) => {
        const task = ref.current.getTask(id);
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
