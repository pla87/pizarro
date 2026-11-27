"use server";

import { z } from "zod";
import { describeAction, noteProject } from "@/lib/action-context";
import { visibleProjectsWhere } from "@/lib/access";
import { runAction } from "@/lib/action";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { encryptSecret } from "@/lib/crypto";
import { appUrl } from "@/lib/mail";
import { notifyShareRevoked } from "@/lib/notify";
import { requireAdmin, requireUser } from "@/lib/session";
import { activeShareUrl, revokeProjectShares, shareInfoOf } from "@/lib/share-out";
import { isShareColumn, isShareExpiry, MAX_SHARE_TASKS, shareLinkState, type BoardShareInfo } from "@/lib/share-out-board";
import { hashShareToken, newShareToken, shareUrl } from "@/lib/share-out-core";
import { TASK_ORDER } from "@/lib/task-positions";
import * as v from "@/lib/validation";

// «Compartir fuera» desde la app: activarla en el proyecto (administradores), generar o actualizar la web de una columna,
// el selector de caducidad y revocar el enlace. Convertir una columna en «Compartir fuera» y quitárselo están en
// columns.ts (es un cambio de rol). Nada de esto se deshace: un enlace revocado no vuelve, y uno nuevo es otro enlace.
// En la base, el token se busca por su huella (tokenHash) y se guarda además cifrado con ENCRYPTION_KEY (tokenEnc), para
// que cualquiera del proyecto vuelva a ver la dirección en el diálogo: solo lo descifran «Generar web» / «Actualizar web»
// y el botón del enlace (getShareLink), nunca el tablero, el informe, Logs ni una exportación. Al terminar el enlace
// (revocar, caducar, quitar la función) se borra.

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

/**
 * Lo que enseña el diálogo de la columna: la dirección del enlace activo (null si no hay, o `lost` si no se puede volver
 * a enseñar) y su estado.
 */
interface ShareLinkView {
  url: string | null;
  lost: boolean;
  info: BoardShareInfo;
}

/** Resultado de generar o actualizar: lo del diálogo, más cuántas tareas se han publicado. */
interface ShareWebResult extends ShareLinkView {
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
    // Una web nueva sin tareas no se publica (el botón del tablero ya lo dice); con el enlace activo, actualizarla vacía
    // sí vale: es la forma de despublicar lo que ya no está.
    if (!taskIds.length && !keep) throw new AppError("No hay tareas en esta columna: añade alguna antes de generar la web.");
    const token = keep ? null : newShareToken();
    const data = {
      taskIds, generatedAt: now, generatedById: user.id, lastUsedAt: now,
      ...(token ? {
        tokenHash: hashShareToken(token), tokenEnc: encryptSecret(token), revokedAt: null, revokedById: null,
        // El enlace que se sustituye: «ha caducado» desde que terminó (o desde ahora, si seguía activo).
        ...(share.tokenHash ? { oldTokenHash: share.tokenHash, oldEndedAt: current.state === "active" ? now : (current.endsAt ?? now) } : {}),
      } : {}),
    };
    // Solo si nadie la ha cambiado entre medias (otra persona pudo generar a la vez: su enlace no se pisa sin saberlo) y
    // con la función aún activada: la fila del proyecto se bloquea para leer (FOR SHARE) y apagarla (setProjectShareOut,
    // que la escribe y revoca en una transacción) espera a que esto termine, o al revés. Sin eso, generar justo mientras
    // se apagaba dejaba un enlace sin revocar que volvía a funcionar al encenderla otra vez.
    const count = await db.$transaction(async (tx) => {
      const [project] = await tx.$queryRaw<{ on: boolean }[]>`SELECT "shareOutEnabled" AS "on" FROM "Project" WHERE "id" = ${column.projectId} FOR SHARE`;
      if (!project?.on) throw new AppError("«Compartir fuera» no está activado en este proyecto.");
      return (await tx.columnShare.updateMany({ where: { id: share.id, columnId: column.id, tokenHash: share.tokenHash, project: { shareOutEnabled: true } }, data })).count;
    });
    if (!count) throw new AppError("Los datos han cambiado mientras tanto. Recarga e inténtalo de nuevo.");
    const row = await db.columnShare.findUniqueOrThrow({ where: { id: share.id } });
    // Con una sola tarea, «(1 tarea)» y no «(1 tareas)».
    const one = taskIds.length === 1;
    const key = token
      ? share.tokenHash
        ? one ? "Creó un enlace nuevo para la web de «{col}» (1 tarea)" : "Creó un enlace nuevo para la web de «{col}» ({n} tareas)"
        : one ? "Generó la web de «{col}» (1 tarea)" : "Generó la web de «{col}» ({n} tareas)"
      : one ? "Actualizó la web de «{col}» (1 tarea)" : "Actualizó la web de «{col}» ({n} tareas)";
    describeAction(key, { col: column.name, n: taskIds.length }, { shareId: share.id });
    const link = token ? { url: shareUrl(appUrl(), token), lost: false } : await activeShareUrl(row);
    return { ...link, info: await shareInfoOf(row, now), published: taskIds.length, left: Math.max(0, total - taskIds.length) };
  });
}

