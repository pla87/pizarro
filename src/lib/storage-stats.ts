import "server-only";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { diskStats } from "./disk-space";
import { getQuotaLimits, getQuotaSettings } from "./quota-settings";
import type { QuotaSetting, QuotaSource } from "./quota";
import { backupsDir, uploadDir } from "./upload-dir";

interface Part {
  count: number;
  bytes: number;
}

/** Uso de almacenamiento de un proyecto desglosado (lo que cuenta para la cuota: adjuntos, copias de releases y documentación). */
export interface ProjectStorage {
  usedBytes: number;
  /** Cuota vigente en MB (null = sin límite) y de dónde sale. */
  quotaMb: number | null;
  quotaSource: QuotaSource;
  /** Cuota propia del proyecto (null = usa la general). */
  override: number | null;
  taskActive: Part;
  taskArchived: Part;
  releases: Part;
  documents: Part;
  documentsTrash: Part;
}

const part = (r: { _count: { _all: number }; _sum: { size: number | null } }): Part => ({ count: r._count._all, bytes: r._sum.size ?? 0 });

export async function projectStorage(projectId: string): Promise<ProjectStorage> {
  const agg = { _count: { _all: true }, _sum: { size: true } } as const;
  const [limits, project, active, archived, releases, docs, trash] = await Promise.all([
    getQuotaLimits(projectId),
    db.project.findUnique({ where: { id: projectId }, select: { storageQuotaMb: true } }),
    db.taskAttachment.aggregate({ ...agg, where: { task: { projectId, archivedAt: null } } }),
    db.taskAttachment.aggregate({ ...agg, where: { task: { projectId, archivedAt: { not: null } } } }),
    db.releaseAttachment.aggregate({ ...agg, where: { release: { projectId } } }),
    db.projectDocument.aggregate({ ...agg, where: { projectId, deletedAt: null } }),
    db.projectDocument.aggregate({ ...agg, where: { projectId, deletedAt: { not: null } } }),
  ]);
  const p = { taskActive: part(active), taskArchived: part(archived), releases: part(releases), documents: part(docs), documentsTrash: part(trash) };
  return {
    usedBytes: Object.values(p).reduce((n, x) => n + x.bytes, 0),
    quotaMb: limits.projectMb,
    quotaSource: limits.projectSource,
    override: project?.storageQuotaMb ?? null,
    ...p,
  };
}

export type LargeAttachment = {
  kind: "task" | "release" | "document";
  id: string;
  name: string;
  size: number;
  /** Tarea (título), release («R3 · título») o null en los documentos. */
  parent: string | null;
  /** Tarea archivada, release o documento en la papelera. */
  flagged: boolean;
  /** Id de la tarea para enlazar (solo adjuntos de tarea). */
  taskId: string | null;
};

/** Los `limit` ficheros más grandes del proyecto, de los tres tipos juntos. */
export async function largestAttachments(projectId: string, limit = 20): Promise<LargeAttachment[]> {
  const rows = await db.$queryRaw<{ kind: string; id: string; name: string; size: number; parent: string | null; flagged: boolean; taskId: string | null }[]>(Prisma.sql`
    SELECT * FROM (
      SELECT 'task' AS kind, a."id", a."originalName" AS name, a."size", t."title" AS parent, (t."archivedAt" IS NOT NULL) AS flagged, t."id" AS "taskId"
        FROM "TaskAttachment" a JOIN "Task" t ON t."id" = a."taskId" WHERE t."projectId" = ${projectId}
      UNION ALL
      SELECT 'release', a."id", a."fileName", a."size", 'R' || r."number" || ' · ' || r."title", false, NULL
        FROM "ReleaseAttachment" a JOIN "Release" r ON r."id" = a."releaseId" WHERE r."projectId" = ${projectId}
      UNION ALL
      SELECT 'document', d."id", d."name", d."size", NULL, (d."deletedAt" IS NOT NULL), NULL
        FROM "ProjectDocument" d WHERE d."projectId" = ${projectId}
    ) u ORDER BY u."size" DESC, u."id" LIMIT ${limit}`);
  return rows.map((r) => ({ ...r, kind: r.kind as LargeAttachment["kind"], size: Number(r.size) }));
}

// --- Vista del servidor (Administración → Ajustes) -------------------------------

/** Suma el tamaño de los ficheros de una carpeta y sus subcarpetas (las carpetas de copias y exportaciones son pequeñas). */
export async function dirBytes(dir: string, depth = 0): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let sum = 0;
  for (const e of entries) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 4) sum += await dirBytes(file, depth + 1);
    } else if (e.isFile()) {
      sum += await stat(file).then((s) => s.size, () => 0);
    }
  }
  return sum;
}

