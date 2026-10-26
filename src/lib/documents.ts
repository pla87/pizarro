import "server-only";
import { visibleProjectsWhere } from "./access";
import { db } from "./db";
import { DOCUMENT_TRASH_DAYS, DOCUMENTS_MAX_PER_PROJECT, type DocumentKindName } from "./document-kind";
import { AppError, notFound } from "./errors";
import type { CurrentUser } from "./session";
import { quotaExceededFor } from "./storage-usage";
import type { QuotaExceeded } from "./quota";
import { noteProject } from "./action-context";
import { logEvent } from "./log";
import { removeDocumentFiles } from "./uploads";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DocumentRow {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: DocumentKindName;
  createdAt: string;
  createdByName: string | null;
}

const SELECT = {
  id: true, name: true, mimeType: true, size: true, kind: true, createdAt: true, createdBy: { select: { name: true } },
} as const;

type Row = { id: string; name: string; mimeType: string; size: number; kind: DocumentKindName; createdAt: Date; createdBy: { name: string } | null };

export const toDocumentRow = (r: Row): DocumentRow => ({
  id: r.id, name: r.name, mimeType: r.mimeType, size: r.size, kind: r.kind, createdAt: r.createdAt.toISOString(), createdByName: r.createdBy?.name ?? null,
});

/** Documentación del proyecto sin la papelera, la más reciente primero. Sin acceso al proyecto: «no encontrado». */
export async function listProjectDocuments(user: CurrentUser, projectId: string): Promise<DocumentRow[]> {
  if (!(await db.project.count({ where: { id: projectId, ...visibleProjectsWhere(user) } }))) throw notFound();
  const rows = await db.projectDocument.findMany({ where: { projectId, deletedAt: null }, orderBy: { createdAt: "desc" }, take: DOCUMENTS_MAX_PER_PROJECT + 50, select: SELECT });
  return rows.map(toDocumentRow);
}

export interface TrashedDocumentRow extends DocumentRow {
  deletedAt: string;
  deletedByName: string | null;
  /** Días enteros (redondeados hacia arriba) que faltan para que se purgue; 0 si es inminente. */
  daysLeft: number;
}

/** Cuándo se purga un documento enviado a la papelera en `deletedAt`. */
export const trashPurgeAt = (deletedAt: Date): Date => new Date(deletedAt.getTime() + DOCUMENT_TRASH_DAYS * DAY_MS);

/** Días que faltan para la purga (redondeo hacia arriba, mínimo 0). */
export const trashDaysLeft = (deletedAt: Date, now: Date = new Date()): number =>
  Math.max(0, Math.ceil((trashPurgeAt(deletedAt).getTime() - now.getTime()) / DAY_MS));

/** Papelera del proyecto: lo borrado más reciente primero. Sin acceso al proyecto: «no encontrado». */
export async function listTrashedDocuments(user: CurrentUser, projectId: string, now: Date = new Date()): Promise<TrashedDocumentRow[]> {
  if (!(await db.project.count({ where: { id: projectId, ...visibleProjectsWhere(user) } }))) throw notFound();
  const rows = await db.projectDocument.findMany({
    where: { projectId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    take: DOCUMENTS_MAX_PER_PROJECT + 50,
    select: { ...SELECT, deletedAt: true, deletedBy: { select: { name: true } } },
  });
  return rows.map((r) => ({
    ...toDocumentRow(r),
    deletedAt: r.deletedAt!.toISOString(),
    deletedByName: r.deletedBy?.name ?? null,
    daysLeft: trashDaysLeft(r.deletedAt!, now),
  }));
}

/**
 * Un documento solo si su proyecto es visible para el usuario; si no, null (nunca se distingue «no existe» de «sin acceso»).
 * Incluye los de la papelera (`deletedAt` no nulo): se pueden previsualizar desde ella.
 */
export async function findDocumentForUser(user: CurrentUser, documentId: string) {
  return db.projectDocument.findFirst({
    where: { id: documentId, project: visibleProjectsWhere(user) },
    select: { id: true, name: true, mimeType: true, size: true, kind: true, projectId: true, deletedAt: true },
  });
}

export type DocumentCreateResult =
  | { ok: true; document: DocumentRow }
  | { ok: false; reason: "count"; limit: number }
  | { ok: false; reason: "quota"; quota: QuotaExceeded };

/**
 * Da de alta el documento solo si no se supera el máximo de documentos del proyecto ni sus cuotas de almacenamiento
 * (las de adjuntos: la documentación cuenta en la misma suma). Cuenta y alta van en una transacción con el candado
 * común de las subidas, así que subidas simultáneas no pueden pasarse juntas.
 */
export async function createDocumentWithinLimit(data: {
  projectId: string; name: string; mimeType: string; size: number; kind: DocumentKindName; createdById: string;
}): Promise<DocumentCreateResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pz:attachment-quota'))::text`;
    // El máximo cuenta solo los documentos fuera de la papelera; su tamaño, en cambio, sigue contando en la cuota hasta la purga.
    const count = await tx.projectDocument.count({ where: { projectId: data.projectId, deletedAt: null } });
    if (count >= DOCUMENTS_MAX_PER_PROJECT) return { ok: false as const, reason: "count" as const, limit: DOCUMENTS_MAX_PER_PROJECT };
    const quota = await quotaExceededFor(data.projectId, data.size, tx);
    if (quota) return { ok: false as const, reason: "quota" as const, quota };
    const row = await tx.projectDocument.create({ data, select: SELECT });
    return { ok: true as const, document: toDocumentRow(row) };
  });
}

