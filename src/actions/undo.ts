"use server";

import { assertProjectAccess } from "@/lib/access";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { applyUndo, type UndoOp } from "@/lib/undo";
import * as v from "@/lib/validation";

/** Deshace la última acción deshacible del usuario en el proyecto (hasta 10 seguidas). */
export async function undoLast(projectId: string) {
  return runAction({ name: "undo.undoLast", args: [projectId] }, async (): Promise<{ label: string; remaining: number; skipped: number }> => {
    const user = await requireUser();
    const pid = v.id.parse(projectId);
    await assertProjectAccess(user, pid);
    const entry = await db.undoEntry.findFirst({ where: { userId: user.id, projectId: pid }, orderBy: { createdAt: "desc" } });
    if (!entry) throw new AppError("No hay nada que deshacer.");
    // Se retira primero: dos clics seguidos no deshacen dos veces lo mismo.
    const { count } = await db.undoEntry.deleteMany({ where: { id: entry.id } });
    if (!count) throw new AppError("Esa acción ya se ha deshecho.");
    const skipped = await applyUndo(pid, entry.ops as unknown as UndoOp[]);
    const remaining = await db.undoEntry.count({ where: { userId: user.id, projectId: pid } });
    describeAction(`Deshizo: ${entry.label}${skipped ? ` (${skipped} parte${skipped === 1 ? "" : "s"} ya no existía${skipped === 1 ? "" : "n"})` : ""}`, { undoneId: entry.id });
    return { label: entry.label, remaining, skipped };
  });
}

/** Cuántas acciones puede deshacer el usuario en el proyecto y cuál es la última. */
export async function undoStatus(projectId: string) {
  return runAction(async (): Promise<{ count: number; label: string | null }> => {
    const user = await requireUser();
    const pid = v.id.parse(projectId);
    await assertProjectAccess(user, pid);
    const [count, last] = await Promise.all([
      db.undoEntry.count({ where: { userId: user.id, projectId: pid } }),
      db.undoEntry.findFirst({ where: { userId: user.id, projectId: pid }, orderBy: { createdAt: "desc" }, select: { label: true } }),
    ]);
    return { count, label: last?.label ?? null };
  });
}