/** El almacén de copias puede tener decenas de miles de objetos: su tamaño se recalcula como mucho cada 10 min. */
const BACKUPS_BYTES_TTL_MS = 10 * 60 * 1000;
const backupsBytesCache = ((globalThis as unknown as { __pzBackupsBytes?: { dir: string; at: number; bytes: Promise<number> | null } }).__pzBackupsBytes ??= { dir: "", at: 0, bytes: null });

/** Bytes de UPLOAD_DIR/backups, guardados 10 min en memoria (varias cargas a la vez comparten el mismo recorrido). */
export function backupsDirBytes(now = Date.now()): Promise<number> {
  const dir = backupsDir();
  const c = backupsBytesCache;
  if (c.bytes && c.dir === dir && now - c.at < BACKUPS_BYTES_TTL_MS) return c.bytes;
  const bytes = dirBytes(dir);
  Object.assign(c, { dir, at: now, bytes });
  // Si fallara, que la próxima carga lo vuelva a intentar en lugar de servir el error 10 min.
  bytes.catch(() => {
    if (c.bytes === bytes) c.bytes = null;
  });
  return bytes;
}

export interface StorageAdminView {
  uploadDir: string;
  disk: { total: number; free: number } | null;
  settings: { project: QuotaSetting; total: QuotaSetting };
  env: { project: number | null; total: number | null };
  effective: { projectMb: number | null; projectSource: QuotaSource; totalMb: number | null; totalSource: QuotaSource };
  categories: { taskAttachments: number; releaseAttachments: number; documents: number; documentsTrash: number; backups: number; exports: number };
  trackedBytes: number;
  topProjects: { id: string; name: string | null; bytes: number }[];
}

const envNumber = (raw: string | undefined): number | null => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

export async function storageAdminView(): Promise<StorageAdminView> {
  const dir = uploadDir();
  const [disk, settings, limits, tasks, releases, docs, trash, backups, exports, top] = await Promise.all([
    diskStats(dir),
    getQuotaSettings(),
    getQuotaLimits(null),
    db.taskAttachment.aggregate({ _sum: { size: true } }),
    db.releaseAttachment.aggregate({ _sum: { size: true } }),
    db.projectDocument.aggregate({ _sum: { size: true }, where: { deletedAt: null } }),
    db.projectDocument.aggregate({ _sum: { size: true }, where: { deletedAt: { not: null } } }),
    backupsDirBytes(),
    dirBytes(path.join(dir, "exports")),
    db.$queryRaw<{ projectId: string; bytes: bigint }[]>(Prisma.sql`
      SELECT "projectId", SUM("size")::bigint AS bytes FROM (
        SELECT t."projectId", a."size" FROM "TaskAttachment" a JOIN "Task" t ON t."id" = a."taskId"
        UNION ALL SELECT r."projectId", a."size" FROM "ReleaseAttachment" a JOIN "Release" r ON r."id" = a."releaseId"
        UNION ALL SELECT d."projectId", d."size" FROM "ProjectDocument" d
      ) u GROUP BY "projectId" ORDER BY bytes DESC LIMIT 10`),
  ]);
  const projects = await db.project.findMany({ where: { id: { in: top.map((r) => r.projectId) } }, select: { id: true, name: true, isPrivate: true } });
  const byId = new Map(projects.map((p) => [p.id, p]));
  const categories = {
    taskAttachments: tasks._sum.size ?? 0,
    releaseAttachments: releases._sum.size ?? 0,
    documents: docs._sum.size ?? 0,
    documentsTrash: trash._sum.size ?? 0,
    backups,
    exports,
  };
  return {
    uploadDir: dir,
    disk,
    settings,
    env: { project: envNumber(process.env.UPLOAD_QUOTA_MB_PER_PROJECT), total: envNumber(process.env.UPLOAD_QUOTA_MB_TOTAL) },
    effective: { projectMb: limits.projectMb, projectSource: limits.projectSource, totalMb: limits.totalMb, totalSource: limits.totalSource },
    categories,
    trackedBytes: categories.taskAttachments + categories.releaseAttachments + categories.documents + categories.documentsTrash,
    // Un proyecto privado no lo ve ni un administrador que no sea miembro: sin nombre ni enlace.
    topProjects: top.map((r) => {
      const p = byId.get(r.projectId);
      return { id: r.projectId, name: p && !p.isPrivate ? p.name : null, bytes: Number(r.bytes) };
    }),
  };
}
