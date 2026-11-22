/** Tope del recuento de avisos sin leer: a partir de 100 la interfaz dice «99+» o «Más de 99 sin leer» y no se cuenta más. */
export const UNREAD_COUNT_CAP = 100;

const UNREAD_EVENT = "pz:unread";

/**
 * Avisa a la cabecera (AppShell) del recuento de sin leer que acaba de dar el servidor (al leer un aviso o «Marcar todo
 * como leído»): lo pone tal cual en el contador y en la insignia de la app, sin volver a pedir la página. Es el número
 * real (con el tope de 100), no un decremento hecho aquí: así no se desincroniza con otra pestaña ni con más de 100.
 */
export function announceUnreadCount(count: number): void {
  window.dispatchEvent(new CustomEvent<number>(UNREAD_EVENT, { detail: count }));
}

export function onUnreadCount(cb: (count: number) => void): () => void {
  const handler = (e: Event) => {
    const n = (e as CustomEvent<unknown>).detail;
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) cb(Math.min(Math.floor(n), UNREAD_COUNT_CAP));
  };
  window.addEventListener(UNREAD_EVENT, handler);
  return () => window.removeEventListener(UNREAD_EVENT, handler);
}

/**
 * Solo vale la respuesta de la última petición: con dos avisos leídos seguidos, la del primero puede llegar después
 * que la del segundo con un número ya viejo (uno más). `next()` numera cada petición; `isLatest(n)`, si es la última.
 */
export function latestOnly(): { next: () => number; isLatest: (n: number) => boolean } {
  let last = 0;
  return { next: () => ++last, isLatest: (n) => n === last };
}
