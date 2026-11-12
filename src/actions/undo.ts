"use server";

import { Prisma } from "@/generated/prisma/client";
import { assertProjectAccess } from "@/lib/access";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { removeTaskEvents, restoreTaskEvents } from "@/lib/task-events";
import { renderStoredLabel } from "@/lib/undo-label";
import { getT } from "@/i18n/server";
import { makeT, type T } from "@/i18n/core";
import { actionContext } from "@/lib/action-context";
import { findUndoConflicts, type UndoConflicts } from "@/lib/undo-conflicts";
import { applyUndo, discardEntries, fingerprintsOf, mirrorOps, saveUndo, type SavedEvent, type UndoKind, type UndoOp } from "@/lib/undo";
import * as v from "@/lib/validation";

type Result = { label: string; remaining: number; skipped: number; redoable: number };

/** Lo que devuelve undoChecked/redoChecked: lo aplicado o, si otra persona cambió lo mismo después, qué preguntar. */
type CheckedResult =
  | { applied: Result; conflict?: undefined }
  | { applied?: undefined; conflict: { entryId: string; title: string; message: string; confirmLabel: string; danger: boolean } };

/** La última entrada de la pila `kind` del usuario (con una tarea abierta, de esa tarea). */
async function lastEntry(kind: UndoKind, projectId: string, taskId?: string | null) {
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
  return { user, pid, entry };
}

/**
 * Aplica la última entrada de la pila `kind` del usuario y deja en la contraria (deshacer ↔ rehacer)
 * el estado previo, para poder alternar. Con una tarea abierta (`taskId`) el contexto es esa tarea.
 */
async function applyLast(kind: UndoKind, projectId: string, taskId?: string | null): Promise<Result> {
  const { user, pid, entry } = await lastEntry(kind, projectId, taskId);
  return applyEntry(kind, user, pid, entry);
}

/** Lista legible de lo que otros añadieron a una tarea que se va a quitar («2 comentarios, 1 adjunto»). */
function addedItems(a: UndoConflicts["added"], t: T): string {
  const parts: string[] = [];
  if (a.comments) parts.push(a.comments === 1 ? t("1 comentario") : t("{n} comentarios", { n: a.comments }));
  if (a.attachments) parts.push(a.attachments === 1 ? t("1 adjunto") : t("{n} adjuntos", { n: a.attachments }));
  if (a.links) parts.push(a.links === 1 ? t("1 enlace") : t("{n} enlaces", { n: a.links }));
  return parts.join(", ");
}

/** El texto del diálogo de confirmación, en el idioma de quien deshace. */
function conflictDialog(c: UndoConflicts, redo: boolean, t: T): { title: string; message: string; confirmLabel: string; danger: boolean } {
  const question = redo ? t("¿Rehacer igualmente?") : t("¿Deshacer igualmente?");
  const several = c.affected > 1;
  const names = c.names.length > 3 ? `${c.names.slice(0, 3).join(", ")}…` : c.names.join(", ");
  const what = c.generic
    ? t("Otra persona ha cambiado esto después.")
    : c.names.length === 1
      ? several ? t("{name} cambió {n} de estas tareas después.", { name: names, n: c.tasks }) : t("{name} cambió esta tarea después.", { name: names })
      : several ? t("Otras personas ({names}) cambiaron {n} de estas tareas después.", { names, n: c.tasks }) : t("Otras personas ({names}) cambiaron esta tarea después.", { names });
  const items = addedItems(c.added, t);
  // Quitar la tarea entera (deshacer su creación, rehacer su borrado) se lleva también lo que otros le añadieron.
  const loses = items ? ` ${t("También se borrará lo que añadieron: {items}.", { items })}` : "";
  return { title: t("Cambios de otras personas"), message: `${what}${loses} ${question}`, confirmLabel: redo ? t("Rehacer igualmente") : t("Deshacer igualmente"), danger: !!items };
}

/**
 * Como undoLast/redoLast, pero antes mira si otra persona cambió después lo que la entrada va a tocar (findUndoConflicts).
 * Si no, la aplica igual que siempre. Si sí, no aplica nada y devuelve el texto de la confirmación con el id de la
 * entrada; con `confirmEntryId` (la persona aceptó) la aplica sin preguntar, solo si sigue siendo la última de su pila
 * (si entretanto cambió, se pide volver a intentarlo para no aplicar otra cosa de la que se confirmó).
 */
async function applyLastChecked(kind: UndoKind, projectId: string, taskId: string | null | undefined, confirmEntryId: string | null | undefined): Promise<CheckedResult> {
  const { user, pid, entry } = await lastEntry(kind, projectId, taskId);
  if (confirmEntryId) {
    if (v.id.parse(confirmEntryId) !== entry.id) throw new AppError("Ha cambiado entretanto lo que se iba a deshacer o rehacer: vuelve a intentarlo.");
    return { applied: await applyEntry(kind, user, pid, entry, { force: true }) };
  }
  const conflicts = await findUndoConflicts(entry, user.id, pid);
  if (conflicts) {
    // No se ha aplicado nada: el registro lo dice así, sin historial de tareas ni aviso a las demás pestañas.
    const store = actionContext.getStore();
    if (store) {
      store.message = `${kind === "REDO" ? "Rehacer" : "Deshacer"} pendiente de confirmar: otra persona cambió lo mismo después`;
      store.events = [];
      store.noPublish = true;
    }
    return { conflict: { entryId: entry.id, ...conflictDialog(conflicts, kind === "REDO", await getT()) } };
  }
  return { applied: await applyEntry(kind, user, pid, entry) };
}

