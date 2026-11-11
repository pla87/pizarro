// Mi perfil → Avisos → Conectar Telegram: mientras se espera a que la persona pulse «Iniciar», la pantalla pregunta cada
// pocos segundos por sus canales (myChannels). Si el administrador cambia o quita el bot, o se pide otro enlace desde otra
// pestaña, el código de este enlace se borra y ya no puede conectar nada: hay que dejar de esperar y avisar (antes se
// seguía esperando los 10 minutos del enlace).

export interface TelegramWaitLink {
  /** Bot al que lleva el enlace. */
  bot: string;
  /** Caducidad del código del enlace (ISO): identifica el código pendiente. */
  expiresAt: string;
}

export interface TelegramWaitView {
  available: boolean;
  botUsername: string;
  connected: boolean;
  /** Caducidad (ISO) del código de enlace pendiente de la persona, o null si no tiene ninguno. */
  linkExpiresAt: string | null;
}

/**
 * Qué hacer tras una consulta: «connected» (ya está), «waiting» (seguir), «stale» (el código ya no existe o es otro:
 * puede ser el instante en que se gasta, así que conviene confirmarlo en la siguiente consulta) o «botChanged» (el bot
 * es otro o se ha desactivado: dejar de esperar ya).
 */
export function telegramWaitState(link: TelegramWaitLink, view: TelegramWaitView | null | undefined): "connected" | "waiting" | "stale" | "botChanged" {
  if (view?.connected) return "connected";
  if (!view?.available || view.botUsername !== link.bot) return "botChanged";
  return view.linkExpiresAt === link.expiresAt ? "waiting" : "stale";
}
