import "server-only";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { makeT, toLocale, type T } from "@/i18n/core";
import { db } from "./db";
import { assertDiskRoom, isNoSpaceError, NO_SPACE_MESSAGE, releaseDisk, reserveDisk } from "./disk-space";
import { AppError } from "./errors";
import { logEvent } from "./log";
import { buildProjectExport, estimateProjectExport } from "./project-export/export";
import { ArchiveError } from "./project-export/errors";
import { importProjectFile, type ImportSummary } from "./project-export/import";
import type { ExportOptions } from "./project-export/types";
import { writeProjectExport } from "./project-export/write";
import { uploadDir } from "./upload-dir";
import { ZipReadError } from "./zip-read";

// Exportaciones e importaciones de proyectos en segundo plano. La petición solo crea una fila (cola FIFO propia,
// separada de los huecos de ZIP de releases y de subida) y un trabajador del servidor las va ejecutando, anotando el
// progreso en la fila para que la interfaz lo consulte. Un reinicio deja las filas RUNNING sin latido: se retoman o se marcan como fallidas.

export type TransferKind = "EXPORT" | "IMPORT";
export type TransferStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "EXPIRED";

export interface TransferProgress {
  phase?: "datos" | "archivos" | "comprimir" | "validar" | "base de datos";
  done?: number;
  total?: number;
}

/** Máximo de trabajos en cola o en marcha por persona. */
export const MAX_JOBS_PER_USER = 2;
/** Cuánto vive el fichero exportado (y el resumen de una importación) tras terminar. */
export const TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;
/** Las filas terminadas se borran del todo pasado este tiempo. */
const ROW_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** Un trabajo RUNNING sin escribir nada desde hace esto se da por muerto (el trabajador late cada HEARTBEAT_MS). */
export const STALE_MS = 40_000;
const HEARTBEAT_MS = 10_000;
const SWEEP_EVERY_MS = 20_000;
/** Veces que una exportación interrumpida por un reinicio se vuelve a poner en cola antes de darla por fallida. */
const MAX_ATTEMPTS = 2;
const LOCK_TRANSFER_CLAIM = 741_031_003;
const INTERRUPTED = "Interrumpido por un reinicio";
/** Hueco de más que se pide al disco sobre el tamaño del archivo al importar (imágenes recodificadas, temporales…). */
const IMPORT_FACTOR = 1.5;

/** Trabajos simultáneos por defecto. Cada uno tiene en memoria como mucho el project.json (64 MB) o un adjunto de importación (~100 MB), así que dos caben de sobra. */
export const DEFAULT_CONCURRENCY = 2;

/** Trabajos simultáneos en todo el servidor (PROJECT_TRANSFER_CONCURRENCY, 2 por defecto). Se lee cada vez. */
export function transferConcurrency(raw: string | undefined = process.env.PROJECT_TRANSFER_CONCURRENCY): number {
  const n = Math.floor(Number(raw));
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : DEFAULT_CONCURRENCY;
}

export const exportsDir = () => path.join(/*turbopackIgnore: true*/ uploadDir(), "exports");

type JobRow = Awaited<ReturnType<typeof db.projectTransferJob.findUniqueOrThrow>>;

interface ExportJobResult { file: string; size: number; name: string; missingFiles: number; counts: Record<string, number> }

// ---------------------------------------------------------------------------------------------------------------
// Alta de trabajos

