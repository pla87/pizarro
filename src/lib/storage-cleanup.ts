import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { discardEntries } from "./undo";
import { removeAttachmentFiles, removeDocumentFiles, removeReleaseAttachmentFiles } from "./uploads";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Filas que se borran en cada tanda: transacciones cortas aunque haya miles de adjuntos. */
const BATCH = 200;

export type CleanupKind = "archivedTasks" | "documentsTrash" | "oldReleases";

export interface CleanupResult {
  count: number;
  bytes: number;
}

export const CLEANUP_DAYS: Record<CleanupKind, readonly number[]> = {
  archivedTasks: [0, 7, 15, 30, 90, 365],
  documentsTrash: [0],
  oldReleases: [7, 15, 30, 90, 180, 365],
};

const cutoff = (days: number, now: Date) => new Date(now.getTime() - days * DAY_MS);

const taskWhere = (projectId: string, days: number, now: Date): Prisma.TaskAttachmentWhereInput => ({
  task: { projectId, archivedAt: { not: null, lte: cutoff(days, now) } },
});
const releaseWhere = (projectId: string, days: number, now: Date): Prisma.ReleaseAttachmentWhereInput => ({
  release: { projectId, deployedAt: { lt: cutoff(days, now) } },
});
const trashWhere = (projectId: string): Prisma.ProjectDocumentWhereInput => ({ projectId, deletedAt: { not: null } });

/** Cuántos ficheros y bytes se borrarían (para el diálogo de confirmación). */
export async function previewCleanup(projectId: string, kind: CleanupKind, days: number, now: Date = new Date()): Promise<CleanupResult> {
  const agg = { _count: { _all: true }, _sum: { size: true } } as const;
  const r =
    kind === "archivedTasks" ? await db.taskAttachment.aggregate({ ...agg, where: taskWhere(projectId, days, now) })
    : kind === "oldReleases" ? await db.releaseAttachment.aggregate({ ...agg, where: releaseWhere(projectId, days, now) })
    : await db.projectDocument.aggregate({ ...agg, where: trashWhere(projectId) });
  return { count: r._count._all, bytes: r._sum.size ?? 0 };
}

/**
 * Las entradas de deshacer del proyecto que mencionan alguno de estos ids ya no se pueden aplicar (el fichero no
 * existe): se descartan enteras. Los ficheros que retenían ya están borrados (`discardEntries` ignora los que faltan).
 */
export async function invalidateUndoReferencing(projectId: string, ids: Iterable<string>): Promise<number> {
  const gone = new Set(ids);
  if (gone.size === 0) return 0;
  const doomed: { id: string; ops: unknown }[] = [];
  for (let cursor: string | undefined; ; ) {
    const page = await db.undoEntry.findMany({ where: { projectId }, select: { id: true, ops: true }, orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const e of page) {
      for (const m of JSON.stringify(e.ops).matchAll(/[a-z0-9]{20,}/gi)) {
        if (gone.has(m[0])) {
          doomed.push(e);
          break;
        }
      }
    }
    if (page.length < 200) break;
    cursor = page[page.length - 1]!.id;
  }
  await discardEntries(doomed);
  return doomed.length;
}

export interface DeletedTaskAttachments extends CleanupResult {
  ids: string[];
  taskIds: string[];
}

/** Borra para siempre estos adjuntos de tarea del proyecto (filas y ficheros con su miniatura), por tandas. */
export async function deleteTaskAttachments(projectId: string, ids: string[]): Promise<DeletedTaskAttachments> {
  const out: DeletedTaskAttachments = { count: 0, bytes: 0, ids: [], taskIds: [] };
  const tasks = new Set<string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    // Solo los del proyecto; RETURNING da lo realmente borrado (otra persona pudo borrar alguno a la vez).
    const rows = await db.$queryRaw<{ id: string; size: number; taskId: string }[]>(Prisma.sql`
      DELETE FROM "TaskAttachment" a USING "Task" t
      WHERE a."taskId" = t."id" AND t."projectId" = ${projectId} AND a."id" IN (${Prisma.join(chunk)})
      RETURNING a."id", a."size", a."taskId"`);
    await removeAttachmentFiles(rows.map((r) => r.id));
    for (const r of rows) {
      out.count++;
      out.bytes += Number(r.size);
      out.ids.push(r.id);
      tasks.add(r.taskId);
    }
  }
  out.taskIds = [...tasks];
  return out;
}

