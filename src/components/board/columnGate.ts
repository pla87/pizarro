import type { ColumnRoleValue } from "@/lib/constants";
import type { BoardTask } from "@/lib/types";
import type { Store } from "./stores";

/**
 * Por qué no se puede usar la acción de una columna Lista de comprobación o Agenda («Ver lista», «Exportar a calendario»):
 * sin tarjetas, o sin ninguna con lo que la acción necesita (subtareas, fecha límite). Un código, no el texto: es un
 * valor primitivo, así que sirve de instantánea para useSyncExternalStore (solo cambia cuando cambia el motivo).
 */
export type ColumnGate = "empty" | "noDueDate" | "noSubtasks";

type GateTask = Pick<BoardTask, "columnId" | "dueDate" | "subtaskTotal">;

/** El motivo (o null si la acción se puede usar). `cardCount`: tarjetas que se ven en la columna. */
export function columnGate(tasks: readonly GateTask[], columnId: string, role: ColumnRoleValue, cardCount: number): ColumnGate | null {
  if (cardCount === 0) return "empty";
  if (role === "AGENDA") return tasks.some((x) => x.columnId === columnId && x.dueDate) ? null : "noDueDate";
  if (role === "CHECKLIST") return tasks.some((x) => x.columnId === columnId && x.subtaskTotal > 0) ? null : "noSubtasks";
  return null;
}

// Una pasada por lista de tareas y columna (la lista es inmutable): React pide la instantánea en cada dibujo y en cada
// cambio del almacén, y con dos botones por columna (el de la cabecera y el del menú) se repetiría el recorrido.
const cache = new WeakMap<readonly GateTask[], Map<string, ColumnGate | null>>();

/**
 * Instantánea para useSyncExternalStore sobre el almacén de tareas: devuelve el mismo valor mientras no cambie el motivo de
 * ESA columna, así que quien se suscribe no se redibuja cuando cambia una tarea de otra columna (ni una de la suya, si el
 * motivo sigue igual).
 */
export function columnGateSnapshot(store: Pick<Store<BoardTask[]>, "get">, columnId: string, role: ColumnRoleValue, cardCount: number): () => ColumnGate | null {
  return () => {
    if (cardCount === 0) return "empty";
    const tasks = store.get();
    let byColumn = cache.get(tasks);
    if (!byColumn) cache.set(tasks, (byColumn = new Map()));
    const key = `${role}:${columnId}`;
    let gate = byColumn.get(key);
    if (gate === undefined) byColumn.set(key, (gate = columnGate(tasks, columnId, role, cardCount)));
    return gate;
  };
}
