// Lo mínimo del formato JSON de las tareas (lib/task-json.ts) que necesitan los componentes que no leen tareas: los
// marcadores de formato, los topes de tamaño y la comprobación estricta de Ctrl+V. Sin imports: así el tablero no arrastra
// la lectura tolerante, los importadores de otros Kanban ni los diccionarios hasta que hace falta. task-json.ts lo reexporta.

export const TASK_JSON_FORMAT = "pizarro.task";
export const TASKS_JSON_FORMAT = "pizarro.tasks";
/** Tamaño máximo del texto que se intenta leer como UNA tarea (una descripción llena y 100 subtareas caben de sobra). */
export const TASK_JSON_MAX_CHARS = 200_000;
/** Tamaño máximo del texto que se lee al importar varias tareas (también lo comprueba el servidor). */
export const TASKS_TEXT_MAX_CHARS = 5_000_000;

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Ctrl+V estricto: el formato del texto si es EXACTAMENTE un objeto JSON con `"format": "pizarro.task"` (o
 * «pizarro.tasks», con su lista `tasks`), sin bloque ```, sin texto alrededor (salvo espacios y la marca BOM) y sin ser una
 * lista; si no, null y el pegado sigue su curso. La importación con los botones es la tolerante (parseTasksText).
 */
export function strictJsonFormat(raw: string): "pizarro.task" | "pizarro.tasks" | null {
  if (typeof raw !== "string" || raw.length > TASKS_TEXT_MAX_CHARS) return null;
  const s = raw.replace(/^﻿/, "").trim();
  if (s.charCodeAt(0) !== 123 || s.charCodeAt(s.length - 1) !== 125) return null;
  let v: unknown;
  try {
    v = JSON.parse(s);
  } catch {
    return null;
  }
  if (!isObject(v)) return null;
  if (v.format === TASK_JSON_FORMAT) return s.length <= TASK_JSON_MAX_CHARS ? TASK_JSON_FORMAT : null;
  if (v.format === TASKS_JSON_FORMAT && Array.isArray(v.tasks)) return TASKS_JSON_FORMAT;
  return null;
}
