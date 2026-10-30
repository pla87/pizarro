import "server-only";
import { DEFAULT_WAITING_DAYS } from "./constants";
import { calendarDaysSince } from "./dates";
import { appTimeZone } from "./format";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { logEvent } from "./log";
import { notifyTask } from "./notify";

// Recordatorio de tareas que esperan a alguien: en una columna con rol WAITING, cuando una tarea lleva
// `waitingDays` días (por defecto 3) desde que entró (Task.columnEnteredAt, que mantiene un disparador de la
// BD al cambiar de columna), se avisa a su responsable (o, sin él, a quien la creó). Se avisa una sola vez por
// estancia: Task.waitingNotifiedAt se anota al avisar y el disparador lo borra si la tarea cambia de columna.

const BATCH = 500;
/** Tope de tareas revisadas por pasada: acota el trabajo de una pasada aunque haya miles pendientes (el resto sale en la siguiente). */
const RUN_CAP = 5000;

/** Envía los recordatorios que toquen (`now` inyectable para los tests); devuelve cuántos avisos ha creado. */
export async function deliverWaitingReminders(now: Date = new Date()): Promise<number> {
  let sent = 0;
  const tz = appTimeZone();
  // Solo se piden a la BD las tareas que ya cumplen el plazo (así las recientes no ocupan sitio y no hay inanición),
  // en lotes y con un cursor (columnEnteredAt, id): una tarea que falla y queda libre no se repite en la misma pasada.
  let cursor: { at: string; id: string } | null = null;
  let seen = 0;
  while (seen < RUN_CAP) {
    const want = Math.min(BATCH, RUN_CAP - seen);
    const due: { id: string; at: Date }[] = await dueWaitingIds(now, tz, cursor, want);
    if (!due.length) break;
    seen += due.length;
    const last = due[due.length - 1]!;
    cursor = { at: last.at.toISOString(), id: last.id };
    const rows = await db.task.findMany({
      where: { id: { in: due.map((d) => d.id) }, archivedAt: null, waitingNotifiedAt: null, column: { role: "WAITING", isDone: false } },
      orderBy: [{ columnEnteredAt: "asc" }, { id: "asc" }],
      select: { id: true, projectId: true, columnId: true, assigneeId: true, createdById: true, columnEnteredAt: true, column: { select: { waitingDays: true } } },
    });
    sent += await remindBatch(rows, now, tz);
    if (due.length < want) break;
  }
  if (sent) logEvent({ category: "notify", action: "notify.waiting", message: `${sent} recordatorio(s) de tareas en espera enviados`, details: { count: sent } });
  return sent;
}

/**
 * Tareas en una columna «Esperando» que ya llevan `waitingDays` (3 por defecto) días naturales en la zona de la app,
 * sin aviso, de más antigua a más nueva, a partir de `cursor`. Es la misma cuenta de calendarDaysSince (dates.ts).
 */
async function dueWaitingIds(now: Date, tz: string, cursor: { at: string; id: string } | null, limit: number): Promise<{ id: string; at: Date }[]> {
  const nowIso = now.toISOString();
  const after = cursor ? Prisma.sql`AND (t."columnEnteredAt", t."id") > (${cursor.at}::timestamp, ${cursor.id})` : Prisma.empty;
  const rows = await db.$queryRaw<{ id: string; at: Date }[]>`
    SELECT t."id" AS "id", t."columnEnteredAt" AS "at"
    FROM "Task" t JOIN "Column" c ON c."id" = t."columnId"
    WHERE t."archivedAt" IS NULL AND t."waitingNotifiedAt" IS NULL AND c."role" = 'WAITING' AND c."isDone" = false
      AND ((${nowIso}::timestamptz AT TIME ZONE ${tz})::date - ((t."columnEnteredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date) >= COALESCE(c."waitingDays", ${DEFAULT_WAITING_DAYS})
      ${after}
    ORDER BY t."columnEnteredAt" ASC, t."id" ASC
    LIMIT ${limit}`;
  return rows;
}

async function remindBatch(
  rows: { id: string; projectId: string; columnId: string; assigneeId: string | null; createdById: string | null; columnEnteredAt: Date; column: { waitingDays: number | null } }[],
  now: Date,
  tz: string,
): Promise<number> {
  let sent = 0;
  for (const task of rows) {
    // Días naturales en la zona de la app: la misma cuenta que resalta la tarjeta del tablero.
    const days = calendarDaysSince(task.columnEnteredAt, now, tz);
    if (days < (task.column.waitingDays ?? DEFAULT_WAITING_DAYS)) continue;
    let claimed = false;
    try {
      // Se reclama la tarea antes de avisar: dos procesos a la vez (o una pasada solapada) no envían dos veces.
      const claim = await db.task.updateMany({ where: { id: task.id, columnId: task.columnId, waitingNotifiedAt: null }, data: { waitingNotifiedAt: now } });
      if (!claim.count) continue;
      claimed = true;
      const recipient = task.assigneeId ?? task.createdById;
      if (!recipient) continue;
      const r = await notifyTask({ type: "WAITING", actorId: null, taskId: task.id, projectId: task.projectId, recipientIds: [recipient], excerpt: String(days), immediate: true });
      sent += r.recipients.length;
    } catch (err) {
      console.error("[waiting]", err);
      // Si el aviso falló, se libera la reclamación para reintentarlo en la siguiente pasada.
      if (claimed) await db.task.updateMany({ where: { id: task.id, columnId: task.columnId, waitingNotifiedAt: now }, data: { waitingNotifiedAt: null } }).catch(() => {});
    }
  }
  return sent;
}
