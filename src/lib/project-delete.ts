import "server-only";
import { db } from "./db";
import { forgetReleaseNumbers } from "./release-number";
import { revokeProject } from "./revoke";
import { discardProjectTransfers } from "./transfer-jobs";
import { lockTaskRowsForDelete } from "./task-positions";
import { discardUndo } from "./undo";
import { removeAttachmentFiles, removeDocumentFiles, removeReleaseAttachmentFiles } from "./uploads";

/** Borra un proyecto con sus tareas, releases, documentación, los ficheros de sus adjuntos y sus exportaciones. */
export async function purgeProject(projectId: string): Promise<void> {
  // Antes que nada: libera los ficheros que solo retenía el historial de deshacer.
  await discardUndo({ projectId });
  const attachments = await db.taskAttachment.findMany({ where: { task: { projectId } }, select: { id: true } });
  // Las copias de los adjuntos de sus releases se borran en cascada: se leen antes sus ids.
  const releaseAttachments = await db.releaseAttachment.findMany({ where: { release: { projectId } }, select: { id: true } });
  // La documentación del proyecto también cae en cascada: sus ficheros se borran con el resto.
  const documents = await db.projectDocument.findMany({ where: { projectId }, select: { id: true } });
  await db.$transaction(
    async (tx) => {
      // Sus tareas, bloqueadas en orden de id antes del DELETE: si alguien las mueve a la vez, espera en vez de 40P01.
      const ids = (await tx.task.findMany({ where: { projectId }, select: { id: true }, orderBy: { id: "asc" } })).map((t) => t.id);
      await lockTaskRowsForDelete(tx, ids);
      await tx.task.deleteMany({ where: { projectId } });
      await tx.project.delete({ where: { id: projectId } });
    },
    { timeout: 60_000 },
  );
  revokeProject(projectId);
  await forgetReleaseNumbers(projectId);
  await removeAttachmentFiles(attachments.map((a) => a.id));
  await removeReleaseAttachmentFiles(releaseAttachments.map((a) => a.id));
  await removeDocumentFiles(documents.map((d) => d.id));
  // Sus exportaciones (el .pizarro.zip en uploads/exports) y las importaciones que lo crearon.
  await discardProjectTransfers(projectId);
}
