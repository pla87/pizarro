import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";

export interface TaskTotalExceeded {
  /** Suma de los adjuntos que ya tiene la tarea (bytes). */
  usedBytes: number;
  limitMb: number;
}

/**
 * Crea el adjunto solo si la suma de los adjuntos de la tarea (con el nuevo) cabe en el tope del proyecto
 * (`Project.taskAttachMaxMb`). Suma y alta van en una transacción con un candado por tarea
 * (pg_advisory_xact_lock): dos subidas simultáneas a la misma tarea no pueden pasarse del tope juntas.
 */
export async function createAttachmentWithinLimit<S extends Prisma.TaskAttachmentSelect>(
  data: Prisma.TaskAttachmentUncheckedCreateInput,
  select: S,
): Promise<{ ok: true; attachment: Prisma.TaskAttachmentGetPayload<{ select: S }> } | ({ ok: false } & TaskTotalExceeded)> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${data.taskId}))::text`;
    const [{ project }, sum] = await Promise.all([
      tx.task.findUniqueOrThrow({ where: { id: data.taskId }, select: { project: { select: { taskAttachMaxMb: true } } } }),
      tx.taskAttachment.aggregate({ _sum: { size: true }, where: { taskId: data.taskId } }),
    ]);
    const usedBytes = sum._sum.size ?? 0;
    const limitMb = project.taskAttachMaxMb;
    if (usedBytes + data.size > limitMb * 1024 * 1024) return { ok: false as const, usedBytes, limitMb };
    const attachment = await tx.taskAttachment.create({ data, select });
    return { ok: true as const, attachment };
  });
}

/** Megas con un decimal como mucho («45», «12,5» se pinta en el cliente según el idioma). */
export function roundMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}