/** Cuenta los trabajos vivos de la persona y crea el nuevo con la misma exclusión (bloqueo por persona), para que dos peticiones a la vez no superen el tope. */
async function enqueue(userId: string, data: Omit<Prisma.ProjectTransferJobUncheckedCreateInput, "userId">): Promise<JobRow> {
  const job = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`transfer-user:${userId}`}))::text`;
    const live = await tx.projectTransferJob.count({ where: { userId, status: { in: ["QUEUED", "RUNNING"] } } });
    if (live >= MAX_JOBS_PER_USER) throw new AppError("Ya tienes dos exportaciones o importaciones en curso. Espera a que termine alguna.", 429, "transfer_limit");
    return tx.projectTransferJob.create({ data: { ...data, userId } });
  });
  kickTransferWorker();
  return job;
}

/** ¿Tiene ya la persona el máximo de trabajos vivos? Se comprueba pronto (antes de recibir un archivo grande). */
export async function assertUserCanQueue(userId: string): Promise<void> {
  const live = await db.projectTransferJob.count({ where: { userId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (live >= MAX_JOBS_PER_USER) throw new AppError("Ya tienes dos exportaciones o importaciones en curso. Espera a que termine alguna.", 429, "transfer_limit");
}

/** Pone en cola la exportación de un proyecto (permisos ya comprobados). Comprueba antes que haya sitio en disco. */
export async function createExportJob(userId: string, projectId: string, options: ExportOptions): Promise<JobRow> {
  await assertUserCanQueue(userId);
  const est = await estimateProjectExport(projectId, options);
  await assertDiskRoom(exportsDir(), Math.ceil(est.bytes * 1.05) + 1024 * 1024);
  return enqueue(userId, { kind: "EXPORT", projectId, options: { attachments: options.attachments, scope: options.scope }, progress: {} });
}

/** Pone en cola la importación de un archivo ya subido a `tempFile` (de `bytes` bytes). El trabajo se queda con el fichero y lo borra al terminar. */
export async function createImportJob(userId: string, tempFile: string, bytes: number, isPrivate: boolean, name?: string): Promise<JobRow> {
  await assertDiskRoom(uploadDir(), Math.ceil(bytes * IMPORT_FACTOR));
  return enqueue(userId, { kind: "IMPORT", options: { isPrivate, tempFile, bytes, ...(name ? { name } : {}) }, progress: { phase: "validar" } });
}

// ---------------------------------------------------------------------------------------------------------------
// Consulta (con permisos) y forma pública

export interface TransferViewer {
  id: string;
  role: "ADMIN" | "MEMBER";
}

/** Solo la persona que lo pidió (ni siquiera un administrador). Los demás no saben ni que existe. */
export async function getJobFor(viewer: TransferViewer, id: string): Promise<JobRow> {
  const job = await db.projectTransferJob.findUnique({ where: { id } });
  if (!job || job.userId !== viewer.id) throw new AppError("No encontrado o sin acceso.", 404);
  return job;
}

export interface TransferJobView {
  id: string;
  kind: TransferKind;
  status: TransferStatus;
  projectId: string | null;
  progress: TransferProgress;
  /** Exportación: nombre y tamaño del archivo; importación: el resumen. */
  result: { name: string; size: number } | ImportSummary | null;
  error: string | null;
  /** Trabajos en cola por delante de este (solo si está en cola). */
  ahead: number;
  notified: boolean;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
}

/** Forma que ve la interfaz: sin rutas del servidor y con el error en el idioma de quien lo pide. */
export async function toView(job: JobRow, t: T): Promise<TransferJobView> {
  const ahead = job.status === "QUEUED" ? await db.projectTransferJob.count({ where: { status: "QUEUED", OR: [{ createdAt: { lt: job.createdAt } }, { createdAt: job.createdAt, id: { lt: job.id } }] } }) : 0;
  let result: TransferJobView["result"] = null;
  if (job.result && job.status === "DONE") {
    result = job.kind === "EXPORT" ? { name: (job.result as unknown as ExportJobResult).name, size: (job.result as unknown as ExportJobResult).size } : (job.result as unknown as ImportSummary);
  }
  return {
    id: job.id, kind: job.kind, status: job.status, projectId: job.projectId, progress: job.progress as TransferProgress, result,
    error: job.error ? t(job.error) : null, ahead, notified: job.notifiedAt !== null,
    createdAt: job.createdAt.toISOString(), finishedAt: job.finishedAt?.toISOString() ?? null, expiresAt: job.expiresAt?.toISOString() ?? null,
  };
}

/** Cuánto sigue en la lista una exportación caducada (para que se vea que caducó y se pueda volver a exportar). */
const EXPIRED_SHOWN_MS = 24 * 60 * 60 * 1000;

/** Trabajos vivos, los terminados hace menos de 24 h, las exportaciones listas hasta que caducan y las caducadas hace menos de 24 h; los más recientes primero. */
export async function listRecentJobs(userId: string, filter: { kind?: TransferKind; projectId?: string } = {}, now: Date = new Date()): Promise<JobRow[]> {
  return db.projectTransferJob.findMany({
    where: {
      userId, ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.projectId ? { projectId: filter.projectId } : {}),
      OR: [
        { status: { in: ["QUEUED", "RUNNING"] } },
        { status: "DONE", expiresAt: { gt: now } },
        { status: { in: ["DONE", "FAILED"] }, finishedAt: { gt: new Date(now.getTime() - TRANSFER_TTL_MS) } },
        { status: "EXPIRED", expiresAt: { gt: new Date(now.getTime() - EXPIRED_SHOWN_MS) } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });
}

/** Anota que la persona ya vio cómo terminó (para no volver a avisarla con el aviso emergente). */
export async function acknowledgeJob(viewer: TransferViewer, id: string): Promise<void> {
  const job = await getJobFor(viewer, id);
  if (job.userId !== viewer.id || job.notifiedAt) return;
  await db.projectTransferJob.updateMany({ where: { id, notifiedAt: null, status: { in: ["DONE", "FAILED", "EXPIRED"] } }, data: { notifiedAt: new Date() } });
}

/** Ruta absoluta del archivo exportado, o null si no es una exportación lista (o la ruta guardada no cuelga de exports/). */
export function exportFileOf(job: JobRow): { file: string; name: string; size: number } | null {
  if (job.kind !== "EXPORT" || job.status !== "DONE" || !job.result) return null;
  const r = job.result as unknown as ExportJobResult;
  const dir = exportsDir();
  const file = path.resolve(dir, r.file);
  if (path.dirname(file) !== dir) return null;
  return { file, name: r.name, size: r.size };
}

// ---------------------------------------------------------------------------------------------------------------
// Trabajador

const state = ((globalThis as unknown as { __pzTransfer?: { active: number; pumping: boolean; again: boolean; started: boolean } }).__pzTransfer ??= { active: 0, pumping: false, again: false, started: false });

/** Reserva el trabajo más antiguo en cola si hay hueco en todo el servidor (cuenta los RUNNING de cualquier proceso). */
export async function claimNextJob(now: Date = new Date()): Promise<JobRow | null> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${LOCK_TRANSFER_CLAIM})::text`;
    if ((await tx.projectTransferJob.count({ where: { status: "RUNNING" } })) >= transferConcurrency()) return null;
    const next = await tx.projectTransferJob.findFirst({ where: { status: "QUEUED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!next) return null;
    return tx.projectTransferJob.update({ where: { id: next.id }, data: { status: "RUNNING", startedAt: now, progress: { phase: next.kind === "EXPORT" ? "datos" : "validar" } } });
  });
}

