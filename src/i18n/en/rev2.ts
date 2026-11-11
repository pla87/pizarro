// Revisión de la mensajería (Telegram y WhatsApp): código de verificación de WhatsApp, topes de los mensajes de
// prueba y plantillas configuradas por variables. Clave: texto exacto en español.
export const rev2: Record<string, string> = {
  // Mensaje con el código (variable {{1}} de la plantilla) y su comprobación.
  "Tu código de verificación de Pizarro es {code}": "Your Pizarro verification code is {code}",
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

  // Mi perfil → Avisos → WhatsApp.
  "Te hemos enviado un código por WhatsApp.": "We have sent you a code on WhatsApp.",
  "Te hemos enviado otro código por WhatsApp.": "We have sent you another code on WhatsApp.",
  "Guardar y enviar código": "Save and send code",
  "Te hemos enviado un código de 6 cifras por WhatsApp a {phone}. Escríbelo aquí para confirmar que el número es tuyo.": "We have sent a 6-digit code by WhatsApp to {phone}. Enter it here to confirm the number is yours.",
  "El código enviado a {phone} ha caducado o ya no vale. Pide otro.": "The code sent to {phone} has expired or is no longer valid. Ask for another one.",
  "Código de WhatsApp": "WhatsApp code",
  "Enviar otro código": "Send another code",
  "El código caduca a los 15 minutos y admite 5 intentos. Hasta que lo confirmes no se te envían avisos por WhatsApp. Si no llega, revisa el número o pide al administrador que compruebe la configuración.": "The code expires after 15 minutes and allows 5 attempts. Until you confirm it, no notices are sent to you by WhatsApp. If it does not arrive, check the number or ask the administrator to check the setup.",
  "Este número estaba guardado en tu perfil, pero los avisos por WhatsApp no están activados. Para activarlos, acepta recibirlos y confírmalo con el código que te enviaremos.": "This number was saved in your profile, but WhatsApp notices are not turned on. To turn them on, agree to receive them and confirm it with the code we will send you.",
  "Número guardado: {phone}. Los avisos por WhatsApp no están activados.": "Saved number: {phone}. WhatsApp notices are not turned on.",
  "Borrar el número": "Delete the number",
  "Número borrado.": "Number deleted.",

  // Administración → Ajustes → WhatsApp.
  "La plantilla sale de la variable WHATSAPP_TEMPLATE_NAME: se usa el formato antiguo (4 variables) y solo se envían menciones. Si tu plantilla ya es la nueva (3 variables, abajo), escribe su nombre en «Nombre de la plantilla» y guarda.": "The template comes from the WHATSAPP_TEMPLATE_NAME variable: the old format (4 variables) is used and only mentions are sent. If your template is already the new one (3 variables, below), type its name in “Template name” and save.",
};
