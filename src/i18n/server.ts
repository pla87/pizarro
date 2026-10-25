import "server-only";
import { cache } from "react";
import { getInstanceSettings } from "@/lib/instance";
import { getCurrentUser, getPendingUser } from "@/lib/session";
import { makeT, toLocale, type Locale, type T } from "./core";

/** Idioma de la petición: el del usuario; sin sesión (pantalla de acceso), el de la instalación (español por defecto). */
export const getLocale = cache(async (): Promise<Locale> => {
  const user = (await getCurrentUser().catch(() => null)) ?? (await getPendingUser().catch(() => null));
  return user ? toLocale(user.locale) : (await getInstanceSettings()).locale;
});

/** Traductor para componentes de servidor, rutas y acciones. */
export async function getT(): Promise<T> {
  return makeT(await getLocale());
}
