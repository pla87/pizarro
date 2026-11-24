// Constantes compartidas entre cliente y servidor (sin dependencias de Node).

import type { CSSProperties } from "react";

/** Estilo del distintivo de un tipo de tarea (va con la clase `kind-badge`, que ajusta el contraste). */
export function kindBadgeStyle(color: string): CSSProperties {
  return { "--kind": color } as CSSProperties;
}

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export const COLUMN_ROLES = ["NONE", "NEXT_RELEASE", "IN_PRODUCTION", "WAITING", "WEEKLY_PLAN", "CHECKLIST", "REVIEW", "ROUTINES", "BUDGET", "PROGRAM", "AI_PLAN"] as const;
export type ColumnRoleValue = (typeof COLUMN_ROLES)[number];

/**
 * Roles retirados: «Agenda» (el calendario suscrito ya da las fechas) y «Entrega al cliente». Dejaron de ofrecerse en la
 * v1.68 y salieron del enum en la v1.69, pero aún pueden llegar como texto (un `.pizarro.zip` o JSON exportado con la
 * v1.67, una plantilla guardada, una entrada antigua de deshacer): se aceptan y se leen como «Sin rol» (liveColumnRole).
 */
const RETIRED_COLUMN_ROLES = ["AGENDA", "DELIVERY"] as const;
type RetiredColumnRole = (typeof RETIRED_COLUMN_ROLES)[number];
/** Los roles que se aceptan al leer una entrada (los de ahora y los retirados). */
export const INPUT_COLUMN_ROLES = [...COLUMN_ROLES, ...RETIRED_COLUMN_ROLES] as const;
/** El rol tal como se guarda ahora: uno retirado pasa a NONE. */
export function liveColumnRole(role: ColumnRoleValue | RetiredColumnRole): ColumnRoleValue {
  return (RETIRED_COLUMN_ROLES as readonly string[]).includes(role) ? "NONE" : (role as ColumnRoleValue);
}

/** Roles que solo puede tener una columna por proyecto (el resto de roles pueden repetirse). */
export const UNIQUE_COLUMN_ROLES: readonly ColumnRoleValue[] = ["NEXT_RELEASE", "IN_PRODUCTION"];
export const isUniqueColumnRole = (role: string): boolean => (UNIQUE_COLUMN_ROLES as readonly string[]).includes(role);

/**
 * Roles cuyas columnas tienen tareas fijas (evergreen: «Siempre en la release» / «Siempre en el plan»): no se mueven al
 * generar y entran siempre. Fuera de una columna con uno de estos roles una tarea no puede ser fija.
 */
export const EVERGREEN_COLUMN_ROLES = ["NEXT_RELEASE", "AI_PLAN"] as const satisfies readonly ColumnRoleValue[];
export const hasEvergreenTasks = (role: string | null | undefined): boolean => (EVERGREEN_COLUMN_ROLES as readonly string[]).includes(role ?? "");

/** Tipos de plantilla de cabecera y pie: los de las releases y los del plan de trabajo para IA (misma tabla). */
export const RELEASE_TEMPLATE_KINDS = ["HEADER", "FOOTER"] as const;
export const PLAN_TEMPLATE_KINDS = ["PLAN_HEADER", "PLAN_FOOTER"] as const;
export const TEMPLATE_KINDS = [...RELEASE_TEMPLATE_KINDS, ...PLAN_TEMPLATE_KINDS] as const;
export type TemplateKindValue = (typeof TEMPLATE_KINDS)[number];
/** Solo las plantillas de release (las del plan no cuentan en «Generar release», en las plantillas de proyecto ni al aplicarlas). */
export function releaseTemplateRows<R extends { kind: string }>(rows: R[]): (R & { kind: (typeof RELEASE_TEMPLATE_KINDS)[number] })[] {
  return rows.filter((r): r is R & { kind: (typeof RELEASE_TEMPLATE_KINDS)[number] } => r.kind === "HEADER" || r.kind === "FOOTER");
}

/** Días por defecto de una columna de espera antes de recordar a la persona asignada. */
export const DEFAULT_WAITING_DAYS = 3;
export const MAX_WAITING_DAYS = 365;

export const COLUMN_ROLE_LABEL: Record<ColumnRoleValue | RetiredColumnRole, string> = {
  NONE: "Sin rol",
  NEXT_RELEASE: "Siguiente salto (genera releases)",
  IN_PRODUCTION: "En producción (destino al desplegar)",
  WAITING: "Esperando (avisa si tarda)",
  WEEKLY_PLAN: "Planificación semanal",
  CHECKLIST: "Lista consolidada",
  REVIEW: "Revisión con requisitos",
  // Los retirados (AGENDA, DELIVERY) conservan su nombre: lo usan los registros antiguos.
  AGENDA: "Agenda",
  ROUTINES: "Rutinas",
  DELIVERY: "Entrega al cliente",
  BUDGET: "Presupuesto (suma el coste)",
  PROGRAM: "Programa del curso (PDF)",
  AI_PLAN: "Plan de trabajo para IA",
};

