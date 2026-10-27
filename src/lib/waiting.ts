import "server-only";
import { DEFAULT_WAITING_DAYS } from "./constants";
import { db } from "./db";
import { logEvent } from "./log";
import { notifyTask } from "./notify";

// Recordatorio de tareas que esperan a alguien: en una columna con rol WAITING, cuando una tarea lleva
// `waitingDays` días (por defecto 3) desde que entró (Task.columnEnteredAt, que mantiene un disparador de la
// BD al cambiar de columna), se avisa a su responsable (o, sin él, a quien la creó). Se avisa una sola vez por
// estancia: Task.waitingNotifiedAt se anota al avisar y el disparador lo borra si la tarea cambia de columna.

const DAY_MS = 86_400_000;
const BATCH = 500;

/** Envía los recordatorios que toquen (`now` inyectable para los tests); devuelve cuántos avisos ha creado. */
export async function deliverWaitingReminders(now: Date = new Date()): Promise<number> {
  let sent = 0;
  const rows = await db.task.findMany({
    where: { archivedAt: null, waitingNotifiedAt: null, column: { role: "WAITING", isDone: false } },
    orderBy: { columnEnteredAt: "asc" },
    take: BATCH,
    select: { id: true, projectId: true, columnId: true, assigneeId: true, createdById: true, columnEnteredAt: true, column: { select: { waitingDays: true } } },
  });
  for (const task of rows) {
    const days = Math.floor((now.getTime() - task.columnEnteredAt.getTime()) / DAY_MS);
    if (days < (task.column.waitingDays ?? DEFAULT_WAITING_DAYS)) continue;
    try {
      // Se reclama la tarea antes de avisar: dos procesos a la vez (o una pasada solapada) no envían dos veces.
      const claimed = await db.task.updateMany({ where: { id: task.id, columnId: task.columnId, waitingNotifiedAt: null }, data: { waitingNotifiedAt: now } });
      if (!claimed.count) continue;
      const recipient = task.assigneeId ?? task.createdById;
      if (!recipient) continue;
      const r = await notifyTask({ type: "WAITING", actorId: null, taskId: task.id, projectId: task.projectId, recipientIds: [recipient], excerpt: String(days), immediate: true });
      sent += r.recipients.length;
    } catch (err) {
      console.error("[waiting]", err);
    }
  }
  if (sent) logEvent({ category: "notify", action: "notify.waiting", message: `${sent} recordatorio(s) de tareas en espera enviados`, details: { count: sent } });
  return sent;
}
