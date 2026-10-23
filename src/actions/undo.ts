"use server";

import type { Prisma } from "@/generated/prisma/client";
import { assertProjectAccess } from "@/lib/access";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { renderStoredLabel } from "@/lib/undo-label";
import { getT } from "@/i18n/server";
import { makeT } from "@/i18n/core";
import { applyUndo, mirrorOps, saveUndo, type UndoKind, type UndoOp } from "@/lib/undo";
import * as v from "@/lib/validation";

type Result = { label: string; remaining: number; skipped: number; redoable: number };

/**
 * Aplica la última entrada de la pila `kind` del usuario y deja en la contraria (deshacer ↔ rehacer)
 * el estado previo, para poder alternar. Con una tarea abierta (`taskId`) el contexto es esa tarea.
 */
async function applyLast(kind: UndoKind, projectId: string, taskId?: string | null): Promise<Result> {
  const undo = kind === "UNDO";
  const user = await requireUser();
  const pid = v.id.parse(projectId);
  await assertProjectAccess(user, pid);
  const tid = taskId ? v.id.parse(taskId) : null;
  const entry = await db.undoEntry.findFirst({ where: { userId: user.id, projectId: pid, kind, ...(tid ? { taskId: tid } : {}) }, orderBy: { createdAt: "desc" } });
  if (!entry) {
    throw new AppError(
      undo ? (tid ? "No hay nada que deshacer en esta tarea." : "No hay nada que deshacer.") : tid ? "No hay nada que rehacer en esta tarea." : "No hay nada que rehacer.",
    );
  }
  // Se retira primero: dos clics seguidos no aplican dos veces lo mismo.
  const { count } = await db.undoEntry.deleteMany({ where: { id: entry.id } });
  if (!count) throw new AppError(undo ? "Esa acción ya se ha deshecho." : "Esa acción ya se ha rehecho.");
  const ops = entry.ops as unknown as UndoOp[];
  // Antes de aplicar, el estado actual de lo que se va a tocar: es lo que hace la entrada contraria.
  let counter: UndoOp[];
  let skipped: number;
  try {
    counter = await mirrorOps(pid, ops);
    skipped = await applyUndo(pid, ops, { keepFiles: true });
  } catch (err) {
    // Si algo falla a medias, la entrada vuelve a su sitio para poder reintentarlo.
    await db.undoEntry.create({
      data: { id: entry.id, userId: entry.userId, projectId: entry.projectId, taskId: entry.taskId, label: entry.label, kind: entry.kind, ops: entry.ops as Prisma.InputJsonValue, createdAt: entry.createdAt },
    }).catch(() => {});
    throw err;
  }
  if (counter.length) await saveUndo(user.id, pid, entry.label, counter, entry.taskId, undo ? "REDO" : "UNDO", false);
  const [remaining, redoable] = await Promise.all([
    db.undoEntry.count({ where: { userId: user.id, projectId: pid, kind: "UNDO" } }),
    db.undoEntry.count({ where: { userId: user.id, projectId: pid, kind: "REDO" } }),
  ]);
  const parts = skipped ? ` (${skipped} parte${skipped === 1 ? "" : "s"} ya no existía${skipped === 1 ? "" : "n"})` : "";
  describeAction(`${undo ? "Deshizo" : "Rehízo"}: ${renderStoredLabel(entry.label, makeT("es"))}${parts}`, { [undo ? "undoneId" : "redoneId"]: entry.id });
  return { label: renderStoredLabel(entry.label, await getT()), remaining, skipped, redoable };
}

/**
 * Deshace la última acción deshacible del usuario en el proyecto (hasta 10 seguidas). Con una
 * tarea abierta (`taskId`), el contexto es esa tarea: solo sus acciones.
 */
export async function undoLast(projectId: string, taskId?: string | null) {
  return runAction({ name: "undo.undoLast", args: [projectId, taskId] }, () => applyLast("UNDO", projectId, taskId));
}

/** Rehace lo último que se deshizo (mismo contexto que undoLast). Una acción nueva vacía esta pila. */
export async function redoLast(projectId: string, taskId?: string | null) {
  return runAction({ name: "undo.redoLast", args: [projectId, taskId] }, () => applyLast("REDO", projectId, taskId));
}
