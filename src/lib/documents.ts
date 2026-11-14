import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { visibleProjectsWhere } from "./access";
import { db } from "./db";
import { DOCUMENT_TRASH_DAYS, DOCUMENTS_MAX_PER_PROJECT, sanitizeDocumentName, type DocumentKindName } from "./document-kind";
import { uploadWriteError } from "./disk-space";
import { effectiveFileMaxMb } from "./upload-size";
import { AppError, notFound } from "./errors";
import type { CurrentUser } from "./session";
import { quotaExceededFor } from "./storage-usage";
import type { QuotaExceeded } from "./quota";
import { noteProject } from "./action-context";
import { logEvent } from "./log";
import { newFileId, removeDocumentFiles, saveDocumentFile } from "./uploads";

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

const toDocumentRow = (r: Row): DocumentRow => ({
  id: r.id, name: r.name, mimeType: r.mimeType, size: r.size, kind: r.kind, createdAt: r.createdAt.toISOString(), createdByName: r.createdBy?.name ?? null,
});

/** Documentación del proyecto sin la papelera, la más reciente primero. Sin acceso al proyecto: «no encontrado». */
export async function listProjectDocuments(user: CurrentUser, projectId: string): Promise<DocumentRow[]> {
  if (!(await db.project.count({ where: { id: projectId, ...visibleProjectsWhere(user) } }))) throw notFound();
  return listProjectDocumentsOf(projectId);
}

