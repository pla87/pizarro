// Tareas periódicas de mantenimiento (se arrancan desde instrumentation.ts, una vez por proceso). Si hay
// varios procesos, solo uno las ejecuta cada vez (bloqueo de Postgres) y la última ejecución queda en JobRun.

import type { JobDef, JobSkip } from "./jobs";
import { LOCK_MAIL, LOCK_MAINTENANCE, LOCK_RELEASE_RESUME } from "./advisory-locks";
import { appTimeZone } from "./format";
import { isShuttingDown } from "./shutdown";
import { logSize } from "./format-size";

const DAY_MS = 24 * 60 * 60 * 1000;
const NON_IMAGE_COPY_DAYS = 7;
const READ_NOTIFICATION_DAYS = 90;
const UNREAD_NOTIFICATION_DAYS = 365;
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
  logEvent({ category: "system", action: "releases.nonImageCopiesPurged", label: { k: "Copias de ficheros no imagen borradas (más de {days} días): {n}", p: { days: NON_IMAGE_COPY_DAYS, n: ids.length } }, details: { count: ids.length } });
  return ids.length;
}

/**
 * Borra las entradas de deshacer de más de 7 días (y los ficheros que solo ellas retenían) y las instantáneas de los
 * cambios de plantilla que ya no se pueden deshacer.
 */
async function purgeOldUndo(now: Date = new Date()): Promise<number> {
  const [{ discardUndo, UNDO_MAX_AGE_DAYS }, { db }, { TEMPLATE_UNDO_HOURS }] = await Promise.all([import("@/lib/undo"), import("@/lib/db"), import("@/lib/template-apply-core")]);
  const changes = await db.projectTemplateChange.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - TEMPLATE_UNDO_HOURS * 3_600_000) } } });
  return changes.count + (await discardUndo({ createdAt: { lt: new Date(now.getTime() - UNDO_MAX_AGE_DAYS * DAY_MS) } }));
}

/** Borra de la papelera los documentos con más de DOCUMENT_TRASH_DAYS días (filas y ficheros). */
async function purgeDocumentsTrash(now: Date = new Date()): Promise<number> {
  const { purgeTrashedDocuments } = await import("@/lib/documents");
  return purgeTrashedDocuments(now);
}

/**
 * Borra los avisos ya leídos de más de 90 días y los que nunca se leyeron de más de un año (sin tope, las bandejas de
 * quien no abre la app crecían para siempre). Ambos casos usan el índice (readAt, createdAt).
 */
async function purgeOldNotifications(now: Date = new Date()): Promise<number> {
  const { db } = await import("@/lib/db");
  const read = await db.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: new Date(now.getTime() - READ_NOTIFICATION_DAYS * DAY_MS) } } });
  const unread = await db.notification.deleteMany({ where: { readAt: null, createdAt: { lt: new Date(now.getTime() - UNREAD_NOTIFICATION_DAYS * DAY_MS) } } });
  return read.count + unread.count;
}

/** Borra los enlaces de email caducados y los dispositivos conocidos sin actividad en más de un año. */
async function purgeAuthData(now: Date = new Date()): Promise<number> {
  const [{ purgeExpiredTokens }, { purgeOldDevices }, { purgeExpiredChallenges }, { purgeEndedShares }] = await Promise.all([import("@/lib/auth-token"), import("@/lib/devices"), import("@/lib/two-factor"), import("@/lib/share-out")]);
  // También los enlaces de «Compartir fuera» terminados hace más de 30 días (share-out.ts).
  return (await purgeExpiredTokens(now)) + (await purgeOldDevices(now)) + (await purgeExpiredChallenges(now)) + (await purgeEndedShares(now));
}

/** Ids de fichero (cuid) que mencionan las entradas de deshacer: sus ficheros se retienen aunque la fila ya no exista. */
function undoReferencedTokens(ops: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const m of JSON.stringify(ops).matchAll(/[a-z0-9]{20,}/gi)) out.add(m[0]);
  return out;
}

