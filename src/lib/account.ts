import "server-only";
import { db } from "./db";
import { sendPasswordChangedMail } from "./auth-mail";
import { emailEnabled, sendMailInBackground } from "./mail";

/**
 * Guarda una contraseña nueva ya cifrada: quita la marca de «cambio obligatorio», cierra TODAS las
 * sesiones del usuario, descarta los enlaces pendientes de contraseña y avisa por email si hay correo.
 * Quien llama abre después la sesión nueva si procede.
 */
export async function applyNewPassword(userId: string, passwordHash: string, opts: { notice?: boolean } = {}): Promise<void> {
  const [user] = await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false }, select: { name: true, email: true, locale: true } }),
    db.session.deleteMany({ where: { userId } }),
    db.authToken.deleteMany({ where: { userId, purpose: { in: ["PASSWORD_RESET", "PASSWORD_CHANGE"] } } }),
    // Con otra contraseña, también se deja de confiar en los dispositivos recordados para el segundo paso.
    db.knownDevice.updateMany({ where: { userId, trustedUntil: { not: null } }, data: { trustedUntil: null } }),
  ]);
  if (opts.notice !== false && emailEnabled()) {
    sendMailInBackground("aviso de contraseña cambiada", () => sendPasswordChangedMail(user));
  }
}