/** Actualiza el progreso como mucho unas dos veces por segundo (siempre escribe el último valor al terminar la fase). */
function progressWriter(jobId: string) {
  let last = 0;
  let latest: TransferProgress = {};
  let chain: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    last = Date.now();
    const value = latest as Prisma.InputJsonValue;
    chain = chain.then(() => db.projectTransferJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { progress: value } })).catch(() => {});
  };
  return {
    set(p: TransferProgress) {
      const phaseChanged = p.phase !== latest.phase;
      latest = p;
      const wait = 500 - (Date.now() - last);
      if (phaseChanged || wait <= 0) flush();
      else timer ??= setTimeout(flush, wait); // el último valor no se pierde si llega dentro del intervalo
    },
    /** Latido: escribe el último progreso (y con ello `updatedAt`) aunque no haya cambiado. */
    beat: flush,
    async settle() {
      clearTimeout(timer);
      await chain;
    },
  };
}

async function translatorFor(userId: string): Promise<T> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { locale: true } }).catch(() => null);
  return makeT(toLocale(u?.locale));
}

/** Mensaje de error del trabajo, ya en el idioma de la persona. Los fallos inesperados se anotan en el registro y se resumen. */
function failureMessage(err: unknown, t: T, fallback: string): string {
  if (err instanceof ArchiveError) return `${t(err.base)}${err.detail ? ` (${err.detail})` : ""}`;
  if (err instanceof ZipReadError) return `${t("El archivo está dañado.")} (${err.message})`;
  if (err instanceof AppError) return t(err.message);
  return t(fallback);
}

