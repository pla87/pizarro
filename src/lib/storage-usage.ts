import "server-only";
import { db } from "./db";
import { checkQuota, type QuotaExceeded } from "./quota";

/** Bytes de adjuntos (y copias de releases) de un proyecto y del servidor entero. */
export async function storageUsage(projectId: string): Promise<{ project: number; total: number }> {
  const [pTasks, pReleases, tTasks, tReleases] = await Promise.all([
    db.taskAttachment.aggregate({ _sum: { size: true }, where: { task: { projectId } } }),
    db.releaseAttachment.aggregate({ _sum: { size: true }, where: { release: { projectId } } }),
    db.taskAttachment.aggregate({ _sum: { size: true } }),
    db.releaseAttachment.aggregate({ _sum: { size: true } }),
  ]);
  return {
    project: (pTasks._sum.size ?? 0) + (pReleases._sum.size ?? 0),
    total: (tTasks._sum.size ?? 0) + (tReleases._sum.size ?? 0),
  };
}

/** Comprueba si una subida de `bytes` cabe en las cuotas; devuelve null si cabe. */
export async function quotaExceededFor(projectId: string, bytes: number): Promise<QuotaExceeded | null> {
  return checkQuota(await storageUsage(projectId), bytes);
}
