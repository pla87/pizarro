import "server-only";
import { revokeUser } from "./revoke";
import { db } from "./db";
import { sendPasswordChangedMail } from "./auth-mail";
import { emailEnabled, sendMailInBackground } from "./mail";

/**
 * Guarda una contraseña nueva ya cifrada: quita la marca de «cambio obligatorio», cierra TODAS las
 * sesiones del usuario, descarta TODOS los enlaces pendientes (contraseña, cambio de email e invitación: con otra
 * contraseña, un cambio de email pedido por quien conocía la anterior ya no puede confirmarse) y avisa por email.
 * Quien llama abre después la sesión nueva si procede.
 */
export async function applyNewPassword(userId: string, passwordHash: string, opts: { notice?: boolean } = {}): Promise<void> {
  const [user] = await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false }, select: { name: true, email: true, locale: true } }),
    db.session.deleteMany({ where: { userId } }),
    db.authToken.deleteMany({ where: { userId, purpose: { in: ["INVITE", "PASSWORD_RESET", "PASSWORD_CHANGE", "EMAIL_CHANGE"] } } }),
    // Con otra contraseña, también se deja de confiar en los dispositivos recordados para el segundo paso.
    db.knownDevice.updateMany({ where: { userId, trustedUntil: { not: null } }, data: { trustedUntil: null } }),
  ]);
  // Sesiones borradas: también se cortan sus canales en vivo (SSE, presencia).
  revokeUser(userId);
  if (opts.notice !== false && emailEnabled()) {
    sendMailInBackground("aviso de contraseña cambiada", () => sendPasswordChangedMail(user));
  }
}
