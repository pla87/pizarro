// Avisos por Telegram y WhatsApp: Administración → Ajustes, Mi perfil → Avisos, mensajes del bot y errores.
export const mensajeria: Record<string, string> = {
  // Mensajes que se envían por Telegram y WhatsApp
  "Mensaje de prueba de Pizarro": "Pizarro test message",
  "Si lo lees, los avisos por Telegram funcionan.": "If you can read this, Telegram notices are working.",
  "Mensaje de prueba de Pizarro: si lo lees, los avisos por WhatsApp funcionan": "Pizarro test message: if you can read this, WhatsApp notices are working",
  "Listo, {name}: a partir de ahora recibirás aquí tus avisos de Pizarro. Para dejar de recibirlos, escribe /stop o desconéctalo en Mi perfil → Avisos.": "Done, {name}: from now on you'll get your Pizarro notices here. To stop them, type /stop or disconnect it in My profile → Notifications.",
  "Hecho: ya no recibirás avisos de Pizarro aquí. Puedes volver a conectarte desde Mi perfil → Avisos.": "Done: you won't get Pizarro notices here any more. You can connect again from My profile → Notifications.",
  "Este chat no está conectado a ninguna cuenta de Pizarro.": "This chat isn't connected to any Pizarro account.",

  // Administración → Ajustes
  "3. Avisos por Telegram y WhatsApp": "3. Telegram and WhatsApp notices",
  "Los avisos también en el móvil. Telegram es gratis; WhatsApp lo cobra Meta por mensaje.": "Notifications on your phone too. Telegram is free; Meta charges for each WhatsApp message.",
  "Bot @{bot} guardado y activado.": "Bot @{bot} saved and turned on.",
  "Has cambiado de bot: cada persona tiene que volver a conectar Telegram.": "You changed bots: everyone has to connect Telegram again.",
  "Avisos por Telegram activados.": "Telegram notices turned on.",
  "Avisos por Telegram desactivados.": "Telegram notices turned off.",
  "El bot @{bot} responde y te ha enviado un mensaje de prueba.": "Bot @{bot} answers and has sent you a test message.",
  "El bot @{bot} responde. Conecta tu Telegram en Mi perfil → Avisos para recibir un mensaje de prueba.": "Bot @{bot} answers. Connect your Telegram in My profile → Notifications to get a test message.",
  "¿Quitar el bot? Se borrará el token y todas las personas dejarán de recibir avisos por Telegram.": "Remove the bot? The token will be deleted and nobody will get Telegram notices any more.",
  "Bot de Telegram quitado.": "Telegram bot removed.",
  "Telegram avisa a Pizarro al instante en {url}.": "Telegram notifies Pizarro instantly at {url}.",
  "Falta APP_URL en el servidor: Pizarro preguntará a Telegram cada pocos segundos. Los enlaces de los avisos necesitan APP_URL.": "APP_URL is missing on the server: Pizarro will ask Telegram every few seconds. The links in notices need APP_URL.",
  "Pizarro pregunta a Telegram cada pocos segundos; funciona igual.": "Pizarro asks Telegram every few seconds; it works the same.",
  "Telegram (gratis)": "Telegram (free)",
  "Activo: bot @{bot}. {n} persona(s) conectada(s).": "On: bot @{bot}. {n} person(s) connected.",
  "Desactivado: el bot @{bot} está guardado, pero no se envían avisos.": "Off: bot @{bot} is saved, but no notices are sent.",
  "Inactivo: crea un bot y pega aquí su token.": "Inactive: create a bot and paste its token here.",
  "Telegram ha respondido con un error:": "Telegram replied with an error:",
  "Cómo crear el bot (2 minutos)": "How to create the bot (2 minutes)",
  "En Telegram, abre @BotFather y escribe /newbot.": "In Telegram, open @BotFather and type /newbot.",
  "Elige un nombre (p. ej. «Avisos de Pizarro») y un usuario que termine en «bot» (p. ej. pizarro_avisos_bot).": "Choose a name (e.g. “Pizarro notices”) and a username ending in “bot” (e.g. pizarro_notices_bot).",
  "BotFather te da un token del tipo 123456789:AA…; cópialo y pégalo aquí.": "BotFather gives you a token like 123456789:AA…; copy it and paste it here.",
  "Pulsa «Guardar y activar» y después «Probar».": "Press “Save and turn on” and then “Test”.",
  "Token del bot": "Bot token",
  "configurado (…{last4})": "set (…{last4})",
  "configurado": "set",
  "Guardar y activar": "Save and turn on",
  "Probar": "Test",
  "Quitar el bot": "Remove the bot",
  "El token se guarda cifrado y no se vuelve a mostrar.": "The token is stored encrypted and never shown again.",
  "Configuración de WhatsApp guardada.": "WhatsApp settings saved.",
  "Avisos por WhatsApp activados.": "WhatsApp notices turned on.",
  "Avisos por WhatsApp desactivados.": "WhatsApp notices turned off.",
  "Vacío = {value} (variable {name} del servidor)": "Empty = {value} (server variable {name})",
  "WhatsApp (de pago, Cloud API de Meta)": "WhatsApp (paid, Meta Cloud API)",
  "Activo: {n} persona(s) conectada(s) y {p} pendiente(s) de confirmar su número.": "On: {n} person(s) connected and {p} still to confirm their number.",
  "Desactivado: la configuración está completa, pero no se envían avisos.": "Off: the settings are complete, but no notices are sent.",
  "Inactivo: faltan el token, el identificador del número o la plantilla.": "Inactive: the token, the phone number ID or the template is missing.",
  "Meta cobra cada aviso entregado (plantilla de utilidad: unos céntimos por mensaje según el país).": "Meta charges for each delivered notice (utility template: a few cents per message depending on the country).",
  "Precios de Meta": "Meta pricing",
  "Usas la plantilla antigua mencion_pizarro: solo se envían menciones. Crea aviso_pizarro (abajo) para enviar todos los tipos de aviso.": "You're using the old mencion_pizarro template: only mentions are sent. Create aviso_pizarro (below) to send every kind of notice.",
  "Qué necesitas de Meta": "What you need from Meta",
  "Una app de tipo Empresa en developers.facebook.com con el producto WhatsApp y un número de teléfono.": "A Business app on developers.facebook.com with the WhatsApp product and a phone number.",
  "Un token permanente de un usuario del sistema (Configuración del negocio → Usuarios del sistema) con el permiso whatsapp_business_messaging.": "A permanent token from a system user (Business settings → System users) with the whatsapp_business_messaging permission.",
  "El identificador del número (Phone number ID) de WhatsApp → Configuración de la API.": "The Phone number ID from WhatsApp → API Setup.",
  "Una plantilla de categoría Utilidad llamada aviso_pizarro, aprobada, con este texto exacto:": "An approved Utility template named aviso_pizarro with exactly this text:",
  "Español (es)": "Spanish (es)",
  "Inglés (en), opcional": "English (en), optional",
  "Token de acceso": "Access token",
  "Vacío = variable WHATSAPP_TOKEN del servidor": "Empty = server variable WHATSAPP_TOKEN",
  "Identificador del número (Phone number ID)": "Phone number ID",
  "Nombre de la plantilla": "Template name",
  "Idioma": "Language",
  "Idioma en inglés": "English language",
  "opcional, p. ej. en": "optional, e.g. en",
  "Lo que guardas aquí manda; los campos vacíos usan las variables WHATSAPP_* del servidor, si las hay.": "What you save here takes precedence; empty fields use the server's WHATSAPP_* variables, if any.",
  "Número para la prueba": "Number for the test",

  // Mi perfil → Avisos
  "Siempre salen en la campana de avisos; además, puedes recibirlas por email:": "They always show in the notification bell; you can also get them by email:",
  "Avisos en el móvil: Telegram y WhatsApp": "Notices on your phone: Telegram and WhatsApp",
  "Recibe tus avisos en el móvil. En cada canal eliges qué avisos quieres; por defecto, solo menciones y asignaciones.": "Get your notices on your phone. For each channel you choose which notices you want; by default, only mentions and assignments.",
  "Telegram conectado.": "Telegram connected.",
  "El administrador ha desactivado los avisos por Telegram: ahora no te llegarán.": "The administrator has turned off Telegram notices: you won't get them for now.",
  "Conectado como {name}.": "Connected as {name}.",
  "Conectado.": "Connected.",
  "Abre el enlace en el móvil (o escanea el código con la cámara) y pulsa «Iniciar» en Telegram. El enlace sirve una sola vez y caduca en 10 minutos.": "Open the link on your phone (or scan the code with the camera) and press “Start” in Telegram. The link works only once and expires in 10 minutes.",
  "Código QR para conectar Telegram": "QR code to connect Telegram",
  "Abrir Telegram": "Open Telegram",
  "Esperando a que pulses «Iniciar»…": "Waiting for you to press “Start”…",
  "Gratis. Necesitas la app de Telegram en el móvil o en el ordenador.": "Free. You need the Telegram app on your phone or computer.",
  "Conectar Telegram": "Connect Telegram",
  "Número guardado.": "Number saved.",
  "WhatsApp conectado.": "WhatsApp connected.",
  "El administrador ha desactivado los avisos por WhatsApp: ahora no te llegarán.": "The administrator has turned off WhatsApp notices: you won't get them for now.",
  "Acepto recibir avisos de Pizarro por WhatsApp en este número. Puedo dejar de recibirlos cuando quiera desde aquí.": "I agree to receive Pizarro notices on WhatsApp at this number. I can stop them at any time from here.",
  "Cambiar número": "Change number",
  "Conectado: {phone}.": "Connected: {phone}.",
  "Con la plantilla de WhatsApp que usa esta instalación solo se envían las menciones.": "With the WhatsApp template this installation uses, only mentions are sent.",
  "WhatsApp le cuesta dinero a tu organización por cada mensaje: actívalo solo si lo vas a usar.": "WhatsApp costs your organisation money for each message: turn it on only if you'll use it.",
  "Mensaje de prueba enviado.": "Test message sent.",
  "Telegram desconectado.": "Telegram disconnected.",
  "WhatsApp desconectado.": "WhatsApp disconnected.",
  "Qué avisos recibir por aquí": "Which notices to get here",
  "Enviar mensaje de prueba": "Send a test message",
  "Menciones (@)": "Mentions (@)",
  "Tareas que me asignan": "Tasks assigned to me",
  "Comentarios y respuestas en tareas que sigo": "Comments and replies on tasks I follow",
  "Cambios de fecha límite y recordatorios de «Esperando»": "Due date changes and “Waiting” reminders",
  "Enviado por Telegram": "Sent via Telegram",

  // Errores
  "El token no tiene el formato que da @BotFather (números, dos puntos y letras).": "The token doesn't have the format @BotFather gives (digits, a colon and letters).",
  "Pega primero el token del bot.": "Paste the bot token first.",
  "Telegram no acepta este token.": "Telegram doesn't accept this token.",
  "Telegram no acepta el token guardado.": "Telegram doesn't accept the saved token.",
  "El bot responde, pero no se pudo enviarte el mensaje de prueba.": "The bot answers, but the test message couldn't be sent to you.",
  "No se pudo enviar el WhatsApp de prueba.": "The test WhatsApp couldn't be sent.",
  "No se pudo enviar el mensaje de prueba.": "The test message couldn't be sent.",
  "El token de WhatsApp no es válido.": "The WhatsApp token isn't valid.",
  "Faltan datos: el token, el identificador del número y la plantilla.": "Some details are missing: the token, the phone number ID and the template.",
  "Escribe el número al que enviar la prueba.": "Type the number to send the test to.",
  "Los avisos por Telegram no están activados en esta instalación.": "Telegram notices aren't turned on in this installation.",
  "Los avisos por WhatsApp no están activados en esta instalación.": "WhatsApp notices aren't turned on in this installation.",
  "Conecta primero este canal.": "Connect this channel first.",
  "Marca la casilla para aceptar recibir avisos por WhatsApp.": "Tick the box to agree to receive WhatsApp notices.",
  "Guarda primero tu número de WhatsApp.": "Save your WhatsApp number first.",
  "El identificador del número de WhatsApp son solo cifras (Phone number ID).": "The WhatsApp phone number ID is digits only (Phone number ID).",
  "El nombre de la plantilla solo admite minúsculas, cifras y guiones bajos.": "The template name only allows lowercase letters, digits and underscores.",
  "El idioma de la plantilla no es válido (por ejemplo es, es_ES o en_US).": "The template language isn't valid (for example es, es_ES or en_US).",

  // Administración → Ajustes → Telegram: guardado o activado, pero el webhook o el sondeo fallaron
  "Bot @{bot} guardado, pero Telegram ha respondido con un error al prepararlo.": "Bot @{bot} saved, but Telegram replied with an error while setting it up.",
  "Avisos por Telegram activados, pero Telegram ha respondido con un error al preparar el bot.": "Telegram notices turned on, but Telegram replied with an error while setting up the bot.",
  "Avisos por Telegram desactivados, pero Telegram ha respondido con un error.": "Telegram notices turned off, but Telegram replied with an error.",

  // Administración → Ajustes → WhatsApp: la primera vez no se activa sola
  "Configuración de WhatsApp guardada. Pulsa «Activar» para empezar a enviar avisos (de pago).": "WhatsApp settings saved. Press “Enable” to start sending notices (paid).",

  // Mi perfil → Avisos: la prueba falla porque el bot está bloqueado
  "Telegram no deja enviarte mensajes (has bloqueado el bot o borrado el chat), así que se ha desconectado. Vuelve a conectarlo para recibir avisos.": "Telegram won't let us message you (you blocked the bot or deleted the chat), so it has been disconnected. Connect it again to get notices.",

  // Mensajes del bot de Telegram: la pestaña se llama Mi perfil → Avisos (en inglés, My profile → Notifications)
  "Hola. Soy el bot de avisos de Pizarro. Para recibir aquí tus avisos, pulsa «Conectar Telegram» en Pizarro, en Mi perfil → Avisos.": "Hi! I'm the Pizarro notices bot. To get your notices here, press “Connect Telegram” in Pizarro, under My profile → Notifications.",
  "Este enlace ha caducado o ya se ha usado. Vuelve a pulsar «Conectar Telegram» en Pizarro, en Mi perfil → Avisos.": "This link has expired or has already been used. Press “Connect Telegram” again in Pizarro, under My profile → Notifications.",
  "Soy el bot de avisos de Pizarro: no leo mensajes. Para conectar o desconectar los avisos, ve en Pizarro a Mi perfil → Avisos (o escribe /stop).": "I'm the Pizarro notices bot: I don't read messages. To connect or disconnect notices, go to My profile → Notifications in Pizarro (or type /stop).",

  // Mi perfil → Avisos: se esperaba a «Iniciar» y el administrador cambió el bot (o se pidió otro enlace en otra pestaña)
  "Este enlace ya no vale: el administrador ha cambiado el bot de Telegram o se ha pedido otro enlace. Vuelve a pulsar «Conectar Telegram».":
    "This link is no longer valid: the administrator changed the Telegram bot or another link was requested. Press “Connect Telegram” again.",

  // Administración → Ajustes → WhatsApp: idioma en inglés de la plantilla de verificación
  "Idioma en inglés de la verificación": "English verification language",
  "Los idiomas en inglés se usan con quien tiene Pizarro en inglés (añade esa traducción a la plantilla en Meta). Vacíos, todos reciben el idioma principal.": "The English languages are used for people who have Pizarro in English (add that translation to the template in Meta). If empty, everyone gets the main language.",

  // Código de verificación de WhatsApp: envío y comprobación
  "No se pudo enviar el código por WhatsApp.": "The code could not be sent by WhatsApp.",
  "Escribe el código de 6 cifras que te ha llegado por WhatsApp.": "Enter the 6-digit code you received on WhatsApp.",
  "El código no es correcto. Te queda 1 intento.": "That code is not correct. You have 1 attempt left.",
  "El código no es correcto. Te quedan {n} intentos.": "That code is not correct. You have {n} attempts left.",
  "El código no es correcto y ya no quedan intentos. Pide otro con «Enviar otro código».": "That code is not correct and there are no attempts left. Ask for another one with “Send another code”.",
  "El código ha caducado o ya no vale. Pide otro con «Enviar otro código».": "The code has expired or is no longer valid. Ask for another one with “Send another code”.",
  "Demasiados intentos con este código. Pide otro con «Enviar otro código».": "Too many attempts with this code. Ask for another one with “Send another code”.",
  "Tu número de WhatsApp ya está confirmado.": "Your WhatsApp number is already confirmed.",
  "Confirma primero tu número con el código que te llegó por WhatsApp.": "First confirm your number with the code you received on WhatsApp.",
  "Has llegado al máximo de mensajes de WhatsApp de prueba por hoy. Vuelve a intentarlo mañana.": "You have reached today's limit of WhatsApp test messages. Try again tomorrow.",
  "Pidió otro código de WhatsApp para {to}": "Requested another WhatsApp code for {to}",

  // Mi perfil → Avisos → WhatsApp: número y código
  "Te hemos enviado un código por WhatsApp.": "We have sent you a code on WhatsApp.",
  "Te hemos enviado otro código por WhatsApp.": "We have sent you another code on WhatsApp.",
  "Guardar y enviar código": "Save and send code",
  "Te hemos enviado un código de 6 cifras por WhatsApp a {phone}. Escríbelo aquí para confirmar que el número es tuyo.": "We have sent a 6-digit code by WhatsApp to {phone}. Enter it here to confirm the number is yours.",
  "El código enviado a {phone} ha caducado o ya no vale. Pide otro.": "The code sent to {phone} has expired or is no longer valid. Ask for another one.",
  "Código de WhatsApp": "WhatsApp code",
  "Enviar otro código": "Send another code",
  "Caduca a los 15 minutos. Si no llega, revisa el número.": "It expires after 15 minutes. If it doesn't arrive, check the number.",
  "Los avisos por WhatsApp no están activados en este número: acepta recibirlos y confírmalo con el código que te enviaremos.": "WhatsApp notifications aren't on for this number: agree to receive them and confirm with the code we'll send you.",
  "Número guardado: {phone}. Los avisos por WhatsApp no están activados.": "Saved number: {phone}. WhatsApp notices are not turned on.",
  "Borrar el número": "Delete the number",
  "Número borrado.": "Number deleted.",

  // Administración → Ajustes → WhatsApp: plantilla configurada por variables
  "La plantilla sale de la variable WHATSAPP_TEMPLATE_NAME: se usa el formato antiguo (4 variables) y solo se envían menciones. Si tu plantilla ya es la nueva (3 variables, abajo), escribe su nombre en «Nombre de la plantilla» y guarda.": "The template comes from the WHATSAPP_TEMPLATE_NAME variable: the old format (4 variables) is used and only mentions are sent. If your template is already the new one (3 variables, below), type its name in “Template name” and save.",

  // Plantilla de autenticación de WhatsApp (codigo_pizarro): Administración → Ajustes y su «Probar»
  "Plantilla de verificación": "Verification template",
  "Idioma de la verificación": "Verification language",
  "Lleva el código de 6 cifras con el que cada persona conecta su WhatsApp; Meta exige la categoría Autenticación (no vale aviso_pizarro). Vacía = codigo_pizarro, en el idioma de los avisos.": "It carries the 6-digit code each person uses to connect WhatsApp; Meta requires the Authentication category (aviso_pizarro won't do). Empty = codigo_pizarro, in the notification language.",
  "Una plantilla de categoría Autenticación llamada codigo_pizarro, aprobada, con la opción «Copiar código» y el mismo idioma. Su texto lo pone Meta («Tu código de verificación es…»): con ella llega el código para conectar WhatsApp.":
    "An approved Authentication template named codigo_pizarro, with the “Copy code” option and the same language. Meta sets its text (“… is your verification code”): it carries the code for connecting WhatsApp.",
  "Envía 2 mensajes de pago: un aviso de prueba y un código de muestra.": "Sends 2 paid messages: a test notification and a sample code.",
  "Enviados 2 WhatsApp de prueba a {to}: un aviso y un código de verificación de muestra (123456).": "2 test WhatsApp messages sent to {to}: a notice and a sample verification code (123456).",
  "Solo ha salido el aviso de prueba.": "Only the test notice was sent.",
  "Solo ha salido el código de verificación de prueba.": "Only the test verification code was sent.",
  "Plantilla de avisos:": "Notice template:",
  "Plantilla de verificación:": "Verification template:",

  // Meta rechaza la plantilla de verificación (errores 132001, 132000/132012/132018, 132015/132016)
  "La plantilla de verificación «{name}» ({lang}) no existe en Meta o aún no está aprobada (error {code}). Créala en WhatsApp Manager: categoría Autenticación, opción «Copiar código», con ese nombre e idioma. Hasta entonces nadie puede conectar su WhatsApp.":
    "The verification template “{name}” ({lang}) does not exist in Meta or is not approved yet (error {code}). Create it in WhatsApp Manager: Authentication category, “Copy code” option, with that name and language. Until then nobody can connect their WhatsApp.",
  "La plantilla de verificación «{name}» no tiene la forma que espera Pizarro (error {code}): tiene que ser de categoría Autenticación con el botón «Copiar código».":
    "The verification template “{name}” is not in the form Pizarro expects (error {code}): it must be in the Authentication category with the “Copy code” button.",
  "Meta ha pausado o desactivado la plantilla de verificación «{name}» (error {code}). Revísala en WhatsApp Manager.":
    "Meta has paused or disabled the verification template “{name}” (error {code}). Check it in WhatsApp Manager.",

  // Mi perfil → Avisos → WhatsApp: la plantilla de verificación no está lista
  "Ahora no se pueden enviar códigos por WhatsApp: el administrador de Pizarro tiene que crear (o revisar) en Meta la plantilla de verificación. Avísale y vuelve a intentarlo después.":
    "Codes cannot be sent by WhatsApp right now: your Pizarro administrator needs to create (or check) the verification template in Meta. Let them know and try again later.",
  "Todavía no se ha podido enviar el código a {phone}. Cuando el administrador lo arregle, pulsa «Enviar otro código».":
    "The code could not be sent to {phone} yet. Once the administrator fixes it, press “Send another code”.",
};