/** Borra para siempre los adjuntos de tareas archivadas (hace al menos `days` días; 0 = todas las archivadas). */
export async function cleanupArchivedTaskAttachments(projectId: string, days: number, now: Date = new Date()): Promise<DeletedTaskAttachments> {
  const total: DeletedTaskAttachments = { count: 0, bytes: 0, ids: [], taskIds: [] };
  const tasks = new Set<string>();
  for (;;) {
    const rows = await db.taskAttachment.findMany({ where: taskWhere(projectId, days, now), select: { id: true }, orderBy: { id: "asc" }, take: BATCH });
    if (rows.length === 0) break;
    const r = await deleteTaskAttachments(projectId, rows.map((x) => x.id));
    if (r.count === 0) break;
    total.count += r.count;
    total.bytes += r.bytes;
    total.ids.push(...r.ids);
    r.taskIds.forEach((id) => tasks.add(id));
  }
  total.taskIds = [...tasks];
  await invalidateUndoReferencing(projectId, total.ids);
  return total;
}

/** Borra para siempre estas copias de adjuntos de releases del proyecto (el texto de la release se conserva). */
export async function deleteReleaseAttachments(projectId: string, ids: string[]): Promise<CleanupResult & { ids: string[] }> {
  const out = { count: 0, bytes: 0, ids: [] as string[] };
  for (let i = 0; i < ids.length; i += BATCH) {
    const rows = await db.$queryRaw<{ id: string; size: number }[]>(Prisma.sql`
      DELETE FROM "ReleaseAttachment" a USING "Release" r
      WHERE a."releaseId" = r."id" AND r."projectId" = ${projectId} AND a."id" IN (${Prisma.join(ids.slice(i, i + BATCH))})
      RETURNING a."id", a."size"`);
    await removeReleaseAttachmentFiles(rows.map((r) => r.id));
    for (const r of rows) {
      out.count++;
      out.bytes += Number(r.size);
      out.ids.push(r.id);
    }
  }
  return out;
}

/** Borra para siempre las copias de adjuntos de las releases con más de `days` días. */
export async function cleanupOldReleaseAttachments(projectId: string, days: number, now: Date = new Date()): Promise<CleanupResult> {
  const total = { count: 0, bytes: 0 };
  for (;;) {
    const rows = await db.releaseAttachment.findMany({ where: releaseWhere(projectId, days, now), select: { id: true }, orderBy: { id: "asc" }, take: BATCH });
    if (rows.length === 0) break;
    const r = await deleteReleaseAttachments(projectId, rows.map((x) => x.id));
    if (r.count === 0) break;
    total.count += r.count;
    total.bytes += r.bytes;
  }
  return total;
}

/** Borra para siempre estos documentos del proyecto (vivos o en la papelera). */
export async function deleteDocumentsForever(projectId: string, ids: string[]): Promise<CleanupResult> {
  const out = { count: 0, bytes: 0 };
  for (let i = 0; i < ids.length; i += BATCH) {
    const rows = await db.$queryRaw<{ id: string; size: number }[]>(Prisma.sql`
      DELETE FROM "ProjectDocument" WHERE "projectId" = ${projectId} AND "id" IN (${Prisma.join(ids.slice(i, i + BATCH))}) RETURNING "id", "size"`);
    await removeDocumentFiles(rows.map((r) => r.id));
    for (const r of rows) {
      out.count++;
      out.bytes += Number(r.size);
    }
  }
  return out;
}

/** Vacía la papelera de documentación del proyecto (filas y ficheros). */
export async function emptyDocumentsTrash(projectId: string): Promise<CleanupResult> {
  const total = { count: 0, bytes: 0 };
  for (;;) {
    const rows = await db.projectDocument.findMany({ where: trashWhere(projectId), select: { id: true }, orderBy: { id: "asc" }, take: BATCH });
    if (rows.length === 0) break;
    const r = await deleteDocumentsForever(projectId, rows.map((x) => x.id));
    if (r.count === 0) break;
    total.count += r.count;
    total.bytes += r.bytes;
  }
  return total;
}
