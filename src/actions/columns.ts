"use server";

import { z } from "zod";
import { describeAction, noteProject } from "@/lib/action-context";
import { columnsLockName } from "@/lib/advisory-locks";
import { assertFitsProgramRole } from "@/lib/column-capacity";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertProjectAccess, visibleProjectsWhere } from "@/lib/access";
import { AppError, notFound } from "@/lib/errors";
import { DEFAULT_WAITING_DAYS, EVERGREEN_COLUMN_ROLES, hasEvergreenTasks, isUniqueColumnRole, MAX_WAITING_DAYS } from "@/lib/constants";
import { POSITION_STEP } from "@/lib/positions";
import { lastPositionIn, lockColumns, setTaskColumnPositions, TASK_ORDER } from "@/lib/task-positions";
import { requireUser } from "@/lib/session";
import { isValidWipLimit, WIP_MAX, WIP_MIN } from "@/lib/wip";
import { normalizeTaskFields } from "@/lib/task-fields";
import { addUndo, captureTasks } from "@/lib/undo";
import * as v from "@/lib/validation";
import type { BoardColumn } from "@/lib/types";
import { getT } from "@/i18n/server";

const columnSelect = { id: true, name: true, position: true, role: true, isDone: true, waitingDays: true, routineTargetColumnId: true, wipLimit: true } as const;

async function findColumn(columnId: string) {
  const user = await requireUser();
  const column = await db.column.findFirst({
    where: { id: v.id.parse(columnId), project: visibleProjectsWhere(user) },
    select: { ...columnSelect, projectId: true, planCount: true },
  });
  if (!column) throw notFound();
  noteProject(column.projectId);
  return column;
}

