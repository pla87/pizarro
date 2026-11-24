// Qué roles enseña primero el submenú «Rol de la columna» (ColumnView). Sin dependencias: lo usa el navegador. El mapa
// plantilla → roles vive junto a las plantillas de serie (TEMPLATE_COLUMN_ROLES, builtin-templates.ts) y el servidor manda
// al tablero la lista ya calculada (BoardData.project.suggestedRoles).
import { COLUMN_ROLES, type ColumnRoleValue } from "./constants";

/** Una opción del submenú: un rol (salvo «Sin rol», que sale siempre) o «Asignación a persona» (rol NONE con persona). */
export type ColumnRoleChoice = Exclude<ColumnRoleValue, "NONE"> | "ASSIGN";

/** Todas las opciones, en el orden del submenú. */
export const ROLE_CHOICES: readonly ColumnRoleChoice[] = [...COLUMN_ROLES.filter((r): r is Exclude<ColumnRoleValue, "NONE"> => r !== "NONE"), "ASSIGN"];

/** Roles que sirven en casi cualquier proyecto: se sugieren también en los que salen de una plantilla propia. */
export const GENERAL_ROLE_CHOICES: readonly ColumnRoleChoice[] = ["WAITING", "WEEKLY_PLAN", "CHECKLIST", "ROUTINES", "ASSIGN"];

/** La opción que tiene ahora una columna (null: «Sin rol»). */
export function currentRoleChoice(column: { role: ColumnRoleValue; assign: boolean }): ColumnRoleChoice | null {
  if (column.assign) return "ASSIGN";
  return column.role === "NONE" ? null : column.role;
}

/**
 * Reparte las opciones entre las que se ven al abrir el submenú y las de «Más roles…». `suggested` null (proyecto sin
 * plantilla conocida): todas a la vista, como siempre. La que ya tiene la columna nunca se esconde.
 */
export function splitRoleChoices(suggested: readonly ColumnRoleChoice[] | null | undefined, current: ColumnRoleChoice | null): { first: ColumnRoleChoice[]; more: ColumnRoleChoice[] } {
  if (!suggested) return { first: [...ROLE_CHOICES], more: [] };
  const shown = new Set<ColumnRoleChoice>(suggested);
  if (current) shown.add(current);
  return { first: ROLE_CHOICES.filter((r) => shown.has(r)), more: ROLE_CHOICES.filter((r) => !shown.has(r)) };
}
