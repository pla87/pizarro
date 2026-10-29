import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { dateToIso, isoToDate, todayIso } from "./dates";
import { db } from "./db";
import { appTimeZone, loadBoardTask } from "./board";
import { nextOccurrenceDue } from "./recurrence-date";
import { POSITION_STEP } from "./positions";
import { lastPositionIn, lockColumns } from "./task-positions";
import { addUndo } from "./undo";
import { hasTaskCapacity } from "./caps";
import { logEvent } from "./log";
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
 * Columna ROUTINES de la que cuelga una tarea recurrente (en la que está o la última en la que estuvo) y columna
 * donde nace su siguiente aparición: la destino configurada o, por defecto, la propia columna de rutinas
 * (salvo que cuente como terminada: entonces se sigue la regla general). null si no viene de una rutina.
 */
async function routineColumnOf(src: { projectId: string; columnId: string; routineColumnId: string | null; column: { role: string } }): Promise<{ columnId: string; targetId: string } | null> {
  const id = src.column.role === "ROUTINES" ? src.columnId : src.routineColumnId;
  if (!id) return null;
  const col = await db.column.findFirst({ where: { id, projectId: src.projectId, role: "ROUTINES" }, select: { id: true, isDone: true, routineTargetColumnId: true } });
  if (!col) return null;
  if (col.routineTargetColumnId) return { columnId: col.id, targetId: col.routineTargetColumnId };
  return col.isDone ? null : { columnId: col.id, targetId: col.id };
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
 * `titles` (taskId → título) sustituye al guardado: el despliegue de una release antepone un código al título
 * y la siguiente aparición debe nacer con el original.
 */
export async function spawnRecurrences(taskIds: string[], actorId: string, titles?: Map<string, string>): Promise<BoardTask[]> {
  if (!taskIds.length) return [];
  const sources = await db.task.findMany({
    where: { id: { in: taskIds }, recurrence: { not: "NONE" }, recurrenceNext: null },
    orderBy: [{ column: { position: "asc" } }, { position: "asc" }],
    select: {
      id: true, projectId: true, columnId: true, title: true, description: true, kindId: true, color: true, linkUrl: true,
      assigneeId: true, dueDate: true, deliverableId: true, recurrence: true, recurrenceDay: true,
      routineColumnId: true,
      column: { select: { isDone: true, role: true } },
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
    // Rutinas: si la tarea vive (o vivió) en una columna ROUTINES, la siguiente aparición va a su columna destino.
    const routine = await routineColumnOf(src);
    if (routine) columnId = routine.targetId;
    else if (src.column.isDone) {
      if (!firstOpen.has(src.projectId)) {
        const open = await db.column.findFirst({ where: { projectId: src.projectId, isDone: false }, orderBy: { position: "asc" }, select: { id: true } });
        firstOpen.set(src.projectId, open?.id ?? null);
      }
      columnId = firstOpen.get(src.projectId) ?? src.columnId;
    }
    // Proyecto en el tope de tareas activas: no nace la siguiente aparición (y mover la tarjeta no falla).
    if (!(await hasTaskCapacity(db, src.projectId))) {
      logEvent({
        level: "warn", category: "system", action: "recurrence.skippedCap",
        message: `No se creó la siguiente aparición de «${src.title}»: el proyecto tiene el máximo de tareas activas`,
        details: { taskId: src.id, projectId: src.projectId },
      });
      continue;
    }
    const dueDate = isoToDate(nextOccurrenceDue(src.recurrence, src.recurrenceDay, dateToIso(src.dueDate), today));
    const assigneeId = await stillAssignable(src.projectId, src.assigneeId);
    try {
      // Al final de la columna, con la columna bloqueada (sin compartir posición con otra tarea).
      const next = await db.$transaction(async (tx) => {
        await lockColumns(tx, [columnId]);
        const last = await lastPositionIn(tx, columnId);
        return tx.task.create({
          data: {
            projectId: src.projectId,
            columnId,
            title: titles?.get(src.id) ?? src.title,
            description: src.description,
            kindId: src.kindId,
            color: src.color,
            linkUrl: src.linkUrl,
            assigneeId,
            deliverableId: src.deliverableId,
            dueDate,
            recurrence: src.recurrence,
            recurrenceDay: src.recurrenceDay,
            recurrenceFromId: src.id,
            routineColumnId: routine?.columnId ?? null,
            position: (last ?? 0) + POSITION_STEP,
            createdById: actorId,
            labels: { create: src.labels.map((l) => ({ labelId: l.labelId })) },
            subtasks: { create: src.subtasks.map((s) => ({ title: s.title, position: s.position })) },
          },
          select: { id: true },
        });
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
