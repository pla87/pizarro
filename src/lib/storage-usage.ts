import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { checkQuota, type QuotaExceeded } from "./quota";
import { getQuotaLimits } from "./quota-settings";

type Client = Prisma.TransactionClient | typeof db;

/** Bytes de adjuntos, copias de releases y documentación de un proyecto y del servidor entero. */
export async function storageUsage(projectId: string, client: Client = db, opts: { total?: boolean } = {}): Promise<{ project: number; total: number }> {
  // Sin cuota global no hace falta sumar todo el servidor (se llama dentro del bloqueo de subidas).
  const wantTotal = opts.total ?? (await getQuotaLimits(null, client)).total !== null;
  const zero = { _sum: { size: null as number | null } };
  const [pTasks, pReleases, tTasks, tReleases, pDocs, tDocs] = await Promise.all([
    client.taskAttachment.aggregate({ _sum: { size: true }, where: { task: { projectId } } }),
    client.releaseAttachment.aggregate({ _sum: { size: true }, where: { release: { projectId } } }),
    wantTotal ? client.taskAttachment.aggregate({ _sum: { size: true } }) : zero,
    wantTotal ? client.releaseAttachment.aggregate({ _sum: { size: true } }) : zero,
    client.projectDocument.aggregate({ _sum: { size: true }, where: { projectId } }),
    wantTotal ? client.projectDocument.aggregate({ _sum: { size: true } }) : zero,
  ]);
  return {
    project: (pTasks._sum.size ?? 0) + (pReleases._sum.size ?? 0) + (pDocs._sum.size ?? 0),
    total: (tTasks._sum.size ?? 0) + (tReleases._sum.size ?? 0) + (tDocs._sum.size ?? 0),
  };
}

/** Comprueba si una subida de `bytes` cabe en las cuotas; devuelve null si cabe. */
export async function quotaExceededFor(projectId: string, bytes: number, client: Client = db): Promise<QuotaExceeded | null> {
  const limits = await getQuotaLimits(projectId, client);
  return checkQuota(await storageUsage(projectId, client, { total: limits.total !== null }), bytes, limits);
}
