// «Compartir fuera» en el tablero: lo que sabe el navegador de una columna compartida (sin dependencias del servidor: lo
// usan ColumnView, ShareColumn y el servidor al preparar el tablero). Nunca lleva el token.
import { isAssignColumn } from "./column-assign-core";

/** BoardColumn.share: el estado del enlace de una columna «Compartir fuera». */
export interface BoardShareInfo {
  state: "none" | "active" | "ended";
  /** Hasta cuándo vale si no se usa (activo) o cuándo terminó (ISO). */
  endsAt: string | null;
  expiryDays: number;
  /** Huella corta del enlace actual (no revela el token): el navegador que lo generó recuerda su dirección con ella. */
  linkId: string | null;
  generatedAt: string | null;
  generatedByName: string | null;
  /** Tareas publicadas en la última generación. */
  published: number;
}

/**
 * ¿Es una columna «Compartir fuera»? Con su fila (share), rol NONE y sin «Asignación a persona»: si un deshacer le devolvió
 * otro rol, vuelve a ser una columna de ese rol (y su enlace deja de funcionar).
 */
export function isShareColumn(c: { role: string; assigneeId?: string | null; assignDueDays?: number | null; share?: unknown }): boolean {
  return c.share != null && c.role === "NONE" && !isAssignColumn(c);
}

/** Lo que dice la cabecera y el informe del estado del enlace (clave de traducción y fecha). */
export function shareStateText(info: Pick<BoardShareInfo, "state" | "endsAt">): { key: "Enlace activo hasta el {date}" | "Enlace caducado" | "Web sin generar"; date: string | null } {
  if (info.state === "active") return { key: "Enlace activo hasta el {date}", date: info.endsAt };
  if (info.state === "ended") return { key: "Enlace caducado", date: null };
  return { key: "Web sin generar", date: null };
}
