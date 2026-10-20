// Constantes compartidas entre cliente y servidor (sin dependencias de Node).

/** Estilo del distintivo de un tipo de tarea a partir de su color (hex). */
export function kindBadgeStyle(color: string): { backgroundColor: string; color: string; boxShadow: string } {
  // El blanco no se vería sobre fondo claro: fondo blanco, texto pizarra y borde gris.
  if (color.toLowerCase() === "#ffffff") return { backgroundColor: "#ffffff", color: "#334155", boxShadow: "inset 0 0 0 1px #94a3b8" };
  return { backgroundColor: `${color}22`, color, boxShadow: `inset 0 0 0 1px ${color}55` };
}

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

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
  "#64748b", "#ffffff", "#ef4444", "#f97316", "#8b5a2b", "#eab308",
  "#22c55e", "#166534", "#14b8a6", "#0ea5e9", "#6366f1", "#1e3a8a",
  "#a855f7", "#ec4899",
] as const;

export const WHITE_COLOR = "#ffffff";
export const isWhite = (c: string | null | undefined) => c?.toLowerCase() === WHITE_COLOR;
/** Color de texto legible sobre un fondo de la paleta (el blanco necesita texto oscuro). */
export const onColor = (c: string) => (isWhite(c) ? "#0f172a" : "#ffffff");

/** Nombre en español de cada color de la paleta (accesibilidad). */
export const COLOR_NAME: Record<string, string> = {
  "#64748b": "Gris", "#ffffff": "Blanco", "#ef4444": "Rojo", "#f97316": "Naranja", "#8b5a2b": "Marrón",
  "#eab308": "Amarillo", "#22c55e": "Verde", "#166534": "Verde oscuro", "#14b8a6": "Turquesa",
  "#0ea5e9": "Celeste", "#6366f1": "Índigo", "#1e3a8a": "Azul marino", "#a855f7": "Violeta", "#ec4899": "Rosa",
};

export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 20_000;
export const MAX_TEMPLATE = 20_000;
export const MAX_RELEASE_CONTENT = 200_000;
export const ALLOWED_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];
