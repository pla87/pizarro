// Con quién se comparten los Docs/Sheets creados desde una tarea (por proyecto). Sin dependencias de servidor:
// lo usan también los ajustes del proyecto y los tests.

export const GOOGLE_SHARE_MODES = ["DOMAIN_WRITE", "DOMAIN_READ", "MEMBERS", "NONE"] as const;
export type GoogleShareMode = (typeof GOOGLE_SHARE_MODES)[number];

/** Resultado de compartir un archivo recién creado (se guarda en TaskLink.shareStatus). */
export type ShareStatus = "SHARED" | "PARTIAL" | "NOT_SHARED";

export const isShareMode = (x: unknown): x is GoogleShareMode => (GOOGLE_SHARE_MODES as readonly string[]).includes(x as string);
export const isDomainMode = (m: GoogleShareMode) => m === "DOMAIN_WRITE" || m === "DOMAIN_READ";

const ROLES = ["writer", "commenter", "reader"];

/** Rol de GOOGLE_SHARE_ROLE (writer por defecto) o null si está desactivado ("none") o no es válido. */
function envRole(role: string | undefined): string | null {
  const r = role ?? "writer";
  return ROLES.includes(r) ? r : null;
}

/** Qué se hace al crear un archivo: a quién (dominio, miembros o nadie) y con qué rol de Drive. */
export type ShareRule = { scope: "domain" | "members" | "none"; role: string };

/**
 * Regla efectiva de un proyecto. Sin modo guardado (proyectos anteriores) se mantiene lo que daba la configuración
 * del servidor: dominio con GOOGLE_SHARE_ROLE en los de equipo, miembros con ese rol en los privados.
 * Un proyecto privado nunca comparte con el dominio, aunque tenga guardado un modo de dominio.
 */
export function shareRule(mode: string | null | undefined, isPrivate: boolean, env: { role?: string } = {}): ShareRule {
  if (!isShareMode(mode)) {
    const role = envRole(env.role);
    if (!role) return { scope: "none", role: "writer" };
    return { scope: isPrivate ? "members" : "domain", role };
  }
  if (mode === "NONE") return { scope: "none", role: "writer" };
  if (mode === "MEMBERS" || isPrivate) return { scope: "members", role: "writer" };
  return { scope: "domain", role: mode === "DOMAIN_READ" ? "reader" : "writer" };
}

/** Modo que se muestra en los ajustes: el guardado (si vale para el proyecto) o el equivalente al comportamiento por defecto. */
export function effectiveShareMode(mode: string | null | undefined, isPrivate: boolean, env: { role?: string } = {}): GoogleShareMode {
  const rule = shareRule(mode, isPrivate, env);
  if (rule.scope === "none") return "NONE";
  if (rule.scope === "members") return "MEMBERS";
  return rule.role === "writer" ? "DOMAIN_WRITE" : "DOMAIN_READ";
}

/** Estado de compartir según los permisos que había que crear y los que fallaron. */
export function shareStatusOf(total: number, failed: number): ShareStatus {
  if (total === 0 || failed >= total) return "NOT_SHARED";
  return failed > 0 ? "PARTIAL" : "SHARED";
}
