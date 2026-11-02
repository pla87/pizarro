// Ordenado de la vista de lista del tablero: lógica pura, sin React (la prueba tests/list-sort.test.ts).
import { mentionsToPlain } from "@/lib/mentions";
import { TASK_PRIORITIES } from "@/lib/task-fields";
import type { BoardTask } from "@/lib/types";

export const LIST_SORT_KEYS = ["title", "column", "assignee", "due", "labels", "priority", "subtasks"] as const;
export type ListSortKey = (typeof LIST_SORT_KEYS)[number];
export type ListSortDir = "asc" | "desc";
export interface ListSort {
  key: ListSortKey;
  dir: ListSortDir;
}

/** Por defecto: el orden del tablero (columna y posición). */
export const DEFAULT_LIST_SORT: ListSort = { key: "column", dir: "asc" };

export interface ListSortContext {
  /** Posición de cada columna en el tablero. */
  columnPosition: ReadonlyMap<string, number>;
  userName: ReadonlyMap<string, string>;
  labelName: ReadonlyMap<string, string>;
  /** Locale de Intl («es-ES», «en-GB»…): decide cómo se ordenan los acentos. */
  locale: string;
}

type Key = string | number | null;

/** Orden del tablero: columna, posición dentro de ella y, si coincidieran, id (no depende del orden de entrada). */
function boardOrder(a: BoardTask, b: BoardTask, ctx: ListSortContext): number {
  const ca = ctx.columnPosition.get(a.columnId) ?? Number.MAX_SAFE_INTEGER;
  const cb = ctx.columnPosition.get(b.columnId) ?? Number.MAX_SAFE_INTEGER;
  if (ca !== cb) return ca - cb;
  if (a.columnId !== b.columnId) return a.columnId < b.columnId ? -1 : 1;
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Tareas ordenadas por una columna. Los valores vacíos (sin fecha, sin responsable, sin prioridad…) van siempre al
 * final, también en descendente; los empates se resuelven con el orden del tablero. Devuelve un array nuevo.
 */
export function sortTasks(tasks: readonly BoardTask[], sort: ListSort, ctx: ListSortContext): BoardTask[] {
  const collator = new Intl.Collator(ctx.locale, { sensitivity: "base", numeric: true });
  const sign = sort.dir === "desc" ? -1 : 1;
  const keyOf = (t: BoardTask): Key => {
    switch (sort.key) {
      case "title":
        return mentionsToPlain(t.title).trim() || null;
      case "column":
        return ctx.columnPosition.get(t.columnId) ?? null;
      case "assignee":
        return (t.assigneeId && ctx.userName.get(t.assigneeId)) || null;
      case "due":
        return t.dueDate;
      case "labels": {
        const names = t.labelIds.map((id) => ctx.labelName.get(id)).filter((n): n is string => !!n).sort(collator.compare);
        return names.length ? names.join(", ") : null;
      }
      case "priority": {
        const rank = t.priority ? TASK_PRIORITIES.indexOf(t.priority) : -1;
        return rank >= 0 ? rank : null;
      }
      case "subtasks":
        // Avance (hechas/total); sin subtareas, al final.
        return t.subtaskTotal > 0 ? t.subtaskDone / t.subtaskTotal : null;
    }
  };
  // Las claves se calculan una vez por tarea (no en cada comparación).
  const rows = tasks.map((task) => ({ task, key: keyOf(task) }));
  rows.sort((a, b) => {
    if (a.key === null || b.key === null) {
      if (a.key !== b.key) return a.key === null ? 1 : -1;
    } else if (a.key !== b.key) {
      let c = 0;
      if (typeof a.key === "number" && typeof b.key === "number") c = a.key - b.key;
      else if (typeof a.key === "string" && typeof b.key === "string") c = sort.key === "due" ? (a.key < b.key ? -1 : 1) : collator.compare(a.key, b.key);
      if (c !== 0) return c * sign;
    }
    // Empate (o sin criterio): el orden del tablero, siempre ascendente.
    return boardOrder(a.task, b.task, ctx);
  });
  return rows.map((r) => r.task);
}

/** Clic en una cabecera: otra columna empieza en ascendente; la misma alterna. */
export function nextSort(current: ListSort, key: ListSortKey): ListSort {
  return current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
}

export const ariaSortOf = (current: ListSort, key: ListSortKey): "ascending" | "descending" | "none" =>
  current.key !== key ? "none" : current.dir === "asc" ? "ascending" : "descending";

// --- Vista elegida (Tablero / Lista), recordada por proyecto en el navegador ---------------------------------

export type BoardView = "board" | "list";

export const viewStorageKey = (projectId: string): string => `pz:board-view:${projectId}`;

/** Valor de `?vista=`: «lista» o «tablero»; cualquier otra cosa (o nada) = null. */
export function parseViewParam(v: string | null | undefined): BoardView | null {
  return v === "lista" ? "list" : v === "tablero" ? "board" : null;
}

/** Lo guardado en localStorage; cualquier cosa rara = tablero. */
export function parseStoredView(raw: string | null | undefined): BoardView {
  return raw === "list" ? "list" : "board";
}
