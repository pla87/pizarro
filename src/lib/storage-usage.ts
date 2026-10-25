import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { checkQuota, type QuotaExceeded } from "./quota";

type Client = Prisma.TransactionClient | typeof db;

/** Bytes de adjuntos, copias de releases y documentación de un proyecto y del servidor entero. */
export async function storageUsage(projectId: string, client: Client = db): Promise<{ project: number; total: number }> {
  const [pTasks, pReleases, tTasks, tReleases, pDocs, tDocs] = await Promise.all([
    client.taskAttachment.aggregate({ _sum: { size: true }, where: { task: { projectId } } }),
    client.releaseAttachment.aggregate({ _sum: { size: true }, where: { release: { projectId } } }),
    client.taskAttachment.aggregate({ _sum: { size: true } }),
    client.releaseAttachment.aggregate({ _sum: { size: true } }),
    client.projectDocument.aggregate({ _sum: { size: true }, where: { projectId } }),
    client.projectDocument.aggregate({ _sum: { size: true } }),
  ]);
  return {
    project: (pTasks._sum.size ?? 0) + (pReleases._sum.size ?? 0) + (pDocs._sum.size ?? 0),
    total: (tTasks._sum.size ?? 0) + (tReleases._sum.size ?? 0) + (tDocs._sum.size ?? 0),
  };
}

/** Comprueba si una subida de `bytes` cabe en las cuotas; devuelve null si cabe. */
export async function quotaExceededFor(projectId: string, bytes: number, client: Client = db): Promise<QuotaExceeded | null> {
  return checkQuota(await storageUsage(projectId, client), bytes);
}
