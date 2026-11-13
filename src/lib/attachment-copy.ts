import "server-only";
import { constants } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { isNoSpaceError } from "./disk-space";
import { logEvent } from "./log";
import { checkQuota, type QuotaExceeded } from "./quota";
import { getQuotaLimits } from "./quota-settings";
import { storageUsage } from "./storage-usage";
import { uploadDir } from "./upload-dir";
import { attachmentPath, newFileId, removeAttachmentFiles } from "./uploads";

// Copia de los adjuntos de una tarea en otra (Duplicar, también al soltar con Ctrl/Alt en otra columna).
//
// Cada copia es un adjunto independiente con su propio fichero (`<idNuevo>.webp` + miniatura, o `.bin`): borrar la
// original o la copia (y deshacerlo, y la limpieza de huérfanos, que mira las filas) no afecta a la otra. No se comparte
// el fichero entre dos filas: todo el código que borra ficheros (deshacer, limpieza de espacio, borrado de proyectos,
// huérfanos) asume un fichero por fila. La copia usa COPYFILE_FICLONE: en sistemas de ficheros que lo admiten (btrfs,
// XFS, APFS) no ocupa espacio hasta que una de las dos cambia; en el resto es una copia normal.
//
// Cuotas: las copias cuentan como cualquier subida (tope de adjuntos por tarea y cuotas de almacenamiento del proyecto
// y total). Se copian en orden mientras quepan; los que no caben se omiten y quien duplica recibe un aviso con cuáles y
// por qué (la tarea se crea igualmente: lo importante de duplicar es la tarea, y los adjuntos que faltan se pueden subir
// después o liberar espacio y volver a duplicar).

type Client = Prisma.TransactionClient | typeof db;

type CopySkipReason = "task_total" | "quota" | "missing" | "error";

interface AttachmentCopySkip {
  name: string;
  size: number;
  reason: CopySkipReason;
}

export interface AttachmentCopyResult {
  copied: number;
  skipped: AttachmentCopySkip[];
  /** Con algún omitido por cuota: la primera cuota superada (para el mensaje). */
  quota?: QuotaExceeded;
  /** Con algún omitido por el tope de la tarea: ese tope (MB). */
  taskLimitMb?: number;
}

type Verdict = { ok: true } | { ok: false; reason: "task_total" } | { ok: false; reason: "quota"; quota: QuotaExceeded };

/**
 * Qué cabe de estos tamaños, en orden, en la tarea `taskId` (tope de adjuntos por tarea del proyecto) y en las cuotas
 * de almacenamiento. Lo que no cabe no cuenta para los siguientes: un adjunto pequeño detrás de uno grande que no cabe
 * se copia igual. Mismas reglas que una subida (attachmentLimitProblem).
 */
async function fitPlan(client: Client, taskId: string, sizes: number[]): Promise<{ verdicts: Verdict[]; limitMb: number } | null> {
  const task = await client.task.findUnique({ where: { id: taskId }, select: { projectId: true, project: { select: { taskAttachMaxMb: true } } } });
  if (!task) return null;
  const [sum, limits] = await Promise.all([
    client.taskAttachment.aggregate({ _sum: { size: true }, where: { taskId } }),
    getQuotaLimits(task.projectId, client),
  ]);
  const usage = await storageUsage(task.projectId, client, { total: limits.total !== null });
  const limitMb = task.project.taskAttachMaxMb;
  const taskMax = limitMb * 1024 * 1024;
  let taskUsed = sum._sum.size ?? 0;
  let added = 0;
  const verdicts = sizes.map((size): Verdict => {
    if (taskUsed + size > taskMax) return { ok: false, reason: "task_total" };
    const quota = checkQuota({ project: usage.project + added, total: usage.total + added }, size, limits);
    if (quota) return { ok: false, reason: "quota", quota };
    taskUsed += size;
    added += size;
    return { ok: true };
  });
  return { verdicts, limitMb };
}

