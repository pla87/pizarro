// Constantes compartidas entre cliente y servidor (sin dependencias de Node).

import type { CSSProperties } from "react";

/** Estilo del distintivo de un tipo de tarea (va con la clase `kind-badge`, que ajusta el contraste). */
export function kindBadgeStyle(color: string): CSSProperties {
  return { "--kind": color } as CSSProperties;
}

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export const COLUMN_ROLES = ["NONE", "NEXT_RELEASE", "IN_PRODUCTION", "WAITING", "WEEKLY_PLAN"] as const;
export type ColumnRoleValue = (typeof COLUMN_ROLES)[number];

/** Roles que solo puede tener una columna por proyecto (WAITING y WEEKLY_PLAN pueden repetirse). */
export const UNIQUE_COLUMN_ROLES: readonly ColumnRoleValue[] = ["NEXT_RELEASE", "IN_PRODUCTION"];
export const isUniqueColumnRole = (role: string): boolean => (UNIQUE_COLUMN_ROLES as readonly string[]).includes(role);

/** Días por defecto de una columna de espera antes de recordar a la persona asignada. */
export const DEFAULT_WAITING_DAYS = 3;
export const MAX_WAITING_DAYS = 365;

export const COLUMN_ROLE_LABEL: Record<ColumnRoleValue, string> = {
  NONE: "Sin rol",
  NEXT_RELEASE: "Siguiente salto (genera releases)",
  IN_PRODUCTION: "En producción (destino al desplegar)",
  WAITING: "Esperando (avisa si tarda)",
  WEEKLY_PLAN: "Planificación semanal",
};

export const DEFAULT_COLUMNS: { name: string; nameEn: string; role: ColumnRoleValue; isDone: boolean }[] = [
  { name: "Backlog", nameEn: "Backlog", role: "NONE", isDone: false },
  { name: "En progreso", nameEn: "In progress", role: "NONE", isDone: false },
  { name: "Siguiente salto a producción", nameEn: "Next release", role: "NEXT_RELEASE", isDone: false },
  { name: "En producción", nameEn: "In production", role: "IN_PRODUCTION", isDone: true },
  { name: "Cerrado", nameEn: "Closed", role: "NONE", isDone: true },
];

/** Columnas por defecto de un proyecto nuevo, con los nombres en el idioma de quien lo crea. */
export function defaultColumns(locale: "es" | "en" = "es"): { name: string; role: ColumnRoleValue; isDone: boolean }[] {
  return DEFAULT_COLUMNS.map(({ name, nameEn, role, isDone }) => ({ name: locale === "en" ? nameEn : name, role, isDone }));
}

/** Paleta de colores para tarjetas y etiquetas (hex). */
export const PALETTE = [
  "#64748b", "#ffffff", "#ef4444", "#f97316", "#8b5a2b", "#eab308",
  "#22c55e", "#166534", "#14b8a6", "#0ea5e9", "#6366f1", "#1e3a8a",
  "#a855f7", "#ec4899",
] as const;

const WHITE_COLOR = "#ffffff";
export const isWhite = (c: string | null | undefined) => c?.toLowerCase() === WHITE_COLOR;
/** ¿Color tan claro (blanco o casi) que sobre un fondo claro no se distingue? */
export function isVeryLight(c: string | null | undefined) {
  const m = /^#([0-9a-f]{6})$/i.exec(c ?? "");
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) >= 235;
}
/** Clases de borde para una muestra de color: el blanco (y lo muy claro) lleva un borde visible, en claro y en oscuro. */
export const swatchBorder = (c: string | null | undefined) => (isVeryLight(c) ? "border border-slate-400 dark:border-slate-500" : "");

/** Color de texto legible sobre un fondo de la paleta (el blanco necesita texto oscuro). */
export const onColor = (c: string) => (isWhite(c) ? "#0f172a" : "#ffffff");

/** Nombre en español de cada color de la paleta (accesibilidad). */
export const COLOR_NAME: Record<string, string> = {
  "#64748b": "Gris", "#ffffff": "Blanco", "#ef4444": "Rojo", "#f97316": "Naranja", "#8b5a2b": "Marrón",
  "#eab308": "Amarillo", "#22c55e": "Verde", "#166534": "Verde oscuro", "#14b8a6": "Turquesa",
  "#0ea5e9": "Celeste", "#6366f1": "Índigo", "#1e3a8a": "Azul marino", "#a855f7": "Violeta", "#ec4899": "Rosa",
};

export const MAX_TITLE = 210;
export const MAX_DESCRIPTION = 20_000;
export const MAX_TEMPLATE = 20_000;
export const MAX_RELEASE_CONTENT = 200_000;
/** Tope del ZIP de adjuntos de una release (MB): valor por defecto y límites que admite el ajuste del proyecto. */
export const RELEASE_ZIP_DEFAULT_MB = 80;
export const RELEASE_ZIP_MIN_MB = 10;
export const RELEASE_ZIP_MAX_MB = 500;

/** Topes por proyecto (que ninguno crezca sin límite) y ritmos máximos de creación por persona y minuto. */
export const MAX_LABELS_PER_PROJECT = 50;
export const MAX_DELIVERABLES_PER_PROJECT = 100;
export const MAX_ACTIVE_TASKS_PER_PROJECT = 1000;
/** Tareas nuevas por minuto y persona (las creaciones múltiples cuentan una por tarea; debe ser ≥ MAX_BULK_TASKS). */
export const TASK_CREATE_PER_MINUTE = 300;
export const LABEL_CREATE_PER_MINUTE = 30;
export const DELIVERABLE_CREATE_PER_MINUTE = 30;
