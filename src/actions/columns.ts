"use server";

import { z } from "zod";
import { describeAction, noteProject } from "@/lib/action-context";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertProjectAccess, visibleProjectsWhere } from "@/lib/access";
import { AppError, notFound } from "@/lib/errors";
import { DEFAULT_WAITING_DAYS, isUniqueColumnRole, MAX_WAITING_DAYS } from "@/lib/constants";
import { POSITION_STEP } from "@/lib/positions";
import { lastPositionIn, lockColumns, setTaskColumnPositions, TASK_ORDER } from "@/lib/task-positions";
import { requireUser } from "@/lib/session";
import { normalizeTaskFields } from "@/lib/task-fields";
import { addUndo, captureTasks } from "@/lib/undo";
import * as v from "@/lib/validation";
import type { BoardColumn } from "@/lib/types";

const columnSelect = { id: true, name: true, position: true, role: true, isDone: true, waitingDays: true, routineTargetColumnId: true } as const;

async function findColumn(columnId: string) {
  const user = await requireUser();
  const column = await db.column.findFirst({
    where: { id: v.id.parse(columnId), project: visibleProjectsWhere(user) },
    select: { ...columnSelect, projectId: true },
  });
  if (!column) throw notFound();
  noteProject(column.projectId);
  return column;
}

export async function createColumn(projectId: string, name: string) {
  return runAction({ name: "columns.createColumn", args: [projectId, name] }, async (): Promise<BoardColumn> => {
    const user = await requireUser();
    await assertProjectAccess(user, v.id.parse(projectId));
    const count = await db.column.count({ where: { projectId } });
    if (count >= 30) throw new AppError("Máximo 30 columnas por proyecto.");
    const last = await db.column.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } });
    describeAction("Creó la columna «{name}»", { name: v.name.parse(name) });
    const column = await db.column.create({
      data: { projectId, name: v.name.parse(name), position: (last?.position ?? 0) + POSITION_STEP },
      select: columnSelect,
    });
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
    // Deshacer: roles de todas las columnas y las tareas fijas que dejarían de serlo.
    const before = await db.column.findMany({ where: { projectId: column.projectId }, select: { id: true, role: true } });
    const fixed = await db.task.findMany({ where: { projectId: column.projectId, evergreen: true }, select: { id: true } });
    addUndo(...before.map((c) => ({ t: "column.set" as const, id: c.id, data: { role: c.role } })), ...(await captureTasks(fixed.map((t) => t.id), ["evergreen", "evergreenEvery"])));
    describeAction("Cambió el rol de la columna «{name}»", { name: column.name });
    // Una columna de presupuesto suma el coste de sus tareas: el campo Coste se activa si no lo estaba.
    const project = value === "BUDGET" ? await db.project.findUniqueOrThrow({ where: { id: column.projectId }, select: { taskFields: true } }) : null;
    const enablesCost = project !== null && !project.taskFields.includes("cost");
    await db.$transaction(async (tx) => {
      if (enablesCost) await tx.project.update({ where: { id: column.projectId }, data: { taskFields: normalizeTaskFields([...project!.taskFields, "cost"]) } });
      // Solo NEXT_RELEASE e IN_PRODUCTION son únicos; WAITING, WEEKLY_PLAN y BUDGET se pueden repetir.
      if (isUniqueColumnRole(value)) {
        await tx.column.updateMany({ where: { projectId: column.projectId, role: value }, data: { role: "NONE" } });
      }
      await tx.column.update({ where: { id: columnId }, data: { role: value } });
      // Una columna que pasa a «Esperando» cuenta la espera desde ahora: sin esto, las tareas antiguas recibirían de golpe un aviso cada una.
      if (value === "WAITING" && column.role !== "WAITING") await tx.task.updateMany({ where: { columnId, archivedAt: null }, data: { columnEnteredAt: new Date(), waitingNotifiedAt: null } });
      // Las tareas fijas solo existen en la columna de release: si deja de serlo, pasan a ser normales.
      if (value !== "NEXT_RELEASE") await tx.task.updateMany({ where: { columnId, evergreen: true }, data: { evergreen: false, evergreenEvery: 1 } });
      else await tx.task.updateMany({ where: { projectId: column.projectId, evergreen: true, columnId: { not: columnId } }, data: { evergreen: false, evergreenEvery: 1 } });
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
    addUndo(...columns.map((c) => ({ t: "column.set" as const, id: c.id, data: { position: c.position } })));
    describeAction(dir < 0 ? "Movió la columna «{name}» a la izquierda" : "Movió la columna «{name}» a la derecha", { name: column.name });
    const idx = columns.findIndex((c) => c.id === columnId);
    const target = idx + dir;
    if (target < 0 || target >= columns.length) return;
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
      { t: "column.restore", row: { id: column.id, projectId: column.projectId, name: column.name, position: column.position, role: column.role, isDone: column.isDone, waitingDays: column.waitingDays, routineTargetColumnId: column.routineTargetColumnId } },
    );
    await db.$transaction(async (tx) => {
      const active = await tx.task.count({ where: { columnId, archivedAt: null } });
      if (active > 0) throw new AppError("La columna todavía tiene tarjetas. Muévelas antes de borrarla.");
      // Solo se reubican las archivadas, al final de la otra columna y en su orden (sin compartir posición con
      // las de allí). Si alguien suelta una tarjeta activa a la vez, la clave foránea (Restrict) hace fallar el
      // borrado en lugar de moverla en silencio.
      await lockColumns(tx, [other.id]);
      const rows = await tx.task.findMany({ where: { columnId, archivedAt: { not: null } }, orderBy: TASK_ORDER, select: { id: true } });
      let pos = (await lastPositionIn(tx, other.id)) ?? 0;
      await setTaskColumnPositions(rows.map((r) => ({ id: r.id, position: (pos += POSITION_STEP) })), other.id, { client: tx });
      await tx.column.delete({ where: { id: columnId } });
    });
    describeAction("Borró la columna «{name}»", { name: column.name });
  });
}