/**
 * Borra de UPLOAD_DIR los ficheros (adjuntos, miniaturas, copias de releases) que ninguna fila de la BD
 * referencia y que tienen más de 24 h. No toca backups/, enlaces simbólicos ni nombres desconocidos. Primero borra los
 * de las importaciones cortadas por un reinicio (import-journal.ts).
 */
async function purgeOrphanFiles(): Promise<number> {
  const [{ db }, { logEvent, logText }, { cleanOrphanFiles }, { uploadDir }, { recoverImportJournals }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/log"),
    import("@/lib/orphan-files"),
    import("@/lib/upload-dir"),
    import("@/lib/project-export/import-journal"),
  ]);
  // Antes, los ficheros de las importaciones que no terminaron: en una importación grande son más de la mitad de los
  // ficheros y, sin borrarlos aquí, la limpieza se cancelaría por el tope de seguridad.
  await recoverImportJournals();
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
    attachments: new Set(attachments.map((a) => a.id)),
    releaseAttachments: new Set(releaseAttachments.map((a) => a.id)),
    documents: new Set(documents.map((d) => d.id)),
    retained,
  });
  if (report.aborted) {
    const why = report.abortReason === "noRows"
      ? "la base de datos no tiene ningún adjunto ni documento (¿base de datos nueva, equivocada o a medio restaurar?)"
      : "demasiados; ¿base de datos equivocada?";
    logEvent({ level: "warn", category: "system", action: "uploads.orphansAborted", label: { k: "Limpieza de huérfanos cancelada: {orphans} de {scanned} ficheros parecen huérfanos ({why})", p: { orphans: report.orphans, scanned: report.scanned, why: logText(why) } }, details: { ...report } });
  } else if (report.deleted > 0) {
    logEvent({ category: "system", action: "uploads.orphansPurged", label: { k: "Ficheros huérfanos borrados: {n} ({size})", p: { n: report.deleted, size: logSize(report.bytes) } }, details: { ...report } });
  }
  return report.deleted;
}

/** Copia de seguridad diaria cifrada de la base de datos y los ficheros (si hay BACKUP_KEY). */
async function backupJob(): Promise<JobSkip | void> {
  const { dailyBackupJob } = await import("@/lib/backup");
  return dailyBackupJob();
}

/** Sube la última copia a los destinos externos (BACKUP_EXTERNAL_DIR / BACKUP_S3_*) si aún no la tienen. */
async function backupExternalJob(): Promise<JobSkip | void> {
  const { externalBackupJob } = await import("@/lib/backup");
  return externalBackupJob();
}

/** Avisa por email a los administradores si la última copia correcta tiene más de 48 h (como mucho cada 24 h). */
async function backupAlertJob(): Promise<void> {
  const { notifyBackupAlertIfDue } = await import("@/lib/backup-alert");
  await notifyBackupAlertIfDue();
}

/** Prueba de restauración mensual de la última copia. */
async function restoreTestJob(): Promise<JobSkip | void> {
  const { monthlyRestoreTestJob } = await import("@/lib/backup");
  return monthlyRestoreTestJob();
}

/** Borra el historial de tareas de más de un año. */
async function purgeOldTaskHistory(now: Date = new Date()): Promise<number> {
  const { purgeOldTaskEvents } = await import("@/lib/task-events");
  return purgeOldTaskEvents(now);
}

/** Recordatorio a quien tiene tareas esperando demasiado en una columna «Esperando» (ver waiting.ts). */
async function waitingRemindersJob(now: Date = new Date()): Promise<number> {
  const { deliverWaitingReminders } = await import("@/lib/waiting");
  return deliverWaitingReminders(now);
}

/** Resumen diario y informe semanal por email a quien toca (ver periodic-mail.ts). */
async function sendPeriodicMail(now: Date = new Date()): Promise<number> {
  const { sendDueDigests, sendDueReports } = await import("@/lib/periodic-mail");
  return (await sendDueDigests(now)) + (await sendDueReports(now));
}

