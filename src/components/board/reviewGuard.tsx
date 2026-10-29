"use client";

import { useCallback, useEffect, useRef } from "react";
import { getPendingSubtasks } from "@/actions/column-views";
import { missingSubtasksText } from "@/lib/checklist";
import type { BoardColumn, BoardTask } from "@/lib/types";
import { useT } from "@/i18n/client";
import { useConfirm } from "../ui/ConfirmDialog";

/**
 * Columnas «Revisión con requisitos»: al sacar tarjetas con subtareas sin marcar de una de ellas, pide
 * confirmación y lista lo que falta. Todos los caminos de movimiento (arrastrar, menú, teclado, selección,
 * diálogo de tarea) pasan por la función devuelta: `true` = seguir con el movimiento.
 * Solo avisa (el servidor no bloquea): si no se puede consultar el detalle, se avisa con los contadores.
 */
export function useReviewGuard(projectId: string, columns: BoardColumn[], getTask: (id: string) => BoardTask | undefined) {
  const t = useT();
  const confirm = useConfirm();
  const ref = useRef({ projectId, columns, getTask, t, confirm });
  useEffect(() => {
    ref.current = { projectId, columns, getTask, t, confirm };
  });

  return useCallback(async (taskIds: string[], toColumnId: string): Promise<boolean> => {
    const { projectId, columns, getTask, t, confirm } = ref.current;
    const reviewIds = new Set(columns.filter((c) => c.role === "REVIEW").map((c) => c.id));
    if (!reviewIds.size) return true;
    const leaving = taskIds.map(getTask).filter((x): x is BoardTask => !!x && reviewIds.has(x.columnId) && x.columnId !== toColumnId && x.subtaskDone < x.subtaskTotal);
    if (!leaving.length) return true;
    const res = await getPendingSubtasks(projectId, leaving.map((x) => x.id));
    const detail = res.ok ? new Map(res.data.map((d) => [d.taskId, d])) : new Map<string, { title: string; pending: string[] }>();
    const lines = leaving.map((x) => {
      const pending = detail.get(x.id)?.pending;
      const text = pending?.length ? missingSubtasksText(pending, t) : t("Faltan {n} subtareas", { n: x.subtaskTotal - x.subtaskDone });
      return { id: x.id, title: detail.get(x.id)?.title ?? x.title, text };
    });
    return confirm({
      title: t("Faltan requisitos"),
      message: (
        <div className="space-y-2">
          <p>{leaving.length === 1 ? t("Esta tarjeta sale de una columna de revisión con subtareas sin marcar.") : t("Estas tarjetas salen de una columna de revisión con subtareas sin marcar.")}</p>
          <ul className="max-h-60 space-y-1.5 overflow-y-auto text-sm">
            {lines.map((l) => (
              <li key={l.id}>
                {leaving.length > 1 && <strong className="block">{l.title}</strong>}
                <span className="text-slate-600 dark:text-slate-300">{l.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ),
      confirmLabel: t("Mover igualmente"),
      cancelLabel: t("Cancelar"),
    });
  }, []);
}