/** Ejecuta un trabajo ya reservado (RUNNING). Nunca lanza: deja el resultado o el error en la fila. */
export async function executeJob(job: JobRow): Promise<void> {
  const t = await translatorFor(job.userId);
  const progress = progressWriter(job.id);
  const beat = setInterval(() => progress.beat(), HEARTBEAT_MS);
  beat.unref?.();
  const started = performance.now();
  const user = await db.user.findUnique({ where: { id: job.userId }, select: { id: true, name: true, email: true, role: true, active: true } }).catch(() => null);
  let result: object | null = null;
  let projectId = job.projectId;
  let error: string | null = null;
  try {
    if (!user || !user.active) throw new AppError("No autorizado", 401);
    if (job.kind === "EXPORT") result = await runExport(job, progress);
    else {
      const summary = await runImport(job, user, t, progress);
      result = summary;
      projectId = summary.projectId;
    }
  } catch (err) {
    error = failureMessage(err, t, job.kind === "EXPORT" ? "No se pudo exportar el proyecto." : "No se pudo importar el proyecto.");
    if (!(err instanceof AppError) && !(err instanceof ZipReadError)) console.error(`[transfer ${job.kind}]`, err);
    logEvent({
      level: err instanceof AppError || err instanceof ZipReadError ? "warn" : "error", category: "api",
      action: job.kind === "EXPORT" ? "projects.exportFailed" : "projects.importFailed",
      message: `Fallo en ${job.kind === "EXPORT" ? "la exportación" : "la importación"} de un proyecto: ${err instanceof Error ? err.message : String(err)}`,
      userId: job.userId, userName: user?.name ?? null, projectId: projectId ?? undefined, path: "background:transfer", durationMs: performance.now() - started, details: { jobId: job.id },
    });
  } finally {
    clearInterval(beat);
    releaseDisk(job.id);
    await progress.settle();
    if (job.kind === "IMPORT") await rm(String((job.options as { tempFile?: string }).tempFile ?? ""), { force: true }).catch(() => {});
  }
  const now = new Date();
  const finished = await db.projectTransferJob
    .updateMany({
      // Con el mismo startedAt que reservó este trabajador: un duplicado rezagado (el trabajo ya se retomó) no pisa al vigente.
      where: { id: job.id, status: "RUNNING", startedAt: job.startedAt },
      data: error === null
        ? { status: "DONE", finishedAt: now, expiresAt: new Date(now.getTime() + TRANSFER_TTL_MS), result: result as Prisma.InputJsonValue, projectId, error: null, progress: { phase: job.kind === "EXPORT" ? "comprimir" : "base de datos", done: 1, total: 1 } }
        : { status: "FAILED", finishedAt: now, expiresAt: new Date(now.getTime() + TRANSFER_TTL_MS), error },
    })
    .catch((err) => { console.error("[transfer] no se pudo anotar el final", err); return null; });
  if (finished?.count && error === null && job.kind === "EXPORT") await dropPreviousExports(job);
}

/**
 * Al terminar una exportación, retira las exportaciones listas anteriores de la misma persona y el mismo proyecto
 * (la fila pasa a EXPIRED y se borra el archivo): la última sustituye a las demás y no se acumulan GB en el disco.
 */
