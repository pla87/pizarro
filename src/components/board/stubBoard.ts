import type { EditorModeValue, ProjectFormData } from "@/lib/types";
import type { BoardApi } from "./context";
import { createBoardStores } from "./stores";

/** Un «tablero» mínimo para los diálogos de tareas fuera del tablero: las opciones del proyecto y nada de tarjetas. */
export function stubBoard(form: ProjectFormData, currentUserId: string, editorMode: EditorModeValue): BoardApi {
  const noop = () => {};
  const passthrough = <T,>(p: Promise<T>) => p;
  const stores = createBoardStores([]);
  return {
    project: form.project,
    users: form.users,
    currentUserId,
    columns: form.columns,
    labels: form.labels,
    deliverables: form.deliverables,
    kinds: form.kinds,
    kindById: new Map(form.kinds.map((k) => [k.id, k])),
    cardStyle: "STRIPE",
    editorMode,
    dragHandle: false,
    google: { enabled: false, connected: false },
    today: "",
    stores,
    getTask: () => undefined,
    getTasks: () => [],
    upsertTask: noop,
    patchTask: noop,
    removeTask: noop,
    revealTask: noop,
    track: passthrough,
    trackRaw: passthrough,
    settle: async () => {},
    refresh: noop,
  } as unknown as BoardApi;
}