type Entry = NonNullable<Awaited<ReturnType<typeof db.undoEntry.findFirst>>>;

/** Aplica una entrada concreta de la pila (la última o una elegida) y deja la contraria para alternar. */
async function applyEntry(kind: UndoKind, user: { id: string }, pid: string, entry: Entry, opts: { force?: boolean } = {}): Promise<Result> {
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
  // Otras entradas con huella (de la misma persona y proyecto) que siguen intactas: este cambio es suyo, así que tras
  // aplicarlo se les actualiza la huella para que no cuente como ajeno. Las huellas de esta entrada y de las demás
  // salen de una sola lectura del estado (fingerprintsOf), antes y después de aplicar, no de una lectura por entrada.
  let siblings: { id: string; ops: unknown; fingerprint: string | null }[];
  let prints: string[];
  try {
    siblings = await db.undoEntry.findMany({ where: { userId: user.id, projectId: pid, fingerprint: { not: null }, id: { not: entry.id } }, select: { id: true, ops: true, fingerprint: true } });
    prints = await fingerprintsOf(pid, [
      ...(entry.fingerprint ? [{ ops, stored: entry.fingerprint }] : []),
      ...siblings.map((s) => ({ ops: s.ops as unknown as UndoOp[], stored: s.fingerprint })),
    ]);
  } catch (err) {
    await restore();
    throw err;
  }
  const current = entry.fingerprint ? prints.shift()! : null;
  // Si otra persona ha cambiado lo afectado desde que se creó esta entrada, aplicarla pisaría su trabajo:
  // se descarta (para no bloquear la pila) y se avisa. Las acciones propias ya vacían la pila de rehacer.
  // Con `force` la persona ya lo ha confirmado (undoChecked/redoChecked): se aplica igualmente.
  if (entry.fingerprint && current !== entry.fingerprint && !opts.force) {
    await discardEntries([{ id: entry.id, ops: entry.ops }]);
    throw new AppError(
      undo ? "Otra persona ha cambiado esto después de rehacerlo: no se puede deshacer." : "Otra persona ha cambiado esto después de deshacerlo: no se puede rehacer.",
    );
  }
  const intact = siblings.filter((s, i) => prints[i] === s.fingerprint);
  let counter: UndoOp[];
  let skipped: number;
  try {
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
  // Una release desplegada no se puede recrear: rehacer volvería a mover las tareas sin ella. No hay entrada de rehacer.
  const recreatable = !(undo && ops.some((op) => op.t === "release.remove"));
  const saveCounter = recreatable && counter.length > 0;
  // Después de aplicar: la huella de la entrada contraria y la nueva de las intactas, otra vez con una sola lectura.
  // Se recalculan todas (no solo las que comparten tareas con esta): aplicar también puede mover otras filas
  // (renumerar una columna, quitar la marca de fija, llevar tareas de una columna borrada a otra). Solo se escriben
  // las que han cambiado.
  const after = await fingerprintsOf(pid, [...(saveCounter ? [{ ops: counter }] : []), ...intact.map((s) => ({ ops: s.ops as unknown as UndoOp[] }))]);
  if (saveCounter) await saveUndo(user.id, pid, entry.label, counter, entry.taskId, undo ? "REDO" : "UNDO", false, after.shift()!, history);
  const changed = intact.flatMap((s, i) => (after[i] !== s.fingerprint ? [Prisma.sql`(${s.id}::text, ${after[i]!}::text)`] : []));
  if (changed.length) {
    await db.$executeRaw`UPDATE "UndoEntry" AS u SET "fingerprint" = v."fp" FROM (VALUES ${Prisma.join(changed)}) AS v("id", "fp") WHERE u."id" = v."id"`;
  }
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
 * Deshacer del botón y de Ctrl+Z: como undoLast, pero si otra persona cambió después lo que se va a deshacer, devuelve
 * `conflict` sin aplicar nada; se vuelve a llamar con `confirmEntryId` cuando la persona acepta. En el registro
 * cuenta como undo.undoLast (es la misma acción).
 */
export async function undoChecked(projectId: string, taskId?: string | null, confirmEntryId?: string | null) {
  return runAction({ name: "undo.undoLast", args: [projectId, taskId, confirmEntryId] }, () => applyLastChecked("UNDO", projectId, taskId, confirmEntryId));
}

/** Lo mismo para rehacer (undo.redoLast). */
export async function redoChecked(projectId: string, taskId?: string | null, confirmEntryId?: string | null) {
  return runAction({ name: "undo.redoLast", args: [projectId, taskId, confirmEntryId] }, () => applyLastChecked("REDO", projectId, taskId, confirmEntryId));
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
    // Fuera de orden solo se deshace un borrado de adjuntos (lo que ofrece el aviso): otras entradas antiguas podrían
    // pisar cambios posteriores del mismo usuario. Si es la última, vale cualquiera (igual que undoLast).
    const onlyAttachments = (entry.ops as unknown as UndoOp[]).every((op) => op.t === "attachment.restore");
    if (!onlyAttachments) {
      const latest = await db.undoEntry.findFirst({ where: { userId: user.id, projectId: entry.projectId, kind: "UNDO" }, orderBy: { createdAt: "desc" }, select: { id: true } });
      if (latest?.id !== entry.id) throw new AppError("Esa acción ya no se puede deshacer desde aquí: usa Deshacer.");
    }
    return applyEntry("UNDO", user, entry.projectId, entry);
  });
}