export async function dropPreviousExports(job: { id: string; userId: string; projectId: string | null }): Promise<number> {
  if (!job.projectId) return 0;
  let dropped = 0;
  try {
    // Solo las que terminaron estrictamente antes (a igual instante, desempata el id): dos exportaciones casi
    // simultáneas no se borran entre sí, y la más reciente siempre sobrevive.
    const me = await db.projectTransferJob.findUnique({ where: { id: job.id }, select: { finishedAt: true } });
    if (!me?.finishedAt) return 0;
    const old = await db.projectTransferJob.findMany({
      where: {
        kind: "EXPORT", status: "DONE", userId: job.userId, projectId: job.projectId, id: { not: job.id },
        OR: [{ finishedAt: { lt: me.finishedAt } }, { finishedAt: me.finishedAt, id: { lt: job.id } }],
      },
    });
    for (const o of old) {
      const res = await db.projectTransferJob.updateMany({ where: { id: o.id, status: "DONE" }, data: { status: "EXPIRED" } });
      if (res.count === 0) continue;
      const f = exportFileOf(o);
      if (f) await rm(f.file, { force: true }).catch(() => {});
      dropped++;
    }
  } catch (err) {
    console.error("[transfer] no se pudieron retirar las exportaciones anteriores", err);
  }
  return dropped;
}

/** Temporal del intento actual de una exportación (junto al archivo final, para renombrarlo sin salir del sistema de ficheros). */
const exportTmpFile = (job: { id: string; attempts: number }) => path.join(exportsDir(), `${job.id}.${job.attempts}.tmp`);

async function runExport(job: JobRow, progress: ReturnType<typeof progressWriter>): Promise<ExportJobResult> {
  const options = job.options as unknown as ExportOptions;
  if (!job.projectId) throw new AppError("No encontrado o sin acceso.", 404);
  const started = performance.now();
  progress.set({ phase: "datos" });
  const project = await db.project.findUnique({ where: { id: job.projectId }, select: { id: true, name: true } });
  if (!project) throw new AppError("El proyecto ya no existe.", 404);
  // La fase «datos» incluye leer y resumir cada adjunto: avanza por ficheros (el total sale de los recuentos previos).
  const total = options.attachments ? (await estimateProjectExport(project.id, options)).attachments : 0;
  let seen = 0;
  const built = await buildProjectExport(project.id, options, new Date(), total ? () => progress.set({ phase: "datos", done: Math.min(++seen, total), total }) : undefined);
  const dir = exportsDir();
  await mkdir(dir, { recursive: true });
  // Con el tamaño exacto ya conocido: la comprobación definitiva de espacio, antes de escribir nada.
  await assertDiskRoom(dir, built.size, undefined, undefined, job.id);
  reserveDisk(job.id, dir, built.size); // hasta que termine, otros trabajos descuentan lo que este aún va a escribir
  const rel = `${job.id}.pizarro.zip`;
  const dest = path.join(dir, rel);
  progress.set({ phase: "archivos", done: 0, total: 0 });
  let size: number;
  try {
    // «archivos» mientras se vuelcan los adjuntos al ZIP; al terminar el último pasa a «comprimir» (cerrar, comprobar y renombrar).
    size = await writeProjectExport(built, dest, (done, total) => progress.set(total > 0 && done >= total ? { phase: "comprimir" } : { phase: "archivos", done, total }), exportTmpFile(job));
  } catch (err) {
    await rm(exportTmpFile(job), { force: true }).catch(() => {});
    if (isNoSpaceError(err)) throw new AppError(NO_SPACE_MESSAGE, 507, "disk_full");
    throw err;
  }
  const u = await db.user.findUnique({ where: { id: job.userId }, select: { name: true } });
  logEvent({
    category: "api", action: "projects.export",
    message: `Proyecto «${project.name}» exportado (${built.manifest.counts.tasks} tareas, ${Math.round(size / 1024)} KB)`,
    userId: job.userId, userName: u?.name ?? null, projectId: project.id, path: "background:transfer", durationMs: performance.now() - started,
    details: { jobId: job.id, options: built.manifest.options, counts: built.manifest.counts, bytes: size, missingFiles: built.missingFiles },
  });
  return { file: rel, size, name: built.filename, missingFiles: built.missingFiles, counts: built.manifest.counts as unknown as Record<string, number> };
}

