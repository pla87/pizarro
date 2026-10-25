"use server";

import type { Prisma } from "@/generated/prisma/client";
import { assertProjectAccess } from "@/lib/access";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { removeTaskEvents, restoreTaskEvents } from "@/lib/task-events";
import { renderStoredLabel } from "@/lib/undo-label";
import { getT } from "@/i18n/server";
import { makeT } from "@/i18n/core";
import { applyUndo, discardEntries, fingerprintOps, mirrorOps, saveUndo, type SavedEvent, type UndoKind, type UndoOp } from "@/lib/undo";
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
  return applyEntry(kind, user, pid, entry);
}

type Entry = NonNullable<Awaited<ReturnType<typeof db.undoEntry.findFirst>>>;

/** Aplica una entrada concreta de la pila (la última o una elegida) y deja la contraria para alternar. */
async function applyEntry(kind: UndoKind, user: { id: string }, pid: string, entry: Entry): Promise<Result> {
  const undo = kind === "UNDO";
  // Se retira primero: dos clics seguidos no aplican dos veces lo mismo.
  const { count } = await db.undoEntry.deleteMany({ where: { id: entry.id } });
  if (!count) throw new AppError(undo ? "Esa acción ya se ha deshecho." : "Esa acción ya se ha rehecho.");
  const ops = entry.ops as unknown as UndoOp[];
  // Si algo falla a medias, la entrada vuelve a su sitio (con su huella) para poder reintentarlo.
  const restore = () =>
    db.undoEntry
      .create({
        data: {
          id: entry.id, userId: entry.userId, projectId: entry.projectId, taskId: entry.taskId, label: entry.label, kind: entry.kind,
          ops: entry.ops as Prisma.InputJsonValue, fingerprint: entry.fingerprint, createdAt: entry.createdAt,
          eventIds: entry.eventIds, ...(entry.events ? { events: entry.events as Prisma.InputJsonValue } : {}),
        },
      })
      .catch(() => {});
  let current: string | null = null;
  try {
    if (entry.fingerprint) current = await fingerprintOps(pid, ops);
  } catch (err) {
    await restore();
    throw err;
  }
  // Si otra persona ha cambiado lo afectado desde que se creó esta entrada, aplicarla pisaría su trabajo:
  // se descarta (para no bloquear la pila) y se avisa. Las acciones propias ya vacían la pila de rehacer.
  if (entry.fingerprint && current !== entry.fingerprint) {
    await discardEntries([{ id: entry.id, ops: entry.ops }]);
    throw new AppError(
      undo ? "Otra persona ha cambiado esto después de rehacerlo: no se puede deshacer." : "Otra persona ha cambiado esto después de deshacerlo: no se puede rehacer.",
    );
  }
  let intact: { id: string; ops: unknown }[];
  let counter: UndoOp[];
  let skipped: number;
  try {
    // Otras entradas con huella (de la misma persona y proyecto) que siguen intactas: este cambio es suyo,
    // así que tras aplicarlo se les actualiza la huella para que no cuente como ajeno.
    const siblings = await db.undoEntry.findMany({ where: { userId: user.id, projectId: pid, fingerprint: { not: null }, id: { not: entry.id } }, select: { id: true, ops: true, fingerprint: true } });
    const prints = await Promise.all(siblings.map((s) => fingerprintOps(pid, s.ops as unknown as UndoOp[])));
    intact = siblings.filter((s, i) => prints[i] === s.fingerprint);
    // Antes de aplicar, el estado actual de lo que se va a tocar: es lo que hace la entrada contraria.
    counter = await mirrorOps(pid, ops);
    skipped = await applyUndo(pid, ops, { keepFiles: true });
  } catch (err) {
    await restore();
    throw err;
  }
  // Historial: deshacer borra las entradas que registró la acción (y guarda una copia en la de rehacer);
  // rehacer las recrea y la nueva entrada de deshacer recuerda sus ids.
  const history = undo
    ? { events: await removeTaskEvents(entry.eventIds, pid) }
    : { eventIds: await restoreTaskEvents((entry.events ?? []) as unknown as SavedEvent[], pid) };
  if (counter.length) await saveUndo(user.id, pid, entry.label, counter, entry.taskId, undo ? "REDO" : "UNDO", false, await fingerprintOps(pid, counter), history);
  await Promise.all(
    intact.map(async (s) => db.undoEntry.updateMany({ where: { id: s.id }, data: { fingerprint: await fingerprintOps(pid, s.ops as unknown as UndoOp[]) } })),
  );
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


/**
 * Deshace exactamente una entrada (la que devolvió una acción, p. ej. el aviso «Adjunto borrado»), aunque
 * después se hayan hecho otras cambios. Mismas comprobaciones que undoLast; deja su entrada de rehacer.
 */
export async function undoEntry(entryId: string) {
  return runAction({ name: "undo.undoEntry", args: [entryId] }, async () => {
    const user = await requireUser();
    const entry = await db.undoEntry.findFirst({ where: { id: v.id.parse(entryId), userId: user.id, kind: "UNDO" } });
    if (!entry) throw new AppError("Esa acción ya se ha deshecho.");
    await assertProjectAccess(user, entry.projectId);
    return applyEntry("UNDO", user, entry.projectId, entry);
  });
}