/** Sin comprobar el acceso: solo para quien ya lo ha comprobado (p. ej. la página, que lee el proyecto antes). */
export async function listProjectDocumentsOf(projectId: string): Promise<DocumentRow[]> {
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
const trashPurgeAt = (deletedAt: Date): Date => new Date(deletedAt.getTime() + DOCUMENT_TRASH_DAYS * DAY_MS);

/** Días que faltan para la purga (redondeo hacia arriba, mínimo 0). */
export const trashDaysLeft = (deletedAt: Date, now: Date = new Date()): number =>
  Math.max(0, Math.ceil((trashPurgeAt(deletedAt).getTime() - now.getTime()) / DAY_MS));

/** Papelera del proyecto: lo borrado más reciente primero. Sin acceso al proyecto: «no encontrado». */
export async function listTrashedDocuments(user: CurrentUser, projectId: string, now: Date = new Date()): Promise<TrashedDocumentRow[]> {
  if (!(await db.project.count({ where: { id: projectId, ...visibleProjectsWhere(user) } }))) throw notFound();
  return listTrashedDocumentsOf(projectId, now);
}

/** Sin comprobar el acceso (ver listProjectDocumentsOf). */
export async function listTrashedDocumentsOf(projectId: string, now: Date = new Date()): Promise<TrashedDocumentRow[]> {
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

/** Por qué no cabe un documento: el máximo de documentos del proyecto o una cuota de almacenamiento. */
export type DocumentLimitProblem = { reason: "count"; limit: number } | { reason: "quota"; quota: QuotaExceeded };

type DocumentCreateResult = { ok: true; document: DocumentRow } | ({ ok: false } & DocumentLimitProblem);

/**
 * ¿Cabe un documento de `size` bytes en el proyecto? null si cabe. Como attachmentLimitProblem: dentro de la transacción
 * con el candado de las subidas es la comprobación definitiva; fuera, orientativa (antes de escribir el fichero).
 */
export async function documentLimitProblem(projectId: string, size: number, client: Prisma.TransactionClient | typeof db = db): Promise<DocumentLimitProblem | null> {
  // El máximo cuenta solo los documentos fuera de la papelera; su tamaño, en cambio, sigue contando en la cuota hasta la purga.
  const count = await client.projectDocument.count({ where: { projectId, deletedAt: null } });
  if (count >= DOCUMENTS_MAX_PER_PROJECT) return { reason: "count", limit: DOCUMENTS_MAX_PER_PROJECT };
  const quota = await quotaExceededFor(projectId, size, client);
  return quota ? { reason: "quota", quota } : null;
}

/** Nombre de un documento que se decide dentro de la transacción del alta (p. ej. con un número de versión que se reserva ahí). */
type DocumentNameFor = (tx: Prisma.TransactionClient) => Promise<string>;

/**
 * Da de alta el documento solo si no se supera el máximo de documentos del proyecto ni sus cuotas de almacenamiento
 * (las de adjuntos: la documentación cuenta en la misma suma). Cuenta y alta van en una transacción con el candado
 * común de las subidas, así que subidas simultáneas no pueden pasarse juntas. `nameFor`: el nombre se calcula ya dentro de
 * esa transacción, después de comprobar los límites (si no cabe, no se llama: no se gasta, p. ej., un número de versión).
 */
export async function createDocumentWithinLimit(data: {
  /** Id elegido antes (newFileId): el fichero se escribe antes que la fila. */
  id?: string; projectId: string; name: string; mimeType: string; size: number; kind: DocumentKindName; createdById: string;
}, nameFor?: DocumentNameFor): Promise<DocumentCreateResult> {
  return db.$transaction(async (tx) => {
    // `nameFor` suele escribir en la fila del proyecto (la versión: UPDATE "Project"): se bloquea ANTES del candado común
    // de las subidas. Si no, esperando a otra transacción larga del proyecto (p. ej. «Aplicar plantilla») se tendría ese
    // candado y no podría subir nada nadie, en ningún proyecto, hasta que terminara. Las subidas solo toman la fila con
    // FOR KEY SHARE (compatible con este bloqueo), así que el orden fila → candado no se cruza con ninguna.
    if (nameFor) await tx.$queryRaw`SELECT 1 FROM "Project" WHERE id = ${data.projectId} FOR NO KEY UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pz:attachment-quota'))::text`;
    // Proyecto borrado durante la subida: 404 en vez del fallo de clave ajena (P2003) al dar de alta la fila (ver
    // createAttachmentWithinLimit). Quien llama borra el fichero ya escrito.
    const alive = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "Project" WHERE id = ${data.projectId} FOR KEY SHARE`;
    if (!alive.length) throw new AppError("El proyecto ya no existe.", 404, "project_gone");
    const problem = await documentLimitProblem(data.projectId, data.size, tx);
    if (problem) return { ok: false as const, ...problem };
    const name = nameFor ? sanitizeDocumentName(await nameFor(tx)) : data.name;
    const row = await tx.projectDocument.create({ data: { ...data, name }, select: SELECT });
    return { ok: true as const, document: toDocumentRow(row) };
  });
}

/** Por qué no se guardó un documento generado: además de los de una subida, el tamaño máximo por archivo del proyecto. */
export type GeneratedDocumentProblem = DocumentLimitProblem | { reason: "size"; maxMb: number };

/**
 * Guarda en la Documentación del proyecto un archivo generado por la app (p. ej. el PDF del programa de un curso), con
 * los mismos límites que una subida: tamaño máximo por archivo, máximo de documentos y cuotas. Como la subida, escribe
 * primero el fichero y después la fila (y lo borra si la fila no se da de alta). Quien llama comprueba el acceso.
 * `name` puede ser una función: se llama dentro de la transacción del alta, solo si el documento cabe (ver
 * createDocumentWithinLimit); así un número de versión que se reserve en ella no se gasta si no se guarda.
 */
export async function saveGeneratedDocument(data: {
  projectId: string; name: string | DocumentNameFor; content: Uint8Array; mimeType: string; kind: DocumentKindName; createdById: string;
}): Promise<{ ok: true; document: DocumentRow } | { ok: false; problem: GeneratedDocumentProblem }> {
  const project = await db.project.findUnique({ where: { id: data.projectId }, select: { fileMaxMb: true } });
  if (!project) throw notFound();
  const maxMb = effectiveFileMaxMb(project.fileMaxMb);
  if (data.content.length > maxMb * 1024 * 1024) return { ok: false, problem: { reason: "size", maxMb } };
  const early = await documentLimitProblem(data.projectId, data.content.length);
  if (early) return { ok: false, problem: early };
  const id = newFileId();
  try {
    await saveDocumentFile(id, Buffer.from(data.content));
  } catch (err) {
    await removeDocumentFiles([id]);
    throw uploadWriteError(err, { action: "documents.noSpace", bytes: data.content.length, details: { projectId: data.projectId } });
  }
  const fixedName = typeof data.name === "string" ? sanitizeDocumentName(data.name) : "";
  const created = await createDocumentWithinLimit({
    id, projectId: data.projectId, name: fixedName, mimeType: data.mimeType, size: data.content.length, kind: data.kind, createdById: data.createdById,
  }, typeof data.name === "function" ? data.name : undefined).catch(async (err) => {
    await removeDocumentFiles([id]);
    throw err;
  });
  if (!created.ok) {
    await removeDocumentFiles([id]);
    const { ok: _ok, ...problem } = created;
    return { ok: false, problem };
  }
  return { ok: true, document: created.document };
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
    // Sin comprobar la cuota: los bytes del documento ya cuentan en el uso (la papelera cuenta), así que restaurarlo no añade
    // nada. Bloquearlo con el proyecto por encima de la cuota impediría recuperar un documento justo cuando más falta hace.
    const { count: n } = await tx.projectDocument.updateMany({ where: { id: doc.id, deletedAt: { not: null } }, data: { deletedAt: null, deletedById: null } });
    return n ? ("ok" as const) : ("gone" as const);
  });
  if (res === "count") throw new AppError("No se puede restaurar: la documentación del proyecto ya tiene el máximo de documentos.");
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
  const limit = new Date(now.getTime() - DOCUMENT_TRASH_DAYS * DAY_MS);
  // El estado se vuelve a comprobar en el DELETE: un documento restaurado entre medias no se toca, y solo se borran
  // del disco las filas realmente eliminadas (RETURNING).
  const rows = await db.$queryRaw<{ id: string; size: number }[]>(Prisma.sql`
    DELETE FROM "ProjectDocument" WHERE "deletedAt" IS NOT NULL AND "deletedAt" < ${limit} RETURNING "id", "size"`);
  if (rows.length === 0) return 0;
  await removeDocumentFiles(rows.map((d) => d.id));
  logEvent({
    category: "system", action: "documents.trashPurged",
    message: `Documentos de la papelera borrados (más de ${DOCUMENT_TRASH_DAYS} días): ${rows.length}`,
    details: { count: rows.length, bytes: rows.reduce((n, d) => n + Number(d.size), 0) },
  });
  return rows.length;
}

export async function renameDocumentRow(user: CurrentUser, documentId: string, name: string) {
  const doc = await findDocumentForUser(user, documentId);
  if (!doc || doc.deletedAt) throw notFound();
  noteProject(doc.projectId);
  if (!name) throw new AppError("El nombre no puede estar vacío.");
  await db.projectDocument.update({ where: { id: doc.id }, data: { name } });
  return { ...doc, name };
}
