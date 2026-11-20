// Cuándo refrescar el tablero al volver a la ventana o pestaña (foco / visibilidad). Antes cada vez que la ventana
// recuperaba el foco se recargaba el tablero entero desde el servidor; ahora se espacia:
//  - Canal en vivo (SSE) conectado y sin cortes desde la última sincronización: el servidor ya avisa de cada cambio,
//    así que basta una comprobación de respaldo cada 5 minutos.
//  - Sin canal en vivo (no soportado o aún sin conectar): como mucho una vez por minuto.
//  - El canal estuvo desconectado desde la última sincronización (se pudieron perder avisos): se refresca al volver,
//    con una pausa mínima de 10 s para que una conexión inestable no provoque una cadena de recargas.

export const FOCUS_REFRESH_MIN_MS = 60_000;
export const FOCUS_REFRESH_LIVE_MS = 5 * 60_000;
export const FOCUS_REFRESH_GAP_MS = 10_000;

interface FocusRefreshInput {
  /** Milisegundos desde que los datos del tablero se pidieron o llegaron por última vez. */
  sinceSyncMs: number;
  /** ¿El canal en vivo está abierto ahora mismo? */
  channelOpen: boolean;
  /** ¿El canal se cortó desde la última sincronización (avisos que pudieron perderse)? */
  channelGap: boolean;
}

export function shouldRefreshOnFocus({ sinceSyncMs, channelOpen, channelGap }: FocusRefreshInput): boolean {
  if (channelGap) return sinceSyncMs >= FOCUS_REFRESH_GAP_MS;
  return sinceSyncMs >= (channelOpen ? FOCUS_REFRESH_LIVE_MS : FOCUS_REFRESH_MIN_MS);
}

// Recarga de respaldo periódica (con la pestaña a la vista y sin diálogos ni acciones en curso). El servidor manda un
// evento `ping` por el canal cada 25 s: si llegó uno (o cualquier otro mensaje) hace menos de LIVE_HEALTHY_MS, el canal
// está sano y los cambios ya llegan al momento, así que basta una recarga cada 15 minutos. Sin canal, o con el canal
// caído o mudo (un proxy que lo deja abierto sin pasar nada), cada 2 minutos, como antes.
export const BACKUP_REFRESH_MS = 2 * 60_000;
export const BACKUP_REFRESH_LIVE_MS = 15 * 60_000;
export const LIVE_HEALTHY_MS = 60_000;
/** Cada cuánto se mira si toca la recarga de respaldo. */
export const BACKUP_CHECK_MS = 30_000;

/** ¿El canal en vivo está sano? Abierto y con un mensaje del servidor hace menos de un minuto. */
export function channelHealthy({ open, sinceMessageMs }: { open: boolean; sinceMessageMs: number }): boolean {
  return open && sinceMessageMs < LIVE_HEALTHY_MS;
}

/** ¿Toca la recarga de respaldo? */
export function backupRefreshDue({ sinceSyncMs, healthy }: { sinceSyncMs: number; healthy: boolean }): boolean {
  return sinceSyncMs >= (healthy ? BACKUP_REFRESH_LIVE_MS : BACKUP_REFRESH_MS);
}
