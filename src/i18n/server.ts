import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { getCurrentUser } from "@/lib/session";
import { makeT, toLocale, type Locale, type T } from "./core";

/** Idioma de la petición: el del usuario; sin sesión, el del navegador (inglés si lo prefiere). */
export const getLocale = cache(async (): Promise<Locale> => {
  const user = await getCurrentUser().catch(() => null);
  if (user) return toLocale(user.locale);
  const accept = (await headers()).get("accept-language") ?? "";
  return /^en\b/i.test(accept.trim()) ? "en" : "es";
});

/** Traductor para componentes de servidor, rutas y acciones. */
export async function getT(): Promise<T> {
  return makeT(await getLocale());
}
