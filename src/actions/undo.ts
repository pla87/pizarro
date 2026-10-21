"use server";

import { assertProjectAccess } from "@/lib/access";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { renderStoredLabel } from "@/lib/undo-label";
import { getT } from "@/i18n/server";
import { makeT } from "@/i18n/core";
import { applyUndo, type UndoOp } from "@/lib/undo";
import * as v from "@/lib/validation";

/**
 * Deshace la última acción deshacible del usuario en el proyecto (hasta 10 seguidas). Con una
 * tarea abierta (`taskId`), el contexto es esa tarea: solo sus acciones.
 */
export async function undoLast(projectId: string, taskId?: string | null) {
  return runAction({ name: "undo.undoLast", args: [projectId, taskId] }, async (): Promise<{ label: string; remaining: number; skipped: number }> => {
    const user = await requireUser();
    const pid = v.id.parse(projectId);
    await assertProjectAccess(user, pid);
    const tid = taskId ? v.id.parse(taskId) : null;
    const entry = await db.undoEntry.findFirst({ where: { userId: user.id, projectId: pid, ...(tid ? { taskId: tid } : {}) }, orderBy: { createdAt: "desc" } });
    if (!entry) throw new AppError(tid ? "No hay nada que deshacer en esta tarea." : "No hay nada que deshacer.");
    // Se retira primero: dos clics seguidos no deshacen dos veces lo mismo.
    const { count } = await db.undoEntry.deleteMany({ where: { id: entry.id } });
    if (!count) throw new AppError("Esa acción ya se ha deshecho.");
    const skipped = await applyUndo(pid, entry.ops as unknown as UndoOp[]);
    const remaining = await db.undoEntry.count({ where: { userId: user.id, projectId: pid } });
    describeAction(`Deshizo: ${renderStoredLabel(entry.label, makeT("es"))}${skipped ? ` (${skipped} parte${skipped === 1 ? "" : "s"} ya no existía${skipped === 1 ? "" : "n"})` : ""}`, { undoneId: entry.id });
    return { label: renderStoredLabel(entry.label, await getT()), remaining, skipped };
  });
}
