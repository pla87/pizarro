// Filtros rápidos del tablero (además del texto): lógica pura, sin React.
import { weekBoundsIso } from "@/lib/dates";
import type { BoardTask } from "@/lib/types";

/** Valor de `assigneeId` para «solo las que no tienen responsable». */
export const NO_ASSIGNEE = "none";

export interface BoardFilters {
  /** Asignadas a mí. */
  mine: boolean;
  /** Con la fecha límite pasada y sin estar en una columna terminada. */
  overdue: boolean;
  /** Con fecha límite entre el lunes y el domingo de esta semana. */
  week: boolean;
  /** Cualquiera de estas etiquetas. */
  labelIds: string[];
  /** Cualquiera de estos tipos. */
  kindIds: string[];
  /** "" = cualquiera, NO_ASSIGNEE o el id de una persona. */
  assigneeId: string;
}

export const EMPTY_FILTERS: BoardFilters = { mine: false, overdue: false, week: false, labelIds: [], kindIds: [], assigneeId: "" };

/** Cuántos filtros hay activos (cada grupo cuenta una vez). */
export function activeFilterCount(f: BoardFilters): number {
  return [f.mine, f.overdue, f.week, f.labelIds.length > 0, f.kindIds.length > 0, f.assigneeId !== ""].filter(Boolean).length;
}

export function filtersKey(userId: string, projectId: string): string {
  return `pz:board-filters:${userId}:${projectId}`;
}

const strings = (v: unknown, max = 100): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))].slice(0, max) : []);

/** Lee lo guardado en localStorage; cualquier cosa rara da «sin filtros». */
export function parseStoredFilters(raw: string | null): BoardFilters {
  if (!raw) return EMPTY_FILTERS;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return EMPTY_FILTERS;
    return {
      mine: v.mine === true,
      overdue: v.overdue === true,
      week: v.week === true,
      labelIds: strings(v.labelIds),
      kindIds: strings(v.kindIds),
      assigneeId: typeof v.assigneeId === "string" ? v.assigneeId : "",
    };
  } catch {
    return EMPTY_FILTERS;
  }
}

/** Quita lo que ya no existe (etiqueta borrada, tipo oculto, persona que dejó el proyecto) para que no oculte tarjetas sin motivo visible. */
export function sanitizeFilters(f: BoardFilters, valid: { labels: Set<string>; kinds: Set<string>; users: Set<string> }): BoardFilters {
  const labelIds = f.labelIds.filter((id) => valid.labels.has(id));
  const kindIds = f.kindIds.filter((id) => valid.kinds.has(id));
  const assigneeId = f.assigneeId === NO_ASSIGNEE || valid.users.has(f.assigneeId) ? f.assigneeId : "";
  if (labelIds.length === f.labelIds.length && kindIds.length === f.kindIds.length && assigneeId === f.assigneeId) return f;
  return { ...f, labelIds, kindIds, assigneeId };
}

interface FilterContext {
  currentUserId: string;
  /** Hoy, YYYY-MM-DD. */
  today: string;
  /** Columnas terminadas (las tareas en ellas no están «vencidas»). */
  doneColumnIds: Set<string>;
}

/** Todos los filtros activos deben cumplirse (Y); dentro de etiquetas y de tipos basta uno (O). */
export function taskMatchesFilters(task: BoardTask, f: BoardFilters, ctx: FilterContext): boolean {
  if (f.mine && task.assigneeId !== ctx.currentUserId) return false;
  if (f.overdue && !(task.dueDate && task.dueDate < ctx.today && !ctx.doneColumnIds.has(task.columnId))) return false;
  if (f.week) {
    const { start, end } = weekBoundsIso(ctx.today);
    if (!task.dueDate || task.dueDate < start || task.dueDate > end) return false;
  }
  if (f.labelIds.length && !task.labelIds.some((id) => f.labelIds.includes(id))) return false;
  if (f.kindIds.length && !f.kindIds.includes(task.kindId)) return false;
  if (f.assigneeId === NO_ASSIGNEE ? task.assigneeId !== null : f.assigneeId !== "" && task.assigneeId !== f.assigneeId) return false;
  return true;
}
