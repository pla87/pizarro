// Cuándo refrescar el tablero al volver a la ventana o pestaña (foco / visibilidad). Antes cada vez que la ventana
// recuperaba el foco se recargaba el tablero entero desde el servidor; ahora se espacia:
//  - Canal en vivo (SSE) conectado y sin cortes desde la última sincronización: el servidor ya avisa de cada cambio,
//    así que basta una comprobación de respaldo cada 5 minutos.
//  - Sin canal en vivo (no soportado o aún sin conectar): como mucho una vez por minuto.
//  - Canal sano y, además, al día según su `ping` (ver LIVE_CHECKED_REFRESH_MS): solo la recarga de seguridad (1 hora).
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
  /** ¿El último `ping` (o saludo) confirmó hace poco que no se ha perdido ningún aviso? (ver `cursorChecked`) */
  upToDate?: boolean;
}

export function shouldRefreshOnFocus({ sinceSyncMs, channelOpen, channelGap, upToDate = false }: FocusRefreshInput): boolean {
  if (channelGap) return sinceSyncMs >= FOCUS_REFRESH_GAP_MS;
  if (channelOpen && upToDate) return sinceSyncMs >= LIVE_CHECKED_REFRESH_MS;
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

/**
 * ¿Canal abierto pero mudo? Abierto y sin ningún mensaje (ni el `ping` periódico) en el tiempo en que cuenta como sano: lo
 * deja así un proxy que no deja pasar nada, sin que el navegador dé error. Entonces se da por caído y se reabre.
 */
export function channelStalled({ open, sinceMessageMs }: { open: boolean; sinceMessageMs: number }): boolean {
  return open && !channelHealthy({ open, sinceMessageMs });
}

// Canal sano y al día: el `ping` lleva también la posición del proyecto en el canal (`{ boot, seq }`, como el saludo) y la
// pestaña la compara con la suya (missedByPing, remoteChange.ts). Si se perdió algo, recarga en el acto; si coincide, no
// hace falta la recarga de 15 minutos ni la de volver a la ventana: queda una de seguridad cada hora, que cubre lo que el
// número no ve (un cambio que no se anuncia por el canal, un parche de tarjetas que no casó del todo, un fallo raro). Con
// un servidor anterior (ping sin posición) nunca se da por al día y siguen los plazos de antes.
export const LIVE_CHECKED_REFRESH_MS = 60 * 60_000;

/**
 * ¿Confirmó un mensaje del canal, hace poco, que la pestaña está al día? `sinceCheckMs`: desde el último `ping` (o saludo)
 * cuya posición coincidía con la de la pestaña (Infinity si ninguno). Mismo margen que «sano»: si deja de llegar un ping
 * con posición (servidor anterior tras un despliegue, proxy), al minuto se vuelve a los plazos normales.
 */
export function cursorChecked({ sinceCheckMs }: { sinceCheckMs: number }): boolean {
  return sinceCheckMs < LIVE_HEALTHY_MS;
}

/** ¿Toca la recarga de respaldo? */
export function backupRefreshDue({ sinceSyncMs, healthy, upToDate = false }: { sinceSyncMs: number; healthy: boolean; upToDate?: boolean }): boolean {
  if (healthy && upToDate) return sinceSyncMs >= LIVE_CHECKED_REFRESH_MS;
  return sinceSyncMs >= (healthy ? BACKUP_REFRESH_LIVE_MS : BACKUP_REFRESH_MS);
}