async function runImport(job: JobRow, user: { id: string; name: string; email: string; role: "ADMIN" | "MEMBER" }, t: T, progress: ReturnType<typeof progressWriter>): Promise<ImportSummary> {
  const opts = job.options as { isPrivate?: boolean; tempFile?: string; bytes?: number };
  if (!opts.tempFile) throw new AppError("No se ha recibido ningún archivo.");
  const started = performance.now();
  try {
    await stat(opts.tempFile);
  } catch {
    throw new AppError("El archivo subido ya no está en el servidor. Vuelve a subirlo.", 410);
  }
  const importBytes = Math.ceil((opts.bytes ?? 0) * IMPORT_FACTOR);
  await assertDiskRoom(uploadDir(), importBytes, undefined, undefined, job.id);
  reserveDisk(job.id, uploadDir(), importBytes);
  const summary = await importProjectFile(opts.tempFile, user, { isPrivate: !!opts.isPrivate, t, onProgress: (p) => progress.set(p) });
  logEvent({
    category: "api", action: "projects.import",
    message: `Proyecto «${summary.name}» importado desde un archivo (${summary.counts.tasks} tareas, ${Math.round((opts.bytes ?? 0) / 1024)} KB)`,
    userId: user.id, userName: user.name, projectId: summary.projectId, path: "background:transfer", durationMs: performance.now() - started,
    details: { jobId: job.id, bytes: opts.bytes, isPrivate: !!opts.isPrivate, counts: summary.counts, unmappedUsers: summary.unmappedUsers.length, addedMembers: summary.addedMembers, warnings: summary.warnings.length },
  });
  return summary;
}

/** Reserva y ejecuta (esperando) el siguiente trabajo en cola; devuelve su id, o null si no había ninguno o no hay hueco. */
export async function runNextTransferJob(): Promise<string | null> {
  const job = await claimNextJob();
  if (!job) return null;
  await executeJob(job);
  return job.id;
}

/** Despierta al trabajador (no espera). Se llama al encolar y al terminar cada trabajo; no hace nada hasta que arranca (startTransferWorker). */
export function kickTransferWorker(): void {
  if (!state.started) return;
  setImmediate(() => void pump());
}