/** Copia `from` en `to` sin dejar nunca un fichero a medias con el nombre final (temporal y rename, como las subidas). */
async function copyAtomic(from: string, to: string): Promise<void> {
  const tmp = `${to}.${process.pid}.tmp`;
  try {
    await copyFile(from, tmp, constants.COPYFILE_FICLONE);
    await rename(tmp, to);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

const isMissing = (err: unknown) => (err as { code?: string } | null)?.code === "ENOENT";

/** Ficheros de un adjunto: imagen (WebP y miniatura; si a la original le falta la miniatura, se copia sin ella) o archivo. */
async function copyFiles(fromId: string, toId: string, isImage: boolean): Promise<void> {
  if (!isImage) return copyAtomic(attachmentPath(fromId, "file"), attachmentPath(toId, "file"));
  await copyAtomic(attachmentPath(fromId, "full"), attachmentPath(toId, "full"));
  await copyAtomic(attachmentPath(fromId, "thumb"), attachmentPath(toId, "thumb")).catch((err) => {
    if (!isMissing(err)) throw err;
  });
}

/**
 * Copia los adjuntos de `fromTaskId` en `toTaskId` (recién creada). Nunca lanza: lo que no se puede copiar (cuota,
 * tope de la tarea, fichero ausente, disco lleno) se devuelve en `skipped` y la tarea queda como esté.
 *
 * Mismo orden que una subida: primero los ficheros (con ids nuevos) y después las filas, dentro del candado común de
 * las subidas (`pz:attachment-quota`) y con la comprobación definitiva de topes y cuotas. Si el proceso se corta entre
 * medias queda como mucho un fichero sin fila, que borra la limpieza de huérfanos.
 */
export async function copyTaskAttachments(fromTaskId: string, toTaskId: string): Promise<AttachmentCopyResult> {
  const result: AttachmentCopyResult = { copied: 0, skipped: [] };
  const sources = await db.taskAttachment.findMany({
    where: { taskId: fromTaskId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, originalName: true, mimeType: true, isImage: true, width: true, height: true, size: true, createdById: true, createdAt: true },
  });
  if (!sources.length) return result;
  const skip = (a: (typeof sources)[number], reason: CopySkipReason) => result.skipped.push({ name: a.originalName, size: a.size, reason });
  const noteVerdict = (a: (typeof sources)[number], v: Exclude<Verdict, { ok: true }>, limitMb: number) => {
    skip(a, v.reason);
    if (v.reason === "quota") result.quota ??= v.quota;
    else result.taskLimitMb = limitMb;
  };

  // Comprobación previa (sin candado): lo que ya no cabe ni se copia en el disco.
  const early = await fitPlan(db, toTaskId, sources.map((a) => a.size)).catch(() => null);
  if (!early) {
    for (const a of sources) skip(a, "error");
    return result;
  }
  const staged: { src: (typeof sources)[number]; id: string }[] = [];
  try {
    await mkdir(uploadDir(), { recursive: true });
  } catch {
    // Si no se puede crear la carpeta, cada copia fallará abajo con su motivo.
  }
  for (const [i, src] of sources.entries()) {
    const v = early.verdicts[i]!;
    if (!v.ok) {
      noteVerdict(src, v, early.limitMb);
      continue;
    }
    const id = newFileId();
    try {
      await copyFiles(src.id, id, src.isImage);
      staged.push({ src, id });
    } catch (err) {
      await removeAttachmentFiles([id]);
      skip(src, isMissing(err) ? "missing" : "error");
      if (!isMissing(err)) {
        logEvent({
          level: "error", category: "system", action: isNoSpaceError(err) ? "attachments.noSpace" : "attachments.copyFailed",
          message: `No se pudo copiar el adjunto «${src.originalName}» al duplicar la tarea: ${err instanceof Error ? err.message : String(err)}`,
          details: { fromTaskId, toTaskId, attachmentId: src.id, bytes: src.size },
        });
      }
    }
  }
  if (!staged.length) return result;

  let created: string[] = [];
  try {
    const done = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pz:attachment-quota'))::text`;
      // La copia se ha podido borrar (o deshacer) mientras se copiaban los ficheros: entonces no se crea nada.
      const alive = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "Task" WHERE id = ${toTaskId} FOR KEY SHARE`;
      if (!alive.length) return null;
      const plan = await fitPlan(tx, toTaskId, staged.map((s) => s.src.size));
      if (!plan) return null;
      const rows: Prisma.TaskAttachmentCreateManyInput[] = [];
      staged.forEach(({ src, id }, i) => {
        if (!plan.verdicts[i]!.ok) return;
        // Misma fecha y autor que la original: conserva el orden de los adjuntos (y de sus nombres en una release).
        const { id: _from, ...data } = src;
        rows.push({ ...data, id, taskId: toTaskId });
      });
      if (rows.length) await tx.taskAttachment.createMany({ data: rows });
      return { ids: rows.map((r) => r.id!), plan };
    });
    if (done) {
      created = done.ids;
      staged.forEach(({ src }, i) => {
        const v = done.plan.verdicts[i]!;
        if (!v.ok) noteVerdict(src, v, done.plan.limitMb);
      });
    }
  } catch (err) {
    logEvent({
      level: "error", category: "system", action: "attachments.copyFailed",
      message: `No se pudieron guardar los adjuntos copiados al duplicar la tarea: ${err instanceof Error ? err.message : String(err)}`,
      details: { fromTaskId, toTaskId },
    });
    for (const s of staged) skip(s.src, "error");
  }
  const kept = new Set(created);
  const leftovers = staged.filter((s) => !kept.has(s.id)).map((s) => s.id);
  if (leftovers.length) await removeAttachmentFiles(leftovers);
  result.copied = created.length;
  return result;
}
