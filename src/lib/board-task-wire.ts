import type { BoardTask } from "./types";

// Tarjetas del tablero tal como viajan al navegador (la página del tablero y el refresco de tarjetas sueltas): sin los
// campos que valen null, [], 0, false o su valor por defecto, que en un tablero normal son la mayoría (sin color, sin
// enlace, sin plazo, sin campos opcionales, sin contadores…). Con 1.000 tarjetas son unos 40 % menos de datos que el
// navegador tiene que leer al abrir el tablero. Al llegar, unpackBoardTask devuelve la tarjeta completa: el resto del
// cliente (tarjeta, detalle, búsqueda, filtros, lista, exportar) sigue leyendo un BoardTask con todos sus campos.

/** Campos que siempre viajan (los demás se omiten si valen lo de BOARD_TASK_DEFAULTS). */
type RequiredKey = "id" | "columnId" | "title" | "kindId" | "position" | "columnEnteredAt";
type OptionalKey = Exclude<keyof BoardTask, RequiredKey>;

/** Tarjeta del tablero en el envío: los campos opcionales que faltan valen lo de BOARD_TASK_DEFAULTS. */
export type BoardTaskWire = Pick<BoardTask, RequiredKey> & Partial<Pick<BoardTask, OptionalKey>>;

/** Valor de cada campo cuando no viaja. Todos los de BoardTask salvo los obligatorios (lo comprueba el tipo). */
const BOARD_TASK_DEFAULTS: { readonly [K in OptionalKey]-?: Exclude<BoardTask[K], undefined> } = {
  color: null,
  linkUrl: null,
  assigneeId: null,
  labelIds: [],
  subtaskTotal: 0,
  subtaskDone: 0,
  imageCount: 0,
  fileCount: 0,
  attachBytes: 0,
  hasDescription: false,
  dueDate: null,
  deliverableId: null,
  commentCount: 0,
  linkCount: 0,
  evergreen: false,
  evergreenEvery: 1,
  recurrence: "NONE",
  recurrenceDay: null,
  textVersion: null,
  blockedBy: null,
  cost: null,
  costPaid: false,
  estimatedHours: null,
  actualHours: null,
  priority: null,
  client: null,
  startDate: null,
};
const OPTIONAL_KEYS = Object.keys(BOARD_TASK_DEFAULTS) as OptionalKey[];

/** ¿El valor es el de por defecto? (las listas, vacías). */
function isDefault(key: OptionalKey, value: unknown): boolean {
  if (value === undefined) return true;
  const fallback = BOARD_TASK_DEFAULTS[key];
  return Array.isArray(fallback) ? Array.isArray(value) && value.length === 0 : value === fallback;
}

/** La tarjeta sin los campos que valen lo de por defecto (en el servidor, antes de enviarla). */
export function packBoardTask(task: BoardTask): BoardTaskWire {
  const out: Record<string, unknown> = { id: task.id, columnId: task.columnId, title: task.title, kindId: task.kindId, position: task.position, columnEnteredAt: task.columnEnteredAt };
  for (const key of OPTIONAL_KEYS) {
    const value = task[key];
    if (!isDefault(key, value)) out[key] = value;
  }
  return out as BoardTaskWire;
}

/**
 * La tarjeta completa a partir de la enviada (en el navegador, al llegar). Siempre con todos los campos, como la que
 * devuelven las acciones (loadBoardTask): sameTask compara también cuántos campos tiene.
 */
export function unpackBoardTask(wire: BoardTaskWire): BoardTask {
  // Una lista nueva por tarjeta: nadie debe compartir la de los valores por defecto.
  return { ...BOARD_TASK_DEFAULTS, labelIds: [], ...wire } as BoardTask;
}
