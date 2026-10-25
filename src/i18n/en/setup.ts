// Traducciones al inglés (asistente de primer arranque /setup). Clave: texto exacto en español.
export const setup: Record<string, string> = {
  "Paso {n} de {total}": "Step {n} of {total}",
  "Configurar Pizarro": "Set up Pizarro",
  "Para asegurarnos de que eres quien instala el servidor, escribe el código de configuración que aparece en el log del servidor (docker compose logs app) o que te dio el instalador.":
    "To make sure you are the person installing the server, enter the setup code shown in the server log (docker compose logs app) or given by the installer.",
  "Código de configuración": "Setup code",
  "Tu organización": "Your organisation",
  "Nombre de la organización": "Organisation name",
  "Idioma de la instalación": "Installation language",
  "Zona horaria": "Time zone",
  "Fijada por la variable APP_TIMEZONE del servidor.": "Fixed by the server's APP_TIMEZONE variable.",
  "Primer administrador": "First administrator",
  "Al entrar por primera vez, Pizarro te pedirá configurar la verificación en dos pasos (obligatoria para administradores).":
    "When you first sign in, Pizarro will ask you to set up two-step verification (required for administrators).",
  "Mínimo 10 caracteres.": "At least 10 characters.",
  "Email": "Email",
  "El servidor tiene el envío de emails configurado (SMTP). Puedes comprobarlo ahora con un email de prueba a {email}.":
    "The server has email sending configured (SMTP). You can check it now with a test email to {email}.",
  "Enviar email de prueba": "Send test email",
  "Email de prueba enviado a {email}. Comprueba tu bandeja de entrada.": "Test email sent to {email}. Check your inbox.",
  "El envío de emails (SMTP) no está configurado. Sin él no hay invitaciones por email ni «¿Olvidaste tu contraseña?». Puedes añadir las variables SMTP_* más adelante (docs/INSTALL.md).":
    "Email sending (SMTP) is not configured. Without it there are no email invitations or “Forgot your password?”. You can add the SMTP_* variables later (docs/INSTALL.md).",
  "Terminar configuración": "Finish setup",
  "Todo listo": "All done",
  "Pizarro está configurado. Entra con tu email y tu contraseña; te pedirá activar la verificación en dos pasos.":
    "Pizarro is set up. Sign in with your email and password; it will ask you to activate two-step verification.",
  "Ir a iniciar sesión": "Go to sign in",
  // Mensajes del servidor (actions/setup.ts, lib/setup.ts)
  "La instalación ya está configurada.": "The installation is already set up.",
  "El código no es correcto o ha caducado.": "The code is incorrect or has expired.",
  "El email no es válido.": "The email is not valid.",
  "Prueba de email de Pizarro": "Pizarro email test",
  "Si lees esto, el envío de emails de Pizarro funciona correctamente.": "If you are reading this, Pizarro email sending works correctly.",
  "No se pudo enviar el email de prueba. Revisa las variables SMTP_* y los logs del contenedor.": "The test email could not be sent. Check the SMTP_* variables and the container logs.",
  "Escribe el nombre de la organización (hasta 80 caracteres).": "Enter the organisation name (up to 80 characters).",
  "Idioma no válido.": "Invalid language.",
  "Zona horaria no válida.": "Invalid time zone.",
  "Escribe tu nombre (hasta 100 caracteres).": "Enter your name (up to 100 characters).",
  "Contraseña no válida.": "Invalid password.",
};
