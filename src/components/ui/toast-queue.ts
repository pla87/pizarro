// Cola de avisos (Toast.tsx), aparte para poder probarla sin React.

/** Avisos visibles a la vez como mucho. */
export const MAX_TOASTS = 4;

/**
 * Añade un aviso al final y, si pasan de MAX_TOASTS, quita los más antiguos salvo `pinnedId` (el de sesión caducada:
 * es lo único que lleva a volver a entrar sin perder lo escrito, y su referencia sigue viva mientras dura).
 */
export function pushToast<T extends { id: number }>(prev: readonly T[], item: T, pinnedId?: number | null, max = MAX_TOASTS): T[] {
  return trimToasts([...prev, item], pinnedId, max);
}

/** Quita los más antiguos (salvo `pinnedId`) hasta que queden `max`. Con el ratón encima de la pila no se recorta (Toast.tsx). */
export function trimToasts<T extends { id: number }>(items: readonly T[], pinnedId?: number | null, max = MAX_TOASTS): T[] {
  const next = [...items];
  while (next.length > max) {
    const i = next.findIndex((x) => x.id !== pinnedId);
    if (i < 0) break;
    next.splice(i, 1);
  }
  return next;
}

/**
 * Cuánto dura un aviso: los errores y los que llevan botón, 6 s; los de deshacer con botón («Deshacer»), 10 s, para que
 * dé tiempo a leerlos y pulsarlo (con 6 s se iban antes de llegar con el ratón); los demás, 2,5 s.
 */
export function toastMs(kind: "success" | "error" | "undo" | "info", hasAction: boolean): number {
  if (kind === "undo" && hasAction) return 10000;
  return kind === "error" || hasAction ? 6000 : 2500;
}

/** Lo que la cola necesita saber de un aviso para «Deshacer» y para los que se actualizan solos. */
interface QueueItem {
  id: number;
  kind: "success" | "error" | "undo" | "info";
  /** Con botón «Deshacer» (u otro). `independent`: deshace algo suyo, no lo último hecho (no lo anula uno posterior). */
  action?: { independent?: boolean };
  /** El botón ya no sirve: llegó después otro aviso con «Deshacer» (ver supersedeUndo). */
  stale?: boolean;
  /** Avisos que se sustituyen unos a otros en su sitio (p. ej. mover una columna con Alt+flechas): ver placeToast. */
  group?: string;
}

/**
 * Llega `item`. Si trae «Deshacer», los avisos anteriores con «Deshacer» (salvo los `independent`) quedan anulados
 * (`stale`): el servidor solo deshace desde un aviso lo último que se hizo, y pulsar el antiguo daba un error confuso.
 * Si es de un grupo (`group`) y ya hay uno de ese grupo a la vista, ocupa su sitio (no se apilan, no se mueve nada); si
 * no, va al final y, con más de `max`, se van los más antiguos (salvo `pinnedId`).
 */
export function placeToast<T extends QueueItem>(prev: readonly T[], item: T, pinnedId?: number | null, max = MAX_TOASTS): T[] {
  const undo = item.kind === "undo" && !!item.action;
  const base = undo ? prev.map((x) => (x.kind === "undo" && x.action && !x.action.independent && !x.stale ? { ...x, stale: true } : x)) : [...prev];
  const at = item.group ? base.findIndex((x) => x.group === item.group) : -1;
  if (at >= 0) {
    base[at] = item;
    return base;
  }
  return pushToast(base, item, pinnedId, max);
}
