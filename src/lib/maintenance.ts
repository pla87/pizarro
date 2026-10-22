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

/** Ids de fichero (cuid) que mencionan las entradas de deshacer: sus ficheros se retienen aunque la fila ya no exista. */
function undoReferencedTokens(ops: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const m of JSON.stringify(ops).matchAll(/[a-z0-9]{20,}/gi)) out.add(m[0]);
  return out;
}

/**
 * Borra de UPLOAD_DIR los ficheros (adjuntos, miniaturas, copias de releases) que ninguna fila de la BD
 * referencia y que tienen más de 24 h. No toca backups/, enlaces simbólicos ni nombres desconocidos.
 */
async function purgeOrphanFiles(): Promise<number> {
  const [{ db }, { logEvent }, { cleanOrphanFiles }, { uploadDir }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/log"),
    import("@/lib/orphan-files"),
    import("@/lib/upload-dir"),
  ]);
  const [attachments, releaseAttachments, undo] = await Promise.all([
    db.taskAttachment.findMany({ select: { id: true } }),
    db.releaseAttachment.findMany({ select: { id: true } }),
    db.undoEntry.findMany({ select: { ops: true } }),
  ]);
  const retained = undoReferencedTokens(undo.map((u) => u.ops));
  const report = await cleanOrphanFiles(uploadDir(), {
    attachments: new Set([...attachments.map((a) => a.id), ...retained]),
    releaseAttachments: new Set([...releaseAttachments.map((a) => a.id), ...retained]),
  });
  if (report.aborted) {
    logEvent({ level: "warn", category: "system", action: "uploads.orphansAborted", message: `Limpieza de huérfanos cancelada: ${report.orphans} de ${report.scanned} ficheros parecen huérfanos (demasiados; ¿base de datos equivocada?)`, details: { ...report } });
  } else if (report.deleted > 0) {
    logEvent({ category: "system", action: "uploads.orphansPurged", message: `Ficheros huérfanos borrados: ${report.deleted} (${Math.round(report.bytes / 1024)} KB)`, details: { ...report } });
  }
  return report.deleted;
}

/** Copia de seguridad diaria cifrada (si hay BACKUP_KEY). */
async function backupJob(): Promise<void> {
  const { dailyBackupJob } = await import("@/lib/backup");
  await dailyBackupJob();
}

/** Prueba de restauración mensual de la última copia. */
async function restoreTestJob(): Promise<void> {
  const { monthlyRestoreTestJob } = await import("@/lib/backup");
  await monthlyRestoreTestJob();
}

/** Una pasada de mantenimiento; nunca lanza. */
async function runMaintenance(): Promise<void> {
  for (const job of [purgeNonImageCopies, purgeOldUndo, purgeOldNotifications, purgeOrphanFiles, backupJob, restoreTestJob]) {
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