/** Borra los archivos de exportación de proyectos con más de 24 h (y marca esos trabajos como caducados). */
async function purgeTransfers(now: Date = new Date()): Promise<number> {
  const { purgeTransferJobs } = await import("@/lib/transfer-jobs");
  return purgeTransferJobs(now);
}

/** Borra lo compartido con «Compartir → Pizarro» que nadie ha usado (caduca a los 30 minutos; ver share-inbox.ts). */
async function purgeSharedFiles(now: Date = new Date()): Promise<number> {
  const { purgeShares } = await import("@/lib/share-inbox");
  return purgeShares(now.getTime());
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

/**
 * Limpiezas con una retención de días (copias no imagen, 7 días; avisos, 90 y 365; dispositivos, un año; historial, un
 * año) o de cosas caducadas que ya no valen (enlaces de email y retos de doble factor): una vez al día basta. Cada hora
 * eran cuatro DELETE de más con su recorrido de índices. Deshacer sigue cada hora (su pila caduca a los 7 días, pero los
 * cambios de plantilla que limpia, a las 24 h).
 */
const DAILY_PURGE_EVERY_MS = 23 * 60 * 60 * 1000;

/** Tareas de cada pasada, en orden. El nombre es la clave en JobRun (y su etiqueta en Administración). */
export const MAINTENANCE_JOBS = [
  { name: "nonImageCopies", run: () => purgeNonImageCopies(), everyMs: DAILY_PURGE_EVERY_MS },
  { name: "undo", run: () => purgeOldUndo() },
  { name: "documentsTrashPurge", run: () => purgeDocumentsTrash(), everyMs: DOCS_TRASH_EVERY_MS },
  { name: "notifications", run: () => purgeOldNotifications(), everyMs: DAILY_PURGE_EVERY_MS },
  { name: "transferJobs", run: () => purgeTransfers() },
  { name: "sharedFiles", run: () => purgeSharedFiles() },
  { name: "authData", run: () => purgeAuthData(), everyMs: DAILY_PURGE_EVERY_MS },
  { name: "taskHistory", run: () => purgeOldTaskHistory(), everyMs: DAILY_PURGE_EVERY_MS },
  { name: "orphanFiles", run: () => purgeOrphanFiles(), everyMs: ORPHAN_EVERY_MS },
  { name: "backup", run: () => backupJob() },
  { name: "backupExternal", run: () => backupExternalJob() },
  { name: "backupAlert", run: () => backupAlertJob() },
  { name: "restoreTest", run: () => restoreTestJob() },
] as const;

/**
 * Correo programado (resúmenes, informes y recordatorios): ciclo y bloqueo propios, a la misma hora que el mantenimiento
 * pero sin esperar a que termine. Iban al final de la pasada, detrás de la copia de seguridad, la subida externa y la
 * prueba de restauración mensual, y un día de copia lenta el resumen diario salía con retraso.
 */
export const MAIL_JOBS = [
  { name: "periodicMail", run: () => sendPeriodicMail() },
  { name: "waitingReminders", run: () => waitingRemindersJob() },
] as const;

/** Todas las tareas programadas en el orden en que se muestran en Administración → Copias de seguridad. */
export const SCHEDULED_JOBS: readonly JobDef[] = [...MAIL_JOBS, ...MAINTENANCE_JOBS];

type LockName = "maintenance" | "mail" | "releaseResume";

/** Ejecuta las tareas bajo el bloqueo `key`: si otro proceso ya lo tiene (p. ej. durante un despliegue), no hace nada. Nunca lanza. */
async function runLocked(key: LockName, jobs: readonly JobDef[]): Promise<void> {
  // Apagado del servidor en marcha: no se empieza trabajo nuevo.
  if (isShuttingDown()) return;
  try {
    const { withAdvisoryLock, runJob } = await import("@/lib/jobs");
    const lockKey = { maintenance: LOCK_MAINTENANCE, mail: LOCK_MAIL, releaseResume: LOCK_RELEASE_RESUME }[key];
    const res = await withAdvisoryLock(lockKey, async () => {
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

/** Una pasada del correo programado; nunca lanza. */
export function runMail(): Promise<void> {
  return runLocked("mail", MAIL_JOBS);
}

/** Margen tras la hora en punto para la pasada del correo (que «las 08:00» ya hayan llegado en todos los relojes). */
const MAIL_AFTER_HOUR_MS = 60 * 1000;

/**
 * Milisegundos hasta la próxima hora en punto (en la zona horaria `timeZone`) más MAIL_AFTER_HOUR_MS. En la zona de la
 * app y no en UTC: en una zona con media hora (Asia/Kolkata, UTC+5:30) la hora en punto local no lo es en UTC.
 */
export function msUntilMailPass(now: Date, timeZone: string): number {
  let minute = now.getUTCMinutes();
  try {
    minute = Number(new Intl.DateTimeFormat("en-US", { timeZone, minute: "2-digit" }).format(now)) % 60;
  } catch {
    // zona no válida: la de UTC
  }
  const intoHour = minute * 60_000 + now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  const wait = EVERY_MS - intoHour + MAIL_AFTER_HOUR_MS;
  // Justo después de la hora en punto (dentro del margen) toca en este mismo minuto, no dentro de una hora.
  return wait > EVERY_MS ? wait - EVERY_MS : wait;
}

/**
 * Programa la pasada del correo a la hora en punto (+1 min) de la zona de la app, y la siguiente al terminar el plazo: un
 * resumen «a las 08:00» sale a las 08:01, no en cualquier minuto hasta las 08:59 según cuándo arrancó el proceso. Con
 * setTimeout encadenado y no setInterval, para no ir desviándose ni seguir con una zona horaria cambiada en Ajustes.
 */
function scheduleMailOnTheHour(): void {
  const wait = msUntilMailPass(new Date(), appTimeZone());
  setTimeout(() => {
    void runMail();
    scheduleMailOnTheHour();
  }, wait).unref?.();
}

/**
 * Arranca los temporizadores una sola vez por proceso. Mantenimiento: primera pasada al minuto, luego cada hora. Correo:
 * una pasada al minuto (para lo que tocaba mientras el servidor estaba parado) y después a cada hora en punto (+1 min).
 */
export function startMaintenance(): void {
  const g = globalThis as unknown as { __pzMaintenance?: boolean };
  if (g.__pzMaintenance) return;
  g.__pzMaintenance = true;
  // Avisos de cambio de fecha agrupados: se revisan cada minuto (DUE_NOTIFY_POLL_MS, ver due-notices.ts).
  void import("@/lib/due-notices").then((m) => m.startDueNoticeScheduler()).catch((err) => console.error("[maintenance] avisos de fecha", err));
  // Exportaciones e importaciones de proyectos en segundo plano: cola propia y recuperación de las interrumpidas.
  void import("@/lib/transfer-jobs").then((m) => m.startTransferWorker()).catch((err) => console.error("[maintenance] transferencias de proyectos", err));
  // Copias de adjuntos de releases que quedaron a medias por un reinicio: se retoman al poco de arrancar (una vez).
  setTimeout(() => void runLocked("releaseResume", [{ name: "releaseResume", run: resumeReleaseCopies }]), RESUME_AFTER_MS).unref?.();
  // Mantenimiento y correo arrancan a la vez, cada uno con su bloqueo: el correo no espera a las copias.
  setTimeout(() => {
    void runMail();
    void runMaintenance();
    setInterval(() => void runMaintenance(), EVERY_MS).unref?.();
  }, FIRST_RUN_MS).unref?.();
  scheduleMailOnTheHour();
}
