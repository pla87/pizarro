import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { AppError } from "./errors";
import type { QuotaExceeded } from "./quota";
import { quotaExceededFor } from "./storage-usage";

export interface TaskTotalExceeded {
  /** Suma de los adjuntos que ya tiene la tarea (bytes). */
  usedBytes: number;
  limitMb: number;
}

/** Por qué no cabe un adjunto: el tope de la tarea o una cuota de almacenamiento. */
export type AttachmentLimitProblem = ({ reason: "task_total" } & TaskTotalExceeded) | { reason: "quota"; quota: QuotaExceeded };

type AttachmentCreateResult<A> = { ok: true; attachment: A } | ({ ok: false } & AttachmentLimitProblem);

type Client = Prisma.TransactionClient | typeof db;

/** La tarea ya no existe (borrada mientras se subía el archivo): 404, sin error en el registro (queda como aviso). */
const taskGone = () => new AppError("La tarea ya no existe.", 404, "task_gone");

/**
 * ¿Cabe un adjunto de `size` bytes en la tarea? null si cabe; si no, el motivo (primero el tope de la tarea, después las
 * cuotas). Dentro de la transacción con el candado de las subidas (createAttachmentWithinLimit) es la comprobación
 * definitiva; fuera, sin candado, es orientativa: la usan las subidas para rechazar antes de escribir el fichero en el
 * disco, con el mismo resultado (y el mismo mensaje) que daría la definitiva en ese momento.
 */
export async function attachmentLimitProblem(taskId: string, size: number, client: Client = db): Promise<AttachmentLimitProblem | null> {
  const [task, sum] = await Promise.all([
    client.task.findUnique({ where: { id: taskId }, select: { projectId: true, project: { select: { taskAttachMaxMb: true } } } }),
    client.taskAttachment.aggregate({ _sum: { size: true }, where: { taskId } }),
  ]);
  // Borrada mientras llegaba el archivo.
  if (!task) throw taskGone();
  const usedBytes = sum._sum.size ?? 0;
  const limitMb = task.project.taskAttachMaxMb;
  if (usedBytes + size > limitMb * 1024 * 1024) return { reason: "task_total", usedBytes, limitMb };
  const quota = await quotaExceededFor(task.projectId, size, client);
  return quota ? { reason: "quota", quota } : null;
}

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
    // La tarea se ha podido borrar durante la subida. FOR KEY SHARE espera a un borrado que esté en curso (y entonces no
    // la encuentra) y, si llega antes, hace esperar al borrado hasta el alta: sin esto el INSERT fallaba con la clave
    // ajena (P2003) y la subida acababa en un 500. Quien llama borra el fichero ya escrito.
    const alive = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "Task" WHERE id = ${data.taskId} FOR KEY SHARE`;
    if (!alive.length) throw taskGone();
    const problem = await attachmentLimitProblem(data.taskId, data.size, tx);
    if (problem) return { ok: false as const, ...problem };
    const attachment = await tx.taskAttachment.create({ data, select });
    return { ok: true as const, attachment };
  });
}

/** Megas con un decimal como mucho («45», «12,5» se pinta en el cliente según el idioma). */
export function roundMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}
