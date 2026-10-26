// Tareas periódicas de mantenimiento (se arrancan desde instrumentation.ts, una vez por proceso). Si hay
// varios procesos, solo uno las ejecuta cada vez (bloqueo de Postgres) y la última ejecución queda en JobRun.

import type { JobDef } from "./jobs";

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

/** Borra de la papelera los documentos con más de DOCUMENT_TRASH_DAYS días (filas y ficheros). */
async function purgeDocumentsTrash(now: Date = new Date()): Promise<number> {
  const { purgeTrashedDocuments } = await import("@/lib/documents");
  return purgeTrashedDocuments(now);
}

/** Borra los avisos ya leídos de más de 90 días (los no leídos se conservan). */
async function purgeOldNotifications(now: Date = new Date()): Promise<number> {
  const { db } = await import("@/lib/db");
  const { count } = await db.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: new Date(now.getTime() - READ_NOTIFICATION_DAYS * DAY_MS) } } });
  return count;
}

/** Borra los enlaces de email caducados y los dispositivos conocidos sin actividad en más de un año. */
async function purgeAuthData(now: Date = new Date()): Promise<number> {
  const [{ purgeExpiredTokens }, { purgeOldDevices }, { purgeExpiredChallenges }] = await Promise.all([import("@/lib/auth-token"), import("@/lib/devices"), import("@/lib/two-factor")]);
  return (await purgeExpiredTokens(now)) + (await purgeOldDevices(now)) + (await purgeExpiredChallenges(now));
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
  const [attachments, releaseAttachments, documents] = await Promise.all([
    db.taskAttachment.findMany({ select: { id: true } }),
    db.releaseAttachment.findMany({ select: { id: true } }),
    db.projectDocument.findMany({ select: { id: true } }),
  ]);
  // Entradas de deshacer por tandas: solo se guardan los ids que mencionan, no todos sus datos a la vez.
  const retained = new Set<string>();
  for (let cursor: string | undefined; ; ) {
    const page = await db.undoEntry.findMany({ select: { id: true, ops: true }, orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const token of undoReferencedTokens(page.map((u) => u.ops))) retained.add(token);
    if (page.length < 200) break;
    cursor = page[page.length - 1]!.id;
  }
  const report = await cleanOrphanFiles(uploadDir(), {
    attachments: new Set([...attachments.map((a) => a.id), ...retained]),
    releaseAttachments: new Set([...releaseAttachments.map((a) => a.id), ...retained]),
    documents: new Set(documents.map((d) => d.id)),
  });
  if (report.aborted) {
    logEvent({ level: "warn", category: "system", action: "uploads.orphansAborted", message: `Limpieza de huérfanos cancelada: ${report.orphans} de ${report.scanned} ficheros parecen huérfanos (demasiados; ¿base de datos equivocada?)`, details: { ...report } });
  } else if (report.deleted > 0) {
    logEvent({ category: "system", action: "uploads.orphansPurged", message: `Ficheros huérfanos borrados: ${report.deleted} (${Math.round(report.bytes / 1024)} KB)`, details: { ...report } });
  }
  return report.deleted;
}

/** Copia de seguridad diaria cifrada de la base de datos y los ficheros (si hay BACKUP_KEY). */
async function backupJob(): Promise<void> {
  const { dailyBackupJob } = await import("@/lib/backup");
  await dailyBackupJob();
}

/** Sube la última copia a los destinos externos (BACKUP_EXTERNAL_DIR / BACKUP_S3_*) si aún no la tienen. */
async function backupExternalJob(): Promise<void> {
  const { externalBackupJob } = await import("@/lib/backup");
  await externalBackupJob();
}

/** Avisa por email a los administradores si la última copia correcta tiene más de 48 h (como mucho cada 24 h). */
async function backupAlertJob(): Promise<void> {
  const { notifyBackupAlertIfDue } = await import("@/lib/backup-alert");
  await notifyBackupAlertIfDue();
}

/** Prueba de restauración mensual de la última copia. */
async function restoreTestJob(): Promise<void> {
  const { monthlyRestoreTestJob } = await import("@/lib/backup");
  await monthlyRestoreTestJob();
}

/** Borra el historial de tareas de más de un año. */
async function purgeOldTaskHistory(now: Date = new Date()): Promise<number> {
  const { purgeOldTaskEvents } = await import("@/lib/task-events");
  return purgeOldTaskEvents(now);
}

/** Resumen diario y informe semanal por email a quien toca (ver periodic-mail.ts). */
async function sendPeriodicMail(now: Date = new Date()): Promise<number> {
  const { sendDueDigests, sendDueReports } = await import("@/lib/periodic-mail");
  return (await sendDueDigests(now)) + (await sendDueReports(now));
}

const RESUME_AFTER_MS = 10 * 1000;

/** Retoma las copias de adjuntos de releases interrumpidas por un reinicio. */
async function resumeReleaseCopies(): Promise<void> {
  const { resumePendingReleaseAttachments } = await import("@/lib/release-attachments");
  await resumePendingReleaseAttachments();
}

/** Recorre todos los adjuntos y la carpeta de subidas: basta con una vez al día. */
const ORPHAN_EVERY_MS = 23 * 60 * 60 * 1000;

/** La papelera de documentos se purga una vez al día. */
const DOCS_TRASH_EVERY_MS = 23 * 60 * 60 * 1000;

/** Tareas de cada pasada, en orden. El nombre es la clave en JobRun (y su etiqueta en Administración). */
export const MAINTENANCE_JOBS = [
  { name: "nonImageCopies", run: () => purgeNonImageCopies() },
  { name: "undo", run: () => purgeOldUndo() },
  { name: "documentsTrashPurge", run: () => purgeDocumentsTrash(), everyMs: DOCS_TRASH_EVERY_MS },
  { name: "notifications", run: () => purgeOldNotifications() },
  { name: "authData", run: () => purgeAuthData() },
  { name: "taskHistory", run: () => purgeOldTaskHistory() },
  { name: "orphanFiles", run: () => purgeOrphanFiles(), everyMs: ORPHAN_EVERY_MS },
  { name: "backup", run: () => backupJob() },
  { name: "backupExternal", run: () => backupExternalJob() },
  { name: "backupAlert", run: () => backupAlertJob() },
  { name: "restoreTest", run: () => restoreTestJob() },
  { name: "periodicMail", run: () => sendPeriodicMail() },
] as const;

/** Ejecuta las tareas bajo el bloqueo `key`: si otro proceso ya lo tiene (p. ej. durante un despliegue), no hace nada. Nunca lanza. */
async function runLocked(key: "maintenance" | "releaseResume", jobs: readonly JobDef[]): Promise<void> {
  try {
    const { withAdvisoryLock, runJob, LOCK_MAINTENANCE, LOCK_RELEASE_RESUME } = await import("@/lib/jobs");
    const res = await withAdvisoryLock(key === "maintenance" ? LOCK_MAINTENANCE : LOCK_RELEASE_RESUME, async () => {
      for (const job of jobs) await runJob(job);
    });
    if (!res.ran) console.info(`[maintenance] ${key}: otro proceso la está ejecutando; se omite esta pasada`);
  } catch (err) {
    console.error(`[maintenance] ${key}`, err);
  }
}

/** Una pasada de mantenimiento; nunca lanza. */
function runMaintenance(): Promise<void> {
  return runLocked("maintenance", MAINTENANCE_JOBS);
}

/** Arranca el temporizador una sola vez por proceso: primera pasada al minuto, luego cada hora. */
export function startMaintenance(): void {
  const g = globalThis as unknown as { __pzMaintenance?: boolean };
  if (g.__pzMaintenance) return;
  g.__pzMaintenance = true;
  // Avisos de cambio de fecha agrupados: se revisan cada 30 s (ver due-notices.ts).
  void import("@/lib/due-notices").then((m) => m.startDueNoticeScheduler()).catch((err) => console.error("[maintenance] avisos de fecha", err));
  // Copias de adjuntos de releases que quedaron a medias por un reinicio: se retoman al poco de arrancar (una vez).
  setTimeout(() => void runLocked("releaseResume", [{ name: "releaseResume", run: resumeReleaseCopies }]), RESUME_AFTER_MS).unref?.();
  setTimeout(() => {
    void runMaintenance();
    setInterval(() => void runMaintenance(), EVERY_MS).unref?.();
  }, FIRST_RUN_MS).unref?.();
}
