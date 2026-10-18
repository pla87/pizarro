// Constantes compartidas entre cliente y servidor (sin dependencias de Node).

export const TASK_TYPES = ["FEATURE", "FIX", "CHORE", "REFACTOR", "HOTFIX"] as const;
export type TaskTypeValue = (typeof TASK_TYPES)[number];

export const TASK_TYPE_META: Record<TaskTypeValue, { label: string; badge: string }> = {
  FEATURE: { label: "Feature", badge: "bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300" },
  FIX: { label: "Fix", badge: "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300" },
  CHORE: { label: "Chore", badge: "bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/20 dark:text-slate-300" },
  REFACTOR: { label: "Refactor", badge: "bg-violet-100 text-violet-800 ring-violet-600/20 dark:bg-violet-500/15 dark:text-violet-300" },
  HOTFIX: { label: "Hotfix", badge: "bg-red-100 text-red-800 ring-red-600/25 dark:bg-red-500/20 dark:text-red-300" },
};

export const COLUMN_ROLES = ["NONE", "NEXT_RELEASE", "IN_PRODUCTION"] as const;
export type ColumnRoleValue = (typeof COLUMN_ROLES)[number];

export const COLUMN_ROLE_LABEL: Record<ColumnRoleValue, string> = {
  NONE: "Sin rol",
  NEXT_RELEASE: "Siguiente salto (genera releases)",
  IN_PRODUCTION: "En producción (destino al desplegar)",
};

export const DEFAULT_COLUMNS: { name: string; role: ColumnRoleValue; isDone: boolean }[] = [
  { name: "Backlog", role: "NONE", isDone: false },
  { name: "En progreso", role: "NONE", isDone: false },
  { name: "Siguiente salto a producción", role: "NEXT_RELEASE", isDone: false },
  { name: "En producción", role: "IN_PRODUCTION", isDone: true },
  { name: "Cerrado", role: "NONE", isDone: true },
];

/** Paleta de colores para tarjetas y etiquetas (hex). */
export const PALETTE = [
  "#64748b", "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899",
] as const;

export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 20_000;
export const MAX_TEMPLATE = 20_000;
export const MAX_RELEASE_CONTENT = 200_000;
export const ALLOWED_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];
