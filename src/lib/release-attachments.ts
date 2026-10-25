import "server-only";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import { db } from "./db";
import { logEvent } from "./log";
import { attachmentFileNames } from "./release";
import { attachmentPath, compactImage, removeReleaseAttachmentFiles, saveReleaseAttachmentFile } from "./uploads";

/** Trabajo de copiar los adjuntos de las tareas de una release al histórico; se guarda en `Release.attachmentsPending`. */
export const pendingJobSchema = z.object({
  items: z.array(z.object({ taskId: z.string(), code: z.string() })),
  /** Tareas que entraron en la release (solo de esas se copian adjuntos). */
  allowed: z.array(z.string()),
  projectId: z.string(),
  userId: z.string(),
  userName: z.string(),
});
export type PendingJob = z.infer<typeof pendingJobSchema>;

// Una release no se copia dos veces a la vez en este proceso (el despliegue y la reanudación del arranque).
const running = ((globalThis as unknown as { __pzReleaseCopies?: Set<string> }).__pzReleaseCopies ??= new Set<string>());

/**
 * Copia los adjuntos y, al terminar (bien o con errores por adjunto, que se registran), limpia el trabajo pendiente.
 * Si el proceso muere a mitad, el pendiente queda en la BD y `resumePendingReleaseAttachments` lo retoma.
 * Es idempotente: se omiten los adjuntos cuya copia (mismo nombre) ya existe en la release.
 */
export async function saveReleaseAttachments(releaseId: string, job: PendingJob): Promise<void> {
  if (running.has(releaseId)) return;
  running.add(releaseId);
  try {
    await copyAttachments(releaseId, job);
    // updateMany: no falla si la release se borró mientras tanto.
    await db.release.updateMany({ where: { id: releaseId }, data: { attachmentsPending: Prisma.DbNull } });
  } finally {
    running.delete(releaseId);
  }
}

async function copyAttachments(releaseId: string, { items, allowed, projectId, userId, userName }: PendingJob) {
  const allowedSet = new Set(allowed);
  const valid = items.filter((i) => allowedSet.has(i.taskId));
  if (new Set(valid.map((i) => i.taskId)).size !== valid.length || new Set(valid.map((i) => i.code)).size !== valid.length) return;
  const tasks = await db.task.findMany({
    where: { id: { in: valid.map((i) => i.taskId) } },
    select: { id: true, attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, originalName: true, isImage: true } } },
  });
  const byId = new Map(tasks.map((t) => [t.id, t.attachments]));
  const saved: string[] = [];
  // La release ya no está (deshecha o borrada antes de empezar): no hay nada que copiar.
  const releaseGone = async () => !(await db.release.count({ where: { id: releaseId } }));
  if (await releaseGone()) return;
  // Reanudación: lo ya copiado (por nombre) se omite y las posiciones siguen a las existentes.
  const existing = await db.releaseAttachment.findMany({ where: { releaseId }, select: { fileName: true, position: true } });
  const done = new Set(existing.map((a) => a.fileName));
  let position = existing.reduce((max, a) => Math.max(max, a.position + 1), 0);
  outer: for (const item of valid) {
    // Tarea o adjuntos borrados mientras tanto: simplemente no hay nada que copiar de ellos.
    const attachments = byId.get(item.taskId) ?? [];
    const names = attachmentFileNames(item.code, attachments);
    for (const [i, att] of attachments.entries()) {
      if (done.has(names[i]!)) continue;
      let rowId: string | null = null;
      try {
        const raw = await readFile(attachmentPath(att.id, att.isImage ? "full" : "file"));
        const data = att.isImage ? await compactImage(raw) : raw;
        const row = await db.releaseAttachment.create({
          data: { releaseId, fileName: names[i]!, size: data.length, isImage: att.isImage, position: position++ },
          select: { id: true },
        });
        rowId = row.id;
        await saveReleaseAttachmentFile(row.id, data, att.isImage ? "webp" : "bin");
        saved.push(row.id);
      } catch (err) {
        if (rowId) await db.releaseAttachment.delete({ where: { id: rowId } }).catch(() => {});
        // La release se ha borrado o deshecho a mitad: se para aquí, sin un error por cada adjunto restante.
        if (await releaseGone()) break outer;
        // Fichero ausente o ilegible (p. ej. el adjunto se borró mientras tanto): se omite; si ya había fila, se ha retirado para no dejarla sin fichero.
        logEvent({
          level: "error", category: "system", action: "releases.saveAttachments",
          message: `Adjunto omitido en la release: «${names[i] ?? att.originalName}» (${err instanceof Error ? err.message : String(err)})`,
          userId, userName, projectId, details: { releaseId, attachmentId: att.id },
        });
      }
    }
  }
  // Se guardan después de responder: si mientras tanto se ha borrado o deshecho la release, sus filas ya no
  // están y los ficheros recién escritos sobran.
  if (saved.length) {
    const alive = new Set((await db.releaseAttachment.findMany({ where: { id: { in: saved } }, select: { id: true } })).map((a) => a.id));
    const gone = saved.filter((id) => !alive.has(id));
    if (gone.length) await removeReleaseAttachmentFiles(gone);
  }
}

/** Lanza la copia registrando en el log cualquier fallo global (nunca lanza). */
export function runReleaseAttachmentsJob(releaseId: string, job: PendingJob): Promise<void> {
  return saveReleaseAttachments(releaseId, job).catch((err) =>
    logEvent({
      level: "error", category: "system", action: "releases.saveAttachments",
      message: `No se pudieron guardar los adjuntos de la release: ${err instanceof Error ? err.message : String(err)}`,
      userId: job.userId, userName: job.userName, projectId: job.projectId, details: { releaseId },
    }),
  );
}

/**
 * Al arrancar: retoma las copias de adjuntos que quedaron a medias (reinicio del servidor durante el despliegue).
 * Devuelve cuántas releases ha retomado. Un pendiente ilegible se descarta con un aviso en el log.
 */
export async function resumePendingReleaseAttachments(): Promise<number> {
  const pending = await db.release.findMany({ where: { NOT: { attachmentsPending: { equals: Prisma.DbNull } } }, select: { id: true, attachmentsPending: true } });
  let resumed = 0;
  for (const r of pending) {
    const parsed = pendingJobSchema.safeParse(r.attachmentsPending);
    if (!parsed.success) {
      logEvent({ level: "warn", category: "system", action: "releases.resumeAttachments", message: "Trabajo pendiente de adjuntos de release ilegible: se descarta", details: { releaseId: r.id } });
      await db.release.updateMany({ where: { id: r.id }, data: { attachmentsPending: Prisma.DbNull } });
      continue;
    }
    await runReleaseAttachmentsJob(r.id, parsed.data);
    resumed++;
    logEvent({ category: "system", action: "releases.resumeAttachments", message: "Copia de adjuntos de release retomada tras el reinicio", projectId: parsed.data.projectId, details: { releaseId: r.id } });
  }
  return resumed;
}
