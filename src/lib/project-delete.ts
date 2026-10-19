import "server-only";
import { db } from "./db";
import { removeAttachmentFiles, removeReleaseAttachmentFiles } from "./uploads";

/** Borra un proyecto con sus tareas, releases y los ficheros de sus adjuntos. */
export async function purgeProject(projectId: string): Promise<void> {
  const attachments = await db.taskAttachment.findMany({ where: { task: { projectId } }, select: { id: true } });
  // Las copias de los adjuntos de sus releases se borran en cascada: se leen antes sus ids.
  const releaseAttachments = await db.releaseAttachment.findMany({ where: { release: { projectId } }, select: { id: true } });
  await db.$transaction([db.task.deleteMany({ where: { projectId } }), db.project.delete({ where: { id: projectId } })]);
  await removeAttachmentFiles(attachments.map((a) => a.id));
  await removeReleaseAttachmentFiles(releaseAttachments.map((a) => a.id));
}
