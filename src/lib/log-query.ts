import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { logRetentionDays } from "./log";
import { cleanText, clipText } from "./log-clean";

// Filtros compartidos por la página de logs y la descarga CSV (Administración → Logs).

export const LOG_RANGES = [
  { value: "1h", label: "Última hora", hours: 1 },
  { value: "24h", label: "Últimas 24 h", hours: 24 },
  { value: "7d", label: "7 días", hours: 24 * 7 },
] as const;

interface LogFilters {
  range: string;
  level: string;
  category: string;
  userId: string;
  q: string;
  /** Incluir las consultas (páginas vistas, aperturas, descargas); por defecto solo se ven los cambios. */
  reads: boolean;
  /** Solo la descarga CSV: intervalo explícito que sustituye al periodo. */
  period?: { gte: Date; lt: Date };
}

/** Acciones que solo consultan datos: se ocultan salvo que se pidan las consultas. */
export const READ_ACTIONS = [
  "tasks.getTaskDetail",
  "tasks.getOlderComments",
  "tasks.getRecentComments",
  "tasks.getArchivedTasks",
  "tasks.getTaskHistory",
  "tasks.getTaskJson",
  "tasks.exportTasksJson",
  "tasks.getProjectFormData",
  "columnViews.getColumnChecklist",
  "columnViews.getPendingSubtasks",
  "releases.getReleaseTaskDetails",
  "releases.countReleasesOn",
  "releases.getReleaseContent",
  "aiPlan.getAiPlanSetup",
  "aiPlan.getAiPlanTaskDetails",
  "templates.listTemplates",
  "projects.listProjectStarts",
  "report.pdf",
  "release.zipDownload",
  "aiPlan.zipDownload",
  "storage.previewCleanup",
  "storage.largestAttachments",
  "admin.techInfo",
  "templateApply.listApplicableTemplates",
  "templateApply.previewTemplateChange",
  "calendarFeed.suggestedScope",
];

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseLogFilters(p: Params): LogFilters {
  const range = LOG_RANGES.some((r) => r.value === first(p.range)) ? first(p.range) : "24h";
  const level = ["info", "warn", "error"].includes(first(p.level)) ? first(p.level) : "";
  return {
    range,
    level,
    // Sin NUL (PostgreSQL no lo admite en un texto: /admin/logs?category=%00 daba el error 22021 y la página de error)
    // ni medio emoji al recortar.
    category: clipText(first(p.category), 40),
    userId: clipText(first(p.user), 40),
    q: clipText(cleanText(first(p.q)).trim(), 100),
    reads: first(p.consultas) === "1",
  };
}

/** Ids de los proyectos privados de los que el visor es miembro (los únicos cuyos registros puede ver completos). */
export async function memberPrivateProjectIds(viewerId: string): Promise<string[]> {
  const rows = await db.projectMember.findMany({ where: { userId: viewerId, project: { isPrivate: true } }, select: { projectId: true } });
  return rows.map((r) => r.projectId);
}

/** Registros de un proyecto privado del que el visor no es miembro: solo puede ver su hora y su usuario. */
export function isMaskedLog(row: { privateProjectId: string | null }, memberProjectIds: readonly string[]): boolean {
  return !!row.privateProjectId && !memberProjectIds.includes(row.privateProjectId);
}

/**
 * Condición de Prisma para el filtro (`memberProjectIds`: privados de los que el visor es miembro); `withLevel` false sirve para contar por nivel. Los filtros
 * por nivel, categoría y texto solo miran registros no ocultos (para no revelar su contenido).
 */
export function logWhere(f: LogFilters, memberProjectIds: readonly string[], withLevel = true): Prisma.AppLogWhereInput {
  const hours = LOG_RANGES.find((r) => r.value === f.range)!.hours;
  const maxMs = logRetentionDays() * 86_400_000;
  const since = new Date(Date.now() - Math.min(hours * 3_600_000, maxMs));
  const and: Prisma.AppLogWhereInput[] = [{ createdAt: f.period ? { gte: f.period.gte, lt: f.period.lt } : { gte: since } }];
  const visible: Prisma.AppLogWhereInput = { OR: [{ privateProjectId: null }, { privateProjectId: { in: [...memberProjectIds] } }] };
  if ((withLevel && f.level) || f.category || f.q || !withLevel) and.push(visible);
  if (withLevel && f.level) and.push({ level: f.level });
  if (f.category) and.push({ category: f.category });
  // Solo cambios: fuera las consultas que fueron bien (los avisos y errores se ven siempre).
  if (!f.reads) and.push({ NOT: { AND: [{ level: "info" }, { OR: [{ category: "page" }, { action: { in: READ_ACTIONS } }] }] } });
  if (f.userId) and.push({ userId: f.userId });
  if (f.q) {
    // Prisma pasa el texto tal cual a ILIKE: sin escapar, «%» o «_» casaban con cualquier cosa (y «50%» con «500»).
    const q = likeLiteral(f.q);
    and.push({
      OR: [
        { action: { contains: q, mode: "insensitive" } },
        { message: { contains: q, mode: "insensitive" } },
        { path: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: and };
}

/** Texto para `contains`/`startsWith` de Prisma que se busca literal: escapa los comodines de LIKE (`%`, `_`) y `\`. */
function likeLiteral(q: string): string {
  return q.replace(/[\\%_]/g, "\\$&");
}

/**
 * Registros posteriores en el orden de la lista (fecha y id descendentes) a `row`: paginación por clave. El cursor de
 * Prisma (`cursor` + `skip`) generaba un OR que PostgreSQL no puede usar como límite del índice, así que cada página
 * recorría todas las anteriores (el CSV de 200 000 filas, cuadrático). Con `createdAt <= t` el índice empieza en el cursor.
 */
export function logsAfter(row: { createdAt: Date; id: string }): Prisma.AppLogWhereInput {
  return { AND: [{ createdAt: { lte: row.createdAt } }, { OR: [{ createdAt: { lt: row.createdAt } }, { id: { lt: row.id } }] }] };
}

/** Parámetros de búsqueda del filtro actual (sin cursor), para enlaces. */
export function logQuery(f: LogFilters, extra: Record<string, string> = {}): string {
  const sp = new URLSearchParams();
  if (f.range !== "24h") sp.set("range", f.range);
  if (f.level) sp.set("level", f.level);
  if (f.category) sp.set("category", f.category);
  if (f.userId) sp.set("user", f.userId);
  if (f.q) sp.set("q", f.q);
  if (f.reads) sp.set("consultas", "1");
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}
