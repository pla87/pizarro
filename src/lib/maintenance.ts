// Tareas periódicas de mantenimiento (se arrancan desde instrumentation.ts, una vez por proceso).

const DAY_MS = 24 * 60 * 60 * 1000;
export const PRIVATE_BLOCK_DAYS = 30;
export const NON_IMAGE_COPY_DAYS = 7;
const FIRST_RUN_MS = 60 * 1000;
const EVERY_MS = 60 * 60 * 1000;

/** Fecha anterior a la cual un proyecto privado bloqueado ya debe borrarse. */
export function privateExpiryCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - PRIVATE_BLOCK_DAYS * DAY_MS);
}

/** Fecha anterior a la cual una copia de fichero no imagen ya debe borrarse. */
export function nonImageCopyCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - NON_IMAGE_COPY_DAYS * DAY_MS);
}

/** ¿Un proyecto bloqueado desde `blockedAt` ha caducado? */
export function isPrivateExpired(blockedAt: Date | null, now: Date = new Date()): boolean {
  return !!blockedAt && blockedAt.getTime() < privateExpiryCutoff(now).getTime();
}

/** Borra los proyectos privados bloqueados hace más de 30 días (misma limpieza que deleteProject). */
export async function purgeExpiredPrivateProjects(now: Date = new Date()): Promise<number> {
  const [{ db }, { logEvent }, { removeAttachmentFiles, removeReleaseAttachmentFiles }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/log"),
    import("@/lib/uploads"),
  ]);
  const expired = await db.project.findMany({
    where: { privateOwnerId: { not: null }, privateBlockedAt: { lt: privateExpiryCutoff(now) } },
    select: { id: true, privateOwnerId: true },
  });
  let deleted = 0;
  for (const p of expired) {
    try {
      const attachments = await db.taskAttachment.findMany({ where: { task: { projectId: p.id } }, select: { id: true } });
      const releaseAttachments = await db.releaseAttachment.findMany({ where: { release: { projectId: p.id } }, select: { id: true } });
      await db.$transaction([db.task.deleteMany({ where: { projectId: p.id } }), db.project.delete({ where: { id: p.id } })]);
      await removeAttachmentFiles(attachments.map((a) => a.id));
      await removeReleaseAttachmentFiles(releaseAttachments.map((a) => a.id));
      deleted++;
      logEvent({
        category: "system",
        action: "projects.privateExpired",
        message: "Proyecto privado bloqueado borrado tras 30 días",
        projectId: null,
        details: { projectId: p.id, ownerId: p.privateOwnerId, tasksAttachments: attachments.length, releaseAttachments: releaseAttachments.length },
      });
    } catch (err) {
      logEvent({ level: "error", category: "system", action: "projects.privateExpired", message: `No se pudo borrar un proyecto privado caducado: ${(err as Error)?.message ?? err}`, details: { projectId: p.id } });
    }
  }
  return deleted;
}

/** Borra las copias de adjuntos que no son imágenes con más de 7 días (filas y ficheros). */
export async function purgeNonImageCopies(now: Date = new Date()): Promise<number> {
  const [{ db }, { logEvent }, { removeReleaseAttachmentFiles }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/log"),
    import("@/lib/uploads"),
  ]);
  const old = await db.releaseAttachment.findMany({
    where: { isImage: false, createdAt: { lt: nonImageCopyCutoff(now) } },
    select: { id: true },
  });
  if (old.length === 0) return 0;
  const ids = old.map((a) => a.id);
  await db.releaseAttachment.deleteMany({ where: { id: { in: ids } } });
  await removeReleaseAttachmentFiles(ids);
  logEvent({ category: "system", action: "releases.nonImageCopiesPurged", message: `Copias de ficheros no imagen borradas (más de ${NON_IMAGE_COPY_DAYS} días): ${ids.length}`, details: { count: ids.length } });
  return ids.length;
}

/** Una pasada de mantenimiento; nunca lanza. */
export async function runMaintenance(): Promise<void> {
  for (const job of [purgeExpiredPrivateProjects, purgeNonImageCopies]) {
    try {
      await job();
    } catch (err) {
      console.error("[maintenance]", err);
    }
  }
}

/** Arranca el temporizador una sola vez por proceso: primera pasada al minuto, luego cada hora. */
export function startMaintenance(): void {
  const g = globalThis as unknown as { __pzMaintenance?: boolean };
  if (g.__pzMaintenance) return;
  g.__pzMaintenance = true;
  setTimeout(() => {
    void runMaintenance();
    setInterval(() => void runMaintenance(), EVERY_MS).unref?.();
  }, FIRST_RUN_MS).unref?.();
}
