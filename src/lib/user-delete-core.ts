// Reglas para borrar una cuenta, sin base de datos (también las usa la pantalla de «Mi perfil»).

/** Por qué no se puede borrar una cuenta: es la única de la instalación o el último administrador activo. */
export type DeletionBlock = "only-user" | "last-admin";

export const DELETION_BLOCK_MESSAGES: Record<DeletionBlock, string> = {
  "only-user": "Eres la única cuenta de esta instalación: no se puede borrar.",
  "last-admin": "Eres el único administrador. Nombra antes a otro en Administración → Usuarios.",
};

/** Palabra que hay que escribir para confirmar (se traduce: en inglés, «DELETE»). */
export const DELETE_ACCOUNT_WORD = "BORRAR";

export function deletionBlockFor(user: { role: "ADMIN" | "MEMBER"; active: boolean }, others: { users: number; activeAdmins: number }): DeletionBlock | null {
  if (others.users === 0) return "only-user";
  // Un miembro (o un admin desactivado) no cambia cuántos administradores pueden entrar.
  if (user.role === "ADMIN" && user.active && others.activeAdmins === 0) return "last-admin";
  return null;
}

/** ¿Coincide lo escrito con la palabra de confirmación (ya traducida)? Sin distinguir mayúsculas ni espacios de los lados. */
export function confirmWordMatches(typed: string, word: string): boolean {
  return typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase();
}

/**
 * Otra forma de confirmar la baja para quien quizá no conoce su contraseña: «totp» (el código de su app de
 * verificación o uno de recuperación), «email» (un código al email de la cuenta) o «google» (volver a entrar con Google).
 */
export type DeleteFactor = "totp" | "email" | "google";

/**
 * Con qué puede confirmar la baja, además de (o en lugar de) la contraseña, quien entra con Google: una cuenta invitada
 * cuya contraseña provisional (aleatoria) nadie conoce, o cualquiera que nunca la usa. Con la app de verificación (TOTP),
 * solo su código; si no, el código por email (con el envío configurado) o volver a entrar con Google (con Google
 * configurado). Quien no tiene Google enlazado y puede entrar con contraseña confirma con ella, como siempre.
 * `passwordLogin`: su rol puede entrar con contraseña (con «solo Google», AUTH_GOOGLE_ONLY, solo el acceso de emergencia).
 */
export function deleteAlternatives(a: { googleLinked: boolean; passwordLogin: boolean; twoFactor: "TOTP" | "EMAIL" | null; emailAvailable: boolean; googleAvailable: boolean }): DeleteFactor[] {
  if (!a.googleLinked && a.passwordLogin) return [];
  if (a.twoFactor === "TOTP") return ["totp"];
  const out: DeleteFactor[] = [];
  if (a.emailAvailable) out.push("email");
  if (a.googleLinked && a.googleAvailable) out.push("google");
  return out;
}
