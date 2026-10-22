// Traducciones al inglés: cuentas y seguridad (acceso, enlaces por email, sesiones, avisos). Clave: texto exacto en español.
export const cuentas: Record<string, string> = {
  // Administración de usuarios
  "Tiene que elegir una contraseña nueva al entrar": "They must choose a new password when signing in",
  "Contraseña pendiente": "Password pending",
  "Forzar cambio de contraseña de {name}": "Force password change for {name}",
  "Forzar cambio de contraseña": "Force password change",
  "Usuario creado: le hemos enviado una invitación por email": "User created: we've emailed them an invitation",
  "Recibirá un email con un enlace (válido 72 horas) para elegir su propia contraseña. Tú no la llegas a conocer.":
    "They will get an email with a link (valid for 72 hours) to choose their own password. You never get to know it.",
  "El envío de emails no está configurado: dale esta clave por otro medio. Al entrar tendrá que elegir una contraseña nueva, así que tú no llegarás a conocer la definitiva.":
    "Email sending isn't configured: give them this password another way. When they sign in they will have to choose a new password, so you will never know the final one.",
  "Se avisará por email a la dirección antigua del cambio.": "The old address will be notified of the change by email.",
  "Cambio forzado: se han cerrado sus sesiones y le hemos enviado un enlace por email": "Change forced: their sessions were closed and we've emailed them a link",
  "Cambio forzado: se han cerrado sus sesiones": "Change forced: their sessions were closed",
  "Se cerrarán todas sus sesiones y tendrá que elegir una contraseña nueva la próxima vez que entre. Tú no escribes ninguna contraseña.":
    "All their sessions will be closed and they will have to choose a new password next time they sign in. You don't type any password.",
  "Le enviaremos un enlace por email (válido 30 minutos) para elegirla.": "We'll email them a link (valid for 30 minutes) to choose it.",
  "El envío de emails no está configurado: entrará con su contraseña actual y, antes de usar la app, se le pedirá una nueva.":
    "Email sending isn't configured: they will sign in with their current password and, before using the app, be asked for a new one.",
  "Forzar cambio": "Force change",
  // Perfil
  "Cambiar email": "Change email",
  "Tu email actual es {email}. Enviaremos un enlace de confirmación a la dirección nueva (caduca en 30 minutos) y un aviso a la actual; el cambio solo se hace al confirmarlo.":
    "Your current email is {email}. We'll send a confirmation link to the new address (expires in 30 minutes) and a notice to the current one; the change only happens once confirmed.",
  "Te hemos enviado un enlace a la dirección nueva para confirmar el cambio.": "We've sent a link to the new address to confirm the change.",
  "Email nuevo": "New email",
  "Enviar confirmación": "Send confirmation",
  "Te enviaremos un enlace por email para confirmar el cambio; al confirmarlo se cerrará la sesión en todos los dispositivos.":
    "We'll email you a link to confirm the change; once confirmed, all devices will be signed out.",
  "Te hemos enviado un email: confirma el cambio con el enlace (caduca en 30 minutos).": "We've sent you an email: confirm the change with the link (expires in 30 minutes).",
  "Sesiones abiertas": "Open sessions",
  "Dispositivos en los que has iniciado sesión. Cierra los que no reconozcas.": "Devices where you are signed in. Close any you don't recognise.",
  "Se han cerrado las demás sesiones": "The other sessions were closed",
  "Cerrar las demás": "Close the others",
  "Esta sesión": "This session",
  "Última actividad: {date}": "Last activity: {date}",
  "Sesión cerrada": "Session closed",
  // Pantallas de acceso y enlaces
  "Por seguridad, antes de seguir tienes que elegir una contraseña nueva, distinta de la actual.": "For security, before continuing you must choose a new password, different from the current one.",
  "Guardar contraseña": "Save password",
  "Elige una contraseña nueva": "Choose a new password",
  "Elige tu contraseña": "Choose your password",
  "Email actualizado. Úsalo la próxima vez que inicies sesión.": "Email updated. Use it the next time you sign in.",
  "Contraseña actualizada. Se han cerrado todas las sesiones: inicia sesión con la nueva.": "Password updated. All sessions were closed: sign in with the new one.",
  "Ir a mi perfil": "Go to my profile",
  "El email de tu cuenta de Pizarro pasará a ser {email}.": "The email of your Pizarro account will become {email}.",
  "Se aplicará la contraseña nueva que elegiste en tu perfil y se cerrarán todas las sesiones abiertas.":
    "The new password you chose in your profile will be applied and all open sessions will be closed.",
  "Confirmar": "Confirm",
  "Confirmar cambio": "Confirm change",
  "Enlace no válido": "Invalid link",
  "El enlace no es válido o ha caducado. Repite el cambio desde tu perfil.": "The link is invalid or has expired. Repeat the change from your profile.",
  "El enlace no es válido o ha caducado. Pide uno nuevo.": "The link is invalid or has expired. Request a new one.",
  "Pedir un enlace nuevo": "Request a new link",
  "Volver a iniciar sesión": "Back to sign in",
  "Confirmar el nuevo email": "Confirm the new email",
  "Confirmar el cambio de contraseña": "Confirm the password change",
  "Si existe una cuenta con ese email, te hemos enviado un enlace para elegir una contraseña nueva. Caduca en 30 minutos.":
    "If an account exists with that email, we've sent you a link to choose a new password. It expires in 30 minutes.",
  "Escribe el email de tu cuenta y te enviaremos un enlace para elegir una contraseña nueva.": "Enter your account email and we'll send you a link to choose a new password.",
  "Enviar enlace": "Send link",
  "Recuperar contraseña": "Recover password",
  "¿Olvidaste tu contraseña?": "Forgot your password?",
  "Contraseña guardada. Por seguridad se han cerrado todas las sesiones: inicia sesión con la nueva.": "Password saved. For security all sessions were closed: sign in with the new one.",
  // Emails
  "Si no has sido tú, ignora este mensaje: no se cambiará nada.": "If this wasn't you, ignore this message: nothing will change.",
  "Restablece tu contraseña de Pizarro": "Reset your Pizarro password",
  "Hola, {name}:": "Hi {name},",
  "Usa este enlace para elegir una contraseña nueva. Caduca en {n} minutos y solo sirve una vez.": "Use this link to choose a new password. It expires in {n} minutes and works only once.",
  "Elegir contraseña nueva": "Choose a new password",
  "Te han invitado a Pizarro": "You've been invited to Pizarro",
  "{admin} te ha dado de alta en Pizarro. Usa este enlace para elegir tu contraseña. Caduca en {n} horas y solo sirve una vez.":
    "{admin} has created your Pizarro account. Use this link to choose your password. It expires in {n} hours and works only once.",
  "Elegir mi contraseña": "Choose my password",
  "Confirma el cambio de contraseña": "Confirm the password change",
  "Has pedido cambiar tu contraseña de Pizarro. Confirma el cambio con este enlace; caduca en {n} minutos y solo sirve una vez.":
    "You asked to change your Pizarro password. Confirm the change with this link; it expires in {n} minutes and works only once.",
  "Confirmar el cambio": "Confirm the change",
  "Si no has sido tú, ignora este mensaje: tu contraseña actual sigue igual. Te recomendamos cambiarla.":
    "If this wasn't you, ignore this message: your current password stays the same. We recommend changing it.",
  "Tu contraseña de Pizarro ha cambiado": "Your Pizarro password has changed",
  "La contraseña de tu cuenta se ha cambiado y se han cerrado tus sesiones abiertas.": "Your account password was changed and your open sessions were closed.",
  "Si no has sido tú, avisa a un administrador de inmediato.": "If this wasn't you, tell an administrator right away.",
  "Confirma tu nuevo email en Pizarro": "Confirm your new email in Pizarro",
  "Has pedido usar esta dirección como email de tu cuenta de Pizarro. Confírmalo con este enlace; caduca en {n} minutos y solo sirve una vez.":
    "You asked to use this address as the email of your Pizarro account. Confirm it with this link; it expires in {n} minutes and works only once.",
  "Confirmar el email": "Confirm the email",
  "Se ha pedido cambiar el email de tu cuenta": "A change of your account email was requested",
  "Se ha pedido cambiar el email de tu cuenta de Pizarro a {email}. El cambio solo se hará si se confirma desde esa dirección.":
    "A change of your Pizarro account email to {email} was requested. It will only happen if confirmed from that address.",
  "Si no has sido tú, cambia tu contraseña y avisa a un administrador.": "If this wasn't you, change your password and tell an administrator.",
  "El email de tu cuenta de Pizarro ha cambiado": "Your Pizarro account email has changed",
  "El email de tu cuenta de Pizarro ya no es este: ahora es {email}.": "Your Pizarro account email is no longer this one: it is now {email}.",
  "Nuevo inicio de sesión en Pizarro": "New sign-in to Pizarro",
  "Se ha iniciado sesión en tu cuenta desde un dispositivo que no habíamos visto antes.": "Your account was signed in from a device we hadn't seen before.",
  "Dispositivo": "Device",
  "IP": "IP",
  "Desconocida": "Unknown",
  "Si has sido tú, no tienes que hacer nada. Si no, cambia tu contraseña desde «Mi perfil» y cierra las demás sesiones.":
    "If it was you, you don't need to do anything. If not, change your password from “My profile” and close the other sessions.",
  "{browser} en {os}": "{browser} on {os}",
  "Dispositivo desconocido": "Unknown device",
  // Errores del servidor (AppError / validación)
  "Debes elegir una contraseña nueva antes de continuar.": "You must choose a new password before continuing.",
  "La contraseña es demasiado larga (máximo 72 bytes; las tildes y los emojis ocupan más de uno).":
    "The password is too long (maximum 72 bytes; accented letters and emojis take more than one).",
  "El envío de emails no está configurado.": "Email sending is not configured.",
  "El enlace no es válido o ha caducado.": "The link is invalid or has expired.",
  "La contraseña nueva debe ser distinta de la actual.": "The new password must be different from the current one.",
  "No se pudo enviar el email de confirmación. Inténtalo más tarde.": "The confirmation email could not be sent. Try again later.",
  "Ese ya es tu email.": "That is already your email.",
  "Esta es tu sesión actual: usa «Cerrar sesión».": "This is your current session: use “Log out”.",
  "Usuario creado, pero no se pudo enviar la invitación. Usa «Forzar cambio de contraseña» para reenviarla.":
    "User created, but the invitation could not be sent. Use “Force password change” to resend it.",
  "Para cambiar tu propia contraseña usa «Mi perfil».": "To change your own password use “My profile”.",
  "Se ha forzado el cambio, pero no se pudo enviar el email con el enlace.": "The change was forced, but the email with the link could not be sent.",
};
