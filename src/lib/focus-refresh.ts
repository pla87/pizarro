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
