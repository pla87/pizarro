import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { findUsableToken } from "@/lib/auth-token";
import { AUTH_LINK_HEADER, authLinkToken } from "@/lib/auth-link-path";
import { getInstanceSettings } from "@/lib/instance";
import { getCurrentUser, getPendingUser } from "@/lib/session";
import { readChallenge } from "@/lib/two-factor";
import { makeT, toLocale, type Locale, type T } from "./core";

/**
 * Idioma de quien está identificado sin sesión: el del usuario del enlace de un email (/reset/<token>, /confirm/<token>;
 * la ruta la pasa el proxy en una cabecera) o el del segundo paso del acceso pendiente (/login/verify, cookie pz_2fa).
 * Antes esas pantallas salían en el idioma de la instalación aunque ya se supiera quién era.
 */
async function identifiedLocale(): Promise<Locale | null> {
  const link = authLinkToken((await headers()).get(AUTH_LINK_HEADER));
  if (link) {
    const row = await findUsableToken(link.token, link.purposes);
    if (row) return toLocale(row.user.locale);
  }
  const ch = await readChallenge();
  return ch ? toLocale(ch.user.locale) : null;
}

/**
 * Idioma de la petición: el del usuario; sin sesión, el de quien se identifica por un enlace de email o el segundo paso
 * del acceso y, si no, el de la instalación (español por defecto).
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const user = (await getCurrentUser().catch(() => null)) ?? (await getPendingUser().catch(() => null));
  if (user) return toLocale(user.locale);
  return (await identifiedLocale().catch(() => null)) ?? (await getInstanceSettings()).locale;
});

/** Traductor para componentes de servidor, rutas y acciones. */
export async function getT(): Promise<T> {
  return makeT(await getLocale());
}
