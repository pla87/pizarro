"use client";

import dynamic from "next/dynamic";
import { useContext } from "react";
import { ES_VALUE, I18nContext } from "./context";
import { intlLocale, type Locale, type T } from "./shared";

// El diccionario de inglés (~200 KB) no va en el JavaScript común: se carga como fragmento aparte solo si el idioma es
// inglés. Con SSR el servidor ya entrega el HTML en inglés y la página incluye la precarga del fragmento, así que no hay
// parpadeo de español; el fragmento se descarga en paralelo con el resto del JavaScript y la hidratación lo espera.
const EnglishProvider = dynamic(() => import("./EnglishProvider"));

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  if (locale === "en") return <EnglishProvider>{children}</EnglishProvider>;
  return <I18nContext.Provider value={ES_VALUE}>{children}</I18nContext.Provider>;
}

/** Descarga ya el diccionario de inglés (p. ej. antes de cambiar el idioma a inglés, para que el cambio sea inmediato). */
export function preloadEnglish(): Promise<unknown> {
  return import("./EnglishProvider");
}

/** Traductor del usuario actual en componentes de cliente. */
export function useT(): T {
  return useContext(I18nContext).t;
}

/** Idioma de la interfaz (es / en), p. ej. para localizeGeneralKind. */
export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

/** Locale de Intl (es-ES / en-GB) para formatear fechas. */
export function useIntlLocale(): string {
  return intlLocale(useContext(I18nContext).locale);
}
