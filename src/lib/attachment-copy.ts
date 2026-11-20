import "server-only";
import { constants } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { assertDiskRoom, isNoSpaceError } from "./disk-space";
import { logEvent } from "./log";
import { checkQuota, type QuotaExceeded } from "./quota";
import { getQuotaLimits } from "./quota-settings";
import { storageUsage } from "./storage-usage";
import { uploadDir } from "./upload-dir";
import { attachmentPath, newFileId, removeAttachmentFiles } from "./uploads";
import { logSize } from "./format-size";

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
//
// Disco: antes de copiar se comprueba, como en las subidas y las transferencias (assertDiskRoom), que en el volumen de
// las subidas caben los ficheros con el margen de seguridad. Si no caben, no se copia ninguno y el aviso dice que el
// disco del servidor está lleno (en vez del ENOSPC del sistema a medio copiar). Si aun así el disco se llena durante la
// copia, se para ahí con el mismo aviso.

type Client = Prisma.TransactionClient | typeof db;

type CopySkipReason = "task_total" | "quota" | "missing" | "disk" | "error";

interface AttachmentCopySkip {
  name: string;
  size: number;
  reason: CopySkipReason;
}

export interface AttachmentCopyResult {
  copied: number;
  /** Id de cada adjunto copiado → id de su copia (para los enlaces a adjuntos de la descripción). */
  ids: Map<string, string>;
  skipped: AttachmentCopySkip[];
  /** Con algún omitido por cuota: la primera cuota superada (para el mensaje). */
  quota?: QuotaExceeded;
  /** Con algún omitido por el tope de la tarea: ese tope (MB). */
  taskLimitMb?: number;
}

type Verdict = { ok: true } | { ok: false; reason: "task_total" } | { ok: false; reason: "quota"; quota: QuotaExceeded } | { ok: false; reason: "error" };

const MB = 1024 * 1024;

/**
 * Qué cabe de estos adjuntos, en orden, en su tarea de destino (tope de adjuntos por tarea del proyecto) y en las
 * cuotas de almacenamiento. Lo que no cabe no cuenta para los siguientes: un adjunto pequeño detrás de uno grande que no
 * cabe se copia igual. Mismas reglas que una subida (attachmentLimitProblem). Varias tareas a la vez con unas pocas
 * consultas (las tareas, la suma por tarea y la cuota y el uso de cada proyecto, no de cada tarea), en fila: puede ir
 * dentro de una transacción. Una tarea que ya no existe da «error».
 */
async function fitPlan(client: Client, items: { taskId: string; size: number }[]): Promise<{ verdicts: Verdict[]; limitMb: Map<string, number> }> {
  const taskIds = [...new Set(items.map((i) => i.taskId))];
  const tasks = await client.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, projectId: true, project: { select: { taskAttachMaxMb: true } } } });
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const sums = await client.taskAttachment.groupBy({ by: ["taskId"], where: { taskId: { in: taskIds } }, _sum: { size: true } });
  const taskUsed = new Map(sums.map((r) => [r.taskId, r._sum.size ?? 0]));
  const limitsOf = new Map<string, Awaited<ReturnType<typeof getQuotaLimits>>>();
  const usedOf = new Map<string, number>();
  let totalUsed = 0;
  for (const projectId of new Set(tasks.map((t) => t.projectId))) {
    const limits = await getQuotaLimits(projectId, client);
    const usage = await storageUsage(projectId, client, { total: limits.total !== null });
    limitsOf.set(projectId, limits);
    usedOf.set(projectId, usage.project);
    totalUsed = usage.total; // el total del servidor, el mismo desde cualquier proyecto
  }
  const addedOf = new Map<string, number>();
  let addedTotal = 0;
  const verdicts = items.map(({ taskId, size }): Verdict => {
    const task = taskById.get(taskId);
    if (!task) return { ok: false, reason: "error" };
    const used = taskUsed.get(taskId) ?? 0;
    if (used + size > task.project.taskAttachMaxMb * MB) return { ok: false, reason: "task_total" };
    const added = addedOf.get(task.projectId) ?? 0;
    const quota = checkQuota({ project: usedOf.get(task.projectId)! + added, total: totalUsed + addedTotal }, size, limitsOf.get(task.projectId)!);
    if (quota) return { ok: false, reason: "quota", quota };
    taskUsed.set(taskId, used + size);
    addedOf.set(task.projectId, added + size);
    addedTotal += size;
    return { ok: true };
  });
  return { verdicts, limitMb: new Map(tasks.map((t) => [t.id, t.project.taskAttachMaxMb])) };
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
 * tope de la tarea, fichero ausente, disco lleno: «disk») se devuelve en `skipped` y la tarea queda como esté.
 */
