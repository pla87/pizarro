"use server";

import { z } from "zod";
import { describeAction, noteProject } from "@/lib/action-context";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertProjectAccess, visibleProjectsWhere } from "@/lib/access";
import { AppError, notFound } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/positions";
import { requireUser } from "@/lib/session";
import { addUndo, captureTasks } from "@/lib/undo";
import * as v from "@/lib/validation";
import type { BoardColumn } from "@/lib/types";

const columnSelect = { id: true, name: true, position: true, role: true, isDone: true } as const;

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
    addUndo(...before.map((c) => ({ t: "column.set" as const, id: c.id, data: { role: c.role } })), ...(await captureTasks(fixed.map((t) => t.id), ["evergreen"])));
    describeAction("Cambió el rol de la columna «{name}»", { name: column.name });
    await db.$transaction(async (tx) => {
      if (value !== "NONE") {
        await tx.column.updateMany({ where: { projectId: column.projectId, role: value }, data: { role: "NONE" } });
      }
      await tx.column.update({ where: { id: columnId }, data: { role: value } });
      // Las tareas fijas solo existen en la columna de release: si deja de serlo, pasan a ser normales.
      if (value !== "NEXT_RELEASE") await tx.task.updateMany({ where: { columnId, evergreen: true }, data: { evergreen: false } });
      else await tx.task.updateMany({ where: { projectId: column.projectId, evergreen: true, columnId: { not: columnId } }, data: { evergreen: false } });
    });
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
    addUndo(
      ...archived.map((t) => ({ t: "task.set" as const, id: t.id, data: { columnId: column.id } })),
      { t: "column.restore", row: { id: column.id, projectId: column.projectId, name: column.name, position: column.position, role: column.role, isDone: column.isDone } },
    );
    await db.$transaction(async (tx) => {
      const active = await tx.task.count({ where: { columnId, archivedAt: null } });
      if (active > 0) throw new AppError("La columna todavía tiene tarjetas. Muévelas antes de borrarla.");
      // Solo se reubican las archivadas. Si alguien suelta una tarjeta activa a la vez,
      // la clave foránea (Restrict) hace fallar el borrado en lugar de moverla en silencio.
      await tx.task.updateMany({ where: { columnId, archivedAt: { not: null } }, data: { columnId: other.id } });
      await tx.column.delete({ where: { id: columnId } });
    });
    describeAction("Borró la columna «{name}»", { name: column.name });
  });
}
