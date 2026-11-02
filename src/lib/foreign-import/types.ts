// Importación desde otros Kanban (Trello JSON y CSV genérico). Los lectores convierten el archivo en un tablero
// neutro (ForeignBoard) y un único creador (create.ts) lo guarda en la base de datos. Sin dependencias de Node.
import type { TaskPriorityValue } from "../task-fields";

export type ForeignFormat = "trello" | "csv";

/** Etiqueta del tablero de origen: el color ya está aproximado a la paleta de la aplicación (null = sin color). */
export interface ForeignLabel {
  name: string;
  color: string | null;
}

export interface ForeignPerson {
  email: string | null;
  name: string | null;
}

export interface ForeignTask {
  title: string;
  /** Markdown ya saneado. */
  description: string;
  /** Índice en `ForeignBoard.columns`; null = la primera columna. */
  column: number | null;
  archived: boolean;
  /** Fecha límite (día, YYYY-MM-DD). */
  due: string | null;
  labels: ForeignLabel[];
  subtasks: { title: string; done: boolean }[];
  /** Comentarios con el autor original ya citado en el texto; la fecha original se conserva si se conoce. */
  comments: { body: string; createdAt: Date | null }[];
  priority: TaskPriorityValue | null;
  /** Responsables del origen; solo se asignan los que coincidan con un usuario que ya existe. */
  assignees: ForeignPerson[];
}

export interface ForeignBoard {
  name: string;
  /** Descripción del tablero (Markdown saneado; puede ir vacía). */
  description: string;
  /** Nombres de columna en orden (vacío = columnas por defecto de la aplicación). */
  columns: string[];
  tasks: ForeignTask[];
  /** Cosas que no se pudieron importar, ya traducidas. */
  warnings: string[];
}

/** Topes de la aplicación que también valen para lo importado. */
export const FOREIGN_LIMITS = {
  columns: 30,
  /** Igual que MAX_ACTIVE_TASKS_PER_PROJECT. */
  activeTasks: 1000,
  archivedTasks: 5000,
  labels: 50,
  labelName: 40,
  columnName: 80,
  subtasksPerTask: 50,
  commentsPerTask: 200,
  commentBody: 10_000,
  /** Filas de un CSV (activas + archivadas), para no procesar un archivo absurdo. */
  csvRows: 6000,
  /** Tamaño máximo de un JSON o CSV de otro Kanban (bytes). */
  maxBytes: 50 * 1024 * 1024,
} as const;