async function pump(): Promise<void> {
  if (state.pumping) {
    state.again = true;
    return;
  }
  state.pumping = true;
  try {
    do {
      state.again = false;
      // En este proceso nunca más de `transferConcurrency()`; entre procesos lo garantiza la reserva con bloqueo.
      while (state.active < transferConcurrency()) {
        const job = await claimNextJob();
        if (!job) break;
        state.active++;
        void executeJob(job).finally(() => {
          state.active--;
          kickTransferWorker();
        });
      }
    } while (state.again);
  } catch (err) {
    console.error("[transfer] cola", err);
  } finally {
    state.pumping = false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reinicios, caducidad y arranque

/**
 * Trabajos RUNNING sin latido desde hace más de `staleMs` (murió el proceso que los ejecutaba). Las exportaciones se
 * vuelven a poner en cola (hasta MAX_ATTEMPTS veces: no dejan nada a medias); las importaciones se dan por fallidas
 * y se borra su temporal. Devuelve cuántos se tocaron.
 */
export async function recoverInterruptedJobs(now: Date = new Date(), staleMs: number = STALE_MS): Promise<number> {
  const stale = await db.projectTransferJob.findMany({ where: { status: "RUNNING", updatedAt: { lt: new Date(now.getTime() - staleMs) } } });
  let touched = 0;
  for (const job of stale) {
    const guard = { id: job.id, status: "RUNNING" as const, updatedAt: job.updatedAt };
    const requeue = job.kind === "EXPORT" && job.attempts < MAX_ATTEMPTS;
    const res = requeue
      ? await db.projectTransferJob.updateMany({ where: guard, data: { status: "QUEUED", attempts: job.attempts + 1, startedAt: null, progress: {} } })
      : await db.projectTransferJob.updateMany({ where: guard, data: { status: "FAILED", error: INTERRUPTED, finishedAt: now, expiresAt: new Date(now.getTime() + TRANSFER_TTL_MS) } });
    if (res.count === 0) continue;
    touched++;
    if (job.kind === "EXPORT") await rm(exportTmpFile(job), { force: true }).catch(() => {});
    else await rm(String((job.options as { tempFile?: string }).tempFile ?? ""), { force: true }).catch(() => {});
    logEvent({
      level: "warn", category: "system", action: "projects.transferInterrupted",
      message: `${job.kind === "EXPORT" ? "Exportación" : "Importación"} de un proyecto interrumpida por un reinicio (${requeue ? "se vuelve a poner en cola" : "marcada como fallida"})`,
      userId: job.userId, projectId: job.projectId ?? undefined, details: { jobId: job.id, attempts: job.attempts },
    });
  }
  if (touched) kickTransferWorker();
  return touched;
}

/**
 * Mantenimiento: borra los archivos exportados de más de 24 h (la fila pasa a EXPIRED), los restos sin fila en exports/
 * y las filas terminadas hace más de 7 días. Devuelve cuántos archivos se borraron.
 */
export async function purgeTransferJobs(now: Date = new Date()): Promise<number> {
  let removed = 0;
  const due = await db.projectTransferJob.findMany({ where: { status: "DONE", expiresAt: { lt: now } } });
  for (const job of due) {
    const f = exportFileOf(job);
    if (f) {
      await rm(f.file, { force: true }).catch(() => {});
      removed++;
    }
    await db.projectTransferJob.updateMany({ where: { id: job.id, status: "DONE" }, data: { status: "EXPIRED" } });
  }
  // Restos: ficheros de exports/ que no pertenecen a ninguna exportación lista y llevan más de 24 h (temporales de un fallo).
  try {
    const dir = exportsDir();
    const names = await readdir(dir);
    const live = new Set((await db.projectTransferJob.findMany({ where: { kind: "EXPORT", status: { in: ["DONE", "RUNNING", "QUEUED"] } }, select: { id: true } })).map((j) => j.id));
    for (const name of names) {
      if (live.has(name.split(".")[0]!)) continue;
      const file = path.join(dir, name);
      const s = await stat(file).catch(() => null);
      if (s?.isFile() && now.getTime() - s.mtimeMs > TRANSFER_TTL_MS) {
        await rm(file, { force: true });
        removed++;
      }
    }
  } catch {
    // sin carpeta exports/: nada que limpiar
  }
  await db.projectTransferJob.deleteMany({ where: { status: { in: ["DONE", "FAILED", "EXPIRED"] }, finishedAt: { lt: new Date(now.getTime() - ROW_KEEP_MS) } } });
  if (removed) logEvent({ category: "system", action: "projects.transferPurged", message: `Archivos de exportación caducados borrados: ${removed}`, details: { count: removed } });
  return removed;
}

/** Arranca el trabajador una vez por proceso: retoma lo pendiente, vigila los trabajos muertos y atiende la cola. */
export function startTransferWorker(): void {
  if (state.started) return;
  state.started = true;
  const sweep = () => void recoverInterruptedJobs().then(() => pump()).catch((err) => console.error("[transfer] barrido", err));
  setTimeout(() => {
    sweep();
    setInterval(sweep, SWEEP_EVERY_MS).unref?.();
  }, SWEEP_EVERY_MS).unref?.();
  kickTransferWorker();
}
