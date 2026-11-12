"use client";

import dynamic from "next/dynamic";
import { use, useContext } from "react";
import { ES_VALUE, I18nContext, type I18nValue } from "./context";
import { intlLocale, type Locale, type T } from "./shared";

// El diccionario de inglés (~200 KB) no va en el JavaScript común: se carga como fragmento aparte solo si el idioma es
// inglés. Con SSR el servidor ya entrega el HTML en inglés y la página incluye la precarga del fragmento, así que no hay
// parpadeo de español; el fragmento se descarga en paralelo con el resto del JavaScript y la hidratación lo espera.
let english: I18nValue | null = null;
let englishLoad: Promise<I18nValue> | null = null;

function loadEnglish(): Promise<I18nValue> {
  englishLoad ??= import("./EnglishProvider").then(
    (m) => (english = m.EN_VALUE),
    (err) => {
      englishLoad = null; // sin red: el siguiente intento lo vuelve a pedir
      throw err;
    },
  );
  return englishLoad;
}

// Mismo fragmento que loadEnglish(): pintado (no pinta nada) solo para que el HTML del servidor lleve su precarga.
const EnglishPreload = dynamic(() => import("./EnglishProvider"));

/**
 * Proveedor del idioma. Pinta SIEMPRE el mismo árbol (el mismo Provider, solo cambia `value`): cambiar de idioma no
 * desmonta nada por debajo. Antes, español e inglés eran componentes distintos y React desmontaba la página entera
 * (el asistente /setup volvía al paso 1 y perdía lo escrito; «Mi perfil» perdía lo que no estuviera guardado).
 * La primera vez en inglés espera al diccionario con use(): en una transición (router.refresh, startTransition) se
 * sigue viendo lo anterior mientras llega; en la hidratación se queda el HTML del servidor.
 */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = locale === "en" ? (english ?? use(loadEnglish())) : ES_VALUE;
  return (
    <I18nContext.Provider value={value}>
      {locale === "en" && <EnglishPreload />}
      {children}
    </I18nContext.Provider>
  );
}

/** Descarga ya el diccionario de inglés (p. ej. antes de cambiar el idioma a inglés, para que el cambio sea inmediato). */
export function preloadEnglish(): Promise<unknown> {
  return loadEnglish();
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
