import { getTaskDetail } from "@/actions/tasks";

// El detalle de una tarea se pide al hacer clic en la tarjeta, sin esperar a que el diálogo monte y cargue.
// El diálogo recoge ese resultado si es de la misma tarea y reciente; se usa una sola vez (no se reutiliza
// un detalle ya visto, que pudo cambiar mientras tanto) y evita pedirlo dos veces.
const MAX_AGE_MS = 5000;
type Detail = ReturnType<typeof getTaskDetail>;
let entry: { id: string; at: number; promise: Detail } | null = null;

export function prefetchTaskDetail(id: string): void {
  if (entry && entry.id === id && Date.now() - entry.at < MAX_AGE_MS) return;
  entry = { id, at: Date.now(), promise: getTaskDetail(id) };
  // Un fallo de red lo trata quien lo recoja; sin nadie, no queda una promesa rechazada sin atender.
  entry.promise.catch(() => {});
}

/** La petición adelantada de esta tarea si sigue fresca (se consume); si no, null y se pide de nuevo. */
export function takePrefetchedTaskDetail(id: string): Detail | null {
  const e = entry;
  entry = null;
  return e && e.id === id && Date.now() - e.at < MAX_AGE_MS ? e.promise : null;
}
