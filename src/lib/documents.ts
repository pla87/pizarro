import "server-only";
import { visibleProjectsWhere } from "./access";
import { db } from "./db";
import { DOCUMENTS_MAX_PER_PROJECT, type DocumentKindName } from "./document-kind";
import { AppError, notFound } from "./errors";
import type { CurrentUser } from "./session";
import { quotaExceededFor } from "./storage-usage";
import type { QuotaExceeded } from "./quota";
import { noteProject } from "./action-context";

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

/** Documentación del proyecto, la más reciente primero. Sin acceso al proyecto: «no encontrado». */
export async function listProjectDocuments(user: CurrentUser, projectId: string): Promise<DocumentRow[]> {
  if (!(await db.project.count({ where: { id: projectId, ...visibleProjectsWhere(user) } }))) throw notFound();
  const rows = await db.projectDocument.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: DOCUMENTS_MAX_PER_PROJECT + 50, select: SELECT });
  return rows.map(toDocumentRow);
}

/** Un documento solo si su proyecto es visible para el usuario; si no, null (nunca se distingue «no existe» de «sin acceso»). */
export async function findDocumentForUser(user: CurrentUser, documentId: string) {
  return db.projectDocument.findFirst({
    where: { id: documentId, project: visibleProjectsWhere(user) },
    select: { id: true, name: true, mimeType: true, size: true, kind: true, projectId: true },
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
    const count = await tx.projectDocument.count({ where: { projectId: data.projectId } });
    if (count >= DOCUMENTS_MAX_PER_PROJECT) return { ok: false as const, reason: "count" as const, limit: DOCUMENTS_MAX_PER_PROJECT };
    const quota = await quotaExceededFor(data.projectId, data.size, tx);
    if (quota) return { ok: false as const, reason: "quota" as const, quota };
    const row = await tx.projectDocument.create({ data, select: SELECT });
    return { ok: true as const, document: toDocumentRow(row) };
  });
}

/** Borra la fila de un documento al que el usuario tiene acceso; devuelve sus datos (el fichero lo borra quien llama). */
export async function deleteDocumentRow(user: CurrentUser, documentId: string) {
  const doc = await findDocumentForUser(user, documentId);
  if (!doc) throw notFound();
  noteProject(doc.projectId);
  // deleteMany: si otra persona lo borró a la vez no falla.
  await db.projectDocument.deleteMany({ where: { id: doc.id } });
  return doc;
}

export async function renameDocumentRow(user: CurrentUser, documentId: string, name: string) {
  const doc = await findDocumentForUser(user, documentId);
  if (!doc) throw notFound();
  noteProject(doc.projectId);
  if (!name) throw new AppError("El nombre no puede estar vacío.");
  await db.projectDocument.update({ where: { id: doc.id }, data: { name } });
  return { ...doc, name };
}