export async function copyTaskAttachments(fromTaskId: string, toTaskId: string): Promise<AttachmentCopyResult> {
  return (await copyAttachmentsBatch([{ fromTaskId, toTaskId }]))[0]!;
}

interface AttachmentCopyRequest {
  fromTaskId: string;
  toTaskId: string;
  /** Solo estos adjuntos de `fromTaskId` (los que cita su descripción); sin él, todos. */
  attachmentIds?: readonly string[];
}

/**
 * Copias de adjuntos de varias tareas a la vez (la siguiente aparición de un lote de tareas repetidas), con las mismas
 * reglas que copyTaskAttachments y unas pocas consultas para todo el lote, no por tarea. Un resultado por petición, en
 * el mismo orden. `purpose` completa los mensajes del registro.
 *
 * Mismo orden que una subida: primero los ficheros (con ids nuevos) y después las filas, dentro del candado común de
 * las subidas (`pz:attachment-quota`) y con la comprobación definitiva de topes y cuotas. Si el proceso se corta entre
 * medias queda como mucho un fichero sin fila, que borra la limpieza de huérfanos.
 */
export async function copyAttachmentsBatch(requests: readonly AttachmentCopyRequest[], purpose = "al duplicar la tarea"): Promise<AttachmentCopyResult[]> {
  const results: AttachmentCopyResult[] = requests.map(() => ({ copied: 0, ids: new Map(), skipped: [] }));
  const wantedReqs = requests.map((r, i) => ({ r, i })).filter(({ r }) => !r.attachmentIds || r.attachmentIds.length > 0);
  if (!wantedReqs.length) return results;
  const onlyListed = wantedReqs.every(({ r }) => r.attachmentIds);
  const rows = await db.taskAttachment.findMany({
    where: { taskId: { in: [...new Set(wantedReqs.map(({ r }) => r.fromTaskId))] }, ...(onlyListed ? { id: { in: wantedReqs.flatMap(({ r }) => r.attachmentIds!) } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, taskId: true, originalName: true, mimeType: true, isImage: true, width: true, height: true, size: true, createdById: true, createdAt: true },
  });
  type Source = Omit<(typeof rows)[number], "taskId">;
  type Item = { req: number; toTaskId: string; src: Source };
  const byTask = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    const list = byTask.get(row.taskId);
    if (list) list.push(row);
    else byTask.set(row.taskId, [row]);
  }
  const items: Item[] = [];
  for (const { r, i } of wantedReqs) {
    const only = r.attachmentIds ? new Set(r.attachmentIds) : null;
    for (const { taskId: _from, ...src } of byTask.get(r.fromTaskId) ?? []) if (!only || only.has(src.id)) items.push({ req: i, toTaskId: r.toTaskId, src });
  }
  if (!items.length) return results;
  const skip = (it: Item, reason: CopySkipReason) => results[it.req]!.skipped.push({ name: it.src.originalName, size: it.src.size, reason });
  const noteVerdict = (it: Item, v: Exclude<Verdict, { ok: true }>, limitMb: Map<string, number>) => {
    skip(it, v.reason);
    if (v.reason === "quota") results[it.req]!.quota ??= v.quota;
    else if (v.reason === "task_total") results[it.req]!.taskLimitMb = limitMb.get(it.toTaskId);
  };
  const where = (it: Item) => ({ fromTaskId: requests[it.req]!.fromTaskId, toTaskId: it.toTaskId });
  const batchDetails = (first: Item) => (requests.length === 1 ? where(first) : { tasks: requests.length });

  // Comprobación previa (sin candado): lo que ya no cabe ni se copia en el disco.
  const early = await fitPlan(db, items.map((it) => ({ taskId: it.toTaskId, size: it.src.size }))).catch(() => null);
  if (!early) {
    for (const it of items) skip(it, "error");
    return results;
  }
  const staged: { it: Item; id: string }[] = [];
  try {
    await mkdir(uploadDir(), { recursive: true });
  } catch {
    // Si no se puede crear la carpeta, cada copia fallará abajo con su motivo.
  }
  // Espacio en disco para lo que cabe en topes y cuotas (las imágenes llevan además su miniatura: un 10 % de holgura).
  const wanted = items.reduce((n, it, i) => (early.verdicts[i]!.ok ? n + it.src.size : n), 0);
  let diskFull = false;
  if (wanted > 0) {
    try {
      await assertDiskRoom(uploadDir(), Math.ceil(wanted * 1.1));
    } catch {
      diskFull = true;
      logEvent({
        level: "error", category: "system", action: "attachments.noSpace",
        message: `Disco lleno: no se han copiado los adjuntos ${purpose} (${logSize(wanted)})`,
        details: { ...batchDetails(items[0]!), bytes: wanted },
      });
    }
  }
  for (const [i, it] of items.entries()) {
    const v = early.verdicts[i]!;
    if (!v.ok) {
      noteVerdict(it, v, early.limitMb);
      continue;
    }
    if (diskFull) {
      skip(it, "disk");
      continue;
    }
    const id = newFileId();
    try {
      await copyFiles(it.src.id, id, it.src.isImage);
      staged.push({ it, id });
    } catch (err) {
      await removeAttachmentFiles([id]);
      const noSpace = isNoSpaceError(err);
      skip(it, isMissing(err) ? "missing" : noSpace ? "disk" : "error");
      // Disco lleno a media copia: los siguientes tampoco caben.
      if (noSpace) diskFull = true;
      if (!isMissing(err)) {
        logEvent({
          level: "error", category: "system", action: noSpace ? "attachments.noSpace" : "attachments.copyFailed",
          message: `No se pudo copiar el adjunto «${it.src.originalName}» ${purpose}: ${err instanceof Error ? err.message : String(err)}`,
          details: { ...where(it), attachmentId: it.src.id, bytes: it.src.size },
        });
      }
    }
  }
  if (!staged.length) return results;

  let created = new Set<string>();
  try {
    const done = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pz:attachment-quota'))::text`;
      // Una tarea de destino se ha podido borrar (o deshacer) mientras se copiaban los ficheros: a esa no se le crea nada.
      const targets = [...new Set(staged.map((s) => s.it.toTaskId))];
      const alive = new Set((await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Task" WHERE id = ANY(${targets}::text[]) FOR KEY SHARE`).map((r) => r.id));
      const live = staged.filter((s) => alive.has(s.it.toTaskId));
      if (!live.length) return null;
      const plan = await fitPlan(tx, live.map((s) => ({ taskId: s.it.toTaskId, size: s.it.src.size })));
      const data: Prisma.TaskAttachmentCreateManyInput[] = [];
      live.forEach(({ it, id }, i) => {
        if (!plan.verdicts[i]!.ok) return;
        // Misma fecha y autor que la original: conserva el orden de los adjuntos (y de sus nombres en una release).
        const { id: _from, ...fields } = it.src;
        data.push({ ...fields, id, taskId: it.toTaskId });
      });
      if (data.length) await tx.taskAttachment.createMany({ data });
      return { ids: data.map((r) => r.id!), live, plan };
    });
    if (done) {
      created = new Set(done.ids);
      done.live.forEach(({ it }, i) => {
        const v = done.plan.verdicts[i]!;
        if (!v.ok) noteVerdict(it, v, done.plan.limitMb);
      });
    }
  } catch (err) {
    logEvent({
      level: "error", category: "system", action: "attachments.copyFailed",
      message: `No se pudieron guardar los adjuntos copiados ${purpose}: ${err instanceof Error ? err.message : String(err)}`,
      details: batchDetails(staged[0]!.it),
    });
    for (const s of staged) skip(s.it, "error");
  }
  for (const s of staged) {
    if (!created.has(s.id)) continue;
    results[s.it.req]!.ids.set(s.it.src.id, s.id);
    results[s.it.req]!.copied++;
  }
  const leftovers = staged.filter((s) => !created.has(s.id)).map((s) => s.id);
  if (leftovers.length) await removeAttachmentFiles(leftovers);
  return results;
}
