import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import type { QuotaExceeded } from "./quota";
import { quotaExceededFor } from "./storage-usage";

export interface TaskTotalExceeded {
  /** Suma de los adjuntos que ya tiene la tarea (bytes). */
  usedBytes: number;
  limitMb: number;
}

export type AttachmentCreateResult<A> =
  | { ok: true; attachment: A }
  | ({ ok: false; reason: "task_total" } & TaskTotalExceeded)
  | { ok: false; reason: "quota"; quota: QuotaExceeded };

/**
 * Crea el adjunto solo si cabe en el tope de la tarea (`Project.taskAttachMaxMb`, suma de sus adjuntos con el
 * nuevo) y en las cuotas de almacenamiento (por proyecto y total del servidor). Las sumas y el alta van en una
 * transacción con un candado común a todas las subidas (pg_advisory_xact_lock): dos subidas simultáneas, a la
 * misma tarea o a tareas distintas, no pueden pasarse de un tope o de una cuota juntas. Con un equipo pequeño
 * las subidas son pocas y la espera por el candado es despreciable (solo cubre sumas y un INSERT).
 */
export async function createAttachmentWithinLimit<S extends Prisma.TaskAttachmentSelect>(
  data: Prisma.TaskAttachmentUncheckedCreateInput,
  select: S,
): Promise<AttachmentCreateResult<Prisma.TaskAttachmentGetPayload<{ select: S }>>> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pz:attachment-quota'))::text`;
    const [task, sum] = await Promise.all([
      tx.task.findUniqueOrThrow({ where: { id: data.taskId }, select: { projectId: true, project: { select: { taskAttachMaxMb: true } } } }),
      tx.taskAttachment.aggregate({ _sum: { size: true }, where: { taskId: data.taskId } }),
    ]);
    const usedBytes = sum._sum.size ?? 0;
    const limitMb = task.project.taskAttachMaxMb;
    if (usedBytes + data.size > limitMb * 1024 * 1024) return { ok: false as const, reason: "task_total" as const, usedBytes, limitMb };
    const quota = await quotaExceededFor(task.projectId, data.size, tx);
    if (quota) return { ok: false as const, reason: "quota" as const, quota };
    const attachment = await tx.taskAttachment.create({ data, select });
    return { ok: true as const, attachment };
  });
}

/** Megas con un decimal como mucho («45», «12,5» se pinta en el cliente según el idioma). */
export function roundMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}
