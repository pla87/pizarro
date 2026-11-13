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
