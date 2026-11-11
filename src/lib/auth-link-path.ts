import type { TokenPurpose } from "./auth-token-core";

/** Cabecera con la ruta de un enlace de email (/reset/<token>, /confirm/<token>): la pone el proxy, la lee getLocale. */
export const AUTH_LINK_HEADER = "x-pz-auth-link";

/** Token y tipos de enlace de la ruta de una pantalla de enlace de email; null si no lo es. */
export function authLinkToken(path: string | null | undefined): { token: string; purposes: TokenPurpose[] } | null {
  const m = /^\/(reset|confirm)\/([A-Za-z0-9_-]{1,100})\/?$/.exec(path ?? "");
  if (!m) return null;
  return { token: m[2]!, purposes: m[1] === "reset" ? ["PASSWORD_RESET", "INVITE"] : ["PASSWORD_CHANGE", "EMAIL_CHANGE"] };
}
