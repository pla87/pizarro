"use client";

// Único módulo de cliente que importa el diccionario de inglés: webpack lo deja en un fragmento propio que solo se
// descarga cuando el idioma es inglés (ver client.tsx). No importar este fichero desde ningún otro sitio.
import { type I18nValue } from "./context";
import { EN } from "./en";
import { makeTWith } from "./shared";

export const EN_VALUE: I18nValue = { locale: "en", t: makeTWith(EN) };

/**
 * No pinta nada: client.tsx lo carga con next/dynamic solo para que, con SSR en inglés, la página incluya la precarga de
 * este fragmento (así se descarga en paralelo con el resto del JavaScript y la hidratación no espera de más).
 */
export default function EnglishPreload(): null {
  return null;
}
