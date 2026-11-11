// Caza de bugs (2): avisos de Telegram y WhatsApp en Ajustes y Mi perfil, mensajes del bot, informe semanal,
// máximo de comentarios y manifiesto de la app. Clave: texto exacto en español.
export const bh2: Record<string, string> = {
  // Administración → Ajustes → Telegram: guardado o activado, pero el webhook o el sondeo fallaron.
  "Bot @{bot} guardado, pero Telegram ha respondido con un error al prepararlo.": "Bot @{bot} saved, but Telegram replied with an error while setting it up.",
  "Avisos por Telegram activados, pero Telegram ha respondido con un error al preparar el bot.": "Telegram notices turned on, but Telegram replied with an error while setting up the bot.",
  "Avisos por Telegram desactivados, pero Telegram ha respondido con un error.": "Telegram notices turned off, but Telegram replied with an error.",
  // Administración → Ajustes → WhatsApp: la primera vez no se activa sola.
  "Configuración de WhatsApp guardada. Pulsa «Activar» para empezar a enviar avisos (de pago).": "WhatsApp settings saved. Press “Enable” to start sending notices (paid).",
  // Mi perfil → Avisos: la prueba falla porque el bot está bloqueado.
  "Telegram no deja enviarte mensajes (has bloqueado el bot o borrado el chat), así que se ha desconectado. Vuelve a conectarlo para recibir avisos.": "Telegram won't let us message you (you blocked the bot or deleted the chat), so it has been disconnected. Connect it again to get notices.",

  // Mensajes del bot de Telegram: la pestaña se llama Mi perfil → Avisos (en inglés, My profile → Notifications).
  "Hola. Soy el bot de avisos de Pizarro. Para recibir aquí tus avisos, pulsa «Conectar Telegram» en Pizarro, en Mi perfil → Avisos.": "Hi! I'm the Pizarro notices bot. To get your notices here, press “Connect Telegram” in Pizarro, under My profile → Notifications.",
  "Este enlace ha caducado o ya se ha usado. Vuelve a pulsar «Conectar Telegram» en Pizarro, en Mi perfil → Avisos.": "This link has expired or has already been used. Press “Connect Telegram” again in Pizarro, under My profile → Notifications.",
  "Soy el bot de avisos de Pizarro: no leo mensajes. Para conectar o desconectar los avisos, ve en Pizarro a Mi perfil → Avisos (o escribe /stop).": "I'm the Pizarro notices bot: I don't read messages. To connect or disconnect notices, go to My profile → Notifications in Pizarro (or type /stop).",

  // Ajustes del proyecto → Informe semanal: a quién puede ir (report-recipient.ts).
  "Hora de la app ({tz}). Vale la dirección de un miembro del proyecto, la de un administrador o una externa. El informe se genera con tus permisos, así que deja de enviarse si pierdes el acceso al proyecto.": "App time ({tz}). The address can be a project member's, an administrator's or an external one. The report is generated with your permissions, so it stops being sent if you lose access to the project.",
  "Hora de la app ({tz}). Vale la dirección de un miembro del proyecto o la de un administrador (una dirección externa solo puede ponerla un administrador). El informe se genera con tus permisos, así que deja de enviarse si pierdes el acceso al proyecto.": "App time ({tz}). The address must be a project member's or an administrator's (only an administrator can set an external address). The report is generated with your permissions, so it stops being sent if you lose access to the project.",
  "Hora de la app ({tz}). El proyecto es privado: solo vale la dirección de uno de sus miembros. El informe se genera con tus permisos, así que deja de enviarse si pierdes el acceso al proyecto.": "App time ({tz}). The project is private: the address must be one of its members'. The report is generated with your permissions, so it stops being sent if you lose access to the project.",

  // Comentarios: con el máximo en 1.
  "Esta tarea ya tiene el máximo de 1 comentario.": "This task already has the maximum of 1 comment.",

  // Manifiesto de la app instalable (descripción).
  "Kanban ligero y generador de release notes.": "Lightweight Kanban and release notes generator.",
};
