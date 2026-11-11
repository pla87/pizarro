import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import {
  mbToBytes, parseQuotaSetting, resolveProjectQuota, resolveTotalQuota, serializeQuotaSetting,
  type QuotaBytes, type QuotaSetting, type QuotaSource,
} from "./quota";

type Client = Prisma.TransactionClient | typeof db;

export const QUOTA_PROJECT_KEY = "uploadQuotaMbPerProject";
export const QUOTA_TOTAL_KEY = "uploadQuotaMbTotal";

// Memoria de proceso como el resto de ajustes (app-settings.ts): se invalida al guardar y caduca a los 30 s
// por si otro proceso comparte la base de datos. Vive en globalThis: las rutas /api (las subidas) son otra copia del
// módulo que la de las acciones que guardan el ajuste, y con una variable del módulo no les llegaba la invalidación
// (la cuota nueva tardaba hasta 30 s en aplicarse a las subidas).
const TTL_MS = 30_000;
const cache = ((globalThis as unknown as { __pzQuotaSettings?: { value: { project: QuotaSetting; total: QuotaSetting; at: number } | null } }).__pzQuotaSettings ??= { value: null });

export function invalidateQuotaSettings(): void {
  cache.value = null;
}

/** Ajustes guardados en la aplicación (sin tener en cuenta las variables de entorno). */
export async function getQuotaSettings(now: number = Date.now()): Promise<{ project: QuotaSetting; total: QuotaSetting }> {
  const cached = cache.value;
  if (cached && now - cached.at < TTL_MS) return cached;
  const rows = await db.appState.findMany({ where: { key: { in: [QUOTA_PROJECT_KEY, QUOTA_TOTAL_KEY] } }, select: { key: true, value: true } });
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const value = { project: parseQuotaSetting(get(QUOTA_PROJECT_KEY)), total: parseQuotaSetting(get(QUOTA_TOTAL_KEY)), at: now };
  cache.value = value;
  return value;
}

export async function saveQuotaSettings(next: { project: QuotaSetting; total: QuotaSetting }): Promise<void> {
  // Las dos escrituras juntas: o se guardan ambas o ninguna.
  const ops = ([[QUOTA_PROJECT_KEY, next.project], [QUOTA_TOTAL_KEY, next.total]] as const).map(([key, setting]) => {
    const value = serializeQuotaSetting(setting);
    return value === null
      ? db.appState.deleteMany({ where: { key } })
      : db.appState.upsert({ where: { key }, create: { key, value }, update: { value } });
  });
  await db.$transaction(ops);
  invalidateQuotaSettings();
}

export interface EffectiveQuota extends QuotaBytes {
  projectMb: number | null;
  totalMb: number | null;
  projectSource: QuotaSource;
  totalSource: QuotaSource;
}

/**
 * Cuotas vigentes para un proyecto (o las generales con `projectId` null): su cuota propia, la variable de entorno,
 * el ajuste de Administración o 10 GB, y la cuota total del servidor si la hay. Se lee en cada subida (el
 * ajuste, de la memoria).
 */
export async function getQuotaLimits(projectId: string | null, client: Client = db): Promise<EffectiveQuota> {
  const [app, row] = await Promise.all([
    getQuotaSettings(),
    projectId ? client.project.findUnique({ where: { id: projectId }, select: { storageQuotaMb: true } }) : Promise.resolve(null),
  ]);
  const project = resolveProjectQuota({ override: row?.storageQuotaMb ?? null, env: process.env.UPLOAD_QUOTA_MB_PER_PROJECT, app: app.project });
  const total = resolveTotalQuota({ env: process.env.UPLOAD_QUOTA_MB_TOTAL, app: app.total });
  return { project: mbToBytes(project.mb), total: mbToBytes(total.mb), projectMb: project.mb, totalMb: total.mb, projectSource: project.source, totalSource: total.source };
}
