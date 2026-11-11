// Cola de avisos (Toast.tsx), aparte para poder probarla sin React.

/** Avisos visibles a la vez como mucho. */
export const MAX_TOASTS = 4;

/**
 * Añade un aviso al final y, si pasan de MAX_TOASTS, quita los más antiguos salvo `pinnedId` (el de sesión caducada:
 * es lo único que lleva a volver a entrar sin perder lo escrito, y su referencia sigue viva mientras dura).
 */
export function pushToast<T extends { id: number }>(prev: readonly T[], item: T, pinnedId?: number | null): T[] {
  const next = [...prev, item];
  while (next.length > MAX_TOASTS) {
    const i = next.findIndex((x) => x.id !== pinnedId);
    if (i < 0) break;
    next.splice(i, 1);
  }
  return next;
}
