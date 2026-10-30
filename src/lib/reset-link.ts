import { db } from "./db";
import { issueAuthToken } from "./auth-token-issue";

// Enlace de restablecimiento sin email (node dist/reset-link.mjs). Sin «server-only»: lo usa el script de línea de órdenes.

export type ResetLinkResult =
  | { ok: true; url: string; name: string; twoFactorCleared: boolean }
  | { ok: false; error: string };

/** Genera un enlace de un solo uso (30 min) para elegir contraseña nueva; con reset2fa borra también su verificación en dos pasos. */
export async function createResetLink(email: string, opts: { appUrl: string; reset2fa?: boolean }): Promise<ResetLinkResult> {
  const user = await db.user.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } }, select: { id: true, name: true, active: true, twoFactorMethod: true } });
  if (!user) return { ok: false, error: "No existe ningún usuario con ese email." };
  if (!user.active) return { ok: false, error: "Ese usuario está desactivado: reactívalo antes (Administración → Usuarios)." };
  let twoFactorCleared = false;
  if (opts.reset2fa) {
    // Igual que clearTwoFactor (two-factor.ts), que no se puede importar desde aquí por su «server-only».
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { twoFactorMethod: null, totpSecretEnc: null, totpLastStep: null } }),
      db.recoveryCode.deleteMany({ where: { userId: user.id } }),
      db.loginChallenge.deleteMany({ where: { userId: user.id } }),
      db.knownDevice.updateMany({ where: { userId: user.id, trustedUntil: { not: null } }, data: { trustedUntil: null } }),
    ]);
    twoFactorCleared = !!user.twoFactorMethod;
  }
  const token = await issueAuthToken(user.id, "PASSWORD_RESET");
  return { ok: true, url: `${opts.appUrl.replace(/\/$/, "")}/reset/${token}`, name: user.name, twoFactorCleared };
}
