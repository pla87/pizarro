import "server-only";
import { db } from "./db";
import { logEvent } from "./log";
import { dueChangeExcerpt } from "./notification-text";
import { notifyTask } from "./notify";
import { isShuttingDown } from "./shutdown";

// Avisos de cambio de fecha límite agrupados: mover una tarjeta varias veces seguidas (arrastrando en el
// calendario, Alt+flechas…) no genera un aviso por movimiento. Cada cambio actualiza una fila pendiente por
// tarea y destinatario (fecha original → última fecha) y retrasa su envío (debounce); cuando pasa el tiempo
// sin nuevos cambios, el planificador crea UN aviso con la fecha final. Si ésta coincide con la original, no avisa.

/** Tiempo sin nuevos cambios de fecha tras el cual se envía el aviso. */
export const DUE_NOTIFY_DELAY_MS = 5 * 60_000;
/** Cada cuánto mira el planificador si hay avisos que enviar. */
const DUE_NOTIFY_POLL_MS = 30_000;

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
    // Un cambio nuevo empieza otra espera: sus reintentos cuentan desde su propio primer intento.
    update: { actorId, toDue: opts.to, sendAfter, claimedAt: null },
  });
}

/** Descarta los avisos de fecha pendientes de la tarea (salvo los de `exceptRecipientId`), p. ej. al cambiar de responsable. */
export async function dropPendingDueChanges(taskId: string, exceptRecipientId?: string | null): Promise<void> {
  await db.pendingDueNotice.deleteMany({ where: { taskId, ...(exceptRecipientId ? { recipientId: { not: exceptRecipientId } } : {}) } });
}

const BATCH = 100;
/**
 * Al reclamar una fila se retrasa su `sendAfter` este tiempo (el «reclamo»), y se borra cuando su aviso ya ha salido.
 * Si el proceso cae a medias o notifyTask falla, la fila sigue ahí y vuelve a estar vencida al pasar el reclamo: otra
 * pasada la reintenta (el aviso puede llegar dos veces si el fallo fue después de crearlo, pero no se pierde).
 */
export const DUE_NOTICE_CLAIM_MS = 10 * 60_000;
/**
 * Una fila que lleva más que esto desde su primer intento de envío (`claimedAt`, el primer reclamo) se descarta sin
 * avisar: sus reintentos llevan un día fallando. Se cuenta desde el primer reclamo y no desde el cambio de fecha
 * para que un apagado de más de un día no tire los avisos que esperaban (al volver, su primer intento es entonces).
 */
export const DUE_NOTICE_GIVE_UP_MS = 24 * 60 * 60_000;

interface ClaimedNotice { id: string; taskId: string; recipientId: string; actorId: string | null; fromDue: string | null; toDue: string | null; sendAfter: Date; claimedAt: Date }

type Notify = typeof notifyTask;

/**
 * Envía los avisos de fecha cuyo plazo ya ha vencido (`now` inyectable para los tests); devuelve cuántos avisos
 * ha creado. Las filas se reclaman con UPDATE ... FOR UPDATE SKIP LOCKED (su `sendAfter` pasa a `now` +
 * DUE_NOTICE_CLAIM_MS), así que dos procesos a la vez nunca envían lo mismo, y cada una se borra al terminar con ella.
 * Se avisa solo si la tarea sigue existiendo, no está archivada y la persona sigue asignada; si no (borrada, archivada,
 * desasignada o reasignada), se descarta sin avisar. Los permisos del destinatario se vuelven a comprobar en
 * notifyTask y en el envío externo. `notify` es inyectable para los tests.
 */
export async function deliverDueNotices(now: Date = new Date(), notify: Notify = notifyTask): Promise<number> {
  let sent = 0;
  const claimUntil = new Date(now.getTime() + DUE_NOTICE_CLAIM_MS);
  for (;;) {
    const rows = await db.$queryRaw<ClaimedNotice[]>`
      UPDATE "PendingDueNotice" SET "sendAfter" = ${claimUntil}, "claimedAt" = COALESCE("claimedAt", ${now}) WHERE "id" IN (
        SELECT "id" FROM "PendingDueNotice" WHERE "sendAfter" <= ${now} ORDER BY "sendAfter" LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
      ) RETURNING "id", "taskId", "recipientId", "actorId", "fromDue", "toDue", "sendAfter", "claimedAt"`;
    for (const row of rows) {
      try {
        const projectId = await noticeProject(row, now);
        if (projectId && row.actorId) {
          const r = await notify({ type: "DUE_CHANGED", actorId: row.actorId, taskId: row.taskId, projectId, recipientIds: [row.recipientId], excerpt: dueChangeExcerpt(row.fromDue, row.toDue), immediate: true });
          sent += r.recipients.length;
        }
        // Hecho (enviado o descartado). Solo si nadie la ha tocado mientras: un cambio de fecha nuevo (queueDueChange)
        // le pone otro `sendAfter` y se queda para avisar de la fecha nueva.
        await db.pendingDueNotice.deleteMany({ where: { id: row.id, sendAfter: row.sendAfter } });
      } catch (err) {
        // Se queda reclamada: se reintenta al pasar DUE_NOTICE_CLAIM_MS.
        console.error("[due-notices]", err);
      }
    }
    if (rows.length < BATCH) break;
  }
  if (sent) logEvent({ category: "notify", action: "notify.dueGrouped", message: `${sent} aviso(s) de cambio de fecha enviados tras esperar`, details: { count: sent } });
  return sent;
}

/** Proyecto de la tarea si el aviso sigue valiendo; null si no (la fila se borra sin avisar). */
async function noticeProject(row: ClaimedNotice, now: Date): Promise<string | null> {
  if (row.fromDue === row.toDue || !row.actorId) return null; // vuelta a la fecha original: nada que contar
  if (now.getTime() - row.claimedAt.getTime() > DUE_NOTICE_GIVE_UP_MS) {
    logEvent({ level: "warn", category: "notify", action: "notify.dueGaveUp", message: "Aviso de cambio de fecha descartado: su envío lleva más de un día fallando desde el primer intento", details: { taskId: row.taskId, firstAttemptAt: row.claimedAt.toISOString() } });
    return null;
  }
  const task = await db.task.findUnique({ where: { id: row.taskId }, select: { projectId: true, archivedAt: true, assigneeId: true, dueDate: true } });
  if (!task || task.archivedAt || task.assigneeId !== row.recipientId) return null;
  // La fecha actual ya no es la que se iba a comunicar (Cancelar/deshacer/rehacer): el aviso sería falso.
  return (task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null) === row.toDue ? task.projectId : null;
}

/** Arranca el planificador una sola vez por proceso; nunca lanza. */
export function startDueNoticeScheduler(): void {
  const g = globalThis as unknown as { __pzDueNotices?: boolean };
  if (g.__pzDueNotices) return;
  g.__pzDueNotices = true;
  let running = false;
  setInterval(() => {
    if (running || isShuttingDown()) return;
    running = true;
    deliverDueNotices().catch((err) => console.error("[due-notices]", err)).finally(() => { running = false; });
  }, DUE_NOTIFY_POLL_MS).unref?.();
}