export async function createColumn(projectId: string, name: string) {
  return runAction({ name: "columns.createColumn", args: [projectId, name] }, async (): Promise<BoardColumn> => {
    const user = await requireUser();
    await assertProjectAccess(user, v.id.parse(projectId));
    const colName = v.name.parse(name);
    // Bloqueo por proyecto: dos altas a la vez no pueden pasar del tope ni calcular la misma posición.
    const column = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${columnsLockName(projectId)}))`;
      const count = await tx.column.count({ where: { projectId } });
      if (count >= 30) throw new AppError("Máximo 30 columnas por proyecto.");
      const last = await tx.column.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } });
      return tx.column.create({
        data: { projectId, name: colName, position: (last?.position ?? 0) + POSITION_STEP },
        select: columnSelect,
      });
    });
    describeAction("Creó la columna «{name}»", { name: colName });
    addUndo({ t: "column.remove", id: column.id });
    return column;
  });
}

export async function renameColumn(columnId: string, name: string) {
  return runAction({ name: "columns.renameColumn", args: [columnId, name] }, async () => {
    const column = await findColumn(columnId);
    addUndo({ t: "column.set", id: column.id, data: { name: column.name } });
    await db.column.update({ where: { id: columnId }, data: { name: v.name.parse(name) } });
    describeAction("Renombró la columna «{from}» a «{to}»", { from: column.name, to: v.name.parse(name) });
  });
}

/** Asigna un rol funcional; si otra columna del proyecto lo tenía, pasa a NONE. */
export async function setColumnRole(columnId: string, role: string) {
  return runAction({ name: "columns.setColumnRole", args: [columnId, role] }, async () => {
    const column = await findColumn(columnId);
    const value = v.columnRole.parse(role);
    // Si la columna deja de ser «Esperando» o «Rutinas», se borra su plazo de espera o su destino (y el deshacer los devuelve).
    const clearWaiting = column.role === "WAITING" && value !== "WAITING";
    const clearRoutine = column.role === "ROUTINES" && value !== "ROUTINES";
    // Deshacer: solo lo que cambia (esta columna, la que tenía el rol si es único y las tareas fijas que dejan de serlo),
    // para no pisar al deshacer los roles que otras personas hayan cambiado en otras columnas.
    const [holders, fixed] = await Promise.all([
      isUniqueColumnRole(value) ? db.column.findMany({ where: { projectId: column.projectId, role: value, id: { not: columnId } }, select: { id: true } }) : [],
      db.task.findMany({
        // Pierden la marca las de esta columna si su rol nuevo no tiene fijas y, con un rol único (la release), las de la
        // columna que lo tenía y lo pierde. Las de otras columnas de plan para IA se conservan.
        where: {
          projectId: column.projectId, evergreen: true,
          OR: [
            ...(hasEvergreenTasks(value) ? [] : [{ columnId }]),
            ...(isUniqueColumnRole(value) && hasEvergreenTasks(value) ? [{ columnId: { not: columnId }, column: { role: value } }] : []),
          ],
        },
        select: { id: true },
      }),
    ]);
    addUndo(
      { t: "column.set", id: column.id, data: { role: column.role, ...(clearWaiting ? { waitingDays: column.waitingDays } : {}), ...(clearRoutine ? { routineTargetColumnId: column.routineTargetColumnId } : {}) } },
      ...holders.map((c) => ({ t: "column.set" as const, id: c.id, data: { role: value } })),
      ...(await captureTasks(fixed.map((t) => t.id), ["evergreen", "evergreenEvery"])),
    );
    describeAction("Cambió el rol de la columna «{name}»", { name: column.name });
    // Una columna de presupuesto suma el coste de sus tareas: el campo Coste se activa si no lo estaba.
    const project = value === "BUDGET" ? await db.project.findUniqueOrThrow({ where: { id: column.projectId }, select: { taskFields: true } }) : null;
    const enablesCost = project !== null && !project.taskFields.includes("cost");
    await db.$transaction(async (tx) => {
      // «Programa del curso»: como mucho PROGRAM_MAX_SESSIONS sesiones; con más tareas no se le da el rol (con la
      // columna bloqueada, para que nadie meta tareas a la vez: column-capacity.ts).
      if (value === "PROGRAM" && column.role !== "PROGRAM") await assertFitsProgramRole(tx, column);
      if (enablesCost) await tx.project.update({ where: { id: column.projectId }, data: { taskFields: normalizeTaskFields([...project!.taskFields, "cost"]) } });
      // Solo NEXT_RELEASE e IN_PRODUCTION son únicos; WAITING, WEEKLY_PLAN y BUDGET se pueden repetir.
      if (isUniqueColumnRole(value)) {
        await tx.column.updateMany({ where: { projectId: column.projectId, role: value }, data: { role: "NONE" } });
      }
      await tx.column.update({ where: { id: columnId }, data: { role: value, ...(clearWaiting ? { waitingDays: null } : {}), ...(clearRoutine ? { routineTargetColumnId: null } : {}) } });
      // Una columna que pasa a «Esperando» cuenta la espera desde ahora: sin esto, las tareas antiguas recibirían de golpe un aviso cada una.
      if (value === "WAITING" && column.role !== "WAITING") await tx.task.updateMany({ where: { columnId, archivedAt: null }, data: { columnEnteredAt: new Date(), waitingNotifiedAt: null } });
      // Las tareas fijas solo existen en la columna de release y en las de plan para IA: las que quedan fuera pasan a normales.
      await tx.task.updateMany({ where: { projectId: column.projectId, evergreen: true, column: { role: { notIn: [...EVERGREEN_COLUMN_ROLES] } } }, data: { evergreen: false, evergreenEvery: 1 } });
    });
    return { costEnabled: enablesCost };
  });
}

/** Días que una tarea puede esperar en una columna WAITING antes de recordárselo a su responsable (null = por defecto). */
export async function setColumnWaitingDays(columnId: string, days: number | null) {
  return runAction({ name: "columns.setColumnWaitingDays", args: [columnId, days] }, async () => {
    const column = await findColumn(columnId);
    if (column.role !== "WAITING") throw new AppError("Solo las columnas con el rol «Esperando» tienen plazo de espera.");
    const value = days === null ? null : z.number().int("Indica un número entero de días.").min(1, "Mínimo 1 día.").max(MAX_WAITING_DAYS, `Máximo ${MAX_WAITING_DAYS} días.`).parse(days);
    const current = await db.column.findUniqueOrThrow({ where: { id: columnId }, select: { waitingDays: true } });
    addUndo({ t: "column.set", id: column.id, data: { waitingDays: current.waitingDays } });
    describeAction("Cambió el plazo de espera de la columna «{name}» a {days} d", { name: column.name, days: value ?? DEFAULT_WAITING_DAYS });
    await db.column.update({ where: { id: columnId }, data: { waitingDays: value } });
  });
}

/**
 * Límite orientativo de tarjetas (1-999, null = sin límite). Solo avisa en el tablero al pasarlo; nunca impide mover
 * ni crear tarjetas. Se puede deshacer.
 */
export async function setColumnWipLimit(columnId: string, limit: number | null) {
  return runAction({ name: "columns.setColumnWipLimit", args: [columnId, limit] }, async () => {
    const column = await findColumn(columnId);
    const value = limit === null ? null : z.number().int("Indica un número entero de tarjetas.").parse(limit);
    // El rango se comprueba aparte para dar el texto ya traducido (con {min} y {max} no hay clave fija que traducir después).
    if (value !== null && !isValidWipLimit(value)) {
      const t = await getT();
      throw new AppError(t("Indica un número entero entre {min} y {max}, o déjalo vacío.", { min: WIP_MIN, max: WIP_MAX }));
    }
    if (value === column.wipLimit) return;
    addUndo({ t: "column.set", id: column.id, data: { wipLimit: column.wipLimit } });
    if (value === null) describeAction("Quitó el límite de tarjetas de la columna «{name}»", { name: column.name });
    else if (value === 1) describeAction("Puso un límite de 1 tarjeta a la columna «{name}»", { name: column.name });
    else describeAction("Puso un límite de {n} tarjetas a la columna «{name}»", { name: column.name, n: value });
    await db.column.update({ where: { id: columnId }, data: { wipLimit: value } });
  });
}

/** Rutinas: columna a la que va la siguiente aparición de una tarea recurrente de esta columna (null = la misma). */
export async function setColumnRoutineTarget(columnId: string, targetId: string | null) {
  return runAction({ name: "columns.setColumnRoutineTarget", args: [columnId, targetId] }, async () => {
    const column = await findColumn(columnId);
    if (column.role !== "ROUTINES") throw new AppError("Solo las columnas con el rol «Rutinas» tienen destino de la siguiente aparición.");
    const value = targetId === null || targetId === columnId ? null : v.id.parse(targetId);
    if (value) {
      const target = await db.column.findFirst({ where: { id: value, projectId: column.projectId }, select: { isDone: true, role: true } });
      if (!target) throw notFound();
      if (target.isDone || target.role === "ROUTINES") throw new AppError("El destino no puede ser una columna terminada ni otra columna de rutinas.");
    }
    addUndo({ t: "column.set", id: column.id, data: { routineTargetColumnId: column.routineTargetColumnId } });
    describeAction("Cambió el destino de la siguiente aparición de la columna «{name}»", { name: column.name });
    await db.column.update({ where: { id: columnId }, data: { routineTargetColumnId: value } });
  });
}

/** Marca si las tarjetas de la columna cuentan como terminadas (informe y plazos). */
export async function setColumnDone(columnId: string, isDone: boolean) {
  return runAction({ name: "columns.setColumnDone", args: [columnId, isDone] }, async () => {
    const column = await findColumn(columnId);
    addUndo({ t: "column.set", id: column.id, data: { isDone: column.isDone } });
    describeAction(isDone ? "Marcó la columna «{name}» como terminada" : "Desmarcó la columna «{name}» como terminada", { name: column.name });
    await db.column.update({ where: { id: columnId }, data: { isDone: z.boolean().parse(isDone) } });
  });
}

/** Mueve la columna una posición a la izquierda (-1) o derecha (+1). */
export async function moveColumn(columnId: string, direction: number) {
  return runAction({ name: "columns.moveColumn", args: [columnId, direction] }, async () => {
    const column = await findColumn(columnId);
    const dir = z.union([z.literal(-1), z.literal(1)]).parse(direction);
    const columns = await db.column.findMany({
      where: { projectId: column.projectId },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });
    const idx = columns.findIndex((c) => c.id === columnId);
    const target = idx + dir;
    // Ya en el extremo: no hay nada que mover, ni que deshacer, ni que anotar.
    if (idx < 0 || target < 0 || target >= columns.length) return;
    addUndo(...columns.map((c) => ({ t: "column.set" as const, id: c.id, data: { position: c.position } })));
    describeAction(dir < 0 ? "Movió la columna «{name}» a la izquierda" : "Movió la columna «{name}» a la derecha", { name: column.name });
    [columns[idx], columns[target]] = [columns[target]!, columns[idx]!];
    await db.$transaction(
      columns.map((c, i) => db.column.update({ where: { id: c.id }, data: { position: (i + 1) * POSITION_STEP } })),
    );
  });
}

/** Solo se puede borrar una columna sin tarjetas visibles. Las archivadas se reubican. */
export async function deleteColumn(columnId: string) {
  return runAction({ name: "columns.deleteColumn", args: [columnId] }, async () => {
    const column = await findColumn(columnId);
    const other = await db.column.findFirst({
      where: { projectId: column.projectId, id: { not: columnId } },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (!other) throw new AppError("Un proyecto necesita al menos una columna.");
    // Deshacer: la columna (se recrea primero) y la columna de sus archivadas.
    const archived = await db.task.findMany({ where: { columnId, archivedAt: { not: null } }, select: { id: true } });
    // Se aplican en orden inverso: primero se recrea la columna y luego vuelven sus archivadas.
    // Las columnas de rutinas que apuntaban a esta (el borrado deja su destino en null) se vuelven a apuntar al final.
    const pointing = await db.column.findMany({ where: { projectId: column.projectId, routineTargetColumnId: columnId }, select: { id: true } });
    addUndo(
      ...pointing.map((c) => ({ t: "column.set" as const, id: c.id, data: { routineTargetColumnId: column.id } })),
      ...archived.map((t) => ({ t: "task.set" as const, id: t.id, data: { columnId: column.id } })),
      { t: "column.restore", row: { id: column.id, projectId: column.projectId, name: column.name, position: column.position, role: column.role, isDone: column.isDone, waitingDays: column.waitingDays, routineTargetColumnId: column.routineTargetColumnId, wipLimit: column.wipLimit, planCount: column.planCount } },
    );
    await db.$transaction(async (tx) => {
      // Bloqueo de las columnas del proyecto (el de createColumn) y la otra columna, otra vez dentro: borrar a la vez las
      // dos últimas columnas dejaba el proyecto sin ninguna (las dos veían a la otra antes de que nadie borrase).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${columnsLockName(column.projectId)}))`;
      const target = await tx.column.findFirst({
        where: { projectId: column.projectId, id: { not: columnId } },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      if (!target) throw new AppError("Un proyecto necesita al menos una columna.");
      const active = await tx.task.count({ where: { columnId, archivedAt: null } });
      if (active > 0) throw new AppError("La columna todavía tiene tarjetas. Muévelas antes de borrarla.");
      // Solo se reubican las archivadas, al final de la otra columna y en su orden (sin compartir posición con
      // las de allí). Si alguien suelta una tarjeta activa a la vez, la clave foránea (Restrict) hace fallar el
      // borrado en lugar de moverla en silencio.
      await lockColumns(tx, [target.id]);
      const rows = await tx.task.findMany({ where: { columnId, archivedAt: { not: null } }, orderBy: TASK_ORDER, select: { id: true } });
      let pos = (await lastPositionIn(tx, target.id)) ?? 0;
      await setTaskColumnPositions(rows.map((r) => ({ id: r.id, position: (pos += POSITION_STEP) })), target.id, { client: tx });
      await tx.column.delete({ where: { id: columnId } });
    });
    describeAction("Borró la columna «{name}»", { name: column.name });
  });
}