/** Explicación de una línea de cada rol (se ve al pasar por encima en el menú de la columna). */
export const COLUMN_ROLE_HINT: Record<ColumnRoleValue, string> = {
  NONE: "Columna normal, sin funciones especiales.",
  NEXT_RELEASE: "Sus tarjetas forman la siguiente release (botón «Generar release»).",
  IN_PRODUCTION: "Las tarjetas de una release publicada pasan aquí.",
  WAITING: "Avisa a la persona asignada si una tarjeta lleva demasiados días aquí.",
  WEEKLY_PLAN: "PDF de las tareas de la semana, por día o por persona.",
  CHECKLIST: "Reúne las subtareas de todas sus tarjetas en una sola lista.",
  REVIEW: "Avisa al sacar una tarjeta con subtareas sin marcar.",
  ROUTINES: "Tareas que se repiten: elige dónde aparece la siguiente.",
  BUDGET: "Suma el coste de sus tarjetas y activa el campo Coste.",
  PROGRAM: "Cada tarjeta es una sesión del curso: publica el programa en PDF.",
  AI_PLAN: "Sus tarjetas forman un plan de trabajo en Markdown para una IA (botón «Generar plan de trabajo»).",
};

const DEFAULT_COLUMNS: { name: string; nameEn: string; role: ColumnRoleValue; isDone: boolean }[] = [
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
function isVeryLight(c: string | null | undefined) {
  const m = /^#([0-9a-f]{6})$/i.exec(c ?? "");
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) >= 235;
}
/** Clases de borde para una muestra de color: el blanco (y lo muy claro) lleva un borde visible, en claro y en oscuro. */
export const swatchBorder = (c: string | null | undefined) => (isVeryLight(c) ? "border border-slate-400 dark:border-slate-500" : "");

const DARK_TEXT = "#0f172a";
/** Luminancia relativa (WCAG) de un color #rgb o #rrggbb; null si no lo es. */
function luminance(c: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const hex = m[1]!.length === 3 ? m[1]!.replace(/./g, "$&$&") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/**
 * Color de texto legible sobre un fondo (etiquetas, muestras): blanco si da al menos 4,5:1 con el fondo (WCAG AA); si no,
 * el que más contraste dé de blanco y casi negro (#0f172a). En la paleta llevan texto oscuro el blanco, rojo, naranja,
 * amarillo, verde, turquesa, celeste, violeta y rosa; el índigo (4,47:1 con blanco, 4,0:1 con oscuro) se queda en blanco.
 */
export function onColor(c: string): string {
  const l = luminance(c);
  if (l === null) return isWhite(c) ? DARK_TEXT : "#ffffff";
  const withWhite = 1.05 / (l + 0.05);
  if (withWhite >= 4.5) return "#ffffff";
  const withDark = (l + 0.05) / ((luminance(DARK_TEXT) ?? 0) + 0.05);
  return withDark > withWhite ? DARK_TEXT : "#ffffff";
}

/** Nombre en español de cada color de la paleta (accesibilidad). */
export const COLOR_NAME: Record<string, string> = {
  "#64748b": "Gris", "#ffffff": "Blanco", "#ef4444": "Rojo", "#f97316": "Naranja", "#8b5a2b": "Marrón",
  "#eab308": "Amarillo", "#22c55e": "Verde", "#166534": "Verde oscuro", "#14b8a6": "Turquesa",
  "#0ea5e9": "Celeste", "#6366f1": "Índigo", "#1e3a8a": "Azul marino", "#a855f7": "Violeta", "#ec4899": "Rosa",
};

/** Máximo del título de una tarea en caracteres visibles (grafemas: un emoji de familia o una bandera cuentan como uno). */
export const MAX_TITLE = 210;
/**
 * Tope duro del título en unidades UTF-16 del texto visible: protege el tamaño guardado aunque cada «carácter» sea un emoji
 * compuesto de muchas unidades. Holgado: 210 emojis normales (2 unidades) caben de sobra.
 */
export const MAX_TITLE_UNITS = MAX_TITLE * 4;
/** Subtareas por tarea como máximo. */
export const MAX_SUBTASKS = 100;
/** Etiquetas por tarea. */
export const MAX_TASK_LABELS = 20;
export const MAX_DESCRIPTION = 20_000;
export const MAX_TEMPLATE = 20_000;
export const MAX_RELEASE_CONTENT = 200_000;
/** Tope del ZIP de adjuntos de una release (MB): límites que admite el ajuste del proyecto (por defecto 80, en el esquema). */
export const RELEASE_ZIP_MIN_MB = 10;
export const RELEASE_ZIP_MAX_MB = 500;

/** Topes por proyecto (que ninguno crezca sin límite) y ritmos máximos de creación por persona y minuto. */
export const MAX_LABELS_PER_PROJECT = 50;
/** Cabeceras o pies de release del proyecto (por tipo). */
export const MAX_RELEASE_TEMPLATES_PER_KIND = 20;
export const MAX_DELIVERABLES_PER_PROJECT = 100;
export const MAX_ACTIVE_TASKS_PER_PROJECT = 1000;
/** Tareas nuevas por minuto y persona (las creaciones múltiples cuentan una por tarea; debe ser ≥ MAX_BULK_TASKS). */
export const TASK_CREATE_PER_MINUTE = 300;
export const LABEL_CREATE_PER_MINUTE = 30;
export const DELIVERABLE_CREATE_PER_MINUTE = 30;
