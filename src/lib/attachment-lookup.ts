import "server-only";
import { stat } from "node:fs/promises";
import { cachedFileStat, cachedMeta, dropMeta, storeFileStat, storeMeta, type AttachmentMeta, type Variant } from "./attachment-cache";
import { db } from "./db";
import { attachmentPath } from "./uploads";

/** Metadatos del adjunto (null si no existe), con la caché de 5 s de attachment-cache.ts. */
export async function getAttachmentMeta(id: string): Promise<AttachmentMeta | null> {
  const hit = cachedMeta(id);
  if (hit) return hit;
  const row = await db.taskAttachment.findUnique({
    where: { id },
    select: { id: true, taskId: true, originalName: true, mimeType: true, isImage: true, task: { select: { projectId: true } } },
  });
  if (!row) {
    dropMeta(id);
    return null;
  }
  const meta: AttachmentMeta = { id: row.id, taskId: row.taskId, projectId: row.task.projectId, isImage: row.isImage, originalName: row.originalName, mimeType: row.mimeType };
  storeMeta(meta);
  return meta;
}

/** Tamaño y fecha del fichero de una variante. `fresh` lo lee del disco (para servir el cuerpo); si no, puede venir de la caché. Lanza si no existe. */
export async function attachmentFileStat(meta: AttachmentMeta, variant: Variant, fresh: boolean): Promise<{ size: number; mtimeMs: number }> {
  const cached = fresh ? undefined : cachedFileStat(meta.id, variant);
  if (cached) return cached;
  const st = await stat(attachmentPath(meta.id, variant));
  const value = { size: st.size, mtimeMs: st.mtimeMs };
  storeFileStat(meta, variant, value);
  return value;
}
