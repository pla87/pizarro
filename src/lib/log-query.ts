import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { logRetentionDays } from "./log";

// Filtros compartidos por la página de logs y la descarga CSV (Administración → Logs).

export const LOG_RANGES = [
  { value: "1h", label: "Última hora", hours: 1 },
  { value: "24h", label: "Últimas 24 h", hours: 24 },
  { value: "7d", label: "7 días", hours: 24 * 7 },
] as const;

export interface LogFilters {
  range: string;
  level: string;
  category: string;
  userId: string;
  q: string;
}

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseLogFilters(p: Params): LogFilters {
  const range = LOG_RANGES.some((r) => r.value === first(p.range)) ? first(p.range) : "24h";
  const level = ["info", "warn", "error"].includes(first(p.level)) ? first(p.level) : "";
  return {
    range,
    level,
    category: first(p.category).slice(0, 40),
    userId: first(p.user).slice(0, 40),
    q: first(p.q).trim().slice(0, 100),
  };
}

/** Registros de proyectos privados de otra persona: el visor solo puede ver su hora y su usuario. */
export function isMaskedLog(row: { privateOwnerId: string | null }, viewerId: string): boolean {
  return !!row.privateOwnerId && row.privateOwnerId !== viewerId;
}

/**
 * Condición de Prisma para el filtro; `withLevel` false sirve para contar por nivel. Los filtros
 * por nivel, categoría y texto solo miran registros no ocultos (para no revelar su contenido).
 */
export function logWhere(f: LogFilters, viewerId: string, withLevel = true): Prisma.AppLogWhereInput {
  const hours = LOG_RANGES.find((r) => r.value === f.range)!.hours;
  const maxMs = logRetentionDays() * 86_400_000;
  const since = new Date(Date.now() - Math.min(hours * 3_600_000, maxMs));
  const and: Prisma.AppLogWhereInput[] = [{ createdAt: { gte: since } }];
  const visible: Prisma.AppLogWhereInput = { OR: [{ privateOwnerId: null }, { privateOwnerId: viewerId }] };
  if ((withLevel && f.level) || f.category || f.q || !withLevel) and.push(visible);
  if (withLevel && f.level) and.push({ level: f.level });
  if (f.category) and.push({ category: f.category });
  if (f.userId) and.push({ userId: f.userId });
  if (f.q) {
    and.push({
      OR: [
        { action: { contains: f.q, mode: "insensitive" } },
        { message: { contains: f.q, mode: "insensitive" } },
        { path: { contains: f.q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: and };
}

/** Parámetros de búsqueda del filtro actual (sin cursor), para enlaces. */
export function logQuery(f: LogFilters, extra: Record<string, string> = {}): string {
  const sp = new URLSearchParams();
  if (f.range !== "24h") sp.set("range", f.range);
  if (f.level) sp.set("level", f.level);
  if (f.category) sp.set("category", f.category);
  if (f.userId) sp.set("user", f.userId);
  if (f.q) sp.set("q", f.q);
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}
