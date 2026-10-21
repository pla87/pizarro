import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/session";
import { makeT, toLocale, type Locale, type T } from "./core";

/** Idioma de la petición: el del usuario; sin sesión (pantalla de acceso), español. */
export const getLocale = cache(async (): Promise<Locale> => {
  const user = await getCurrentUser().catch(() => null);
  return user ? toLocale(user.locale) : "es";
});

/** Traductor para componentes de servidor, rutas y acciones. */
export async function getT(): Promise<T> {
  return makeT(await getLocale());
}
