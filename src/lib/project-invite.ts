// Invitar a alguien sin cuenta desde los miembros de un proyecto (inviteToProject, actions/users.ts). Parte pura.

/**
 * Nombre provisional de una persona invitada solo con su email: la parte de antes de la arroba, con puntos, guiones y
 * guiones bajos como espacios y cada palabra en mayúscula («ana.garcia@…» → «Ana Garcia»). Lo cambia ella en su perfil.
 */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local.replace(/\+.*$/, "").split(/[._\-\s]+/).filter(Boolean);
  const name = words.map((w) => w.charAt(0).toLocaleUpperCase() + w.slice(1)).join(" ").slice(0, 80).trim();
  return name || email.slice(0, 80);
}

/** Proyecto guardado en una invitación (AuthToken.data), o null si no es una invitación a un proyecto. */
export function inviteProjectId(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const id = (data as { projectId?: unknown }).projectId;
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}
