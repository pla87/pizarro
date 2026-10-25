import "server-only";
import { db } from "./db";
import { logEvent } from "./log";
import { dueChangeExcerpt } from "./notification-text";
import { notifyTask } from "./notify";

// Avisos de cambio de fecha límite agrupados: mover una tarjeta varias veces seguidas (arrastrando en el
// calendario, Alt+flechas…) no genera un aviso por movimiento. Cada cambio actualiza una fila pendiente por
// tarea y destinatario (fecha original → última fecha) y retrasa su envío (debounce); cuando pasa el tiempo
// sin nuevos cambios, el planificador crea UN aviso con la fecha final. Si ésta coincide con la original, no avisa.

/** Tiempo sin nuevos cambios de fecha tras el cual se envía el aviso. */
export const DUE_NOTIFY_DELAY_MS = 3 * 60_000;
/** Cada cuánto mira el planificador si hay avisos que enviar. */
export const DUE_NOTIFY_POLL_MS = 30_000;

/**
 * Anota (o actualiza) el cambio de fecha pendiente de avisar a `recipientId`. Conserva la fecha original del
 * primer cambio y retrasa el envío. Si quien cambia la fecha es la propia persona asignada, no hay nada que
 * avisarle y se descarta lo pendiente (ya sabe cuál es la fecha final).
 */
export async function queueDueChange(opts: { taskId: string; recipientId: string; actorId: string; from: string | null; to: string | null; now?: Date }): Promise<void> {
  const { taskId, recipientId, actorId } = opts;
  if (recipientId === actorId) {
    await db.pendingDueNotice.deleteMany({ where: { taskId, recipientId } });
    return;
  }
  const sendAfter = new Date((opts.now ?? new Date()).getTime() + DUE_NOTIFY_DELAY_MS);
  await db.pendingDueNotice.upsert({
    where: { taskId_recipientId: { taskId, recipientId } },
    create: { taskId, recipientId, actorId, fromDue: opts.from, toDue: opts.to, sendAfter },
    update: { actorId, toDue: opts.to, sendAfter },
  });
}

/** Descarta los avisos de fecha pendientes de la tarea (salvo los de `exceptRecipientId`), p. ej. al cambiar de responsable. */
export async function dropPendingDueChanges(taskId: string, exceptRecipientId?: string | null): Promise<void> {
  await db.pendingDueNotice.deleteMany({ where: { taskId, ...(exceptRecipientId ? { recipientId: { not: exceptRecipientId } } : {}) } });
}

const BATCH = 100;

interface ClaimedNotice { id: string; taskId: string; recipientId: string; actorId: string | null; fromDue: string | null; toDue: string | null }

/**
 * Envía los avisos de fecha cuyo plazo ya ha vencido (`now` inyectable para los tests); devuelve cuántos avisos
 * ha creado. Las filas se reclaman con DELETE ... FOR UPDATE SKIP LOCKED, así que dos procesos a la vez nunca
 * envían lo mismo. Se avisa solo si la tarea sigue existiendo, no está archivada y la persona sigue asignada;
 * si no (borrada, archivada, desasignada o reasignada), se descarta sin avisar. Los permisos del destinatario
 * se vuelven a comprobar en notifyTask y en el envío externo.
 */
export async function deliverDueNotices(now: Date = new Date()): Promise<number> {
  let sent = 0;
  for (;;) {
    const rows = await db.$queryRaw<ClaimedNotice[]>`
      DELETE FROM "PendingDueNotice" WHERE "id" IN (
        SELECT "id" FROM "PendingDueNotice" WHERE "sendAfter" <= ${now} ORDER BY "sendAfter" LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
      ) RETURNING "id", "taskId", "recipientId", "actorId", "fromDue", "toDue"`;
    for (const row of rows) {
      try {
        if (row.fromDue === row.toDue || !row.actorId) continue; // vuelta a la fecha original: nada que contar
        const task = await db.task.findUnique({ where: { id: row.taskId }, select: { projectId: true, archivedAt: true, assigneeId: true } });
        if (!task || task.archivedAt || task.assigneeId !== row.recipientId) continue;
        const r = await notifyTask({ type: "DUE_CHANGED", actorId: row.actorId, taskId: row.taskId, projectId: task.projectId, recipientIds: [row.recipientId], excerpt: dueChangeExcerpt(row.fromDue, row.toDue), immediate: true });
        sent += r.recipients.length;
      } catch (err) {
        console.error("[due-notices]", err);
      }
    }
    if (rows.length < BATCH) break;
  }
  if (sent) logEvent({ category: "notify", action: "notify.dueGrouped", message: `${sent} aviso(s) de cambio de fecha enviados tras esperar`, details: { count: sent } });
  return sent;
}

/** Arranca el planificador una sola vez por proceso; nunca lanza. */
export function startDueNoticeScheduler(): void {
  const g = globalThis as unknown as { __pzDueNotices?: boolean };
  if (g.__pzDueNotices) return;
  g.__pzDueNotices = true;
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    deliverDueNotices().catch((err) => console.error("[due-notices]", err)).finally(() => { running = false; });
  }, DUE_NOTIFY_POLL_MS).unref?.();
}