/**
 * El botón del enlace del pie: la dirección del enlace activo para el diálogo (cualquiera que pueda editar el proyecto
 * la ve, no solo quien la generó). No cuenta como uso ni cambia nada.
 */
export async function getShareLink(columnId: string) {
  return runAction({ name: "shareOut.getLink", args: [columnId] }, async (): Promise<ShareLinkView> => {
    const { column, share } = await findShareColumn(columnId);
    const info = await shareInfoOf(share);
    if (info.state !== "active") return { url: null, lost: false, info };
    describeAction("Abrió el enlace de la web de «{col}»", { col: column.name }, { shareId: share.id });
    return { ...(await activeShareUrl(share)), info };
  });
}

/**
 * Selector de caducidad del pie (7 días, 1 mes, 3 meses): vale para el enlace actual desde su último uso. Con el enlace
 * activo, cambiarla cuenta como uso (si no, pasar por «7 días» caducaba al momento un enlace sin usar en una semana). Con
 * uno terminado, lo deja terminado donde estaba (revokedAt = cuándo terminó): elegir más días no lo resucita.
 */
export async function setShareExpiry(columnId: string, days: number) {
  return runAction({ name: "shareOut.setExpiry", args: [columnId, days] }, async (): Promise<BoardShareInfo> => {
    const { column, share } = await findShareColumn(columnId);
    if (!isShareExpiry(days)) throw new AppError("Caducidad no válida.");
    const now = new Date();
    const current = shareLinkState(share, now);
    const data = current.state === "active"
      ? { expiryDays: days, lastUsedAt: now }
      : current.state === "ended" && !share.revokedAt ? { expiryDays: days, revokedAt: current.endsAt ?? now, tokenEnc: null } : { expiryDays: days };
    const row = await db.columnShare.update({ where: { id: share.id }, data });
    describeAction("Cambió la caducidad de la web de «{col}» a {n} días sin uso", { col: column.name, n: days });
    return shareInfoOf(row);
  });
}

/**
 * «Revocar enlace»: deja de funcionar al momento; la columna sigue compartiéndose (con «Generar web» se crea otro). Si lo
 * revoca otra persona, quien generó la web recibe un aviso SHARE_REVOKED (solo aquí: las revocaciones automáticas no
 * avisan). Solo revoca el enlace que se ha leído y sin revocar aún: dos «Revocar» a la vez no dan dos avisos.
 */
export async function revokeShareLink(columnId: string) {
  return runAction({ name: "shareOut.revoke", args: [columnId] }, async (): Promise<BoardShareInfo> => {
    const { user, column, share } = await findShareColumn(columnId);
    if (shareLinkState(share).state !== "active") return shareInfoOf(share);
    const { count } = await db.columnShare.updateMany({
      where: { id: share.id, tokenHash: share.tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: user.id, tokenEnc: null },
    });
    const row = await db.columnShare.findUniqueOrThrow({ where: { id: share.id } });
    if (!count) return shareInfoOf(row);
    describeAction("Revocó el enlace de la web de «{col}»", { col: column.name });
    if (share.generatedById && share.generatedById !== user.id) {
      // Ya revocado: un fallo al avisar no puede convertirse en un error de la acción.
      await notifyShareRevoked(column.projectId, share.generatedById, user.name, column.name).catch((err) => console.error("[share-out] aviso de revocación", err));
    }
    return shareInfoOf(row);
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
    // En una transacción: si falla la revocación, la función sigue activada (no queda apagada con enlaces vivos que
    // volverían a funcionar al encenderla). Escribir el proyecto lo bloquea: un «Generar web» a la vez espera (ver arriba).
    const revoked = await db.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data: { shareOutEnabled: on } });
      return on ? 0 : revokeProjectShares(id, new Date(), tx);
    });
    describeAction(on ? "Activó «Compartir fuera» en el proyecto «{name}»" : "Apagó «Compartir fuera» en el proyecto «{name}»", { name: project.name }, { revoked });
    return { revoked };
  });
}