/** Envía a la papelera un documento vivo al que el usuario tiene acceso (el fichero se conserva hasta la purga). */
export async function trashDocumentRow(user: CurrentUser, documentId: string, now: Date = new Date()) {
  const doc = await findDocumentForUser(user, documentId);
  if (!doc || doc.deletedAt) throw notFound();
  noteProject(doc.projectId);
  // updateMany con deletedAt null: si otra persona lo borró a la vez, no se pisa su fecha.
  const { count } = await db.projectDocument.updateMany({ where: { id: doc.id, deletedAt: null }, data: { deletedAt: now, deletedById: user.id } });
  if (!count) throw notFound();
  return doc;
}

/**
 * Saca un documento de la papelera. Vuelve a comprobar el máximo de documentos del proyecto y las cuotas, con el candado
 * común de las subidas. Como la papelera ya cuenta en la cuota, solo falla si la cuota se ha reducido desde entonces.
 */
export async function restoreDocumentRow(user: CurrentUser, documentId: string) {
  const doc = await findDocumentForUser(user, documentId);
  if (!doc || !doc.deletedAt) throw notFound();
  noteProject(doc.projectId);
  const res = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pz:attachment-quota'))::text`;
    const count = await tx.projectDocument.count({ where: { projectId: doc.projectId, deletedAt: null } });
    if (count >= DOCUMENTS_MAX_PER_PROJECT) return "count" as const;
    // Su tamaño ya está en el uso actual: se comprueba que el total siga dentro de la cuota (0 bytes más).
    if (await quotaExceededFor(doc.projectId, 0, tx)) return "quota" as const;
    const { count: n } = await tx.projectDocument.updateMany({ where: { id: doc.id, deletedAt: { not: null } }, data: { deletedAt: null, deletedById: null } });
    return n ? ("ok" as const) : ("gone" as const);
  });
  if (res === "count") throw new AppError("No se puede restaurar: la documentación del proyecto ya tiene el máximo de documentos.");
  if (res === "quota") throw new AppError("No se puede restaurar: se supera la cuota de almacenamiento del proyecto.");
  if (res === "gone") throw notFound();
  return doc;
}

/** Borra para siempre (fila y fichero) un documento que está en la papelera. Los vivos no se pueden borrar por aquí. */
export async function deleteTrashedDocumentRow(user: CurrentUser, documentId: string) {
  const doc = await findDocumentForUser(user, documentId);
  if (!doc || !doc.deletedAt) throw notFound();
  noteProject(doc.projectId);
  const { count } = await db.projectDocument.deleteMany({ where: { id: doc.id, deletedAt: { not: null } } });
  if (!count) throw notFound();
  await removeDocumentFiles([doc.id]);
  return doc;
}

/** Purga lo que lleva en la papelera más de DOCUMENT_TRASH_DAYS días: filas y ficheros. Devuelve cuántos. */
export async function purgeTrashedDocuments(now: Date = new Date()): Promise<number> {
  const old = await db.projectDocument.findMany({
    where: { deletedAt: { lt: new Date(now.getTime() - DOCUMENT_TRASH_DAYS * DAY_MS) } },
    select: { id: true, size: true },
  });
  if (old.length === 0) return 0;
  const ids = old.map((d) => d.id);
  await db.projectDocument.deleteMany({ where: { id: { in: ids }, deletedAt: { not: null } } });
  await removeDocumentFiles(ids);
  logEvent({
    category: "system", action: "documents.trashPurged",
    message: `Documentos de la papelera borrados (más de ${DOCUMENT_TRASH_DAYS} días): ${ids.length}`,
    details: { count: ids.length, bytes: old.reduce((n, d) => n + d.size, 0) },
  });
  return ids.length;
}

export async function renameDocumentRow(user: CurrentUser, documentId: string, name: string) {
  const doc = await findDocumentForUser(user, documentId);
  if (!doc || doc.deletedAt) throw notFound();
  noteProject(doc.projectId);
  if (!name) throw new AppError("El nombre no puede estar vacío.");
  await db.projectDocument.update({ where: { id: doc.id }, data: { name } });
  return { ...doc, name };
}
