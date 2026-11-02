"use client";

// Único módulo de cliente que importa el diccionario de inglés: webpack lo deja en un fragmento propio que solo se
// descarga cuando el idioma es inglés (ver client.tsx). No importar este fichero desde ningún otro sitio.
import { I18nContext, type I18nValue } from "./context";
import { EN } from "./en";
import { makeTWith } from "./shared";

const EN_VALUE: I18nValue = { locale: "en", t: makeTWith(EN) };

export default function EnglishProvider({ children }: { children: React.ReactNode }) {
  return <I18nContext.Provider value={EN_VALUE}>{children}</I18nContext.Provider>;
}
