// Tareas periódicas de mantenimiento (se arrancan desde instrumentation.ts, una vez por proceso).

const DAY_MS = 24 * 60 * 60 * 1000;
const NON_IMAGE_COPY_DAYS = 7;
const READ_NOTIFICATION_DAYS = 90;
const FIRST_RUN_MS = 60 * 1000;
const EVERY_MS = 60 * 60 * 1000;

/** Fecha anterior a la cual una copia de fichero no imagen ya debe borrarse. */
export function nonImageCopyCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - NON_IMAGE_COPY_DAYS * DAY_MS);
}

/** Borra las copias de adjuntos que no son imágenes con más de 7 días (filas y ficheros). */
async function purgeNonImageCopies(now: Date = new Date()): Promise<number> {
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

/** Borra las entradas de deshacer de más de 7 días (y los ficheros que solo ellas retenían). */
async function purgeOldUndo(now: Date = new Date()): Promise<number> {
  const { discardUndo, UNDO_MAX_AGE_DAYS } = await import("@/lib/undo");
  return discardUndo({ createdAt: { lt: new Date(now.getTime() - UNDO_MAX_AGE_DAYS * DAY_MS) } });
}

/** Borra los avisos ya leídos de más de 90 días (los no leídos se conservan). */
async function purgeOldNotifications(now: Date = new Date()): Promise<number> {
  const { db } = await import("@/lib/db");
  const { count } = await db.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: new Date(now.getTime() - READ_NOTIFICATION_DAYS * DAY_MS) } } });
  return count;
}

/** Borra los enlaces de email caducados y los dispositivos conocidos sin actividad en más de un año. */
async function purgeAuthData(now: Date = new Date()): Promise<number> {
  const [{ purgeExpiredTokens }, { purgeOldDevices }] = await Promise.all([import("@/lib/auth-token"), import("@/lib/devices")]);
  return (await purgeExpiredTokens(now)) + (await purgeOldDevices(now));
}

/** Una pasada de mantenimiento; nunca lanza. */
async function runMaintenance(): Promise<void> {
  for (const job of [purgeNonImageCopies, purgeOldUndo, purgeOldNotifications, purgeAuthData]) {
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
