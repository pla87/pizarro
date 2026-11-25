// Qué roles enseña primero el submenú «Rol de la columna» (ColumnView). Sin dependencias: lo usa el navegador. El mapa
// plantilla → roles vive junto a las plantillas de serie (TEMPLATE_COLUMN_ROLES, builtin-templates.ts) y el servidor manda
// al tablero la lista ya calculada (BoardData.project.suggestedRoles).
import { COLUMN_ROLES, type ColumnRoleValue } from "./constants";

/**
 * Una opción del submenú: un rol (salvo «Sin rol», que sale siempre), «Asignación a persona» (rol NONE con persona) o
 * «Compartir fuera» (rol NONE con su fila ColumnShare; solo en los proyectos que la tienen activada).
 */
export type ColumnRoleChoice = Exclude<ColumnRoleValue, "NONE"> | "ASSIGN" | "SHARE";

/** Todas las opciones, en el orden del submenú (sin «Compartir fuera», que se añade al final si el proyecto la tiene). */
export const ROLE_CHOICES: readonly ColumnRoleChoice[] = [...COLUMN_ROLES.filter((r): r is Exclude<ColumnRoleValue, "NONE"> => r !== "NONE"), "ASSIGN"];

/** Roles que sirven en casi cualquier proyecto: se sugieren también en los que salen de una plantilla propia. */
export const GENERAL_ROLE_CHOICES: readonly ColumnRoleChoice[] = ["WAITING", "WEEKLY_PLAN", "CHECKLIST", "ROUTINES", "ASSIGN"];

/** La opción que tiene ahora una columna (null: «Sin rol»). */
export function currentRoleChoice(column: { role: ColumnRoleValue; assign: boolean; share?: boolean }): ColumnRoleChoice | null {
  if (column.assign) return "ASSIGN";
  if (column.share) return "SHARE";
  return column.role === "NONE" ? null : column.role;
}

/**
 * Reparte las opciones entre las que se ven al abrir el submenú y las de «Más roles…». Las sugeridas salen en el orden
 * de su lista (lo más usado en esa plantilla primero: en «Casa y familia», «Planificación semanal»); antes se volvían a
 * ordenar como ROLE_CHOICES y salía primero «Esperando». La que ya tiene la columna nunca se esconde: si no está entre
 * las sugeridas, va la primera. `suggested` null (proyecto sin plantilla conocida): todas a la vista, como siempre.
 * `shareOut`: el proyecto tiene activada «Compartir fuera» (la ha encendido un administrador): sale siempre a la vista,
 * al final.
 */
export function splitRoleChoices(suggested: readonly ColumnRoleChoice[] | null | undefined, current: ColumnRoleChoice | null, shareOut = false): { first: ColumnRoleChoice[]; more: ColumnRoleChoice[] } {
  const share: ColumnRoleChoice[] = shareOut || current === "SHARE" ? ["SHARE"] : [];
  if (!suggested) return { first: [...ROLE_CHOICES, ...share], more: [] };
  const first = [...new Set(suggested)].filter((r) => ROLE_CHOICES.includes(r));
  if (current && current !== "SHARE" && !first.includes(current)) first.unshift(current);
  return { first: [...first, ...share], more: ROLE_CHOICES.filter((r) => !first.includes(r)) };
}
