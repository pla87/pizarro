// Reglas para borrar una cuenta, sin base de datos (también las usa la pantalla de «Mi perfil»).

/**
 * Por qué no se puede borrar una cuenta: es la única de la instalación, o es el último administrador activo que ya ha
 * entrado alguna vez: sin más administradores («last-admin»), o con otros que aún tienen la invitación pendiente
 * («pending-admin» con uno solo, que se nombra; «pending-admins» con varios). Quien nunca ha entrado no sostiene la
 * instalación: su invitación puede caducar o no llegar.
 */
type DeletionBlock = "only-user" | "last-admin" | "pending-admin" | "pending-admins";

export interface DeletionBlockInfo {
  reason: DeletionBlock;
  /** Con «pending-admin»: el nombre del administrador que aún no ha entrado. */
  name?: string;
}

export const DELETION_BLOCK_MESSAGES: Record<DeletionBlock, string> = {
  "only-user": "Eres la única cuenta de esta instalación: no se puede borrar.",
  "last-admin": "Eres el único administrador. Nombra antes a otro en Administración → Usuarios.",
  "pending-admin": "Espera a que {name} entre por primera vez antes de borrar tu cuenta.",
  "pending-admins": "Los demás administradores aún no han entrado nunca: espera a que alguno entre por primera vez antes de borrar tu cuenta.",
};

/** Texto (sin traducir) y variables del motivo, para `t(text, vars)`. */
export function deletionBlockMessage(block: DeletionBlockInfo): { text: string; vars: { name: string } } {
  return { text: DELETION_BLOCK_MESSAGES[block.reason], vars: { name: block.name ?? "" } };
}

/** Palabra que hay que escribir para confirmar (se traduce: en inglés, «DELETE»). */
export const DELETE_ACCOUNT_WORD = "BORRAR";

/**
 * `others`: las demás cuentas (`users`), los demás administradores activos que ya han entrado alguna vez
 * (`activeAdmins`, HAS_ENTERED) y los nombres de los activos que aún no (`pendingAdmins`; basta con dos).
 */
export function deletionBlockFor(user: { role: "ADMIN" | "MEMBER"; active: boolean }, others: { users: number; activeAdmins: number; pendingAdmins?: readonly string[] }): DeletionBlockInfo | null {
  if (others.users === 0) return { reason: "only-user" };
  // Un miembro (o un admin desactivado) no cambia cuántos administradores pueden entrar.
  if (user.role !== "ADMIN" || !user.active || others.activeAdmins > 0) return null;
  const pending = others.pendingAdmins ?? [];
  if (pending.length === 1) return { reason: "pending-admin", name: pending[0] };
  return { reason: pending.length > 1 ? "pending-admins" : "last-admin" };
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
