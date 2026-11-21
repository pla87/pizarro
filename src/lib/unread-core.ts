/** Tope del recuento de avisos sin leer: a partir de 100 la interfaz dice «99+» o «Más de 99 sin leer» y no se cuenta más. */
export const UNREAD_COUNT_CAP = 100;

/** Avisos marcados como leídos en esta pestaña: `read` de ellos o todos. */
export type UnreadChange = { read: number } | { all: true };

/**
 * Recuento de la cabecera tras marcar avisos como leídos en el navegador, sin volver a pedir la página. En el tope no se
 * sabe cuántos hay de verdad (puede haber 150): se queda en el tope hasta que el servidor dé otro número.
 */
export function applyUnreadChange(count: number, change: UnreadChange): number {
  if ("all" in change) return 0;
  if (count >= UNREAD_COUNT_CAP) return count;
  return Math.max(0, count - change.read);
}

const UNREAD_EVENT = "pz:unread";

/** Avisa a la cabecera (AppShell) de que se han leído avisos aquí: baja el contador y la insignia de la app. */
export function announceUnreadChange(change: UnreadChange): void {
  window.dispatchEvent(new CustomEvent<UnreadChange>(UNREAD_EVENT, { detail: change }));
}

export function onUnreadChange(cb: (change: UnreadChange) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<UnreadChange>).detail);
  window.addEventListener(UNREAD_EVENT, handler);
  return () => window.removeEventListener(UNREAD_EVENT, handler);
}
