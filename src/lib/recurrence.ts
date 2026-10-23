import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { dateToIso, isoToDate, todayIso } from "./dates";
import { db } from "./db";
import { appTimeZone, loadBoardTask } from "./board";
import { nextOccurrenceDue } from "./recurrence-date";
import { POSITION_STEP } from "./positions";
import { addUndo } from "./undo";
import type { BoardTask } from "./types";

/** El responsable pasa a la siguiente aparición solo si sigue pudiendo tenerla (activo y con acceso). */
async function stillAssignable(projectId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [user, project] = await Promise.all([
    db.user.findFirst({ where: { id: userId, active: true }, select: { role: true, memberships: { where: { projectId }, select: { userId: true } } } }),
    db.project.findUnique({ where: { id: projectId }, select: { isPrivate: true } }),
  ]);
  if (!user || !project) return null;
  return user.memberships.length || (!project.isPrivate && user.role === "ADMIN") ? userId : null;
}

/**
 * Crea la siguiente aparición de las tareas recurrentes que se acaban de terminar (movidas a una columna
 * «terminada») o archivar. Es idempotente: `recurrenceFromId` es único, así que de cada tarea solo sale una
 * siguiente, aunque se mueva varias veces, se archive después de terminarla o dos personas lo hagan a la vez.
 *
 * La nueva copia lleva los mismos campos (subtareas sin marcar; sin comentarios, adjuntos ni historial),
 * la misma repetición y la fecha límite que marca la regla. Va al final de la primera columna no terminada
 * o, si la tarea no estaba en una terminada (p. ej. se archivó desde «En curso»), de su misma columna.
 * Deshacer la acción que la provocó quita también la copia (operación inversa anotada aquí).
 */
export async function spawnRecurrences(taskIds: string[], actorId: string): Promise<BoardTask[]> {
  if (!taskIds.length) return [];
  const sources = await db.task.findMany({
    where: { id: { in: taskIds }, recurrence: { not: "NONE" }, recurrenceNext: null },
    orderBy: [{ column: { position: "asc" } }, { position: "asc" }],
    select: {
      id: true, projectId: true, columnId: true, title: true, description: true, kindId: true, color: true, linkUrl: true,
      assigneeId: true, dueDate: true, deliverableId: true, recurrence: true, recurrenceDay: true,
      column: { select: { isDone: true } },
      labels: { select: { labelId: true } },
      subtasks: { orderBy: { position: "asc" }, select: { title: true, position: true } },
    },
  });
  if (!sources.length) return [];
  const today = todayIso(appTimeZone());
  const created: string[] = [];
  const firstOpen = new Map<string, string | null>();

  for (const src of sources) {
    if (src.recurrence === "NONE") continue;
    let columnId = src.columnId;
    if (src.column.isDone) {
      if (!firstOpen.has(src.projectId)) {
        const open = await db.column.findFirst({ where: { projectId: src.projectId, isDone: false }, orderBy: { position: "asc" }, select: { id: true } });
        firstOpen.set(src.projectId, open?.id ?? null);
      }
      columnId = firstOpen.get(src.projectId) ?? src.columnId;
    }
    const last = await db.task.findFirst({ where: { columnId }, orderBy: { position: "desc" }, select: { position: true } });
    const dueDate = isoToDate(nextOccurrenceDue(src.recurrence, src.recurrenceDay, dateToIso(src.dueDate), today));
    try {
      const next = await db.task.create({
        data: {
          projectId: src.projectId,
          columnId,
          title: src.title,
          description: src.description,
          kindId: src.kindId,
          color: src.color,
          linkUrl: src.linkUrl,
          assigneeId: await stillAssignable(src.projectId, src.assigneeId),
          deliverableId: src.deliverableId,
          dueDate,
          recurrence: src.recurrence,
          recurrenceDay: src.recurrenceDay,
          recurrenceFromId: src.id,
          position: (last?.position ?? 0) + POSITION_STEP,
          createdById: actorId,
          labels: { create: src.labels.map((l) => ({ labelId: l.labelId })) },
          subtasks: { create: src.subtasks.map((s) => ({ title: s.title, position: s.position })) },
        },
        select: { id: true },
      });
      created.push(next.id);
      addUndo({ t: "task.remove", id: next.id });
    } catch (err) {
      // Otra petición ya creó la siguiente aparición de esta tarea: nada que hacer.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  return Promise.all(created.map((id) => loadBoardTask(id)));
}
