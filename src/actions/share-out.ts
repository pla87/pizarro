"use server";

import { z } from "zod";
import { describeAction, noteProject } from "@/lib/action-context";
import { visibleProjectsWhere } from "@/lib/access";
import { runAction } from "@/lib/action";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { appUrl } from "@/lib/mail";
import { requireAdmin, requireUser } from "@/lib/session";
import { revokeProjectShares } from "@/lib/share-out";
import { boardShareOf, isShareColumn, isShareExpiry, shareLinkState, type BoardShareInfo } from "@/lib/share-out-board";
import { hashShareToken, MAX_SHARE_TASKS, newShareToken, shareUrl } from "@/lib/share-out-core";
import { TASK_ORDER } from "@/lib/task-positions";
import * as v from "@/lib/validation";

// «Compartir fuera» desde la app: activarla en el proyecto (administradores), generar o actualizar la web de una columna,
// el selector de caducidad y revocar el enlace. Convertir una columna en «Compartir fuera» y quitárselo están en
// columns.ts (es un cambio de rol). Nada de esto se deshace: un enlace revocado no vuelve, y uno nuevo es otro enlace.
// El token solo existe en la respuesta de la acción que lo crea: en la base, solo su huella.

/** La columna (con permiso para ver su proyecto) y su fila; la función debe estar activada en el proyecto. */
async function findShareColumn(columnId: string) {
  const user = await requireUser();
  const column = await db.column.findFirst({
    where: { id: v.id.parse(columnId), project: visibleProjectsWhere(user) },
    select: { id: true, name: true, role: true, assigneeId: true, assignDueDays: true, projectId: true, project: { select: { shareOutEnabled: true } }, share: true },
  });
  if (!column) throw notFound();
  noteProject(column.projectId);
  if (!column.project.shareOutEnabled) throw new AppError("«Compartir fuera» no está activado en este proyecto.");
  if (!isShareColumn(column) || !column.share) throw new AppError("Esta columna no es una columna «Compartir fuera».");
  return { user, column, share: column.share };
}

/** Resultado de generar o actualizar: la dirección solo cuando se acaba de crear el enlace (después no se puede saber). */
interface ShareWebResult {
  url: string | null;
  info: BoardShareInfo;
  published: number;
  /** Tareas de la columna que no caben en la web (pasan de MAX_SHARE_TASKS). */
  left: number;
}

/**
 * «Generar web» / «Actualizar web»: guarda las tareas que hay ahora en la columna (sin archivadas, como mucho
 * MAX_SHARE_TASKS, en su orden) y cuenta como uso. Con un enlace activo lo mantiene (la misma dirección); sin él (aún sin
 * generar, caducado o revocado) o con `fresh`, crea otro y el anterior pasa a decir «ha caducado» 30 días.
 */
export async function generateShareWeb(columnId: string, opts: { fresh?: boolean } = {}) {
  return runAction({ name: "shareOut.generate", args: [columnId, opts] }, async (): Promise<ShareWebResult> => {
    const { user, column, share } = await findShareColumn(columnId);
    const fresh = z.boolean().optional().parse(opts.fresh) ?? false;
    const now = new Date();
    const where = { columnId: column.id, archivedAt: null };
    const [rows, total] = await Promise.all([db.task.findMany({ where, orderBy: TASK_ORDER, select: { id: true }, take: MAX_SHARE_TASKS }), db.task.count({ where })]);
    const taskIds = rows.map((t) => t.id);
    const current = shareLinkState(share, now);
    const keep = current.state === "active" && !fresh;
    const token = keep ? null : newShareToken();
    const data = {
      taskIds, generatedAt: now, generatedById: user.id, generatedByName: user.name, lastUsedAt: now,
      ...(token ? {
        tokenHash: hashShareToken(token), revokedAt: null,
        // El enlace que se sustituye: «ha caducado» desde que terminó (o desde ahora, si seguía activo).
        ...(share.tokenHash ? { oldTokenHash: share.tokenHash, oldEndedAt: current.state === "active" ? now : (current.endsAt ?? now) } : {}),
      } : {}),
    };
    // Solo si nadie la ha cambiado entre medias (otra persona pudo generar a la vez: su enlace no se pisa sin saberlo).
    const { count } = await db.columnShare.updateMany({ where: { id: share.id, columnId: column.id, tokenHash: share.tokenHash }, data });
    if (!count) throw new AppError("Los datos han cambiado mientras tanto. Recarga e inténtalo de nuevo.");
    const row = await db.columnShare.findUniqueOrThrow({ where: { id: share.id } });
    if (token) describeAction(share.tokenHash ? "Creó un enlace nuevo para la web de «{col}» ({n} tareas)" : "Generó la web de «{col}» ({n} tareas)", { col: column.name, n: taskIds.length }, { shareId: share.id });
    else describeAction("Actualizó la web de «{col}» ({n} tareas)", { col: column.name, n: taskIds.length }, { shareId: share.id });
    return { url: token ? shareUrl(appUrl(), token) : null, info: boardShareOf(row, now), published: taskIds.length, left: Math.max(0, total - taskIds.length) };
  });
}

/** Selector de caducidad del pie (7 días, 1 mes, 3 meses): vale para el enlace actual desde su último uso. */
export async function setShareExpiry(columnId: string, days: number) {
  return runAction({ name: "shareOut.setExpiry", args: [columnId, days] }, async (): Promise<BoardShareInfo> => {
    const { column, share } = await findShareColumn(columnId);
    if (!isShareExpiry(days)) throw new AppError("Caducidad no válida.");
    const row = await db.columnShare.update({ where: { id: share.id }, data: { expiryDays: days } });
    describeAction("Cambió la caducidad de la web de «{col}» a {n} días sin uso", { col: column.name, n: days });
    return boardShareOf(row);
  });
}

/** «Revocar enlace»: deja de funcionar al momento; la columna sigue compartiéndose (con «Generar web» se crea otro). */
export async function revokeShareLink(columnId: string) {
  return runAction({ name: "shareOut.revoke", args: [columnId] }, async (): Promise<BoardShareInfo> => {
    const { column, share } = await findShareColumn(columnId);
    if (shareLinkState(share).state !== "active") return boardShareOf(share);
    const row = await db.columnShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
    describeAction("Revocó el enlace de la web de «{col}»", { col: column.name });
    return boardShareOf(row);
  });
}

/**
 * Ajustes del proyecto (solo administradores): activa o apaga «Compartir fuera». Al apagarla, todos los enlaces del
 * proyecto dejan de funcionar al momento (se revocan) y la opción deja de salir en el menú de las columnas.
 */
export async function setProjectShareOut(projectId: string, enabled: boolean) {
  return runAction({ name: "shareOut.setProject", args: [projectId, enabled] }, async (): Promise<{ revoked: number }> => {
    const user = await requireAdmin();
    const id = v.id.parse(projectId);
    const on = z.boolean().parse(enabled);
    const project = await db.project.findFirst({ where: { id, ...visibleProjectsWhere(user) }, select: { id: true, name: true, shareOutEnabled: true, isPrivate: true } });
    if (!project) throw notFound();
    noteProject(project.id, project.isPrivate);
    if (project.shareOutEnabled === on) return { revoked: 0 };
    await db.project.update({ where: { id }, data: { shareOutEnabled: on } });
    const revoked = on ? 0 : await revokeProjectShares(id);
    describeAction(on ? "Activó «Compartir fuera» en el proyecto «{name}»" : "Apagó «Compartir fuera» en el proyecto «{name}»", { name: project.name }, { revoked });
    return { revoked };
  });
}
